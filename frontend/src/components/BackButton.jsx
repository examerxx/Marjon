import { useNavigate } from "react-router-dom";
import Icon from "./Icon";
import { t } from "../i18n/t";

export default function BackButton({ className = "", iconName = "bi-arrow-left", label = "" }) {
  const navigate = useNavigate();

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  }

  const buttonLabel = label || t("common.back");
  const buttonClassName = ["dashboard-back-button", className].filter(Boolean).join(" ");

  return (
    <button className={buttonClassName} type="button" onClick={handleBack} aria-label={buttonLabel}>
      <Icon name={iconName} size={18} />
      {label ? <span>{t(label)}</span> : null}
    </button>
  );
}
