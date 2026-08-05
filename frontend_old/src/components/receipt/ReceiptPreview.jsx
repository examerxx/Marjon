import { useState } from "react";
import logo from "../../assets/marjon-logo.svg";
import { formatMoney } from "../../api/client";

const customerSampleOrder = {
  order_number: "3",
  table_number: "1 (Divanli Kabina)",
  waiter: "Kassir",
  order_type: "На стол",
  payment_method: "Наличные",
  discount: 8000,
  service_fee: 8000,
  vat: 0,
  total_amount: 108640,
  created_at: "2025-07-31T18:17:00",
  items: [
    { id: 1, name: "Somsa", quantity: 10, price: 8000, total: 80000 },
    { id: 2, name: "Shashlik tovuqli 200g", quantity: 2, price: 32000, total: 64000 },
  ],
};

const kitchenSampleOrder = {
  order_number: "A-1042",
  table_number: "12",
  waiter: "Aziz",
  station: "Горячий цех",
  priority: "Срочно",
  note: "Без лука в салате",
  created_at: new Date().toISOString(),
  items: [
    {
      id: 1,
      name: "Плов чайханский",
      quantity: 2,
      modifiers: ["Без казы", "Острый соус отдельно"],
      note: "Один без моркови",
    },
    { id: 2, name: "Салат Ачичук", quantity: 1, modifiers: ["Меньше соли"], note: "" },
  ],
};

const qrCells = [
  0, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12,
  14, 18, 20, 24, 26, 30, 31, 32, 34, 36,
  38, 39, 42, 43, 45, 47, 49, 50, 52, 55,
  56, 57, 59, 61, 63, 66, 69, 70, 72, 73,
  75, 77, 78, 81, 82, 84, 86, 88, 90, 91,
  92, 94, 96, 98, 99, 100,
];

const movableCustomerBlocks = new Set(["logo", "restaurantName", "qr", "thankYouText", "footerText"]);

function isEnabled(template, block) {
  return template?.enabled?.[block] !== false;
}

function formatReceiptDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date).replace(",", "");
}

function formatKitchenDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value || Date.now()));
}

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU").replace(/\s/g, " ");
}

function ReceiptDivider() {
  return <div className="receipt-preview__divider" aria-hidden="true" />;
}

