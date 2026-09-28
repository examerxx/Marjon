import { useState } from "react";

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
      <div className={`receipt-segments receipt-segments--n${options.length}`}>
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

// Default control resolvers reproduce the accepted Customer constructor
// exactly. Chef pages pass chef-specific resolvers + styleRowClassName;
// Customer call sites stay untouched.
const defaultSizeOptions = () => sizeOptions;
const defaultAlignOptions = () => alignOptions;
const defaultWeightOptions = () => weightOptions;

export default function ReceiptSectionEditor({
  blocks,
  enabled,
  labels,
  blockStyles,
  styleBlocks = [],
  onToggle,
  onStyleChange,
  renderBlockExtra,
  groups,
  styleRowClassName = "",
  sizeOptionsForBlock = defaultSizeOptions,
  alignOptionsForBlock = defaultAlignOptions,
  weightOptionsForBlock = defaultWeightOptions,
}) {
  const styleBlockSet = new Set(styleBlocks);

  // Group collapse state is local editor UI-only: never persisted, never sent
  // to the receipt template API, never reset by draft handlers. All block
  // values live in the parent template state, so collapsing is lossless.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = (groupKey) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const renderRow = (block) => {
    const detailsOpen = Boolean(enabled?.[block]);
    const extra = renderBlockExtra ? renderBlockExtra(block) : null;
    const hasStyle = styleBlockSet.has(block);
    const sizeOpts = sizeOptionsForBlock(block) || [];
    const alignOpts = alignOptionsForBlock(block) || [];
    const weightOpts = weightOptionsForBlock(block) || [];
    const styleClassName = ["receipt-section-row__style", styleRowClassName].filter(Boolean).join(" ");
    return (
      <div className={`receipt-section-row ${detailsOpen ? "is-enabled" : ""}`} key={block} data-block-row={block}>
        <div className="receipt-section-row__top">
          <label className="receipt-toggle">
            <input
              type="checkbox"
              checked={detailsOpen}
              onChange={() => onToggle(block)}
            />
            <span>{labels[block] || block}</span>
          </label>
        </div>
        {hasStyle || extra ? (
          <div className={`receipt-section-row__details${detailsOpen ? " is-open" : ""}`}>
            <div
              className="receipt-section-row__details-inner"
              inert={!detailsOpen ? true : undefined}
            >
              {hasStyle ? (
                <div className={styleClassName}>
                  {sizeOpts.length ? (
                  <SegmentedControl
                    label="Размер текста"
                    value={blockStyles?.[block]?.size || sizeOpts[0].value}
                    options={sizeOpts}
                    onChange={(value) => onStyleChange(block, { size: value })}
                  />
                  ) : null}
                  {alignOpts.length ? (
                  <SegmentedControl
                    label="Выравнивание"
                    value={blockStyles?.[block]?.align || alignOpts[0].value}
                    options={alignOpts}
                    onChange={(value) => onStyleChange(block, { align: value })}
                  />
                  ) : null}
                  {weightOpts.length ? (
                  <SegmentedControl
                    label="Жирность"
                    value={blockStyles?.[block]?.weight || weightOpts[0].value}
                    options={weightOpts}
                    onChange={(value) => onStyleChange(block, { weight: value })}
                  />
                  ) : null}
                </div>
              ) : null}
              {extra}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  // No groups: flat list exactly as before (kitchen page uses this path).
  if (!Array.isArray(groups) || groups.length === 0) {
    return (
      <div className="receipt-section-editor">
        {blocks.map(renderRow)}
      </div>
    );
  }

  const groupedKeys = new Set(groups.flatMap((group) => group.blocks || []));
  const ungrouped = blocks.filter((block) => !groupedKeys.has(block));

  return (
    <div className="receipt-section-editor">
      {groups.map((group) => {
        const open = !collapsedGroups.has(group.key);
        const rows = (group.blocks || []).filter((block) => blocks.includes(block));
        return (
          <section className="receipt-section-group" key={group.key} data-block-group={group.key}>
            <button
              type="button"
              className="receipt-section-group__header"
              aria-expanded={open}
              onClick={() => toggleGroup(group.key)}
            >
              <span className="receipt-section-group__title">{group.title}</span>
              <span className="receipt-section-group__chevron" aria-hidden="true" />
            </button>
            <div className={`receipt-section-group__body${open ? " is-open" : ""}`}>
              <div className="receipt-section-group__inner">
                {rows.map(renderRow)}
              </div>
            </div>
          </section>
        );
      })}
      {ungrouped.map(renderRow)}
    </div>
  );
}
