// Стоп-лист V3.5: накопительные пополнения + управление лимитами.
// Колонки строго: № / ФОТО / БЛЮДО / ТОВАР / ОСТАТОК / ПРЕДЫДУЩИЙ ЛИМИТ /
// НОВЫЙ ЛИМИТ / ДЕЙСТВИЯ. Селектора единицы НЕТ (read-only метка).
// V3.5 coordinated timeline (один связный сценарий, без разрывов):
//   commit (кнопка loading) → chips летят 300ms → своп из POST-ответа +
//   slide истории 280ms с перехлёстом → settle → тихий reconcile фоном.
// Никакого refetch-разрыва посередине: финальные числа уже каноничны
// (POST-ответ backend), reconcile лишь подтверждает. Источник итогов —
// всегда backend, never optimistic fake. conncurrent same-row сейвы
// блокирует mutation-замок; unmount чистит все таймеры/чипы.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import StopListManageModal from "./StopListManageModal";
import { applyLiveMask, formatQuantity, parseQuantityInput } from "./stopListFormat";
import { historyView } from "./stopListHistory";
import { t as tr } from "../../i18n/t";

const FLY_MS = 300;
const SLIDE_MS = 300;

function reducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function StopListPhoto({ row }) {
  if (row.photo) {
    return <img className="stoplist-photo" src={row.photo} alt={row.name} />;
  }
  return (
    <span className="stoplist-photo-placeholder" aria-hidden="true">
      <Icon name="bi-image" />
    </span>
  );
}

// Устоявшийся рендер ячейки истории: только числа/скобки/"—", без подписей.
// Пустое окно (включая состояние после сброса истории) — дефис без единицы.
function HistoryView({ view }) {
  if (view.kind === "pair") {
    const [first, second] = view.pair;
    if (view.pair.length === 1) {
      return <span className="stoplist-hist-new">{formatQuantity(first)}</span>;
    }
    return (
      <span className="stoplist-hist-pair">
        <span className="stoplist-hist-old">({formatQuantity(first)})</span>
        <span className="stoplist-hist-new">{formatQuantity(second)}</span>
      </span>
    );
  }
  return <span className="stoplist-hist-empty">—</span>;
}

// Скользящее окно: старый слой уходит влево с fade, новый въезжает справа.
// Высота строки и ширина колонки фиксированы (scoped clipping, nowrap).
function HistoryCell({ view, slide }) {
  if (!slide) return <HistoryView view={view} />;
  return (
    <span className="stoplist-hist-stage" key={slide.key}>
      <span className="stoplist-hist-layer is-exit" aria-hidden="true">
        <HistoryView view={slide.from} />
      </span>
      <span className="stoplist-hist-layer is-enter">
        <HistoryView view={slide.to} />
      </span>
    </span>
  );
}

// Летящие копии введённого числа: одна — к Остатку, вторая — к истории.
// Только визуальные копии; итоговые числа — из backend response/refetch.
function FlyChips({ flights }) {
  const list = Object.values(flights || {});
  if (list.length === 0) return null;
  return createPortal(
    <>
      {list.flatMap((fly) => {
        const dx = (to) => (to ? to.x + to.w / 2 - (fly.from.x + fly.from.w / 2) : 0);
        const dy = (to) => (to ? to.y + to.h / 2 - (fly.from.y + fly.from.h / 2) : 0);
        return [
          fly.stock ? (
            <span
              key={`${fly.key}-stock`}
              className="stoplist-fly-chip"
              aria-hidden="true"
              style={{
                left: fly.from.x,
                top: fly.from.y,
                width: fly.from.w,
                height: fly.from.h,
                ["--dx"]: `${dx(fly.stock)}px`,
                ["--dy"]: `${dy(fly.stock)}px`,
              }}
            >
              {fly.text}
            </span>
          ) : null,
          fly.hist ? (
            <span
              key={`${fly.key}-hist`}
              className="stoplist-fly-chip"
              aria-hidden="true"
              style={{
                left: fly.from.x,
                top: fly.from.y,
                width: fly.from.w,
                height: fly.from.h,
                ["--dx"]: `${dx(fly.hist)}px`,
                ["--dy"]: `${dy(fly.hist)}px`,
              }}
            >
              {fly.text}
            </span>
          ) : null,
        ];
      })}
    </>,
    document.body,
  );
}

