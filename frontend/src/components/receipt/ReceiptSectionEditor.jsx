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
  onStyleChange,
  renderBlockExtra,
}) {
  const styleBlockSet = new Set(styleBlocks);

  return (
    <div className="receipt-section-editor">
      {blocks.map((block) => (
        <div className={`receipt-section-row ${enabled?.[block] ? "is-enabled" : ""}`} key={block} data-block-row={block}>
          <div className="receipt-section-row__top">
            <label className="receipt-toggle">
              <input
                type="checkbox"
                checked={Boolean(enabled?.[block])}
                onChange={() => onToggle(block)}
              />
              <span>{labels[block] || block}</span>
            </label>
          </div>
          {enabled?.[block] && styleBlockSet.has(block) ? (
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
          {renderBlockExtra ? renderBlockExtra(block) : null}
        </div>
      ))}
    </div>
  );
}
