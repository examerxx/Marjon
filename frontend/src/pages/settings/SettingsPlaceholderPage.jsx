import Icon from "../../components/Icon";
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
            <span className="eyebrow">Настройки</span>
            <h2>{title}</h2>
            {description ? <p className="section-window__description">{description}</p> : null}
          </div>
        </div>

        <div className="settings-placeholder-body" role="status">
          <span className="settings-placeholder-icon" aria-hidden="true">
            <Icon name={icon} size={44} />
          </span>
          <strong className="settings-placeholder-title">Скоро, эта категория в разработке</strong>
        </div>
      </section>
    </div>
  );
}
