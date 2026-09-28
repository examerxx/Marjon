import { api } from "./client";

export const CUSTOMER_TEMPLATE_KEY = "marjon_receipt_template";
export const KITCHEN_TEMPLATE_KEY = "marjon_kitchen_receipt_template";

export const CUSTOMER_BLOCKS = [
  "logo",
  "restaurantName",
  "address",
  "phone",
  "orderNumber",
  "table",
  "waiter",
  "dateTime",
  "items",
  "discount",
  "serviceFee",
  "vat",
  "total",
  "paymentMethod",
  "thankYouText",
  "bottomOrderNumber",
];

export const KITCHEN_BLOCKS = [
  "orderNumber",
  "cancelOrderNumber",
  "orderType",
  "table",
  "waiter",
  "date",
  "showOrderSum",
  "comment",
];

// Legacy kitchen keys (pre-redesign templates). Never rendered anymore, but
// preserved untouched inside the template blob by migrateKitchenTemplate.
export const KITCHEN_LEGACY_BLOCKS = [
  "createdAt",
  "items",
  "modifiers",
  "itemComments",
  "orderNote",
  "priority",
  "station",
];

// Chef-only size enum: 4 values where the reference requires the extra step.
// Customer Receipt keeps its own accepted size contract untouched.

export const CUSTOMER_BLOCK_LABELS = {
  logo: "Логотип",
  restaurantName: "Название ресторана",
  address: "Адрес",
  phone: "Телефон",
  orderNumber: "Номер заказа",
  table: "Стол",
  waiter: "Официант",
  dateTime: "Дата и время",
  items: "Позиции",
  discount: "Скидка",
  serviceFee: "Сервисный сбор",
  vat: "НДС",
  total: "Итого",
  paymentMethod: "Способ оплаты",
  thankYouText: "Комментарий к чеку",
  bottomOrderNumber: "Нижний номер заказа",
};

export const CUSTOMER_STYLE_BLOCKS = [
  "restaurantName",
  "orderNumber",
  "table",
  "waiter",
  "dateTime",
  "items",
  "total",
  "paymentMethod",
  "thankYouText",
  "bottomOrderNumber",
];

export const PRINTER_CONNECTION_LAN = "lan";
export const PRINTER_CONNECTION_USB = "usb";

export const PRINTER_CONNECTION_OPTIONS = [
  { value: PRINTER_CONNECTION_LAN, label: "LAN" },
  { value: PRINTER_CONNECTION_USB, label: "USB" },
];

// Frontend-only printer connection choice. Unknown values resolve to LAN.
// Round-trips through the flexible receipt-template blob, no backend change.
export function normalizePrinterConnection(value) {
  if (value === PRINTER_CONNECTION_USB || value === PRINTER_CONNECTION_LAN) {
    return value;
  }
  return PRINTER_CONNECTION_LAN;
}

export const LINE_SPACING_SMALL = "small";
export const LINE_SPACING_MEDIUM = "medium";
export const LINE_SPACING_LARGE = "large";

export const LINE_SPACING_OPTIONS = [
  { value: LINE_SPACING_SMALL, label: "Малое" },
  { value: LINE_SPACING_MEDIUM, label: "Среднее" },
  { value: LINE_SPACING_LARGE, label: "Большое" },
];

// Global customer-receipt density preset. Unknown/missing values resolve to
// "large" so templates saved before this setting existed render exactly the
// approved baseline. Round-trips through the flexible receipt-template blob
// (PATCH accepts unknown keys), so no backend change is required.
export function normalizeLineSpacing(value) {
  if (value === LINE_SPACING_SMALL || value === LINE_SPACING_MEDIUM || value === LINE_SPACING_LARGE) {
    return value;
  }
  return LINE_SPACING_LARGE;
}

export const KITCHEN_BLOCK_LABELS = {
  orderNumber: "Номер заказа",
  cancelOrderNumber: "Номер заказа (Отмена)",
  orderType: "Тип заказа",
  table: "Номер стола",
  waiter: "Официант",
  date: "Дата",
  showOrderSum: "Заказы (показать сумму)",
  comment: "Комментарий",
};

export const CHEF_SIZE_STANDARD = "standard";
export const CHEF_SIZE_LARGE = "large";
export const CHEF_SIZE_XLARGE = "xlarge";

