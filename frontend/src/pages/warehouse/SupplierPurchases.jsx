import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { warehouseService } from "../../api/warehouse";
import { webDateTime } from "../../utils/webTime";
import "../settings/clients/clientDebts.css";
import "./supplierPurchases.css";

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} UZS`;

// «2026-11-18» → «18-11-2026» (как в журнале приходов)
export function formatPurchaseDate(raw) {
  const text = String(raw || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return text || "—";
}

// Дата регистрации: бэкенд хранит «дд.мм.гггг / чч:мм» по UTC (или ISO-время), показываем по времени заведения.
export function formatPurchaseRegistered(raw) {
  const text = String(raw || "").trim();
  if (!text) return "—";
  let date = null;
  const bare = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s*\/\s*(\d{2}):(\d{2})/);
  if (bare) {
    date = new Date(Date.UTC(Number(bare[3]), Number(bare[2]) - 1, Number(bare[1]), Number(bare[4]), Number(bare[5])));
  } else if (text.includes("T")) {
    const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
    const parsed = new Date(zoned);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return text;
  return webDateTime(date);
}

const qtyText = (value) => {
  const number = Number(value) || 0;
  return number.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
};
const unitText = (unit) => {
  const text = String(unit || "").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
};

// Состав одного прихода: категория, название, тип, цена, количество, сумма — как в журнале приходов.
function PurchaseComposition({ state }) {
  if (state.loading) return <p role="status">Загрузка состава…</p>;
  if (state.error) return <p role="alert">Не удалось загрузить состав прихода.</p>;
  const lines = state.lines;
  if (!lines.length) return <p>В этом приходе нет позиций.</p>;
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  return <div className="supplier-purchases__composition client-debt-frame">
    <table className="report-table owner-report-table supplier-purchases__table supplier-purchases__lines" aria-label="Состав прихода">
      <thead><tr><th>Категория</th><th>Названия</th><th>Тип</th><th>Цена</th><th>Кол-во</th><th>Итоговая сумма</th></tr></thead>
      <tbody>
        {lines.map((line) => <tr key={line.key}>
          <td className="supplier-purchases__category">{line.category}</td>
          <td className="supplier-purchases__name">{line.name}</td>
          <td className="supplier-purchases__type">{line.type}</td>
          <td className="supplier-purchases__strong">{money(line.price)}</td>
          <td className="supplier-purchases__strong">{qtyText(line.quantity)} {unitText(line.unit)}</td>
          <td>{money(line.total)}</td>
        </tr>)}
      </tbody>
      <tfoot><tr><td>Итого</td><td /><td /><td /><td /><td>{money(total)}</td></tr></tfoot>
    </table>
  </div>;
}

// Отдельное окно с составом прихода (как окно «Рецепты»): шапка с реквизитами, ниже таблица состава.
export function PurchaseDialog({ title, facts, state, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  return createPortal(
    <div className="purchase-view">
      <div className="purchase-view__backdrop" onClick={onClose} />
      <div className="purchase-view__card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="purchase-view__head">
          <div className="purchase-view__facts">
            {facts.map((fact) => <div key={fact.label} className="purchase-view__fact">
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>)}
          </div>
          <button type="button" ref={closeRef} className="purchase-view__close" onClick={onClose} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={18} />
          </button>
        </header>
        <div className="purchase-view__body">
          <PurchaseComposition state={state} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Окно с составом прихода: view(item, номер) открывает, dialog — готовый элемент для вставки в страницу.
export function usePurchaseViewer(supplier) {
  // Открытый приход (в отдельном окне): { id, number, item, loading, error, lines }.
  const [viewing, setViewing] = useState(null);
  const ingredientsRef = useRef(null);

  const view = useCallback(async (item, number) => {
    const base = { id: item.id, number, item };
    setViewing({ ...base, loading: true, error: false, lines: [] });
    try {
      if (!ingredientsRef.current) {
        const response = await warehouseService.listIngredients().catch(() => ({ data: [] }));
        const list = Array.isArray(response?.data) ? response.data : response?.data?.items || [];
        ingredientsRef.current = new Map(list.map((entry) => [String(entry.id), entry]));
      }
      const { data } = await warehouseService.getPurchase(item.id);
      const lines = (Array.isArray(data?.items) ? data.items : []).map((line, index) => {
        const ingredient = line.ingredient_id ? ingredientsRef.current.get(String(line.ingredient_id)) : null;
        const price = Number(line.cost_price) || 0;
        const quantity = Number(line.quantity) || 0;
        return {
          key: String(line.id || index),
          category: ingredient?.category || "Без категории",
          name: line.name || "—",
          type: line.product_id || !line.ingredient_id ? "Товар" : "Продукт",
          price,
          quantity,
          unit: line.unit,
          total: line.total != null ? Number(line.total) || 0 : price * quantity,
        };
      });
      setViewing((current) => (current?.id === item.id ? { ...current, loading: false, lines } : current));
    } catch {
      setViewing((current) => (current?.id === item.id ? { ...current, loading: false, error: true } : current));
    }
  }, []);
  const closeView = useCallback(() => setViewing(null), []);

  const dialog = viewing ? <PurchaseDialog
    title={`Приход № ${viewing.number}`}
    facts={[
      { label: "Приход", value: `№ ${viewing.number}` },
      { label: "Поставщик", value: viewing.item.supplier || supplier },
      { label: "На склад", value: viewing.item.warehouse_name || "—" },
      { label: "Дата поступления", value: formatPurchaseDate(viewing.item.date || String(viewing.item.created_at || "").slice(0, 10)) },
      { label: "Итоговая сумма", value: money(viewing.item.total_amount) },
    ]}
    state={viewing}
    onClose={closeView}
  /> : null;
  return { view, dialog };
}

// Приходы поставщика «на потом» (журнал приходов, отфильтрованный по поставщику).
export function useSupplierCreditPurchases(supplier, refreshKey = 0) {
  const [state, setState] = useState({ loading: true, error: false, items: [] });
  useEffect(() => {
    const request = new AbortController();
    setState((current) => ({ ...current, loading: true, error: false }));
    warehouseService.list("incoming-journal", { signal: request.signal })
      .then(({ data }) => {
        if (request.signal.aborted) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setState({ loading: false, error: false, items });
      })
      .catch(() => { if (!request.signal.aborted) setState({ loading: false, error: true, items: [] }); });
    return () => request.abort();
  }, [supplier, refreshKey]);
  const rows = useMemo(() => {
    const wanted = String(supplier || "").trim().toLowerCase();
    return state.items
      .filter((item) => item?.payment_mode === "credit" && String(item.supplier || "").trim().toLowerCase() === wanted)
      .sort((a, b) => Number(b.number || 0) - Number(a.number || 0));
  }, [state.items, supplier]);
  return { rows, loading: state.loading, error: state.error };
}

// Приходы поставщика «на потом» — из них складывается долг перед ним (раздел «Кредиторы»).
// Таблица как в журнале приходов, только без колонки «Поставщик».
export default function SupplierPurchases({ supplier }) {
  const { rows, loading, error } = useSupplierCreditPurchases(supplier);
  const { view, dialog } = usePurchaseViewer(supplier);

  if (loading) return <p role="status">Загрузка приходов…</p>;
  if (error) return <p role="alert">Не удалось загрузить приходы поставщика.</p>;
  return <section className="supplier-purchases" aria-label={`Приходы «на потом»: ${supplier}`}>
    <div className="orders-report-page owner-report-view">
      <div className="report-table-wrapper owner-report-table-scroll client-debt-frame">
        <table className="report-table owner-report-table supplier-purchases__table" aria-label="Приходы поставщика на потом">
          <thead><tr><th>№</th><th>На склад</th><th>Дата поступления</th><th>Дата регистрации</th><th>Итоговая сумма</th></tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={5}>Приходов «на потом» у этого поставщика нет</td></tr> : null}
            {rows.map((item, index) => <tr key={item.id} className="supplier-purchases__row" role="button" tabIndex={0}
              aria-label={`Состав прихода ${index + 1}`}
              onClick={() => view(item, index + 1)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); view(item, index + 1); }
              }}>
              <td>{index + 1}</td>
              <td>{item.warehouse_name || "—"}</td>
              <td>{formatPurchaseDate(item.date || String(item.created_at || "").slice(0, 10))}</td>
              <td>{formatPurchaseRegistered(item.registered_at || item.created_at)}</td>
              <td className="supplier-purchases__sum">{money(item.total_amount)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
    {dialog}
  </section>;
}
