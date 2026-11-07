import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { t } from "../i18n/t";

// Uses the same full-screen photo viewer skin as the Dishes catalogue.
export default function DishPhotoViewer({ photo, name, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="dish-photo-viewer-layer">
      <div className="dish-photo-viewer-overlay" role="presentation" onClick={onClose} />
      <div className="dish-photo-viewer" role="dialog" aria-modal="true" aria-label={`Фото блюда ${name}`}>
        <button ref={closeRef} type="button" className="dish-photo-viewer__close" onClick={onClose} aria-label={t("components.dishphotoviewer.zakryt_foto")}>
          <Icon name="bi-x-lg" size={18} />
        </button>
        <img src={photo} alt={`Фото блюда «${name}»`} />
      </div>
    </div>, document.body,
  );
}
