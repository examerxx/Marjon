import Icon from "../components/Icon";

export default function PlaceholderPage({ eyebrow, title, text }) {
  return (
    <section className="card card-pad">
      <div className="section-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="empty-state">
        <div className="empty-state__icon"><Icon name="bi-grid" size={20} /></div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </section>
  );
}
