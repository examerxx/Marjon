// Общий всплывающий тост (успех / ошибка) — как в референсе.
// Рендерится через portal в body, фиксирован справа сверху,
// не сдвигает контент страницы.
import { createPortal } from "react-dom";
import { t } from "../i18n/t";
import "./Toast.css";

export default function Toast({ kind = "success", title, message, leaving = false, onClose }) {
  const isSuccess = kind !== "error";
  const resolvedTitle = title || (isSuccess ? "Успешно" : "Ошибка");
  if (!message) return null;
  return createPortal(
    <div
      className={`marjon-toast marjon-toast--${isSuccess ? "success" : "error"}${leaving ? " is-leaving" : ""}`}
      role={isSuccess ? "status" : "alert"}
    >
      <span className="marjon-toast__icon" aria-hidden="true">
        {isSuccess ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M16.7 5.3L7.5 14.5L3.3 10.3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="marjon-toast__texts">
        <b className="marjon-toast__title">{resolvedTitle}</b>
        <span className="marjon-toast__message">{message}</span>
      </span>
      {onClose ? (
        <button type="button" className="marjon-toast__close" aria-label={t("components.toast.zakryt_uvedomlenie")} onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
