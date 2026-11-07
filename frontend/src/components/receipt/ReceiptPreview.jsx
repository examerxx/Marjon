import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { groupReceiptItems, normalizeSeparator, rasterRuleGeometry, receiptStaffLabel } from "./receiptLayout";
import { webFormat } from "../../utils/webTime";
import { CHEF_DEFAULT_BLOCK_STYLES, CUSTOMER_BLOCKS, KITCHEN_BLOCKS, normalizeLineSpacing } from "../../api/receipt";
import { orderedBlocks, customerReceiptBlocks } from "../../pages/settings/receiptBlockOrder";
import { t } from "../../i18n/t";

// Демо-заказ превью. Дату/время намеренно НЕ храним константой: превью всегда
// показывает сегодняшний момент (подставляется в ReceiptPreview при рендере),
// иначе оно «замерзало» бы на дате, когда этот файл написали.
export const customerSampleOrder = {
  order_number: "3",
  table_number: "27",
  waiter: "Abdulaziz",
  waiter_role: "cashier",
  order_type: "На стол",
  payment_method: "Смешанная оплата",
  discount: 0,
  // Сумма блюд 240 000, обслуга 12% = 28 800, итого 268 800.
  service_fee: 28800,
  vat: 0,
  total_amount: 268800,
  payments: [
    { label: "Наличные", amount: 200000 },
    { label: "Карта", amount: 68800 },
  ],
  items: [
    { id: 1, name: "Qozon kabob", quantity: 2, price: 72000, total: 144000 },
    { id: 2, name: "Aysberg salati", quantity: 3, price: 28000, total: 84000 },
    { id: 3, name: "Olchali kompot", quantity: 1, price: 12000, total: 12000 },
  ],
};

export const kitchenSampleOrder = {
  order_number: "A-1042",
  order_type: "dine_in",
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
      price: 25000,
      total: 50000,
      modifiers: ["Без казы", "Острый соус отдельно"],
      note: "",
    },
    { id: 2, name: "Салат Ачичук", quantity: 1, price: 15000, total: 15000, modifiers: ["Меньше соли"], note: "" },
    { id: 3, name: "Плов чайханский", quantity: 1, price: 25000, total: 25000, modifiers: ["Один без моркови"], note: "" },
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

