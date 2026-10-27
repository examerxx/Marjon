import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { t } from "../../i18n/t";

// Склад: компактная центрированная модалка семьи dishcat-modal
// (тот же шелл, что «Добавить категорию»: шапка p/h2/X, широкое поле,
// ошибка, футер Отмена/Добавить|Сохранить). Режимы: create/edit/delete.
// V37: статус Активно/Архив (warehouses.is_active) — тоггл в create/edit.
// Закрытие — через exit-анимацию settings-примитива (is-closing → onClose,
// 160мс как settings-modal-out); успешный submit закрывает сразу.
const WH_MODAL_EXIT_MS = 160;
export default function WarehouseModal({ mode, warehouse, saving, error, onClose, onSubmit }) {
  const [name, setName] = useState(warehouse?.name || "");
  const [isActive, setIsActive] = useState(warehouse?.is_active !== false);
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
    closeTimer.current = setTimeout(onClose, WH_MODAL_EXIT_MS);
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isDelete = mode === "delete";
  const isEdit = mode === "edit";

  function handleSubmit(event) {
    event.preventDefault();
    if (isDelete) {
      onSubmit();
      return;
    }
    if (!String(name || "").trim()) return;
    onSubmit({ name: String(name).trim(), is_active: isActive });
  }

  return createPortal(
    <div className="settings-owner-view dishcat-modal-layer">
      <div className={`settings-drawer settings-modal-overlay${closing ? " is-closing" : ""}`} role="presentation">
        <div className="settings-drawer__backdrop" onClick={saving ? undefined : requestClose} />
        <form
          className={`settings-form settings-modal warehouse-modal${isDelete ? " dishcat-confirm" : ""}${isEdit ? " dishcat-modal--edit" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="warehouse-modal-title"
          onSubmit={handleSubmit}
        >
          <header className="settings-form__header">
            <span className="settings-accent-bar" />
            <div>
              <p>{isDelete ? t("pages.warehouse.warehousemodal.udalenie") : isEdit ? t("staff.editing") : t("eyebrow.new_male")}</p>
              <h2 id="warehouse-modal-title">
                {isDelete ? t("pages.warehouse.warehousemodal.udalit_sklad") : isEdit ? t("pages.warehouse.warehousemodal.redaktirovat_sklad") : t("pages.warehouse.warehousemodal.dobavit_sklad")}
              </h2>
            </div>
            <button type="button" disabled={saving} onClick={requestClose} aria-label={t("pages.warehouse.warehousemodal.zakryt")}>
              <Icon name="bi-x-lg" size={20} />
            </button>
          </header>
          {isDelete ? (
            <p className="settings-form__context">
             {t("pages.warehouse.warehousemodal.sklad")} <strong>«{warehouse?.name || "—"}»</strong> {t("pages.warehouse.warehousemodal.budet_udalen_bez_vozmozhnosti_vosstanovleniya")}
            </p>
          ) : (
            <div className="settings-form__body">
              <label className="settings-form__wide">
                <span>{t("pages.warehouse.warehousemodal.nazvanie")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("pages.warehouse.warehousemodal.vvedite_nazvanie")}
                  aria-label={t("pages.warehouse.warehousemodal.nazvanie_sklada")}
                />
              </label>
              <div className="settings-form__wide warehouse-modal__status">
                <span>{t("pages.warehouse.warehousemodal.status")}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  className={`wh-status-toggle ${isActive ? "is-on" : ""}`}
                  onClick={() => setIsActive((value) => !value)}
                >
                  <span className="wh-status-toggle__track"><span className="wh-status-toggle__thumb" /></span>
                  <span className="wh-status-toggle__label">{isActive ? t("common.active") : t("pages.warehouse.warehousemodal.arhivirovano")}</span>
                </button>
              </div>
            </div>
          )}
          {error ? (
            <p className="settings-form__error" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="settings-form__footer">
            <button type="button" disabled={saving} onClick={requestClose}>
             {t("pages.warehouse.warehousemodal.otmena")}
            </button>
            {isDelete ? (
              <button type="submit" className="dishcat-confirm__delete" disabled={saving}>
                {saving ? t("common.deleting") : t("common.delete")}
              </button>
            ) : (
              <button type="submit" disabled={saving || !String(name || "").trim()}>
                {saving ? t("staff.saving") : isEdit ? t("common.save") : t("common.add")}
              </button>
            )}
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