export const CHEF_SIZE_OPTIONS_3 = [
  { value: CHEF_SIZE_STANDARD, label: "Стандартный" },
  { value: CHEF_SIZE_LARGE, label: "Большой" },
  { value: CHEF_SIZE_XLARGE, label: "Очень большой" },
];

export const CHEF_ALIGN_OPTIONS = [
  { value: "left", label: "Влево" },
  { value: "center", label: "В центр" },
  { value: "right", label: "Вправо" },
];

export const CHEF_WEIGHT_OPTIONS = [
  { value: "standard", label: "Стандартный" },
  { value: "bold", label: "Жирный" },
];

// Per-block constructor contract: which controls each of the 8 chef rows
// exposes. align: false means no alignment control for that row.
export const CHEF_STYLE_CONTROLS = {
  orderNumber: { sizes: CHEF_SIZE_OPTIONS_3, align: true, weight: true },
  cancelOrderNumber: { sizes: CHEF_SIZE_OPTIONS_3, align: true, weight: true },
  orderType: { sizes: CHEF_SIZE_OPTIONS_3, align: false, weight: true },
  table: { sizes: CHEF_SIZE_OPTIONS_3, align: false, weight: true },
  waiter: { sizes: CHEF_SIZE_OPTIONS_3, align: false, weight: true },
  date: { sizes: CHEF_SIZE_OPTIONS_3, align: true, weight: true },
  showOrderSum: { sizes: CHEF_SIZE_OPTIONS_3, align: false, weight: true },
  comment: { sizes: CHEF_SIZE_OPTIONS_3, align: false, weight: true },
};

export const CHEF_DEFAULT_BLOCK_STYLES = {
  orderNumber: { size: "large", align: "center", weight: "bold" },
  cancelOrderNumber: { size: "large", align: "center", weight: "bold" },
  orderType: { size: "standard", weight: "standard" },
  table: { size: "standard", weight: "standard" },
  waiter: { size: "standard", weight: "standard" },
  date: { size: "standard", align: "left", weight: "standard" },
  showOrderSum: { size: "standard", weight: "standard" },
  comment: { size: "standard", weight: "standard" },
};

export function buildCustomerTemplate(org = {}) {
  const organization = org || {};
  const enabled = CUSTOMER_BLOCKS.reduce((acc, key) => ({ ...acc, [key]: true }), {});
  const blockStyles = CUSTOMER_BLOCKS.reduce((acc, key) => ({
    ...acc,
    [key]: { size: "standard", align: "left", weight: "standard" },
  }), {});
  enabled.logo = true;
  enabled.address = false;
  enabled.phone = false;
  enabled.vat = false;

  return {
    paperSize: "80mm",
    lineSpacing: LINE_SPACING_LARGE,
    printerConnection: PRINTER_CONNECTION_LAN,
    blocks: [...CUSTOMER_BLOCKS],
    enabled,
    thankYouText: "XARIDINGIZ\nUCHUN RAXMAT!",
    blockStyles: {
      ...blockStyles,
      restaurantName: { size: "large", align: "center", weight: "bold" },
      orderNumber: { size: "standard", align: "center", weight: "bold" },
      dateTime: { size: "standard", align: "center", weight: "bold" },
      total: { size: "xlarge", align: "left", weight: "standard" },
      thankYouText: { size: "large", align: "center", weight: "bold" },
      bottomOrderNumber: { size: "large", align: "center", weight: "bold" },
    },
    positions: {
      logo: { x: 0, y: 0 },
      restaurantName: { x: 0, y: 0 },
      thankYouText: { x: 0, y: 0 },
      bottomOrderNumber: { x: 0, y: 0 },
    },
    restaurantName: organization.name || "MARJON",
    address: organization.address || "",
    phone: organization.phone || "",
    currency: organization.currency || "UZS",
    vatRate: Number(organization.vat_rate || 0),
    serviceFee: Number(organization.service_fee || 0),
  };
}

export function buildKitchenTemplate() {
  const enabled = KITCHEN_BLOCKS.reduce((acc, key) => ({ ...acc, [key]: true }), {});
  enabled.showOrderSum = false;
  return {
    paperSize: "80mm",
    autoPrint: false,
    blocks: [...KITCHEN_BLOCKS],
    enabled,
    blockStyles: JSON.parse(JSON.stringify(CHEF_DEFAULT_BLOCK_STYLES)),
  };
}