function formatCustomerDate(value) {
  return webFormat(value || new Date(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).replace(",", "");
}

function formatKitchenDate(value) {
  return webFormat(value || new Date(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function getOrderNumber(order = {}) {
  return hasValue(order.order_number) ? String(order.order_number) : "-";
}

// Канонические коды типов заказа (pos.order_type) → подпись на чеке:
// на чеке всегда тот тип, что выбран при заказе. Уже-подписанные
// значения (образец "На стол") и неизвестные коды проходят как есть.
const RECEIPT_ORDER_TYPE_LABELS = {
  dine_in: "На стол",
  takeaway: "На вынос",
  delivery: "Доставка",
  qr: "QR",
};

export function formatReceiptOrderType(value) {
  const raw = String(value ?? "");
  return RECEIPT_ORDER_TYPE_LABELS[raw] || raw;
}

export function formatKitchenOrderType(value) {
  return ["takeaway", "На вынос", "НА ВЫНОС"].includes(value) ? "С собой" : formatReceiptOrderType(value);
}

// Blocks whose per-block style (size/align/weight) is user-configurable — must
// stay in sync with CUSTOMER_STYLE_BLOCKS in api/receipt.js. A block is visible
// unless its template.enabled entry is explicitly false (default = shown).
const CUSTOMER_STYLE_SET = new Set([
  "restaurantName", "orderNumber", "table", "waiter", "dateTime",
  "items", "total", "paymentMethod", "thankYouText", "bottomOrderNumber",
]);

function isOn(enabled, block) {
  return enabled?.[block] !== false;
}

function blockClass(block, styles) {
  const classes = ["receipt-preview__block"];
  if (CUSTOMER_STYLE_SET.has(block)) {
    const style = styles?.[block] || {};
    classes.push(`receipt-preview__block--align-${style.align || "left"}`);
    if (style.size === "large" || style.size === "xlarge") {
      classes.push(`receipt-preview__block--size-${style.size}`);
    }
    if (style.weight === "bold") classes.push("receipt-preview__block--weight-bold");
    // Явный класс «стандартного» веса: по нему правила «оба края строки
    // слушают Жирность» отличают стилизуемый блок от контейнера, у которого
    // контролов нет вовсе (шапка, подвал, «Сумма блюд»/«Обслуга»).
    else classes.push("receipt-preview__block--weight-standard");
  }
  return classes.join(" ");
}

const SeparatorContext = createContext({ pattern: "dashed", weight: "thin" });
function ReceiptRule({ solid = false }) {
  const separator = useContext(SeparatorContext);
  const rule = rasterRuleGeometry(separator, separator.paperSize);
  return <div className={`receipt-preview__rule ${solid ? "is-solid" : ""}`} data-separator-pattern={separator.pattern}
    data-separator-weight={separator.weight} aria-hidden="true">{separator.pattern === "stars" ? "* ".repeat(50) : (
      <svg className="receipt-preview__raster-rule" viewBox={`0 0 ${rule.width} ${rule.thickness}`}>
        <path d={rule.path} fill="#000" />
      </svg>
    )}</div>;
}

function tableColumnStyle(fontSize, items, showSums = true) {
  const qtyChars = Math.max(0, ...items.map(item => String(itemQuantity(item)).length));
  const amountChars = Math.max(0, ...items.map(item => money(itemTotal(item)).length));
  return {
    "--receipt-qty-width": `${Math.ceil(Math.max(56, fontSize * 3.8, qtyChars * fontSize * 0.65 + 8))}px`,
    "--receipt-amount-width": `${Math.ceil(Math.max(84, fontSize * 3.3, (showSums ? amountChars : 0) * fontSize * 0.65 + 8))}px`,
  };
}

function CustomerItems({ items = [], styles = {} }) {
  items = groupReceiptItems(items);
  const fontSize = { standard: 17, large: 19, xlarge: 21.5 }[styles.items?.size || "standard"];
  return (
    <div className="receipt-preview__items" style={tableColumnStyle(fontSize, items)} data-receipt-items>
      <div className="receipt-preview__items-head" style={{ fontSize }}>
        <span>{t("components.receipt.receiptpreview.blyudo")}</span>
        <span>{t("components.receipt.receiptpreview.kol_vo")}</span>
        <span>{t("components.receipt.receiptpreview.summa")}</span>
      </div>
      <ReceiptRule solid />
      {items.map((item, index) => (
        <div className="receipt-preview__item-row" key={item.id || `${itemName(item)}-${index}`}>
          <span className="receipt-preview__item-name">{t(itemName(item))}</span>
          <span>{itemQuantity(item)}</span>
          <span>{money(itemTotal(item))}</span>
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
          <span>{t(row.label)}:</span>
          <b>{money(row.amount)}</b>
        </div>
      ))}
    </div>
  );
}

// Contiguous same-section blocks share one container (info list, summary list,
// brand header, footer) and a solid rule separates sections. Order comes from
// the persisted template.blocks — the same source the ESC/POS formatter uses.
function CustomerReceipt({ template = {}, org, order }) {
  const enabled = template.enabled || {};
  const styles = template.blockStyles || {};
  const numberAtTop = styles.bottomOrderNumber?.placement === "top";
  const showTopNumber = numberAtTop && isOn(enabled, "bottomOrderNumber");
  const restaurantName = template.restaurantName || org?.name || "MARJON";
  const totals = getCustomerReceiptTotals(order);
  const payments = getPaymentRows(order, totals.total);

  // Contiguous same-section blocks share one container; rules separate sections.
  const runs = [];
  const push = (section, node) => {
    const last = runs[runs.length - 1];
    if (last && last.section === section) last.nodes.push(node);
    else runs.push({ section, nodes: [node] });
  };
  const infoRow = (block, label, value) => {
    if (!hasValue(value)) return;
    push("info", (
      <div className={`receipt-preview__info-row ${blockClass(block, styles)}`} key={`${block}-${label}`}>
        <b>{t(label)}</b><span>{value}</span>
      </div>
    ));
  };
  const summaryRow = (label, value) => push("summary", (
    <div className="receipt-preview__summary-row" key={`sum-${label}`}><span>{t(label)}</span><b>{money(value)}</b></div>
  ));

  const renderSummary = () => {
    if (totals.subtotal > 0) summaryRow("Сумма блюд", totals.subtotal);
    if (isOn(enabled, "discount") && totals.discount > 0) summaryRow("Скидка", totals.discount);
    if (isOn(enabled, "serviceFee") && totals.service > 0) {
      const base = (order.items || []).filter((item) => item.status !== "cancelled" && !item.takeaway).reduce((sum, item) => sum + itemTotal(item), 0);
      const rate = order.service_fee_rate ?? (base > 0 ? Math.round(totals.service * 10000 / base) / 100 : 0);
      summaryRow(rate > 0 ? t("receipt.preview.service_percent", { rate }) : t("receipt.preview.service"), totals.service);
    }
    if (isOn(enabled, "vat") && totals.tax > 0) summaryRow("Налог", totals.tax);
  };

  let summaryDone = false;
  for (const block of customerReceiptBlocks(template, CUSTOMER_BLOCKS)) {
    // The subtotal/discount/service/vat unit renders once, anchored to `total`.
    if (block === "discount" || block === "serviceFee" || block === "vat") continue;
    if (block === "total") {
      renderSummary();
      summaryDone = true;
      if (isOn(enabled, "total")) {
        push("total", (
          <div className={`receipt-preview__total ${blockClass("total", styles)}`} key="total">
            <span>{t("components.receipt.receiptpreview.itogo")}</span><b>{money(totals.total)}</b>
          </div>
        ));
      }
      continue;
    }
    if (!isOn(enabled, block)) continue;
    const cls = blockClass(block, styles);
    // Logo renders ONLY a real uploaded company logo (org.logo from
    // Company.logo_key). No generic fallback: the physical formatter prints
    // nothing when no logo is uploaded, and the preview must agree.
    if (block === "logo") { if (org?.logo) push("header", <img className="receipt-preview__logo" src={org.logo} alt={restaurantName} key="logo" />); }
    else if (block === "restaurantName") push("header", <div className={`receipt-preview__brand ${cls}`} style={{ fontSize: { standard: 23.33, large: 35, xlarge: 58.33 }[styles.restaurantName?.size || "large"], fontWeight: styles.restaurantName?.weight === "standard" ? 400 : 700 }} key="rn">{restaurantName}</div>);
    else if (block === "orderNumber") { if (!showTopNumber) infoRow("orderNumber", "Номер заказа:", getOrderNumber(order)); infoRow("orderNumber", "Тип заказа:", t(formatReceiptOrderType(order.order_type))); }
    else if (block === "table") infoRow("table", "Номер стола:", order.table_number);
    else if (block === "waiter") {
      const staff = order.receipt_staff?.length ? order.receipt_staff : [{ label: receiptStaffLabel(order), name: order.waiter }];
      staff.forEach(person => infoRow("waiter", `${person.label}:`, person.name));
    }
    else if (block === "dateTime") infoRow("dateTime", "Дата:", formatCustomerDate(order.created_at));
    else if (block === "items") push("items", <div className={cls} key="items"><CustomerItems items={order.items || []} styles={styles} /></div>);
    else if (block === "paymentMethod") { if (payments.length) push("payment", <div className={cls} key="pay"><PaymentRows rows={payments} /></div>); }
    else if (block === "thankYouText") push("footer", <strong className={cls} key="ty">{template.thankYouText || "XARIDINGIZ UCHUN RAXMAT!"}</strong>);
    else if (block === "bottomOrderNumber") push(numberAtTop ? "header" : "footer", (
      <div className={`receipt-preview__bottomnum ${cls}`} key="bon">
        <span className="receipt-preview__bottomnum-caption">{t("components.receipt.receiptpreview.nomer_zakaza")}</span>
        {/* Same proportions as the raster fonts (48/72/96/180 dots), at the
            preview's 17.5px body / printer's 24-dot body reference scale. */}
        <b className="receipt-preview__bottomnum-value" style={{ fontSize: { standard: 35, large: 70, xlarge: 131.25, xxlarge: 160.42 }[styles.bottomOrderNumber?.size || "large"], fontWeight: styles.bottomOrderNumber?.weight === "bold" ? 700 : 400 }}>{getOrderNumber(order)}</b>
      </div>
    ));
    else if (block === "address") { const v = template.address || org?.address; if (hasValue(v)) push("footer", <b key="addr" style={{ justifySelf: "stretch", textAlign: "center" }}>{v}</b>); }
    else if (block === "phone") { const v = template.phone || org?.phone; if (hasValue(v)) push("footer", <b key="ph" style={{ justifySelf: "stretch", textAlign: "center" }}>{v}</b>); }
  }
  if (!summaryDone) renderSummary(); // total block missing from a legacy order

  const wrapRun = (run) => {
    if (run.section === "header") return <header className="receipt-preview__brand-block">{run.nodes}</header>;
    if (run.section === "info") return <div className="receipt-preview__info">{run.nodes}</div>;
    if (run.section === "summary") return <div className="receipt-preview__summary">{run.nodes}</div>;
    if (run.section === "footer") return <footer className="receipt-preview__customer-footer">{run.nodes}</footer>;
    return <>{run.nodes}</>;
  };

  // Fixed reference lines: solid after info, solid under the items head,
  // dashed after the dishes list and after the subtotal block, solid after
  // the grand total and after payment. No line follows the restaurant header
  // (product decision). No configurability, no gaps.
  const boundaryRule = (previous) => {
    if (previous === "header") return null;
    return (previous === "items" || previous === "summary"
      ? <ReceiptRule key={`rule-${previous}`} />
      : <ReceiptRule solid key={`rule-${previous}`} />);
  };

  return (
    <>
      {runs.map((run, index) => (
        <div key={`${run.section}-${index}`} data-receipt-section={run.section}>
          {wrapRun(run)}
          {index < runs.length - 1 ? boundaryRule(run.section) : null}
        </div>
      ))}
    </>
  );
}

function getModifierText(modifier) {
  if (typeof modifier === "string") return modifier;
  return modifier?.name || modifier?.title || modifier?.label || "";
}

function itemNotes(item, { modifiers = true, comments = true } = {}) {
  const notes = [];
  if (modifiers && Array.isArray(item.modifiers)) {
    const modifierText = item.modifiers.map(getModifierText).filter(hasValue).join(", ");
    if (modifierText) notes.push(modifierText);
  }
  if (comments && (hasValue(item.note) || hasValue(item.comment))) {
    notes.push(item.note || item.comment);
  }
  return notes;
}

// Breathing room around the paper inside the fit frame so the drop-shadow
// renders instead of being clipped by the frame's hidden overflow. Kept
// compact so a tall receipt wastes little vertical room. Must stay in sync
// with the `.receipt-fit-frame` padding in receiptSettings.css.
export const FIT_PAD_TOP = 22;
export const FIT_PAD_BOTTOM = 26;
export const FIT_PAD_SIDE = 8;

export const FIT_MIN_SCALE = 0.5;

// Pure fit-scale contract, extracted for unit testing. Desktop paper size
// is driven by paper type + available WIDTH only: scale = min(1, availW / natW)
// clamped at the readable floor for genuinely narrow panes. Pane HEIGHT
// never participates, so browser zoom (which shrinks CSS viewport height)
// cannot shrink the receipt. A very tall receipt keeps this stable scale
// and scrolls inside the preview viewport instead of collapsing.
export function computeFitScale(natW, availW) {
  if (!natW || availW <= 0) return 1;
  const raw = Math.min(1, availW / natW);
  return raw < 1 ? Math.max(raw, FIT_MIN_SCALE) : 1;
}

// Оконный (модальный) режим: чек показывается целиком, поэтому к ширине
// добавляется высота. Это ОПЦИЯ (fitToHeight), а не изменение общего
// контракта: страница настроек по-прежнему масштабирует только по ширине и
// не «схлопывается» при зуме браузера. Ниже 0.72 текст чека уже нечитаем —
// там лучше прокрутка, чем крошечная бумажка.
export const FIT_MIN_HEIGHT_SCALE = 0.72;

export function computeFitHeightScale(natW, availW, natH, availH, { minScale = FIT_MIN_HEIGHT_SCALE, maxScale = 1 } = {}) {
  const widthScale = Math.min(computeFitScale(natW, availW), maxScale);
  if (!natH || !availH || availH <= 0) return widthScale;
  // Рамку (FIT_PAD_*) масштаб не трогает — она входит в высоту как есть,
  // поэтому вычитаем её из доступной высоты, а не прибавляем к бумаге.
  const usableH = availH - FIT_PAD_TOP - FIT_PAD_BOTTOM;
  if (usableH <= 0) return widthScale;
  const heightScale = usableH / natH;
  if (heightScale >= widthScale) return widthScale;
  return Math.max(heightScale, Math.min(widthScale, minScale));
}

function itemMoneyValue(item) {
  if (hasValue(item.total ?? item.amount)) return toNumber(item.total ?? item.amount);
  const computed = toNumber(item.price) * toNumber(item.quantity ?? item.qty ?? 1);
  return computed;
}

// Chef-only style classes (kitchen preview scope). Isolated from the
// Customer blockClass contract. Retired size "medium" maps to "large" so
// unmigrated blobs never render a classless size.
function kitchenBlockClass(block, styles) {
  const classes = ["receipt-preview__block"];
  const style = { ...CHEF_DEFAULT_BLOCK_STYLES[block], ...styles?.[block] };
  if (block === "orderNumber" && style.align) classes.push(`receipt-preview__block--align-${style.align}`);
  if (style.size) classes.push(`receipt-preview__block--size-${style.size === "medium" ? "large" : style.size}`);
  if (style.weight === "bold") classes.push("receipt-preview__block--weight-bold");
  return classes.join(" ");
}

// Keep the same relative font steps as the kitchen raster: 24 / 32 / 38.
// Inline styles also prevent generic summary/heading CSS from overriding
// the constructor's size and weight controls.
function kitchenBlockStyle(block, styles) {
  const style = { ...CHEF_DEFAULT_BLOCK_STYLES[block], ...styles?.[block] };
  const size = style.size === "medium" ? "large" : style.size;
  return {
    fontSize: { standard: 15, large: 20, xlarge: 23.75 }[size] || 15,
    fontWeight: style.weight === "bold" ? 700 : 400,
  };
}

// Табличный режим позиций кухни (всегда как в чеке оплаты):
// Блюдо/Кол-во [+ Сумма]. Отдельного итога в кухонном чеке нет.
// Те же классы таблицы, что у CustomerItems — тот же CSS, без нового.
// Без сумм колонка Кол-во у правого края, цифры строго по центру шапки;
// под шапкой одна сплошная линия (пунктир первой строки гасится).
function KitchenItemsTable({ items = [], comments = true, showSums = false, styles = {} }) {
  items = groupReceiptItems(items);
  const rowStyle = kitchenBlockStyle("dishItems", styles);
  return (
    <div className={`receipt-preview__items receipt-preview__items--kitchen${showSums ? "" : " receipt-preview__items--no-sum"}`} style={tableColumnStyle(rowStyle.fontSize, items, showSums)} data-receipt-items>
      <div className="receipt-preview__items-head" style={{ fontSize: 15, fontWeight: 700 }}>
        <span>{t("components.receipt.receiptpreview.blyudo")}</span>
        <span>{t("components.receipt.receiptpreview.kol_vo")}</span>
        {showSums ? <span>{t("components.receipt.receiptpreview.summa")}</span> : null}
      </div>
      <ReceiptRule solid />
      {items.map((item, index) => {
        const notes = itemNotes(item, { modifiers: true, comments });
        return (
          <Fragment key={item.id || `${itemName(item)}-${index}`}>
            {index > 0 ? <ReceiptRule /> : null}
            <div className={`receipt-preview__item-row${index === 0 ? " receipt-preview__item-row--first" : ""}`} style={rowStyle}>
              <span className="receipt-preview__item-name" style={{ fontSize: "inherit", fontWeight: "inherit" }}>{t(itemName(item))}</span>
              <span style={{ fontSize: "inherit", fontWeight: "inherit" }}>{itemQuantity(item)}</span>
              {showSums ? <span style={{ fontSize: "inherit", fontWeight: "inherit" }}>{hasValue(item.total ?? item.amount ?? item.price) ? money(itemMoneyValue(item)) : ""}</span> : null}
            </div>
            {notes.map((note) => (
              <div key={note} className="receipt-preview__item-note-row">
                <span>! {t(note)}</span>
              </div>
            ))}
          </Fragment>
        );
      })}
    </div>
  );
}

function KitchenReceipt({ template = {}, order }) {
  const enabled = template.enabled || {};
  const styles = template.blockStyles || {};
  const commentOn = enabled.comment !== false;
  // The checkbox controls only the amount column, including real zero amounts.
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const showSums = enabled.showOrderSum === true;
  const runs = [];
  const push = (section, node) => {
    const last = runs[runs.length - 1];
    if (last && last.section === section) last.nodes.push(node);
    else runs.push({ section, nodes: [node] });
  };
  const infoRow = (block, label, value) => {
    if (!hasValue(value)) return;
    push("info", (
      <div className={`receipt-preview__info-row ${kitchenBlockClass(block, styles)}`} style={kitchenBlockStyle(block, styles)} key={`${block}-${label}`}><b>{t(label)}</b><span>{value}</span></div>
    ));
  };

  const blocks = ["orderType", ...orderedBlocks(template.blocks, KITCHEN_BLOCKS).filter((block) => block !== "orderType")];
  for (const block of blocks) {
    if (!isOn(enabled, block)) continue;
    if (block === "orderNumber") {
      push("number", <h3 className={`receipt-preview__kitchen-number ${kitchenBlockClass(block, styles)}`} style={kitchenBlockStyle(block, styles)} key="num">#{getOrderNumber(order)}</h3>);
    } else if (block === "orderType") {
      const value = formatKitchenOrderType(order.order_type);
      if (hasValue(value)) push("heading", <div key="type" data-kitchen-order-type
        className={`receipt-preview__kitchen-type ${kitchenBlockClass(block, styles)}`}
        style={{ ...kitchenBlockStyle(block, styles), textAlign: styles.orderNumber?.align || "center" }}>{t(value)}</div>);
    }
    else if (block === "table") infoRow("table", "Стол:", order.table_number);
    else if (block === "waiter") infoRow("waiter", `${receiptStaffLabel(order)}:`, order.waiter);
    else if (block === "date") infoRow("date", "Время:", formatKitchenDate(order.created_at));
    else if (block === "showOrderSum") continue; // modifier of items, no own position
    else if (block === "comment") continue; // gates item/order notes, no own position
  }

  // Dishes are core content: always printed with modifiers; comments follow
  // the unified "Комментарий" setting; sums only with live money.
  push("items", (
    <KitchenItemsTable key="items" items={orderItems} comments={commentOn} showSums={showSums} styles={styles} />
  ));
  if (commentOn && hasValue(order.note)) push("note", (
    <div className={`receipt-preview__kitchen-comment ${kitchenBlockClass("comment", styles)}`} style={kitchenBlockStyle("comment", styles)} key="note"><b>{t("components.receipt.receiptpreview.kommentariy")}</b><span>- {t(order.note)}</span></div>
  ));

  const wrapRun = (run) => {
    if (run.section === "info") return <div className="receipt-preview__info">{run.nodes}</div>;
    return <>{run.nodes}</>;
  };

  return (
    <>
      {runs.map((run, index) => (
        <div key={`${run.section}-${index}`} data-receipt-section={run.section}>
          {index > 0 && run.section !== "info" && run.section !== "number" ? <ReceiptRule /> : null}
          {wrapRun(run)}
        </div>
      ))}
    </>
  );
}

export default function ReceiptPreview({ type = "customer", template = {}, org, order, fitPane = false, fitToHeight = false }) {
  const paperSize = normalizePaperSize(template.paperSize);
  // Демо-превью показывает СЕГОДНЯШНИЕ дату и время: тикаем раз в 30 секунд,
  // чтобы вкладка, открытая на ночь, к утру не показывала вчерашний день.
  // Для реального заказа (order) время берётся из самого заказа.
  const [sampleNow, setSampleNow] = useState(() => new Date());
  useEffect(() => {
    if (order) return undefined;
    const timer = setInterval(() => setSampleNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, [order]);
  const sample = order || (type === "kitchen"
    ? kitchenSampleOrder
    : { ...customerSampleOrder, created_at: sampleNow });

  // Fit-to-pane (settings preview only): scale the receipt to the preview
  // pane WIDTH. Preview-only presentation — the logical receipt (widths,
  // wrapping, ESC/POS order) is untouched. `zoom` composes naturally:
  // offsetWidth already includes it, so scale is measured against the true
  // on-screen size. Floor 0.5 keeps text readable on genuinely narrow panes;
  // anything smaller is reported via data-fit-scale instead of silently
  // shrinking further. Pane height never enters the scale: browser zoom
  // changes CSS viewport height, and height-fitting is what used to shrink
  // the receipt into a miniature. A receipt taller than the pane keeps this
  // stable scale, stays top-anchored, and scrolls inside the fit viewport.
  // The fit frame reserves padding around the paper (FIT_PAD_*) so the
  // drop-shadow has room to render: frame overflow is hidden, so without
  // this breathing room the shadow would be clipped at the frame edge.
  const availRef = useRef(null);
  const contentRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!fitPane) return undefined;
    const avail = availRef.current;
    const content = contentRef.current;
    if (!avail || !content || typeof ResizeObserver === "undefined") return undefined;
    const compute = () => {
      // Measure the receipt node itself: an ancestor transform never changes
      // layout metrics, so this is always the natural (zoom-included) size.
      const inner = content.querySelector("[data-receipt-print-root]");
      const availW = avail.clientWidth - FIT_PAD_SIDE * 2;
      const availH = avail.clientHeight;
      const natH = inner ? inner.offsetHeight : content.offsetHeight;
      const natW = inner ? inner.offsetWidth : content.offsetWidth;
      if (!natH || !natW || availW <= 0) return;
      const scale = fitToHeight
        ? computeFitHeightScale(natW, availW, natH, availH,
          // This viewer must contain the WHOLE paper, even below the normal
          // readable floor. Settings and boolean fitToHeight keep their defaults.
          fitToHeight === "contain" ? { minScale: 0, maxScale: 0.85 } : undefined)
        : computeFitScale(natW, availW);
      setFit((prev) => (Math.abs(prev.scale - scale) < 0.004 && prev.width === natW && prev.height === natH)
        ? prev
        : { scale, width: natW, height: natH });
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(avail);
    observer.observe(content);
    return () => observer.disconnect();
  }, [fitPane, fitToHeight, template, type, order, org]);

  const receiptNode = (
    <SeparatorContext.Provider value={{ ...normalizeSeparator(template.separator), paperSize }}><div
      className={`receipt-preview receipt-preview--${type} receipt-preview--${paperSize}mm`}
      data-paper-size={paperSize}
      data-line-spacing={normalizeLineSpacing(template.lineSpacing, type === "kitchen" ? "medium" : "large")}
      data-receipt-type={type}
      data-receipt-component="shared"
      data-receipt-print-root
      data-separator-pattern={normalizeSeparator(template.separator).pattern}
      data-separator-weight={normalizeSeparator(template.separator).weight}
    >
      {type === "kitchen"
        ? <KitchenReceipt template={template} order={sample} />
        : <CustomerReceipt template={template} org={org} order={sample} />}
    </div></SeparatorContext.Provider>
  );

  if (!fitPane) {
    return (
      <div className="receipt-preview-shell" data-receipt-preview-shell>
        {receiptNode}
      </div>
    );
  }

  return (
    <div className="receipt-preview-shell receipt-preview-shell--fit" data-receipt-preview-shell data-fit-scale={fit.scale.toFixed(3)}>
      <div className="receipt-fit-viewport" ref={availRef}>
        <div
          className="receipt-fit-frame"
          style={fit.height ? { width: Math.ceil(fit.width * fit.scale + FIT_PAD_SIDE * 2), height: Math.ceil(fit.height * fit.scale + FIT_PAD_TOP + FIT_PAD_BOTTOM) } : undefined}
        >
          <div ref={contentRef} style={{ transform: `scale(${fit.scale})`, transformOrigin: "top left" }}>
            {receiptNode}
          </div>
        </div>
      </div>
    </div>
  );
}
