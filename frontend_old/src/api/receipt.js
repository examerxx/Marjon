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
  "qr",
  "thankYouText",
  "footerText",
];

export const KITCHEN_BLOCKS = [
  "orderNumber",
  "table",
  "waiter",
  "createdAt",
  "station",
  "items",
  "modifiers",
  "itemComments",
  "orderNote",
  "priority",
];

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
  qr: "QR",
  thankYouText: "Текст благодарности",
  footerText: "Нижний текст",
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
  "footerText",
];

export const KITCHEN_BLOCK_LABELS = {
  orderNumber: "Номер заказа",
  table: "Стол",
  waiter: "Официант",
  createdAt: "Время создания",
  station: "Станция",
  items: "Позиции",
  modifiers: "Модификаторы",
  itemComments: "Комментарии к позициям",
  orderNote: "Комментарий заказа",
  priority: "Приоритет",
};

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  return value;
}

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
  enabled.qr = false;
  enabled.vat = false;

  return {
    paperSize: "80mm",
    blocks: [...CUSTOMER_BLOCKS],
    enabled,
    thankYouText: "XARIDINGIZ\nUCHUN RAXMAT!",
    footerText: organization.phone || "+998770702101",
    blockStyles: {
      ...blockStyles,
      restaurantName: { size: "large", align: "center", weight: "bold" },
      orderNumber: { size: "standard", align: "center", weight: "bold" },
      dateTime: { size: "standard", align: "center", weight: "bold" },
      total: { size: "xlarge", align: "left", weight: "standard" },
      thankYouText: { size: "large", align: "center", weight: "bold" },
      footerText: { size: "large", align: "center", weight: "bold" },
    },
    positions: {
      logo: { x: 0, y: 0 },
      restaurantName: { x: 0, y: 0 },
      qr: { x: 0, y: 0 },
      thankYouText: { x: 0, y: 0 },
      footerText: { x: 0, y: 0 },
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
  return {
    paperSize: "80mm",
    autoPrint: false,
    blocks: [...KITCHEN_BLOCKS],
    enabled: KITCHEN_BLOCKS.reduce((acc, key) => ({ ...acc, [key]: true }), {}),
  };
}

async function getTemplate(url, key, fallback) {
  try {
    const { data } = await api.get(url);
    const template = { ...fallback, ...data };
    writeStorage(key, template);
    return { template, source: "api" };
  } catch {
    return { template: readStorage(key, fallback), source: "local" };
  }
}

async function saveTemplate(url, key, template) {
  try {
    const { data } = await api.patch(url, template);
    const saved = { ...template, ...data };
    writeStorage(key, saved);
    return { template: saved, source: "api" };
  } catch {
    return { template: writeStorage(key, template), source: "local" };
  }
}

async function postPrint(url, payload) {
  try {
    const { data } = await api.post(url, payload || {});
    return { ok: true, data, source: "api" };
  } catch (error) {
    return {
      ok: false,
      source: "offline",
      detail: error.response?.data?.detail || "Принтер API недоступен.",
    };
  }
}

export function getCustomerTemplate(org) {
  return getTemplate("/settings/receipt-template", CUSTOMER_TEMPLATE_KEY, buildCustomerTemplate(org));
}

export function saveCustomerTemplate(template) {
  return saveTemplate("/settings/receipt-template", CUSTOMER_TEMPLATE_KEY, template);
}

export function getKitchenTemplate() {
  return getTemplate("/settings/kitchen-receipt-template", KITCHEN_TEMPLATE_KEY, buildKitchenTemplate());
}

export function saveKitchenTemplate(template) {
  return saveTemplate("/settings/kitchen-receipt-template", KITCHEN_TEMPLATE_KEY, template);
}

export function testPrintReceipt(template) {
  return postPrint("/printers/print/test-receipt", { template });
}

export function testPrintKitchen(template) {
  return postPrint("/printers/print/test-kitchen", { template });
}

export function printOrderReceipt(orderId) {
  return postPrint(`/printers/print/orders/${orderId}/receipt`);
}

export function printKitchenReceipt(orderId) {
  return postPrint(`/printers/print/orders/${orderId}/kitchen`);
}
