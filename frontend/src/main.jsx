import React from "react";
import ReactDOM from "react-dom/client";
import { useTranslation } from "react-i18next";
import App from "./App.jsx";
import "./i18n/index.js";
import "./styles/global/marjon-tokens.css";
import "./styles/global/brand.css";
import "./styles/owner/dashboard.css";
import "./styles/shared/topbar-widgets.css";
import "./styles/global/forms.css";
import "./styles/global/tables.css";
import "./styles/owner/staff-pos.css";
import "./styles/global/responsive.css";
import "./styles/app.css";
import "./styles/owner/dishes.css";
import "./styles/owner/stop-list.css";
import "./styles/owner/report-datepicker.css";
import "./styles/owner/staff-users.css";
import "./styles/owner/nomenclature.css";
import "./styles/owner/warehouse.css";
import "./styles/owner/finance.css";
import "./styles/owner/settings.css";
import "./styles/shared/dashboard-curve.css";
import "./styles/global/loader.css";
import "./styles/react-overrides.css";
import "./styles/owner/reports.css";
import "./styles/owner/sales.css";
import "./styles/shared/receipt.css";
import "./styles/shared/auth.css";
import "./styles/shared/login-extras.css";
import "./styles/shared/support-widget.css";
import "./styles/preview/dark-shell.css";
// VIEWPORT-FIT-01: последний слой — подчиняет высоту секций высоте окна.
// Импортируется последним осознанно: перекрывает фиксированные min-height.
import "./styles/owner/viewport-fit.css";

/**
 * Перерисовка всего приложения при смене языка.
 *
 * Часть строк переводится через `t()` из `i18n/t` — это обычная функция, она
 * не подписывается на смену языка сама. Без этой границы после переключения
 * обновлялся бы только сайдбар (он использует `useTranslation`), а остальные
 * страницы оставались на прежнем языке.
 *
 * Меняем `key` — React размонтирует и смонтирует дерево заново, все `t()`
 * вызываются уже с новым языком. Смена языка происходит в настройках, не в
 * середине ввода заказа, поэтому потеря локального состояния здесь безопасна.
 */
function LanguageBoundary({ children }) {
  const { i18n } = useTranslation();
  return <React.Fragment key={i18n.language}>{children}</React.Fragment>;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LanguageBoundary>
      <App />
    </LanguageBoundary>
  </React.StrictMode>,
);