function rowView(row) {
  return historyView(row.recentTopups, { allowance: row.allowance, resetSeq: row.historyResetSeq });
}

export default function StopListTable({
  rows,
  newLimits,
  setNewLimit,
  isDirty,
  commitTopup,
  applyServerRow,
  clearDraft,
  reconcile,
  zeroAllowance,
  resetHistory,
  savingId,
}) {
  const isEmpty = rows.length === 0;
  const wrapRef = useRef(null);
  const timers = useRef([]);
  // Полёты по строкам (карта id → полёт): дубей не бывает (замок),
  // скролл гасит чипы без потери данных (своп уже применён/применится).
  const [flights, setFlights] = useState({});
  // Slide-анимации по строкам (карта id → {from, to, key}).
  const [slides, setSlides] = useState({});
  // Модалка управления лимитами: id строки или null.
  const [manageId, setManageId] = useState(null);

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t));
  }, []);

  const later = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    timers.current.push(t);
  });

  const clearFlight = (id) => {
    setFlights((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const clearSlide = (id) => {
    setSlides((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  // Скролл во время полёта: чипы гасим (иначе оторвутся от ячеек),
  // timeline идёт дальше — данные уже каноничны, слайд в потоке.
  const handleScroll = () => {
    setFlights({});
  };

  async function handleSave(row) {
    const id = String(row.id);
    const draft = String(newLimits[id] ?? "");
    const parsed = parseQuantityInput(draft);
    // Замеряем ДО запроса: поле ещё заполнено, ячейки показывают старое.
    // Координаты viewport-ные (fixed-чипы), скролл им не страшен до старта.
    const root = wrapRef.current;
    const rectOf = (sel) => root
      ?.querySelector(`[data-fly="${id}:${sel}"]`)
      ?.getBoundingClientRect();
    const fromRect = rectOf("input");
    const stockRect = rectOf("stock");
    const histRect = rectOf("hist");
    const before = rowView(row);
    const res = await commitTopup(id);
    if (!res.ok) return; // Ошибка: input, остаток и история не тронуты.
    const chipText = formatQuantity(parsed.ok ? parsed.normalized : draft);
    if (reducedMotion()) {
      applyServerRow(res.product);
      void reconcile();
      return;
    }
    // Фаза 1: чипы летят 300ms; остаток и история пока старые (без вранья —
    // финальные числа уже в ответе, своп — сразу после приземления).
    if (fromRect && (stockRect || histRect)) {
      const rect = (r) => (r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null);
      setFlights((current) => ({
        ...current,
        [id]: {
          key: Date.now(), text: chipText, from: rect(fromRect),
          stock: rect(stockRect), hist: rect(histRect),
        },
      }));
      await later(FLY_MS);
      clearFlight(id);
    }
    // Фаза 2: своп из POST-ответа + slide истории с перехлёстом.
    const mapped = applyServerRow(res.product);
    if (mapped) {
      const to = rowView(mapped);
      setSlides((current) => ({ ...current, [id]: { from: before, to, key: Date.now() } }));
      await later(SLIDE_MS);
      clearSlide(id);
    }
    // Фоновая сверка: визуально ничего не меняет (или честно правит).
    void reconcile();
  }

  const manageRow = manageId ? rows.find((row) => String(row.id) === String(manageId)) || null : null;

  return (
    <div ref={wrapRef} className={`settings-table-wrapper stoplist-grid-wrap${isEmpty ? " is-empty" : ""}`}>
      <div
        className="stoplist-grid-scroll"
        role="region"
        aria-label={tr("pages.nomenclature.stoplisttable.tablitsa_stop_lista_s_prokrutkoy")}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <table className="settings-table stoplist-grid-table" aria-label={tr("pages.nomenclature.stoplisttable.stop_list")}>
          <thead>
            <tr>
              <th className="stoplist-col-index">№</th>
              <th className="stoplist-col-photo">{tr("pages.nomenclature.stoplisttable.foto")}</th>
              <th className="stoplist-col-name">{tr("pages.nomenclature.stoplisttable.blyudo_tovar")}</th>
              <th className="stoplist-col-stock">{tr("pages.nomenclature.stoplisttable.ostatok")}</th>
              <th className="stoplist-col-prev">{tr("pages.nomenclature.stoplisttable.predyduschiy_limit")}</th>
              <th className="stoplist-col-new">{tr("pages.nomenclature.stoplisttable.novyy_limit")}</th>
              <th className="stoplist-col-actions">{tr("pages.nomenclature.stoplisttable.deystviya")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const id = String(row.id);
              const draft = String(newLimits[id] ?? "");
              const dirty = isDirty(row);
              const saving = String(savingId) === id;
              const slide = slides[id] || null;
              const saveReady = dirty && !saving;
              const saveTitle = saving ? "Сохранение..." : (dirty ? "Добавить лимит" : "Нет изменений");
              const handleLimitChange = (event) => {
                const el = event.target;
                const next = applyLiveMask(el.value, el.selectionStart ?? el.value.length);
                setNewLimit(id, next.text);
                const pos = next.caret;
                const restore = () => {
                  try {
                    el.setSelectionRange(pos, pos);
                  } catch {
                    // Не-DOM окружение: позицию не восстановить, значение цело.
                  }
                };
                if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
                else restore();
              };
              return (
                <tr key={row.id}>
                  <td className="stoplist-col-index stoplist-index-cell">{index + 1}</td>
                  <td className="stoplist-col-photo">
                    <StopListPhoto row={row} />
                  </td>
                  <td className="stoplist-col-name">
                    <span className="stoplist-name-text" title={row.name}>{row.name}</span>
                  </td>
                  <td className="stoplist-col-stock" data-fly={`${id}:stock`}>
                    <span
                      className="stoplist-stock-text"
                      title={row.remainderHint || undefined}
                    >
                      {row.remainderText}
                    </span>
                  </td>
                  <td className="stoplist-col-prev" data-fly={`${id}:hist`}>
                    <HistoryCell view={rowView(row)} slide={slide} />
                  </td>
                  <td className="stoplist-col-new">
                    <span className="stoplist-new-field" data-fly={`${id}:input`}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="stoplist-limit-input"
                        value={draft}
                        disabled={saving}
                        aria-label={`Новый лимит для ${row.name}`}
                        onChange={handleLimitChange}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && dirty && !saving) {
                            event.preventDefault();
                            handleSave(row);
                          }
                        }}
                      />
                      {row.unitLabel ? (
                        <span className="stoplist-unit-text">{row.unitLabel}</span>
                      ) : (
                        <span className="stoplist-unit-placeholder">{tr("pages.nomenclature.stoplisttable.ed_izm")}</span>
                      )}
                    </span>
                  </td>
                  <td className="stoplist-col-actions">
                    <div className="stoplist-row-actions">
                      <button
                        type="button"
                        className={`stoplist-save-action${saveReady ? " is-ready" : ""}`}
                        disabled={!saveReady}
                        onClick={() => handleSave(row)}
                        aria-label={saveReady ? `Добавить лимит для ${row.name}` : `Нет изменений для ${row.name}`}
                        title={saveTitle}
                      >
                        {saving ? (
                          <span className="stoplist-spinner" aria-hidden="true" />
                        ) : (
                          <Icon name="bi-check2" size={18} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="stoplist-manage-action"
                        disabled={saving}
                        onClick={() => setManageId(id)}
                        aria-label={`Управление лимитами: ${row.name}`}
                        title={tr("pages.nomenclature.stoplisttable.upravlenie_limitami")}
                      >
                        <Icon name="bi-arrow-counterclockwise" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isEmpty ? (
        <div className="stoplist-empty-overlay">
          <ReportEmptyState title={tr("pages.nomenclature.stoplisttable.blyud_i_tovarov_poka_net")} />
        </div>
      ) : null}
      <FlyChips flights={flights} />
      {manageRow ? (
        <StopListManageModal
          row={manageRow}
          onClose={() => setManageId(null)}
          onZeroRemainder={zeroAllowance}
          onResetHistory={resetHistory}
          savingId={savingId}
        />
      ) : null}
    </div>
  );
}
