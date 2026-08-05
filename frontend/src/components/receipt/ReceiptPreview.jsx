import logo from "../../assets/marjon-logo.svg";

export const customerSampleOrder = {
  order_number: "3",
  table_number: "1 (Divanli Kabina)",
  waiter: "Kassir",
  order_type: "На стол",
  payment_method: "Смешанная оплата",
  discount: 0,
  service_fee: 8000,
  vat: 0,
  total_amount: 108640,
  created_at: "2025-07-31T18:17:00",
  payments: [
    { label: "Наличные", amount: 108000 },
    { label: "Карта", amount: 600 },
  ],
  items: [
    { id: 1, name: "Somsa", quantity: 10, price: 8000, total: 80000 },
    { id: 2, name: "Shashlik tovuqli 200g", quantity: 2, price: 32000, total: 64000 },
  ],
};

export const kitchenSampleOrder = {
  order_number: "A-1042",
  table_number: "12",
  waiter: "Aziz",
  priority: "Срочно",
  note: "Без лука в салате",
  created_at: "2026-07-27T10:41:00",
  items: [
    {
      id: 1,
      name: "Плов чайханский",
      quantity: 2,
      modifiers: ["Без казы", "Острый соус отдельно"],
      note: "",
    },
    { id: 2, name: "Салат Ачичук", quantity: 1, modifiers: ["Меньше соли"], note: "" },
    { id: 3, name: "Плов чайханский", quantity: 1, modifiers: ["Один без моркови"], note: "" },
  ],
};

function normalizePaperSize(value) {
  return String(value || "80mm").includes("58") ? "58" : "80";
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return toNumber(value).toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replace(/\s/g, " ");
}

function itemTotal(item) {
  return toNumber(item.total ?? item.amount ?? toNumber(item.price) * toNumber(item.quantity || 1));
}

function itemName(item) {
  return item.name || item.title || item.product_name || item.dish_name || "Позиция";
}

function itemQuantity(item) {
  return toNumber(item.quantity ?? item.qty ?? 1);
}

function itemPrice(item) {
  return toNumber(item.price ?? item.unit_price ?? item.amount);
}

function formatCustomerDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(",", "");
}

function formatKitchenDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function getCustomerReceiptTotals(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((sum, item) => sum + itemTotal(item), 0);
  const discount = toNumber(order.discount ?? order.discount_amount);
  const service = toNumber(order.service_fee ?? order.service_amount);
  const tax = toNumber(order.vat ?? order.tax ?? order.tax_amount);
  const total = hasValue(order.total_amount)
    ? toNumber(order.total_amount)
    : subtotal - discount + service + tax;
  return { subtotal, discount, service, tax, total };
}

function getPaymentRows(order = {}, total = 0) {
  const paymentRows = [];
  if (Array.isArray(order.payments)) {
    order.payments.forEach((payment) => {
      const amount = toNumber(payment.amount ?? payment.sum ?? payment.total);
      if (amount > 0) {
        paymentRows.push({
          label: payment.label || payment.name || payment.method || payment.payment_method || "Оплата",
          amount,
        });
      }
    });
  }

  [
    ["Наличные", order.cash_amount ?? order.cash],
    ["Карта", order.card_amount ?? order.card],
    ["Перечисление", order.transfer_amount ?? order.transfer],
  ].forEach(([label, value]) => {
    const amount = toNumber(value);
    if (amount > 0) paymentRows.push({ label, amount });
  });

  if (!paymentRows.length && hasValue(order.payment_method) && total > 0) {
    paymentRows.push({ label: order.payment_method, amount: total });
  }

  return paymentRows;
}

function getContactRows(template = {}, org = {}) {
  return [
    template.footerText || template.phone || org.phone,
    template.address || org.address,
  ].filter(hasValue);
}

function getOrderNumber(order = {}) {
  return hasValue(order.order_number) ? String(order.order_number) : "-";
}

function ReceiptRule({ solid = false }) {
  return <div className={`receipt-preview__rule ${solid ? "is-solid" : ""}`} aria-hidden="true" />;
}

