// Central capability registry for the receipt constructor (Direction 1).
//
// A control may be ACTIVE only when its end-to-end contract works:
// UI draft → live preview → PATCH payload → persisted template → reload →
// ReceiptData/formatter → physical ESC/POS output. Anything missing a link
// lives in PENDING_BLOCKS with the exact backend requirement and MUST NOT
// appear as a working control (see receiptBlockCapabilities.test.js).
//
// Physical support below is verified against
// backend/app/modules/printers/formatter.py::format_receipt:
// - toggle: formatter honors enabled[key] for every canonical block.
// - styles "full": size+align+weight honored (restaurantName, orderNumber,
//   dateTime, total, thankYouText, footerText, table, waiter).
// - styles "full-tabular" (items, paymentMethod) — per-dimension truth:
//   preview YES for all three axes; save/reload YES (canonical blockStyles);
//   physical size YES; physical weight YES; physical alignment: codes flow
//   through the canonical contract but stay visually inert on full-width
//   tabular lines (standard ESC/POS physics, NOT a product gap). Narrow-paper
//   xlarge items additionally switch to a wrapped-name + qty/amount layout
//   (never a zero-width dish field) — structured-layout adaptation, same axes.
// - styles "none": no style UI and no formatter styles (logo, address,
//   phone, discount, serviceFee, vat) — full agreement by construction.
import { CUSTOMER_BLOCKS, CUSTOMER_STYLE_BLOCKS } from "../../api/receipt";

const STYLE_TABULAR = new Set(["items", "paymentMethod"]);

function physicalStyles(key) {
  if (!CUSTOMER_STYLE_BLOCKS.includes(key)) return "none";
  return STYLE_TABULAR.has(key) ? "full-tabular" : "full";
}

export const CUSTOMER_BLOCK_PHYSICAL = Object.freeze(
  Object.fromEntries(
    CUSTOMER_BLOCKS.map((key) => [key, Object.freeze({ toggle: true, styles: physicalStyles(key) })]),
  ),
);

// Reference-video functions that are NOT end-to-end supported. Each entry is
// the backend handoff: what must change before the key may enter
// CUSTOMER_BLOCKS (and only then may a control for it become active).
// domain "template" = receipt-template pipeline; "pos" = POS business logic;
// "printer" = printer hardware domain (Настройка принтеров, not here).
export const PENDING_BLOCKS = Object.freeze([
  Object.freeze({
    key: "orderTypeSplit",
    label: "Тип заказа (независимый тоггл)",
    domain: "template",
    need: "Separate enabled key (order type is printed on the orderNumber line); formatter must conditionally render it.",
  }),
  Object.freeze({
    key: "subtotal",
    label: "Общая сумма еды (тоггл)",
    domain: "template",
    need: "enabled key honored by formatter (today the subtotal line always prints); preview already renders it conditionally on the same key once the formatter agrees.",
  }),
  Object.freeze({
    key: "separators",
    label: "Разделение линиями (тоггл)",
    domain: "template",
    need: "enabled key honored by formatter (today dividers are unconditional in both preview and formatter).",
  }),
  Object.freeze({
    key: "deliveryAddress",
    label: "Адрес доставки",
    domain: "template",
    need: "Order.customer_address → ReceiptData field → template block key → formatter rendering → preview payload.",
  }),
  Object.freeze({
    key: "deliveryPhone",
    label: "Телефон доставки",
    domain: "template",
    need: "Order.customer_phone → ReceiptData field → template block key → formatter rendering → preview payload.",
  }),
  Object.freeze({
    key: "deliveryComment",
    label: "Комментарий к доставке",
    domain: "template",
    need: "Order.note → customer ReceiptData field (kitchen already has orderNote) → template block key → formatter rendering → preview payload.",
  }),
  Object.freeze({
    key: "qr",
    label: "QR-код",
    domain: "template",
    need: "QR payload source (what value to encode) → ReceiptData field → formatter ESC/POS QR support (today explicitly excluded: separate QR-printer). Retired from CUSTOMER_BLOCKS until then.",
  }),
  Object.freeze({
    key: "bottomOrderNumber",
    label: "Нижний номер заказа",
    domain: "template",
    need: "Separate canonical template block (same order data, bottom placement, own style) + formatter rendering. Preview duplication alone is not a feature.",
  }),
  Object.freeze({
    key: "splitBill",
    label: "Разделить счёт",
    domain: "pos",
    need: "SPLIT_BILL_NOT_RECEIPT_TEMPLATE_SUPPORTED: POS split-bill business logic must exist first; a receipt-settings toggle must never pretend to implement it.",
  }),
  Object.freeze({
    key: "printerConnection",
    label: "Подключение принтера (LAN/USB)",
    domain: "printer",
    need: "Stays in Настройка принтеров (paper_width/connection/selection already canonical there). A receipt-settings shortcut may only mirror real printer-API state, never duplicate it.",
  }),
]);

// Single source of truth for "may this key appear as an active constructor
// control". The editor row filter in ReceiptSettingsPage uses this (not a
// scattered inline list), so adding a backend capability later means moving
// one key from PENDING_BLOCKS into CUSTOMER_BLOCKS.
export function isActiveConstructorBlock(key) {
  return CUSTOMER_BLOCKS.includes(key);
}
