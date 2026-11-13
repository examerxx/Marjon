import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { warehouseService } from "../../api/warehouse";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { t } from "../../i18n/t";

// Инвентаризация — просмотр корректировок проверки (V42): клик по строке
// таблицы открывает компактную центрированную модалку
// (Дата регистрации / Название / Корректировка). Только чтение:
// факт − остаток (> 0 излишек зелёным, < 0 недостача красным).
// Шелл — тот же dishcat-modal, что у WarehouseModal.
const INV_DETAIL_EXIT_MS = 160;

function formatNum(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

function diffTone(diff) {
  const n = Number(diff) || 0;
  if (n > 0) return "is-plus";
  if (n < 0) return "is-minus";
  return "";
}

function diffText(diff, unit) {
  const n = Number(diff) || 0;
  if (n > 0) return `+${formatNum(n)} ${unit}`;
  if (n < 0) return `−${formatNum(-n)} ${unit}`;
  return "0";
}

export default function InventoryDetailModal({ check, onClose, onSaved }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comment, setComment] = useState(check.comment && check.comment !== "—" ? check.comment : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function requestClose() {
    if (saving || closing) return;
    const reduced = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onClose();
      return;
    }
    setClosing(true);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, INV_DETAIL_EXIT_MS);
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(() => warehouseService.getInventory(check.id))
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data?.items) ? data.items : [];
        setItems(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const detail = err?.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Не удалось загрузить корректировки.");
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check.id]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      // Пустая строка — стирание комментария: бэкенд выкидывает null
      // из PATCH (exclude_none), поэтому шлём "" (показ даст "—").
      const trimmed = String(comment || "").trim();
      await warehouseService.updateInventory(check.id, { comment: trimmed });
      onSaved();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setSaveError(typeof detail === "string" ? detail : "Не удалось сохранить комментарий.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="settings-owner-view dishcat-modal-layer">
      <div className={`settings-drawer settings-modal-overlay${closing ? " is-closing" : ""}`} role="presentation">
        <div className="settings-drawer__backdrop" onClick={requestClose} />
        <div
          className="settings-form settings-modal wh-inv-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-detail-title"
        >
          <header className="settings-form__header">
            <span className="settings-accent-bar" />
            <div>
              <p>{t("pages.warehouse.inventorydetailmodal.sklad_inventarizatsiya")}</p>
              <h2 id="inventory-detail-title">{t("pages.warehouse.inventorydetailmodal.korrektirovki")} {check.warehouse || "—"}</h2>
            </div>
            <button type="button" onClick={requestClose} aria-label={t("pages.warehouse.inventorydetailmodal.zakryt")}>
              <Icon name="bi-x-lg" size={20} />
            </button>
          </header>
          <div className="settings-form__body">
            {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehouse.inventorydetailmodal.zagruzka_korrektirovok")}</div> : null}
            {!loading && error ? <div className="login-error" role="alert">{error}</div> : null}
            {!loading && !error ? (
              <div className="settings-table-wrapper dish-grid-wrap">
                <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehouse.inventorydetailmodal.korrektirovki_s_prokrutkoy")} tabIndex={0}>
                  <table className="settings-table dish-grid-table" aria-label={t("pages.warehouse.inventorydetailmodal.korrektirovki_inventarizatsii")}>
                    <thead>
                      <tr>
                        <th>{t("pages.warehouse.inventorydetailmodal.data_registratsii")}</th>
                        <th>{t("pages.warehouse.inventorydetailmodal.nazvanie")}</th>
                        <th>{t("pages.warehouse.inventorydetailmodal.korrektirovka")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr key={item.id || item.ingredient_id || item.product_id || index}>
                          <td>{check.registeredAt || "—"}</td>
                          <td className="wh-doc-col-name">{item.name || "—"}</td>
                          <td className={`wh-inv-diff ${diffTone(item.diff_qty)}`.trim()}>
                            {diffText(item.diff_qty, item.unit || "")}
                          </td>
                        </tr>
                      ))}
                      {!items.length ? (
                        <tr><td colSpan={3} className="warehouse-empty-cell">{t("pages.warehouse.inventorydetailmodal.korrektirovok_net")}</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            <div className="wh-inv-detail-actions">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder={t("pages.warehouse.inventorydetailmodal.kommentariy")}
                aria-label={t("pages.warehouse.inventorydetailmodal.kommentariy_inventarizatsii")}
              />
              <button type="button" onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
            {saveError ? <Toast kind="error" message={saveError} onClose={() => setSaveError("")} /> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