// Normalize any stored kitchen template (including pre-redesign blobs with
// legacy keys) into the 8-row constructor model. Legacy keys and hidden
// values (paperSize/autoPrint/priority/old style entries) are preserved
// untouched inside the blob — only the visible model is remapped.
// Retired chef size "medium" normalizes to "large" (nearest emphasized
// successor) so old rows always show a selected, canonical state.
export function normalizeChefSize(value) {
  return value === "medium" ? "large" : value;
}
export function migrateKitchenTemplate(stored, defaults) {
  const base = defaults || buildKitchenTemplate();
  const s = stored && typeof stored === "object" ? stored : {};
  const leg = (s.enabled && typeof s.enabled === "object" ? s.enabled : {});
  const hasNewKey = Array.isArray(s.blocks) && s.blocks.some((b) => KITCHEN_BLOCKS.includes(b));
  const enabled = { ...base.enabled, ...leg };
  for (const key of KITCHEN_BLOCKS) {
    if (key === "showOrderSum") enabled[key] = leg[key] ?? false;
    else if (key === "date") enabled[key] = leg[key] ?? leg.createdAt ?? true;
    else if (key === "comment") {
      enabled[key] = leg[key] ?? ((leg.itemComments ?? true) || (leg.orderNote ?? true));
    } else enabled[key] = leg[key] ?? true;
  }
  return {
    ...base,
    ...s,
    paperSize: s.paperSize || base.paperSize,
    autoPrint: s.autoPrint ?? base.autoPrint,
    blocks: hasNewKey
      ? s.blocks.filter((b) => KITCHEN_BLOCKS.includes(b)).concat(
        KITCHEN_BLOCKS.filter((b) => !s.blocks.includes(b)),
      )
      : [...base.blocks],
    enabled,
    blockStyles: {
      // Non-constructor style entries (legacy keys) pass through untouched.
      ...(s.blockStyles && typeof s.blockStyles === "object" ? s.blockStyles : {}),
      ...Object.fromEntries(
        KITCHEN_BLOCKS.map((key) => {
          const merged = {
            ...CHEF_DEFAULT_BLOCK_STYLES[key],
            ...((s.blockStyles && typeof s.blockStyles === "object" ? s.blockStyles[key] : {}) || {}),
          };
          if (merged.size !== undefined) merged.size = normalizeChefSize(merged.size);
          return [key, merged];
        }),
      ),
    },
  };
}

async function getTemplate(url, key, fallback, { signal } = {}) {
  const { data } = await (signal ? api.get(url, { signal }) : api.get(url));
  return { template: { ...fallback, ...data }, source: "api", cacheKey: key };
}

async function saveTemplate(url, key, template) {
  const { data } = await api.patch(url, template);
  return { template: { ...template, ...data }, source: "api", cacheKey: key };
}

async function postPrint(url, payload) {
  const { data } = await api.post(url, payload || {});
  return { ok: true, data, source: "api" };
}

function localTestPrint() {
  if (typeof window !== "undefined" && typeof window.print === "function") {
    window.print();
  }
  return Promise.resolve({ ok: true, source: "local" });
}

export function getCustomerTemplate(org, options) {
  return getTemplate("/settings/receipt-template", CUSTOMER_TEMPLATE_KEY, buildCustomerTemplate(org), options);
}

export function saveCustomerTemplate(template) {
  return saveTemplate("/settings/receipt-template", CUSTOMER_TEMPLATE_KEY, template);
}

export function getKitchenTemplate(options) {
  return getTemplate("/settings/kitchen-receipt-template", KITCHEN_TEMPLATE_KEY, buildKitchenTemplate(), options);
}

export function saveKitchenTemplate(template) {
  return saveTemplate("/settings/kitchen-receipt-template", KITCHEN_TEMPLATE_KEY, template);
}

export function testPrintReceipt(template) {
  return localTestPrint(template);
}

export function testPrintKitchen(template) {
  return localTestPrint(template);
}

export function printOrderReceipt(orderId) {
  return postPrint(`/printers/print/orders/${orderId}/receipt`);
}

export function printKitchenReceipt(orderId) {
  return postPrint(`/printers/print/orders/${orderId}/kitchen`);
}
