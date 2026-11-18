// «QR-меню» в Настройках: общий QR заведения и отдельный QR на каждый стол.
// QR рисуется в браузере из ссылки — ничего не хранится и внешних сервисов нет.
// Ссылка на стол содержит подписанный токен (см. backend qrmenu/service.py):
// гость видит меню и счёт ТОЛЬКО своего стола.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchQrTables } from "../../../api/qrMenu";
import { settingsService } from "../../../api/settings";
import Icon from "../../../components/Icon";
import { useOrg } from "../../../context/OrgContext";
import { modernQrSvg, qrPngDataUrl, qrSvgFileUrl, svgToDataUrl } from "./qrModern";
import "./qrMenuSection.css";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
));

function download(dataUrl, name) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Фото заведения: логотип компании (его же видят гости в меню и он печатается на чеке);
// нет фото или не загрузилось — буква на цветной плитке.
function BrandLogo({ src, name }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className="qr-brand__logo" src={src} alt="" onError={() => setBroken(true)} />;
  }
  return <span className="qr-brand__logo qr-brand__logo--letter" aria-hidden="true">{String(name || "?").trim().charAt(0).toUpperCase()}</span>;
}

const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

const failText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
};

// Название и фото заведения меняются прямо здесь: это название и логотип компании.
function BrandCard({ org, fallbackName, tablesCount, update, reload }) {
  const name = org?.name && org.name !== "MARJON" ? org.name : fallbackName;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const fileRef = useRef(null);

  const startEdit = () => { setDraft(name || ""); setProblem(""); setEditing(true); };

  const saveName = async (event) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) { setProblem("Название не может быть пустым."); return; }
    if (next.length > 255) { setProblem("Название слишком длинное (не больше 255 символов)."); return; }
    if (next === name) { setEditing(false); return; }
    setBusy("name"); setProblem("");
    try {
      await update({ name: next });
      setEditing(false);
    } catch (err) {
      setProblem(failText(err, "Не удалось сохранить название. Попробуйте ещё раз."));
    } finally { setBusy(""); }
  };

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setProblem("Подходят только фото в форматах JPG, PNG или WebP."); return; }
    if (file.size > LOGO_MAX_BYTES) { setProblem("Фото должно быть не больше 5 МБ."); return; }
    setBusy("photo"); setProblem("");
    try {
      await settingsService.uploadCompanyLogo(file);
      await reload();
    } catch (err) {
      setProblem(failText(err, "Не удалось загрузить фото. Попробуйте ещё раз."));
    } finally { setBusy(""); }
  };

  return (
    <section className="qr-brand">
      <div className="qr-brand__photo">
        <BrandLogo key={org?.logo || "none"} src={org?.logo} name={name} />
        <button
          type="button"
          className="qr-brand__camera"
          onClick={() => fileRef.current?.click()}
          disabled={busy === "photo"}
          aria-label="Сменить фото заведения"
          title="Сменить фото"
        >
          {busy === "photo" ? <span className="qr-card__wait" /> : <Icon name="bi-camera" size={16} />}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} aria-label="Файл фото заведения" />
      </div>
      <div className="qr-brand__text">
        {editing ? (
          <form className="qr-brand__form" onSubmit={saveName}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={255}
              autoFocus
              aria-label="Название заведения"
              disabled={busy === "name"}
            />
            <button type="submit" className="qr-brand__save" disabled={busy === "name"}>{busy === "name" ? "Сохраняю…" : "Сохранить"}</button>
            <button type="button" className="qr-brand__cancel" onClick={() => setEditing(false)} disabled={busy === "name"}>Отмена</button>
          </form>
        ) : (
          <h2>
            {name}
            <button type="button" className="qr-brand__pencil" onClick={startEdit} aria-label="Изменить название заведения" title="Изменить название">
              <Icon name="bi-pencil" size={15} />
            </button>
          </h2>
        )}
        <p>Название и фото видят гости в меню · Столов с QR: {tablesCount}</p>
        {problem ? <p className="qr-brand__problem" role="alert">{problem}</p> : null}
      </div>
    </section>
  );
}

// Ссылки для QR. В сам QR кладём короткий адрес ЗАГЛАВНЫМИ буквами: такой текст QR кодирует
// «буквенно-цифровым» режимом, сетка выходит примерно 29×29 вместо 53×53 — модули крупнее,
// как на фирменном референсе. Человеку показываем и копируем тот же адрес строчными.
export function buildQrLinks(data, root) {
  const qrRoot = root.toUpperCase();
  const menu = {
    key: "menu", title: "Меню заведения", subtitle: "Без привязки к столу",
    url: `${root}/m/${data.slug}`, qr: `${qrRoot}/M/${String(data.slug).toUpperCase()}`,
  };
  const tables = data.tables.map((table) => {
    const where = [table.branch, table.hall].filter(Boolean).join(" · ");
    const short = table.short_code;
    return {
      key: table.table_id,
      title: `Стол ${table.number}`,
      subtitle: where,
      group: where || "Столы",
      url: short ? `${root}/t/${short.toLowerCase()}` : `${root}/m/${data.slug}/${table.token}`,
      qr: short ? `${qrRoot}/T/${short}` : `${root}/m/${data.slug}/${table.token}`,
    };
  });
  return [menu, ...tables];
}

