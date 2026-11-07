import { useState } from "react";
import Icon from '../components/Icon';

export default function SectionPage({ eyebrow, title, description, items = [], sectionKey }) {
  const [activeTile, setActiveTile] = useState(null);

  const tableFor = (item) => Boolean(sectionKey && item?.tableKey);

  if (activeTile) {
    return (
      <section className="card card-pad section-window">
        <div className="section-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{activeTile.title}</h2>
            {activeTile.text ? <p className="section-window__description">{activeTile.text}</p> : null}
          </div>
          <button type="button" className="dashboard-back-button" onClick={() => setActiveTile(null)}>
            <Icon name="bi-arrow-left" size={18} />
            <span>Назад</span>
          </button>
        </div>
        <div className="dashboard-empty" role="status">
          <p>Данные недоступны: backend contract для этого отчёта пока не подключён.</p>
        </div>
      </section>
    );
  }

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
        {items.map((item) => {
          const clickable = Boolean(tableFor(item));
          return (
            <article
              className={`section-window__tile ${clickable ? "is-clickable" : ""}`}
              key={item.title}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => setActiveTile(item) : undefined}
              onKeyDown={
                clickable
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveTile(item);
                      }
                    }
                  : undefined
              }
            >
              <div className="section-window__icon"><Icon name={item.icon || "bi-grid"} size={20} /></div>
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
