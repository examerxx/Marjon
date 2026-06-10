export default function SectionPage({ eyebrow, title, description, items = [] }) {
  return (
    <section className="card card-pad section-window">
      <div className="section-header">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {description ? <p className="section-window__description">{description}</p> : null}
        </div>
      </div>

      <div className="section-window__grid">
        {items.map((item) => (
          <article className="section-window__tile" key={item.title}>
            <div className="section-window__icon"><i className={`bi ${item.icon || "bi-grid"}`} /></div>
            <div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
