import Icon from "../../components/Icon";
import { t } from "../../i18n/t";
import "./SettingsPlaceholderPage.css";

// Общая временная заглушка подкатегорий (финансы и аналогичные):
// shell — settings-owner-view как у «Способ оплаты», шапка — спокойная
// section-стилистика, по центру — иконка + короткий текст. Никаких
// действий, списков и демо-контента; layout стабилен (shift = 0).
export default function SettingsPlaceholderPage({ title, description, icon = "bi-wallet2" }) {
  return (
    <div className="settings-page settings-owner-view">
      <section className="settings-card">
        <div className="section-header">
          <div>
            <span className="eyebrow">{t("pages.settings.settingsplaceholderpage.nastroyki")}</span>
            <h2>{title}</h2>
            {description ? <p className="section-window__description">{description}</p> : null}
          </div>
        </div>

        <div className="settings-placeholder-body" role="status">
          <span className="settings-placeholder-icon" aria-hidden="true">
            <Icon name={icon} size={44} />
          </span>
          <strong className="settings-placeholder-title">{t("pages.settings.settingsplaceholderpage.skoro_eta_kategoriya_v_razrabotke")}</strong>
        </div>
      </section>
    </div>
  );
}