export default function QrMenuSection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const { org, update, reload } = useOrg();

  useEffect(() => {
    let alive = true;
    fetchQrTables()
      .then((result) => { if (alive) setData(result); })
      .catch(() => { if (alive) setError("Не удалось загрузить столы. Обновите страницу."); });
    return () => { alive = false; };
  }, []);

  // QR всегда ведут на тот адрес, с которого открыта админка (рабочий адрес сайта).
  const root = window.location.origin;
  const links = useMemo(() => (data ? buildQrLinks(data, root) : []), [data, root]);

  // Современный QR с логотипом Marjon в центре — векторный, рисуется прямо в браузере.
  const images = useMemo(
    () => Object.fromEntries(links.map((link) => [link.key, svgToDataUrl(modernQrSvg(link.qr))])),
    [links],
  );

  const copy = useCallback(async (link) => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      window.prompt("Скопируйте ссылку", link.url);
    }
  }, []);

  // На печатных листах — актуальное название (его можно сменить в карточке выше).
  const printName = org?.name && org.name !== "MARJON" ? org.name : data?.company_name;
  // Печать: карточки с современным QR; лист откроется в новой вкладке и сам вызовет печать.
  const printCards = useCallback((items) => {
    if (!items.length) return;
    const cards = items.map((item) => {
      const isTable = item.key !== "menu";
      return `<section class="card">
        <h2>${escapeHtml(printName)}</h2>
        ${modernQrSvg(item.qr, { sizePx: 600 })}
        <b>${escapeHtml(isTable ? item.title : "Меню")}</b>
        <p>${isTable ? "Наведите камеру телефона: меню и ваш счёт" : "Наведите камеру телефона, чтобы открыть меню"}</p>
      </section>`;
    });
    const win = window.open("", "_blank");
    if (!win) {
      setError("Браузер заблокировал окно печати. Разрешите всплывающие окна для этого сайта.");
      return;
    }
    win.document.write(`<!doctype html><meta charset="utf-8"><title>QR-меню</title>
      <style>
        @page { size: A4; margin: 10mm }
        body { margin: 0; font-family: Arial, sans-serif; color: #0a2a4f; -webkit-print-color-adjust: exact; print-color-adjust: exact }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm }
        .card { border: .3mm solid #cfe3e1; border-radius: 6mm; padding: 7mm 6mm 6mm; text-align: center; break-inside: avoid; page-break-inside: avoid }
        .card h2 { margin: 0 0 4mm; font-size: 15pt; font-weight: 700 }
        .card svg { width: 64mm; height: 64mm; display: block; margin: 0 auto }
        .card b { display: block; font-size: 24pt; margin: 3mm 0 1mm; color: #0a7a72 }
        .card p { margin: 0; font-size: 10.5pt; color: #4a5f73 }
      </style><div class="grid">${cards.join("")}</div>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }, [printName]);

  if (error && !data) return <p className="company-profile-field-hint" role="alert">{error}</p>;
  if (!data) return <p className="company-profile-loading">Загрузка…</p>;

  const [menuLink, ...tableLinks] = links;
  const groups = tableLinks.reduce((acc, link) => {
    (acc[link.group] ||= []).push(link);
    return acc;
  }, {});

  const downloadPng = (link) => {
    qrPngDataUrl(link.qr, 2048)
      .then((dataUrl) => download(dataUrl, `qr-${link.title.replace(/\s+/g, "-")}.png`))
      .catch(() => setError("Не удалось подготовить PNG. Попробуйте ещё раз."));
  };

  const Card = ({ link, big = false }) => (
    <article className={`qr-card${big ? " qr-card--big" : ""}`}>
      <div className="qr-card__img">
        {images[link.key] ? <img src={images[link.key]} alt={`QR: ${link.title}`} /> : <span className="qr-card__wait" />}
      </div>
      <div className="qr-card__meta">
        <b>{link.title}</b>
        {link.subtitle ? <span>{link.subtitle}</span> : null}
      </div>
      <div className="qr-card__actions">
        <button type="button" onClick={() => downloadPng(link)}>
          <Icon name="bi-download" size={15} /> PNG
        </button>
        <button type="button" onClick={() => download(qrSvgFileUrl(link.qr), `qr-${link.title.replace(/\s+/g, "-")}.svg`)}>
          <Icon name="bi-download" size={15} /> SVG
        </button>
        <button type="button" onClick={() => copy(link)}>
          <Icon name="bi-copy" size={15} /> {copied === link.key ? "Скопировано" : "Ссылка"}
        </button>
        <button type="button" onClick={() => printCards([link])}>
          <Icon name="bi-printer" size={15} /> Печать
        </button>
        <a href={link.url} target="_blank" rel="noreferrer">Открыть</a>
      </div>
    </article>
  );

  return (
    <div className="company-profile-main qr-menu">
      {error ? <p className="company-profile-field-hint" role="alert">{error}</p> : null}
      <BrandCard org={org} fallbackName={data.company_name} tablesCount={tableLinks.length} update={update} reload={reload} />
      <section className="qr-menu__block">
        <Card link={menuLink} big />
      </section>

      <section className="qr-menu__block">
        <header className="qr-menu__head">
          <h2>QR на столы</h2>
          {tableLinks.length ? (
            <button type="button" className="qr-menu__printall" onClick={() => printCards(tableLinks)}>
              <Icon name="bi-printer" size={16} /> Печать всех ({tableLinks.length})
            </button>
          ) : null}
        </header>
        <p className="company-profile-field-hint">
          Гость сканирует QR на своём столе и видит меню, а если для стола открыт заказ — блюда и общий счёт.
        </p>
        {tableLinks.length === 0 ? <p className="company-profile-field-hint">Столов пока нет. Добавьте их в разделе «Место».</p> : null}
        {Object.entries(groups).map(([group, items]) => (
          <div className="qr-menu__group" key={group}>
            <h3>{group}</h3>
            <div className="qr-menu__grid">
              {items.map((link) => <Card key={link.key} link={link} />)}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