function InfoRows({ rows }) {
  const visibleRows = rows.filter((row) => hasValue(row.value));
  if (!visibleRows.length) return null;
  return (
    <div className="receipt-preview__info">
      {visibleRows.map((row) => (
        <div className="receipt-preview__info-row" key={row.label}>
          <b>{row.label}</b>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomerItems({ items = [] }) {
  return (
    <div className="receipt-preview__items" data-receipt-items>
      <div className="receipt-preview__items-head">
        <span>НАИМЕНОВАНИЕ</span>
        <span>КОЛ-ВО</span>
        <span>ЦЕНА</span>
        <span>ИТОГО</span>
      </div>
      {items.map((item, index) => (
        <div className="receipt-preview__item-row" key={item.id || `${itemName(item)}-${index}`}>
          <span className="receipt-preview__item-name">{itemName(item)}</span>
          <span>{money(itemQuantity(item))}</span>
          <span>{money(itemPrice(item))}</span>
          <span>{money(itemTotal(item))}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryRows({ totals }) {
  const rows = [
    { label: "Сумма товаров", value: totals.subtotal, show: totals.subtotal > 0 },
    { label: "Скидка", value: totals.discount, show: totals.discount > 0 },
    { label: "Обслуживание", value: totals.service, show: totals.service > 0 },
    { label: "Налог", value: totals.tax, show: totals.tax > 0 },
  ].filter((row) => row.show);

  if (!rows.length) return null;
  return (
    <div className="receipt-preview__summary">
      {rows.map((row) => (
        <div className="receipt-preview__summary-row" key={row.label}>
          <span>{row.label}</span>
          <b>{money(row.value)}</b>
        </div>
      ))}
    </div>
  );
}

function PaymentRows({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="receipt-preview__payments">
      {rows.map((row) => (
        <div className="receipt-preview__payment-row" key={row.label}>
          <span>{row.label}:</span>
          <b>{money(row.amount)}</b>
        </div>
      ))}
    </div>
  );
}

function CustomerReceipt({ template = {}, org, order }) {
  const restaurantName = template.restaurantName || org?.name || "MARJON";
  const totals = getCustomerReceiptTotals(order);
  const payments = getPaymentRows(order, totals.total);
  const contacts = getContactRows(template, org);
  const infoRows = [
    { label: "Номер заказа:", value: getOrderNumber(order) },
    { label: "Тип заказа:", value: order.order_type },
    { label: "Номер стола:", value: order.table_number },
    { label: "Официант:", value: order.waiter },
    { label: "Дата:", value: formatCustomerDate(order.created_at) },
  ];

  return (
    <>
      <header className="receipt-preview__brand-block">
        <img className="receipt-preview__logo" src={org?.logo || logo} alt={restaurantName} />
        <div className="receipt-preview__brand">MARJON</div>
      </header>
      <ReceiptRule solid />
      <InfoRows rows={infoRows} />
      <ReceiptRule solid />
      <CustomerItems items={order.items || []} />
      <ReceiptRule solid />
      <SummaryRows totals={totals} />
      <ReceiptRule solid />
      <div className="receipt-preview__total">
        <span>ИТОГО:</span>
        <b>{money(totals.total)}</b>
      </div>
      <ReceiptRule solid />
      <PaymentRows rows={payments} />
      {payments.length ? <ReceiptRule solid /> : null}
      <footer className="receipt-preview__customer-footer">
        <strong>{template.thankYouText || "XARIDINGIZ UCHUN RAXMAT!"}</strong>
        {contacts.map((contact) => <b key={contact}>{contact}</b>)}
      </footer>
      <ReceiptRule />
      <div className="receipt-preview__bottom-order">
        <span>НОМЕР ЗАКАЗА</span>
        <b>{getOrderNumber(order)}</b>
      </div>
    </>
  );
}

function getModifierText(modifier) {
  if (typeof modifier === "string") return modifier;
  return modifier?.name || modifier?.title || modifier?.label || "";
}

function itemNotes(item) {
  const notes = [];
  if (Array.isArray(item.modifiers)) {
    const modifierText = item.modifiers.map(getModifierText).filter(hasValue).join(", ");
    if (modifierText) notes.push(modifierText);
  }
  if (hasValue(item.note) || hasValue(item.comment)) {
    notes.push(item.note || item.comment);
  }
  return notes;
}

function isUrgent(order = {}) {
  const value = String(order.priority || order.urgency || "").toLowerCase();
  return Boolean(order.is_urgent || order.urgent || value.includes("сроч") || value.includes("urgent"));
}

function KitchenItems({ items = [] }) {
  return (
    <div className="receipt-preview__kitchen-items">
      {items.map((item, index) => {
        const notes = itemNotes(item);
        return (
          <div className="receipt-preview__kitchen-item" key={item.id || `${itemName(item)}-${index}`}>
            <strong>{money(itemQuantity(item))} x {itemName(item)}</strong>
            {notes.map((note) => <span key={note}>- {note}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function KitchenReceipt({ order }) {
  const infoRows = [
    { label: "Стол:", value: order.table_number },
    { label: "Официант:", value: order.waiter },
    { label: "Время:", value: formatKitchenDate(order.created_at) },
  ];

  return (
    <>
      <h3 className="receipt-preview__kitchen-number">#{getOrderNumber(order)}</h3>
      <InfoRows rows={infoRows} />
      <ReceiptRule />
      <KitchenItems items={order.items || []} />
      {hasValue(order.note) ? (
        <>
          <ReceiptRule />
          <div className="receipt-preview__kitchen-comment">
            <b>Комментарий:</b>
            <span>- {order.note}</span>
          </div>
        </>
      ) : null}
      {isUrgent(order) ? (
        <>
          <ReceiptRule />
          <div className="receipt-preview__kitchen-urgent">! СРОЧНО !</div>
        </>
      ) : null}
    </>
  );
}

export default function ReceiptPreview({ type = "customer", template = {}, org, order }) {
  const paperSize = normalizePaperSize(template.paperSize);
  const sample = order || (type === "kitchen" ? kitchenSampleOrder : customerSampleOrder);

  return (
    <div className="receipt-preview-shell" data-receipt-preview-shell>
      <div className="receipt-preview-shell__label">{paperSize} mm preview</div>
      <div
        className={`receipt-preview receipt-preview--${type} receipt-preview--${paperSize}mm`}
        data-paper-size={paperSize}
        data-receipt-type={type}
        data-receipt-component="shared"
        data-receipt-print-root
      >
        {type === "kitchen"
          ? <KitchenReceipt order={sample} />
          : <CustomerReceipt template={template} org={org} order={sample} />}
      </div>
    </div>
  );
}
