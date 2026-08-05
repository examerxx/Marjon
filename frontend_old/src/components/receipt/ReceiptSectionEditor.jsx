import Icon from "../Icon";

const sizeOptions = [
  { value: "standard", label: "Стандартный" },
  { value: "large", label: "Большой" },
  { value: "xlarge", label: "Очень большой" },
];

const alignOptions = [
  { value: "left", label: "Влево" },
  { value: "center", label: "В центр" },
  { value: "right", label: "Вправо" },
];

const weightOptions = [
  { value: "standard", label: "Стандартный" },
  { value: "bold", label: "Жирный" },
];

function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div className="receipt-segment-group">
      <span>{label}</span>
      <div className="receipt-segments">
        {options.map((option) => (
          <button
            type="button"
            className={value === option.value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            key={option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReceiptSectionEditor({
  blocks,
  enabled,
  labels,
  blockStyles,
  styleBlocks = [],
  onToggle,
  onMove,
  onStyleChange,
}) {
  const styleBlockSet = new Set(styleBlocks);

  return (
    <div className="receipt-section-editor">
      {blocks.map((block, index) => (
        <div className={`receipt-section-row ${enabled?.[block] ? "is-enabled" : ""}`} key={block}>
          <div className="receipt-section-row__top">
            <label className="receipt-toggle">
              <input
                type="checkbox"
                checked={Boolean(enabled?.[block])}
                onChange={() => onToggle(block)}
              />
              <span>{labels[block] || block}</span>
            </label>
            <div className="receipt-section-row__actions">
              <button
                type="button"
                className="receipt-icon-btn"
                onClick={() => onMove(block, -1)}
                disabled={index === 0}
                title="Выше"
                aria-label={`${labels[block] || block} выше`}
              >
                <Icon name="bi-arrow-up" size={15} />
              </button>
              <button
                type="button"
                className="receipt-icon-btn"
                onClick={() => onMove(block, 1)}
                disabled={index === blocks.length - 1}
                title="Ниже"
                aria-label={`${labels[block] || block} ниже`}
              >
                <Icon name="bi-arrow-down" size={15} />
              </button>
            </div>
          </div>
          {styleBlockSet.has(block) ? (
            <div className="receipt-section-row__style">
              <SegmentedControl
                label="Размер текста"
                value={blockStyles?.[block]?.size || "standard"}
                options={sizeOptions}
                onChange={(value) => onStyleChange(block, { size: value })}
              />
              <SegmentedControl
                label="Выравнивание"
                value={blockStyles?.[block]?.align || "left"}
                options={alignOptions}
                onChange={(value) => onStyleChange(block, { align: value })}
              />
              <SegmentedControl
                label="Жирность"
                value={blockStyles?.[block]?.weight || "standard"}
                options={weightOptions}
                onChange={(value) => onStyleChange(block, { weight: value })}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
