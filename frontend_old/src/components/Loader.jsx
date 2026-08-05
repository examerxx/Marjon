export default function Loader({ size = "md", text = "", className = "" }) {
  return (
    <div className={`mj-loader mj-loader--${size} ${className}`.trim()}>
      <span className="mj-loader__ring" aria-hidden="true" />
      {text ? <span className="mj-loader__text">{text}</span> : null}
    </div>
  );
}

export function PageLoader({ text = "Загрузка..." }) {
  return (
    <div className="mj-loader-page">
      <Loader size="lg" text={text} />
    </div>
  );
}

export function TableLoader({ colSpan = 1 }) {
  return (
    <tr>
      <td colSpan={colSpan} className="mj-loader-cell">
        <Loader size="sm" text="Загрузка..." />
      </td>
    </tr>
  );
}

export function InlineLoader({ text = "" }) {
  return <Loader size="sm" text={text} className="mj-loader--inline" />;
}