function EditableText({ value, fallback, multiline = false, className = "", onChange, ariaLabel }) {
  const [editing, setEditing] = useState(false);
  const text = value || fallback || "";

  if (!onChange) return multiline ? (
    <span className={className}>{text.split("\n").map((line) => <span key={line || "line"}>{line}</span>)}</span>
  ) : <span className={className}>{text}</span>;

  if (editing) {
    const commonProps = {
      value: text,
      autoFocus: true,
      "aria-label": ariaLabel,
      onChange: (event) => onChange(event.target.value),
      onBlur: () => setEditing(false),
      onKeyDown: (event) => {
        if (event.key === "Escape") setEditing(false);
        if (!multiline && event.key === "Enter") setEditing(false);
      },
    };
    return multiline
      ? <textarea className="receipt-preview__inline-input receipt-preview__inline-input--area" rows="3" {...commonProps} />
      : <input className="receipt-preview__inline-input" {...commonProps} />;
  }

  return (
    <button className={`receipt-preview__editable ${className}`} type="button" onClick={() => setEditing(true)} title="Изменить текст">
      {multiline ? text.split("\n").map((line) => <span key={line || "line"}>{line}</span>) : text}
    </button>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function MovableBlock({ block, template, onTemplateChange, children }) {
  const [drag, setDrag] = useState(null);
  const position = template?.positions?.[block] || { x: 0, y: 0 };
  const canMove = Boolean(onTemplateChange);

  function updatePosition(next) {
    onTemplateChange?.({
      positions: {
        ...(template.positions || {}),
        [block]: {
          x: clamp(Math.round(next.x), -90, 90),
          y: clamp(Math.round(next.y), -80, 80),
        },
      },
    });
  }

  function startDrag(event) {
    if (!canMove) return;
    if (event.target.closest?.(".receipt-preview__drag-reset")) return;
    if (event.target.closest?.(".receipt-preview__editable")) return;
    if (event.target.closest?.(".receipt-preview__inline-input")) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = event;
    setDrag({
      pointerId: pointer.pointerId,
      startX: pointer.clientX,
      startY: pointer.clientY,
      originX: position.x || 0,
      originY: position.y || 0,
    });
    event.currentTarget.setPointerCapture?.(pointer.pointerId);
  }

  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    updatePosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  }

  function endDrag(event) {
    if (drag?.pointerId === event.pointerId) setDrag(null);
  }

  function resetPosition(event) {
    event.preventDefault();
    event.stopPropagation();
    updatePosition({ x: 0, y: 0 });
  }

  if (!canMove) {
    return <div style={{ transform: `translate(${position.x || 0}px, ${position.y || 0}px)` }}>{children}</div>;
  }

  return (
    <div
      className={`receipt-preview__movable ${drag ? "is-dragging" : ""}`}
      style={{ transform: `translate(${position.x || 0}px, ${position.y || 0}px)` }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="Перетащите блок"
    >
      <button
        className="receipt-preview__drag-reset"
        type="button"
        onClick={resetPosition}
        title="Сбросить позицию"
        aria-label="Сбросить позицию"
      >
        x
      </button>
      {children}
    </div>
  );
}

function blockStyleClass(template, block) {
  const style = template?.blockStyles?.[block] || {};
  return [
    `receipt-preview__block--size-${style.size || "standard"}`,
    `receipt-preview__block--align-${style.align || "left"}`,
    `receipt-preview__block--weight-${style.weight || "standard"}`,
  ].join(" ");
}

function Line({ label, value, strong }) {
  return (
    <div className={`receipt-preview__line ${strong ? "is-strong" : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function CustomerBlock({ block, template, org, order, onTemplateChange }) {
  const restaurantName = template.restaurantName || org?.name || "Sardon BMW";
  const subtotal = order.items.reduce((sum, item) => sum + Number(item.total || item.price * item.quantity || 0), 0);
  const serviceRate = Number(template.serviceFee || 8);
  const phone = template.footerText || template.phone || org?.phone || "+998770702101";

  switch (block) {
    case "logo":
      return <img className="receipt-preview__logo" src={org?.logo || logo} alt={restaurantName} />;
    case "restaurantName":
      return (
        <h3 className="receipt-preview__brand">
          <EditableText
            value={template.restaurantName}
            fallback={restaurantName}
            ariaLabel="Название ресторана"
            onChange={(value) => onTemplateChange?.({ restaurantName: value })}
          />
        </h3>
      );
    case "address":
      return template.address || org?.address ? (
        <p className="receipt-preview__muted">
          <EditableText
            value={template.address}
            fallback={org.address}
            ariaLabel="Адрес"
            onChange={(value) => onTemplateChange?.({ address: value })}
          />
        </p>
      ) : null;
    case "phone":
      return template.phone || org?.phone ? (
        <p className="receipt-preview__muted">
          <EditableText
            value={template.phone}
            fallback={org.phone}
            ariaLabel="Телефон"
            onChange={(value) => onTemplateChange?.({ phone: value })}
          />
        </p>
      ) : null;
    case "orderNumber":
      return <p className="receipt-preview__top-meta">Номер заказа: {order.order_number}</p>;
    case "dateTime":
      return <p className="receipt-preview__top-meta">Дата: {formatReceiptDate(order.created_at)}</p>;
    case "table":
      return (
        <>
          <ReceiptDivider />
          <div className="receipt-preview__two-col">
            <span>Тип заказа</span>
            <b>{order.order_type || "На стол"}</b>
          </div>
          <ReceiptDivider />
          <div className="receipt-preview__two-col receipt-preview__two-col--wide-value">
            <span>Номер стола</span>
            <b>{order.table_number || "-"}</b>
          </div>
        </>
      );
    case "waiter":
      return (
        <>
          <ReceiptDivider />
          <div className="receipt-preview__two-col">
            <span>Официант</span>
            <b>{order.waiter || "-"}</b>
          </div>
        </>
      );
    case "items":
      return (
        <div className="receipt-preview__items">
          <ReceiptDivider />
          <div className="receipt-preview__items-head">
            <span>Наименование</span>
            <span>Кол-<br />во</span>
            <span>Цена</span>
            <span>Итого</span>
          </div>
          <ReceiptDivider />
          {order.items.map((item) => (
            <div className="receipt-preview__item" key={item.id}>
              <span>{item.name}</span>
              <b>{Number(item.quantity)}</b>
              <b>{money(item.price)}</b>
              <b>{money(item.total || item.price * item.quantity)}</b>
            </div>
          ))}
        </div>
      );
    case "discount":
      return <div className="receipt-preview__discount">{money(order.discount)}</div>;
    case "serviceFee":
      return (
        <>
          <ReceiptDivider />
          <div className="receipt-preview__service">
            <span>Обслуживание</span>
            <b>{serviceRate}%</b>
            <b>{money(order.service_fee || subtotal * serviceRate / 100)}</b>
          </div>
        </>
      );
    case "vat":
      return Number(template.vatRate || 0) ? (
        <div className="receipt-preview__service">
          <span>НДС</span>
          <b>{Number(template.vatRate)}%</b>
          <b>{money(order.vat)}</b>
        </div>
      ) : null;
    case "total":
      return (
        <>
          <ReceiptDivider />
          <div className="receipt-preview__total">
            <span>Итого:</span>
            <b>{money(order.total_amount)}</b>
          </div>
        </>
      );
    case "paymentMethod":
      return (
        <div className="receipt-preview__payments">
          <div><span>Наличные:</span><b>{money(108000)}</b></div>
          <div><span>Карта:</span><b>{money(600)}</b></div>
          <ReceiptDivider />
        </div>
      );
    case "qr":
      return (
        <div className="receipt-preview__qr">
          {Array.from({ length: 100 }, (_, index) => (
            <i className={qrCells.includes(index) ? "is-dark" : ""} key={index} />
          ))}
        </div>
      );
    case "thankYouText":
      return (
        <p className="receipt-preview__thanks">
          <EditableText
            value={template.thankYouText}
            fallback="XARIDINGIZ\nUCHUN RAXMAT!"
            multiline
            ariaLabel="Текст благодарности"
            onChange={(value) => onTemplateChange?.({ thankYouText: value })}
          />
        </p>
      );
    case "footerText":
      return (
        <div className="receipt-preview__bottom-order">
          <strong>
            <EditableText
              value={template.footerText}
              fallback={phone}
              ariaLabel="Нижний текст"
              onChange={(value) => onTemplateChange?.({ footerText: value })}
            />
          </strong>
          <span>НОМЕР ЗАКАЗА</span>
          <b>{order.order_number}</b>
        </div>
      );
    default:
      return null;
  }
}

function KitchenBlock({ block, order }) {
  switch (block) {
    case "orderNumber":
      return <h3 className="receipt-preview__kitchen-number">#{order.order_number}</h3>;
    case "table":
      return <Line label="Стол" value={order.table_number || "-"} strong />;
    case "waiter":
      return <Line label="Официант" value={order.waiter || "-"} />;
    case "createdAt":
      return <Line label="Время" value={formatKitchenDate(order.created_at)} />;
    case "station":
      return <Line label="Станция" value={order.station || "Общая кухня"} />;
    case "priority":
      return <div className="receipt-preview__priority">{order.priority || "Обычный"}</div>;
    case "items":
      return (
        <div className="receipt-preview__kitchen-items">
          <ReceiptDivider />
          {order.items.map((item) => (
            <div className="receipt-preview__kitchen-item" key={item.id}>
              <strong>{Number(item.quantity)} x {item.name}</strong>
            </div>
          ))}
        </div>
      );
    case "modifiers":
      return (
        <div className="receipt-preview__notes">
          {order.items.map((item) => item.modifiers?.length ? (
            <p key={item.id}><b>{item.name}:</b> {item.modifiers.join(", ")}</p>
          ) : null)}
        </div>
      );
    case "itemComments":
      return (
        <div className="receipt-preview__notes">
          {order.items.map((item) => item.note ? <p key={item.id}><b>{item.name}:</b> {item.note}</p> : null)}
        </div>
      );
    case "orderNote":
      return order.note ? <p className="receipt-preview__order-note">Комментарий: {order.note}</p> : null;
    default:
      return null;
  }
}

export default function ReceiptPreview({ type = "customer", template, org, order, onTemplateChange }) {
  const sample = order || (type === "kitchen" ? kitchenSampleOrder : customerSampleOrder);
  const blocks = template?.blocks || [];

  return (
    <div className="receipt-preview-shell">
      <div className="receipt-preview-shell__label">{template?.paperSize || "80mm"} preview</div>
      <div className={`receipt-preview receipt-preview--${template?.paperSize || "80mm"} ${type === "kitchen" ? "receipt-preview--kitchen" : ""}`}>
        {blocks.filter((block) => isEnabled(template, block)).map((block) => {
          const content = type === "kitchen"
            ? <KitchenBlock block={block} order={sample} />
            : <CustomerBlock block={block} template={template} org={org} order={sample} onTemplateChange={onTemplateChange} />;
          const movable = type === "customer" && movableCustomerBlocks.has(block);
          return (
            <div className={`receipt-preview__block receipt-preview__block--${block} ${type === "customer" ? blockStyleClass(template, block) : ""}`} key={block}>
              {movable ? (
                <MovableBlock block={block} template={template} onTemplateChange={onTemplateChange}>
                  {content}
                </MovableBlock>
              ) : content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
