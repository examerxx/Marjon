import { useCallback, useEffect, useRef, useState } from "react";

import { adminFinanceApi } from "./financeApi";

import { hqService } from "./hqService";

import Icon from '../components/Icon';

import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

import { getAdminFinanceLoadMessage, keepWheelInsideScroller } from "./AdminShared";

import { extractAdminFinanceItems, useDefaultAdminFinanceOrganizationId } from "./AdminFinanceOperations";

export function AdminFinanceHistoryPage({ search, onNotify }) {
  const { organizationId, loadState: organizationLoadState } = useDefaultAdminFinanceOrganizationId(onNotify);
  const [rows, setRows] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [page, setPage] = useState(1);
  const historyScrollRef = useRef(null);
  const [historyScroll, setHistoryScroll] = useState({
    max: 0,
    thumbPercent: 100,
    leftPercent: 0,
  });
  const pageSize = 15;
  const query = search.trim().toLowerCase();
  const beginRequest = useLatestRequest();

  const updateHistoryScroll = useCallback(() => {
    const scroller = historyScrollRef.current;
    if (!scroller) return;

    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const thumbPercent = max
      ? Math.max(14, Math.min(100, (scroller.clientWidth / scroller.scrollWidth) * 100))
      : 100;
    const leftPercent = max ? (scroller.scrollLeft / max) * (100 - thumbPercent) : 0;

    setHistoryScroll((current) => {
      const next = {
        max: Math.round(max),
        thumbPercent: Number(thumbPercent.toFixed(3)),
        leftPercent: Number(leftPercent.toFixed(3)),
      };

      return current.max === next.max
        && current.thumbPercent === next.thumbPercent
        && current.leftPercent === next.leftPercent
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
    const request = beginRequest();
    if (!organizationId) return;
    setLoadState("loading");
    adminFinanceApi.listFinanceHistory(organizationId, { size: 200 }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = extractAdminFinanceItems(data);
        if (!items.length) setRows([]);
        if (items.length) {
          setRows(items.map((r, i) => ({
            id: r.id || `fh-${i}`,
            number: i + 1,
            recordId: r.record_id || r.id || "",
            date: r.date || r.created_at || "",
            companyId: r.company_id || "",
            organization: r.organization_name || r.organization || "",
            newAmount: r.new_amount || "",
            oldAmount: r.old_amount || "",
            type: r.type || "",
            user: r.user_name || r.user || "",
            comment: r.comment || "",
          })));
        }
        setLoadState(items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (!request.isCurrent() || isAbortError(error)) return;
        setRows([]);
        setLoadState("error");
        onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, onNotify, organizationId]);

  const filteredRows = rows.filter((row) => (
    !query || [
      row.recordId,
      row.date,
      row.companyId,
      row.organization,
      row.newAmount,
      row.oldAmount,
      row.type,
      row.user,
      row.comment,
    ].some((value) => String(value).toLowerCase().includes(query))
  ));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    updateHistoryScroll();
    window.addEventListener("resize", updateHistoryScroll);
    return () => window.removeEventListener("resize", updateHistoryScroll);
  }, [pageRows.length, updateHistoryScroll]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function goToPage(nextPage) {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(safePage);
  }

  function scrollHistoryBy(direction) {
    const scroller = historyScrollRef.current;
    if (!scroller) return;
    scroller.scrollBy({
      left: direction * Math.max(160, scroller.clientWidth * 0.44),
      behavior: "smooth",
    });
  }

  function handleHistoryScrollbarPointerDown(event) {
    const scroller = historyScrollRef.current;
    if (!scroller || historyScroll.max <= 0) return;

    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const thumbWidth = Math.max(24, rect.width * (historyScroll.thumbPercent / 100));
    const maxThumbLeft = Math.max(1, rect.width - thumbWidth);
    const currentThumbLeft = (scroller.scrollLeft / historyScroll.max) * maxThumbLeft;
    const target = event.target;
    const isThumb = target instanceof Element && target.closest(".admin-history-scrollbar__thumb");
    const dragOffset = isThumb
      ? event.clientX - rect.left - currentThumbLeft
      : thumbWidth / 2;

    function setScrollFromClientX(clientX) {
      const nextThumbLeft = Math.min(
        Math.max(clientX - rect.left - dragOffset, 0),
        maxThumbLeft,
      );
      scroller.scrollLeft = (nextThumbLeft / maxThumbLeft) * historyScroll.max;
    }

    setScrollFromClientX(event.clientX);

    function handlePointerMove(moveEvent) {
      setScrollFromClientX(moveEvent.clientX);
    }

    function handlePointerUp() {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    event.preventDefault();
  }

  return (
    <section className="admin-income-page admin-history-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>История изменений</h2>
            <p>{filteredRows.length} записей журнала.</p>
          </div>
        </div>
      </div>

      <div
        className="admin-history-table-wrap"
        ref={historyScrollRef}
        onScroll={updateHistoryScroll}
        onWheelCapture={keepWheelInsideScroller}
      >
        <table className="admin-history-table" id="admin-history-table">
          <thead>
            <tr>
              <th>№</th>
              <th>ID</th>
              <th>Дата</th>
              <th>Компания ID</th>
              <th>Организация</th>
              <th>Новая сумма</th>
              <th>Старая сумма</th>
              <th>Тип</th>
              <th>Пользователь</th>
              <th>Комментарии</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id}>
                <td>{row.number}</td>
                <td>{row.recordId}</td>
                <td>{row.date}</td>
                <td>{row.companyId}</td>
                <td>{row.organization}</td>
                <td>{row.newAmount}</td>
                <td>{row.oldAmount}</td>
                <td><span className="admin-history-type">{row.type}</span></td>
                <td>{row.user}</td>
                <td className="admin-history-comment">{row.comment || "—"}</td>
              </tr>
            ))}
            {loadState === "error" || organizationLoadState === "error" ? (
              <tr><td colSpan="10" className="admin-history-empty" role="alert">Не удалось загрузить историю изменений.</td></tr>
            ) : !pageRows.length ? (
              <tr>
                <td colSpan="10" className="admin-history-empty">История изменений не найдена.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="admin-history-scrollbar" aria-label="Р“РѕСЂРёР·РѕРЅС‚Р°Р»СЊРЅР°СЏ РїСЂРѕРєСЂСѓС‚РєР° С‚Р°Р±Р»РёС†С‹">
        <button
          type="button"
          className="admin-history-scrollbar__button is-prev"
          onClick={() => scrollHistoryBy(-1)}
          disabled={historyScroll.max <= 0}
          aria-label="РџСЂРѕРєСЂСѓС‚РёС‚СЊ РІР»РµРІРѕ"
        />
        <div
          className="admin-history-scrollbar__track"
          role="scrollbar"
          aria-controls="admin-history-table"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={historyScroll.max}
          aria-valuenow={historyScroll.max ? Math.round((historyScroll.leftPercent / Math.max(1, 100 - historyScroll.thumbPercent)) * historyScroll.max) : 0}
          onPointerDown={handleHistoryScrollbarPointerDown}
        >
          <span
            className="admin-history-scrollbar__thumb"
            style={{
              width: `${historyScroll.thumbPercent}%`,
              left: `${historyScroll.leftPercent}%`,
            }}
          />
        </div>
        <button
          type="button"
          className="admin-history-scrollbar__button is-next"
          onClick={() => scrollHistoryBy(1)}
          disabled={historyScroll.max <= 0}
          aria-label="РџСЂРѕРєСЂСѓС‚РёС‚СЊ РІРїСЂР°РІРѕ"
        />
      </div>

      <div className="admin-history-pager">
        <button type="button" onClick={() => goToPage(page - 1)} disabled={page === 1} aria-label="Предыдущая страница">
          <Icon name="bi-chevron-left" size={14} />
        </button>
        {[1, 2, 3].map((item) => (
          <button type="button" key={item} className={page === item ? "is-active" : ""} onClick={() => goToPage(item)}>
            {item}
          </button>
        ))}
        <span>...</span>
        <button type="button" onClick={() => onNotify?.("Доступны следующие страницы истории после загрузки с сервера.")}>23</button>
        <button type="button" onClick={() => goToPage(page + 1)} disabled={page === totalPages} aria-label="Следующая страница">
          <Icon name="bi-chevron-right" size={14} />
        </button>
      </div>
    </section>
  );
}

export function AdminCashierBackgroundPage({ search, onNotify }) {
  const [backgrounds, setBackgrounds] = useState([]);
  const [loadState, setLoadState] = useState("loading");
  const [editor, setEditor] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftSort, setDraftSort] = useState("1");
  const [draftPhoto, setDraftPhoto] = useState("");
  const fileInputRef = useRef(null);
  const query = search.trim().toLowerCase();

  useEffect(() => {
    setLoadState("loading");
    hqService.listImageBackgrounds()
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setBackgrounds(items.map((r, i) => ({
            id: r.id || `bg-${i}`,
            name: r.name || "",
            sort: r.sort_order || i + 1,
            photo: r.image_url || r.photo || "",
          })));
        setLoadState(items.length ? "success" : "empty");
      })
      .catch(() => {
        setBackgrounds([]);
        setLoadState("error");
      });
  }, []);
  const filteredBackgrounds = backgrounds
    .filter((row) => !query || row.name.toLowerCase().includes(query) || row.photo.toLowerCase().includes(query))
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));

  useEffect(() => {
    if (!editor) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") closeEditor();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  function openCreate() {
    setEditor({ mode: "create" });
    setDraftName("");
    setDraftSort(String(backgrounds.length + 1));
    setDraftPhoto("");
  }

  function openEdit(row) {
    setEditor({ mode: "edit", row });
    setDraftName(row.name);
    setDraftSort(String(row.sort || 1));
    setDraftPhoto(row.photo);
  }

  function closeEditor() {
    setEditor(null);
    setDraftName("");
    setDraftSort("1");
    setDraftPhoto("");
  }

  function chooseImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onNotify?.("Выберите файл изображения.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setDraftPhoto(reader.result);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function saveBackground(event) {
    event.preventDefault();
    onNotify?.("Сохранение фона недоступно: backend mutation contract не подключён.");
  }

  function deleteBackground(row) {
    void row;
    onNotify?.("Удаление фона недоступно: backend mutation contract не подключён.");
  }

  return (
    <section className="admin-income-page admin-cashier-bg-page">
      <div className="admin-income-head">
        <div className="admin-income-title">
          <span aria-hidden="true" />
          <div>
            <h2>Фон для кассира</h2>
            <p>{filteredBackgrounds.length} фонов для кассового экрана.</p>
          </div>
        </div>
        <button type="button" className="admin-income-add" onClick={openCreate}>
          <span>Добавить</span>
          <Icon name="bi-plus-lg" size={15} />
        </button>
      </div>

      <div className="admin-cashier-bg-table" role="table" aria-label="Фоны для кассира">
        <div className="admin-cashier-bg-row admin-cashier-bg-head" role="row">
          <span>Название</span>
          <span>Фото</span>
          <span aria-label="Действия" />
        </div>
        {filteredBackgrounds.map((row) => (
          <div className="admin-cashier-bg-row" role="row" key={row.id}>
            <strong>{row.name}</strong>
            <span className="admin-cashier-bg-preview">
              <img src={row.photo} alt={row.name} loading="lazy" />
            </span>
            <span className="admin-payment-actions">
              <button type="button" className="admin-income-icon is-edit" onClick={() => openEdit(row)} aria-label="Редактировать фон">
                <Icon name="bi-pencil" size={15} />
              </button>
              <button type="button" className="admin-income-icon is-delete" onClick={() => deleteBackground(row)} aria-label="Удалить фон">
                <Icon name="bi-trash3" size={15} />
              </button>
            </span>
          </div>
        ))}
        {loadState === "error" ? (
          <div className="admin-income-empty" role="alert">Не удалось загрузить фоны кассира.</div>
        ) : !filteredBackgrounds.length ? (
          <div className="admin-income-empty">Фоны для кассира не найдены.</div>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-income-modal" role="dialog" aria-modal="true" aria-label={editor.mode === "create" ? "Добавить фон для кассира" : "Изменить фон для кассира"} onClick={closeEditor}>
          <form className="admin-income-dialog admin-cashier-bg-dialog" onSubmit={saveBackground} onClick={(event) => event.stopPropagation()}>
            <div className="admin-income-dialog__head">
              <div>
                <h3>{editor.mode === "create" ? "Добавить Фон" : "Изменить Фон"}</h3>
              </div>
              <button type="button" className="admin-income-dialog__close" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" size={16} />
              </button>
            </div>

            <label className="admin-income-field">
              <span>Название <b>*</b></span>
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Введите название фона"
                autoFocus
              />
            </label>

            <label className="admin-income-field">
              <span>Сортировка</span>
              <input
                type="number"
                min="1"
                value={draftSort}
                onChange={(event) => setDraftSort(event.target.value)}
              />
            </label>

            <div className="admin-cashier-upload">
              <span>Загрузить изображение</span>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={chooseImage} />
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                <Icon name="bi-image" size={15} />
                <span>Выбрать изображение</span>
              </button>
            </div>

            {draftPhoto.trim() ? (
              <div className="admin-cashier-bg-dialog__preview">
                <img src={draftPhoto.trim()} alt="Предпросмотр фона" />
              </div>
            ) : null}

            <div className="admin-income-dialog__actions is-single">
              <button type="submit" className="is-primary">Сохранить</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
