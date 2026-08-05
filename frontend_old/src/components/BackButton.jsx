import { useNavigate } from "react-router-dom";
import Icon from "./Icon";

export default function BackButton({ className = "", iconName = "bi-arrow-left", label = "" }) {
  const navigate = useNavigate();

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  }

  const buttonLabel = label || "Назад";
  const buttonClassName = ["dashboard-back-button", className].filter(Boolean).join(" ");

  return (
    <button className={buttonClassName} type="button" onClick={handleBack} aria-label={buttonLabel} title={buttonLabel}>
      <Icon name={iconName} size={18} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
