import { Children, cloneElement, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { warehouseService } from "../api/warehouse";
import { nomenclatureService } from "../api/nomenclature";
import { catalogService } from "../api/catalog";
import { settingsService } from "../api/settings";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";
import Icon from "../components/Icon";
import Toast from "../components/Toast";
import ReportDateRangePicker from "../components/ReportDateRangePicker";
import ReportEmptyState from "../components/ReportEmptyState";
import DishSingleSelect from "./nomenclature/DishSingleSelect";
import PurchaseDrawer from "./warehouse/PurchaseDrawer";
import ExpenseDrawer from "./warehouse/ExpenseDrawer";
import WasteDrawer from "./warehouse/WasteDrawer";
import InventoryModal from "./warehouse/InventoryModal";
import InventoryDetailModal from "./warehouse/InventoryDetailModal";
import WarehouseModal from "./warehouse/WarehouseModal";
import { readOutgoingReport } from "./warehouse/outgoingReport";
import { dashboardPeriodFromSearch } from "./dashboard/reportRange";
import { webDayKey, webDateTime, webFormat } from "../utils/webTime";
import { t } from "../i18n/t";

const ACTIVE = "active";
const ARCHIVE = "archive";

const sectionAliases = {
  "stock-in": "incoming",
  "stock-out": "outgoing",
  balance: "stock",
  "income-log": "incoming-journal",
  expense: "outgoing",
};

const warehouseConfigs = {
  incoming: {
    title: "Приход товаров",
    primaryAction: "Новый приход +",
    drawerTitle: "Новый приход",
    importExcel: true,
    tabs: true,
    editable: true,
    itemDrawer: true,
    summary: [
      { label: "Всего приходов", icon: "bi-box-arrow-in-down", tone: "blue" },
      { label: "Сумма прихода", icon: "bi-cash-stack", tone: "green" },
      { label: "Поставщиков", icon: "bi-people", tone: "purple" },
      { label: "Черновики", icon: "bi-journal-text", tone: "orange" },
    ],
    filters: [
      ["warehouse", "Склад", "Все"],
      ["supplier", "Поставщик", "Все"],
      ["status", "Статус", "Все"],
    ],
    columns: ["№", "Документ", "Поставщик", "Склад", "Сумма", "Статус", "Дата", "Действия"],
  },
  outgoing: {
    title: "Расход товаров",
    primaryAction: "Новый расход +",
    drawerTitle: "Новый расход",
    tabs: true,
    editable: true,
    summary: [
      { label: "Всего расходов", icon: "bi-box-arrow-up", tone: "blue" },
      { label: "Сумма расхода", icon: "bi-cash-stack", tone: "green" },
      { label: "Проведено", icon: "bi-check2-circle", tone: "purple" },
      { label: "В ожидании", icon: "bi-clock-history", tone: "orange" },
    ],
    filters: [
      ["warehouse", "Склад", "Все"],
      ["receiver", "Получатель", "Все"],
      ["status", "Статус", "Все"],
    ],
    columns: ["№", "Документ", "Получатель / Категория", "Склад", "Сумма", "Статус", "Дата", "Действия"],
  },
  stock: {
    title: "Остаток товаров",
    // V36/V37: сводка по складам в шелле блюд (как ZimZim-Остаток, но без
    // Полуфабриката): №/Название/Продукты/Товары/Сумма/Статус/Действия + Итого
    // снизу. Продукты склада = Σ qty×cost_price его stock-строк, НЕ связанных
    // с Товарами; Товары = Σ строк, чей ingredient_id пришёл из прихода
    // с product_id (или совпал по имени/ед.изм с карточкой sale);
    // Сумма = Продукты + Товары. Статус = is_active (V37, точка как в
    // Официантах). NB: секция stock рендерит собственный thead (ветка ниже),
    // этот массив columns для stock не используется — держим его в
    // соответствии, чтобы не вводил в заблуждение.
    columns: ["№", "Название", "Продукты", "Товары", "Сумма", "Статус", "Действия"],
  },
  "incoming-journal": {
    title: "Добавить продуктов",
    primaryAction: "Создать",
    drawerTitle: "Создать приход",
    tabs: true,
    editable: true,
    itemDrawer: true,
    // Черновиков/статусов нет: «Сохранить» = сразу «Принято», остатки
    // двигаются в момент создания.
    summary: [
      { label: "Всего приходов", icon: "bi-box-arrow-in-down", tone: "blue" },
      { label: "Сумма прихода", icon: "bi-cash-stack", tone: "green" },
      { label: "Поставщиков", icon: "bi-people", tone: "purple" },
    ],
    filters: [
      ["warehouse", "Склад", "Все"],
      ["supplier", "Поставщик", "Все"],
      ["status", "Статус", "Все"],
    ],
    // Колонки Действия нет специально: удалять документы из журнала нельзя,
    // очистка — только из Настройки → Основные данные.
    columns: ["№", "Поставщик", "На склад", "Дата поступления", "Дата регистрации", "Итоговая сумма"],
  },
  transfer: {
    title: "Перемещение",
    primaryAction: "Новое перемещение +",
    drawerTitle: "Новое перемещение",
    tabs: true,
    editable: true,
    filters: [
      ["from", "Со склада", "Все"],
      ["to", "На склад", "Все"],
      ["status", "Статус", "Все"],
    ],
    columns: ["№", "Документ", "Со склада", "На склад", "Кол-во позиций", "Сумма", "Статус", "Дата", "Действия"],
  },
  inventory: {
    title: "Инвентаризация",
    // V42: таблица как «Добавить продуктов»: №/Склад/Дата регистрации/
    // Комментарий + кнопка Создать (модалка корректировки:
    // факт − остаток → излишки в приход, недостачи в расход).
    primaryAction: "Создать",
    columns: ["№", "Склад", "Дата регистрации", "Комментарий"],
  },
  "write-off": {
    title: "Списание",
    // Отчёт только для чтения: бэкенд отдаёт списания без склада и без
    // структурной суммы (сумма может быть в тексте примечания).
    filters: [
      ["category", "Категория", "Все"],
      ["status", "Статус", "Все"],
    ],
    columns: ["Дата", "Категория", "Позиций", "Статус", "Автор", "Примечание"],
  },
  "write-off-categories": {
    title: "Категории списания",
    // Клиентская агрегация /warehouse/write-offs по категории (отдельного
    // эндпоинта нет): сколько документов и позиций в каждой категории.
    filters: [["category", "Категория", "Все"]],
    columns: ["Категория", "Документов", "Позиций"],
  },
  waste: {
    title: "Отход товаров",
    primaryAction: "Добавить отход +",
    drawerTitle: "Добавить отход",
    tabs: true,
    editable: true,
    summary: [
      { label: "Всего отходов", icon: "bi-recycle", tone: "blue" },
      { label: "Сумма отходов", icon: "bi-cash-stack", tone: "green" },
      { label: "Автоотход", icon: "bi-gear", tone: "purple" },
      { label: "Ручной отход", icon: "bi-pencil", tone: "orange" },
    ],
    filters: [
      ["category", "Категория", "Все"],
      ["author", "Автор", "Все"],
    ],
    columns: ["Дата", "Категория", "Товар", "Ед. изм", "Кол-во", "Сумма", "Автор", "Причина", "Действия"],
  },
};

// WH-01: остаток (stock), расход (outgoing) и отход (waste) разморожены —
// грузятся и мутируются как приход. Добавить продуктов (incoming-journal)
// работает на том же контракте приходов (/warehouse/purchases).
const sectionUnavailableMessages = {
  "write-off": "Документы списания недоступны: подтверждённый backend contract не соответствует семантике этого экрана.",
  "write-off-categories": "Категории списания недоступны: подтверждённый backend contract не подключён.",
};

// Диспетчеризация мутаций по секциям: приход/расход/отход делят один UI, но
// бьют в разные эндпоинты. Проведение везде = PATCH status:"accepted"
// (приход увеличивает остаток, расход и отход — уменьшают, при нехватке 422).
const sectionMutations = {
  incoming: {
    create: (payload) => warehouseService.createPurchase(payload),
    accept: (id) => warehouseService.acceptPurchase(id),
    remove: (id) => warehouseService.deletePurchase(id),
    createLabel: "приход",
    acceptConfirm: "Провести приход? Остатки увеличатся.",
    deleteConfirm: "Удалить приход? Действие необратимо.",
    acceptTitle: "Провести приход",
    deleteTitle: "Удалить приход",
  },
  "incoming-journal": {
    create: (payload) => warehouseService.createPurchase(payload),
    accept: (id) => warehouseService.acceptPurchase(id),
    remove: (id) => warehouseService.deletePurchase(id),
    createLabel: "приход",
    acceptConfirm: "Провести приход? Остатки увеличатся.",
    deleteConfirm: "Удалить приход? Действие необратимо.",
    acceptTitle: "Провести приход",
    deleteTitle: "Удалить приход",
  },
  outgoing: {
    create: (payload) => warehouseService.createExpense(payload),
    accept: (id) => warehouseService.acceptExpense(id),
    remove: (id) => warehouseService.deleteExpense(id),
    createLabel: "расход",
    acceptConfirm: "Провести расход? Остатки уменьшатся.",
    deleteConfirm: "Удалить расход? Действие необратимо.",
    acceptTitle: "Провести расход",
    deleteTitle: "Удалить расход",
  },
  waste: {
    create: (payload) => warehouseService.createWaste(payload),
    accept: (id) => warehouseService.acceptWaste(id),
    remove: (id) => warehouseService.deleteWaste(id),
    createLabel: "отход",
    acceptConfirm: "Провести отход? Остаток уменьшится.",
    deleteConfirm: "Удалить отход? Действие необратимо.",
    acceptTitle: "Провести отход",
    deleteTitle: "Удалить отход",
  },
  // V42: инвентаризация — только удаление шапки (проведение происходит
  // атомарно в момент создания на бэкенде, accept-кнопки нет).
  inventory: {
    create: (payload) => warehouseService.createInventory(payload),
    remove: (id) => warehouseService.deleteInventory(id),
    createLabel: "инвентаризацию",
    deleteConfirm: "Удалить инвентаризацию? Связанные документы прихода/расхода останутся.",
    deleteTitle: "Удалить инвентаризацию",
  },
};

const WAREHOUSE_WRITE_UNAVAILABLE = "Изменения недоступны до подключения подтверждённого Warehouse write contract.";

function normalizeSection(section) {
  return sectionAliases[section] || section || "incoming";
}

// Сегодня строкой YYYY-MM-DD (верхняя граница поля периода).
function todayStr() {
  return webDayKey();
}

// Сегодня строкой DD.MM.YYYY (формат пикера периода из отчётов).
function todayDDMM() {
  return webFormat(new Date(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

// as_of (YYYY-MM-DD) → DD.MM.YYYY для значения пикера.
function asOfToDDMM(asOfText) {
  const m = String(asOfText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : todayDDMM();
}

// Конец периода пикера (DD.MM.YYYY) → as_of (YYYY-MM-DD) для API.
export function stockRangeToAsOf(range) {
  const raw = String(range?.end || range?.start || "");
  const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Дата документа → YYYY-MM-DD для сравнения с диапазоном.
// Документы прихода/расхода хранят дату строкой YYYY-MM-DD, сводка
// журнала показывает DD-MM-YYYY — понимаем оба формата (+ точки).
export function docDateToISO(raw) {
  const text = String(raw || "").trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/^(\d{2})[.\-](\d{2})[.\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

// Дата регистрации → YYYY-MM-DD в Asia/Tashkent для фильтра периода.
// Бэкенд хранит registered_at строкой UTC без зоны ("13.10.2026 / 07:18",
// _now() в warehouse_router.py) — как и в показе (formatDocDateTime),
// переводим в день web (UTC+5), независимо от часового пояса браузера.
export function registeredAtToISO(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  let date = null;
  const bare = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s*\/\s*(\d{2}):(\d{2})/);
  if (bare) {
    date = new Date(Date.UTC(Number(bare[3]), Number(bare[2]) - 1, Number(bare[1]), Number(bare[4]), Number(bare[5])));
  } else if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const iso = text.includes("T") ? text : `${text.slice(0, 10)}T00:00:00Z`;
    const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const parsed = new Date(zoned);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  return webDayKey(date);
}

// Секции-журналы, где период из отчётов реально фильтрует документы.
const DOC_RANGE_SECTIONS = ["incoming", "outgoing", "incoming-journal", "inventory", "waste"];

// Диапазон документов по умолчанию — как в отчётах: Сегодня.
function defaultDocRange() {
  const today = todayDDMM();
  return { preset: "Сегодня", start: today, end: today };
}

// Период переживает перемонтирование внутри одной подкатегории: список,
// создание и деталка документа — разные роуты (разные инстансы страницы),
// назад должен вернуть тот же период. Смена подкатегории кэш сбрасывает.
let cachedDocRangeSection = "";
let cachedDocRangeValue = null;
function initialDocRange(section) {
  const requested = section === "outgoing" ? dashboardPeriodFromSearch(window.location.search) : null;
  if (requested) {
    cachedDocRangeSection = section;
    cachedDocRangeValue = requested;
    return requested;
  }
  if (cachedDocRangeSection === section && cachedDocRangeValue) return cachedDocRangeValue;
  cachedDocRangeSection = section;
  cachedDocRangeValue = defaultDocRange();
  return cachedDocRangeValue;
}
export function __resetDocRangeCache() {
  cachedDocRangeSection = "";
  cachedDocRangeValue = null;
}

function formatAmount(value) {
  // Суммы — целыми, без дробной части (1 030 148,001 → 1 030 148).
  // Округляем только отображение, сырые значения не трогаем.
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value) || 0)} UZS`;
}

// Цена в просмотре документа — целой частью вниз: 40 798.9738 → 40 798
// (без округления вверх, как просил owner). Сырое значение не трогаем,
// итоговая сумма считается из полного значения и показывается через formatAmount.
function formatIntTrunc(value) {
  const num = Number(value) || 0;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.trunc(num));
}

function formatQty(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

// Последняя введённая ЦЕНА по позициям прихода (localStorage): вчера ввели
// для Мяса 110 000 — сегодня поле цены уже заполнено. Количество НЕ храним:
// каждый приход вводится заново с пустого кол-ва. Ключ — стабильный key
// строки (ing-{id}/sale-{id}). Записываем только при успешном сохранении
// документа, читаем при открытии создания. Просмотр истории не трогаем.
const PURCHASE_LAST_VALUES_KEY = "marjon:purchase-last-values:v1";
function readPurchaseLastValues() {
  try {
    if (typeof localStorage === "undefined") return {};
    const parsed = JSON.parse(localStorage.getItem(PURCHASE_LAST_VALUES_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function savedDocNumber(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const num = Number(raw.replace(",", "."));
  return Number.isFinite(num) && num >= 0 ? raw : "";
}
function writePurchaseLastValues(patch) {
  try {
    if (typeof localStorage === "undefined") return;
    const current = readPurchaseLastValues();
    localStorage.setItem(PURCHASE_LAST_VALUES_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // private mode/quota — молча, форма работает как раньше
  }
}

// Дата документа — строкой YYYY-MM-DD (поле date инпута). В списке показываем
// как DD-MM-YYYY (08-10-2026), в тон колонке регистрации.
// registered_at backend отдаёт строкой UTC без зоны ("13.10.2026 / 07:18",
// см. _now() в warehouse_router.py). Показываем в Asia/Tashkent (+5).
// ISO с зоной тоже понимаем; повторно пять часов не прибавляем.
function formatDocDate(raw) {
  const text = String(raw || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return text || "—";
}
function formatDocDateTime(raw) {
  const text = String(raw || "").trim();
  if (!text) return "—";
  let date = null;
  const bare = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s*\/\s*(\d{2}):(\d{2})/);
  if (bare) {
    date = new Date(Date.UTC(Number(bare[3]), Number(bare[2]) - 1, Number(bare[1]), Number(bare[4]), Number(bare[5])));
  } else if (text.includes("T")) {
    const zoned = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
    const parsed = new Date(zoned);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return text;
  return webDateTime(date);
}

// V36: сводка остатков по складам (warehouseSummary ниже) считается из тех
// же трёх источников (/inventory/stock + /warehouse/list); стоимость склада =
// Σ qty×cost_price его stock-строк. Потоварные строки больше не рендерятся.

// Бэкенд отдаёт статусы документов по-английски (draft/accepted/completed…) —
// приводим к русским меткам, которые понимает бейдж statusTone.
function translateDocStatus(status) {
  const map = { draft: "Черновик", accepted: "Принято", completed: "Завершено", cancelled: "Отменено", canceled: "Отменено", pending: "В ожидании" };
  const key = String(status || "").toLowerCase();
  return map[key] || (status || "—");
}

function mapWarehouseReadRow(section, item) {
  if (section === "incoming") {
    // Бэкенд отдаёт status "draft"/"accepted"; проведённый документ также имеет
    // accepted_at. Приводим к русской метке для бейджа и держим булев флаг
    // accepted — по нему прячем кнопку «Провести» и красим статус в green.
    const accepted = item.status === "accepted" || Boolean(item.accepted_at);
    return {
      id: item.id,
      document: item.number == null ? "—" : String(item.number),
      supplier: item.supplier || "—",
      warehouse: item.warehouse_name || "—",
      // Сводка Прихода группирует по складу — держим id для группировки
      // (имя одно может повторяться, старые документы без id — по имени).
      warehouseId: item.warehouse_id || "",
      total: item.total_amount == null ? "—" : formatAmount(item.total_amount),
      status: accepted ? "Принято" : "Черновик",
      accepted,
      date: item.date || "",
      positions: String(item.items_count ?? "—"),
      registeredAt: item.registered_at || "",
      // Период журналов считается по дате регистрации (фолбэк — поступление
      // для старых документов без registered_at).
      regDate: registeredAtToISO(item.registered_at) || docDateToISO(item.date),
      acceptedAt: item.accepted_at || "",
      author: item.created_by_name || "",
      archiveState: ACTIVE,
    };
  }

  if (section === "transfer") {
    return {
      id: item.id,
      document: "—",
      from: item.from_warehouse_name || "—",
      to: item.to_warehouse_name || "—",
      positions: String(item.items_count ?? "—"),
      total: "—",
      status: translateDocStatus(item.status),
      date: item.date || "",
      archiveState: ACTIVE,
    };
  }

  if (section === "incoming-journal") {
    // Статусов нет: каждый сохранённый приход уже принят (остатки сдвинуты
    // в момент создания).
    return {
      id: item.id,
      document: item.number == null ? "—" : String(item.number),
      supplier: item.supplier || "—",
      warehouse: item.warehouse_name || "—",
      warehouseId: item.warehouse_id || "",
      date: formatDocDate(item.date || (item.created_at || "").slice(0, 10)),
      registeredAt: item.registered_at
        ? formatDocDateTime(item.registered_at)
        : formatDocDateTime(item.created_at),
      // Период считается по дате регистрации (сырой registered_at, не показ).
      regDate: registeredAtToISO(item.registered_at) || registeredAtToISO(item.created_at) || docDateToISO(item.date),
      positions: String(item.items_count ?? "—"),
      total: item.total_amount == null ? "—" : formatAmount(item.total_amount),
      author: item.created_by_name || "—",
      archiveState: ACTIVE,
    };
  }

  if (section === "inventory") {
    // V42: номер — порядковый в таблице, склад, дата регистрации (created_at
    // бэкенда), комментарий, статус. Период — по дате регистрации.
    return {
      id: item.id,
      warehouse: item.warehouse_name || "—",
      warehouseId: item.warehouse_id || "",
      registeredAt: item.created_at ? formatDocDateTime(item.created_at) : "—",
      regDate: registeredAtToISO(item.created_at),
      comment: item.comment || "—",
      status: translateDocStatus(item.status),
      accepted: item.status === "accepted",
      author: item.created_by_name || "—",
      archiveState: ACTIVE,
    };
  }

  if (section === "write-off") {
    return {
      id: item.id,
      date: item.created_at ? webFormat(item.created_at, { day: "2-digit", month: "2-digit", year: "numeric" }) : "—",
      category: item.category || "—",
      positions: String(item.items_count ?? "—"),
      status: translateDocStatus(item.status),
      author: item.created_by_name || "—",
      note: item.note || "—",
      archiveState: ACTIVE,
    };
  }

  if (section === "outgoing") {
    // Документ расхода зеркалит приход: number/receiver/warehouse/total/status.
    // accepted прячет кнопку «Провести» и красит статус в green.
    const accepted = item.status === "accepted" || Boolean(item.accepted_at);
    return {
      id: item.id,
      document: item.number == null ? "—" : String(item.number),
      receiver: item.receiver || "—",
      warehouse: item.warehouse_name || "—",
      // Сводка Расхода группирует по складу — держим id (как в приходе).
      warehouseId: item.warehouse_id || "",
      total: item.total_amount == null ? "—" : formatAmount(item.total_amount),
      status: accepted ? "Принято" : "Черновик",
      accepted,
      date: item.date || "",
      positions: String(item.items_count ?? "—"),
      author: item.created_by_name || "",
      registeredAt: item.registered_at || "",
      // Период считается по дате регистрации (фолбэк — дата документа).
      regDate: registeredAtToISO(item.registered_at) || docDateToISO(item.date),
      archiveState: ACTIVE,
    };
  }

  if (section === "waste") {
    // Построчный документ отхода (одна позиция). isAutomatic питает сводки
    // «Автоотход»/«Ручной отход»; accepted управляет кнопкой «Провести».
    // Склад/дата регистрации — как в инвентаризации (таблица ниже зеркалит
    // её каркас: №/Склад/Дата регистрации/Товар/Кол-во/Причина/Действия).
    const accepted = item.status === "accepted" || Boolean(item.accepted_at);
    return {
      id: item.id,
      warehouse: item.warehouse_name || "—",
      warehouseId: item.warehouse_id || "",
      date: formatDocDate(item.date || (item.created_at || "").slice(0, 10)),
      registeredAt: item.registered_at
        ? formatDocDateTime(item.registered_at)
        : item.created_at ? formatDocDateTime(item.created_at) : formatDocDate(item.date),
      regDate: registeredAtToISO(item.registered_at) || docDateToISO(item.date),
      category: item.category || "—",
      product: item.name || "—",
      unit: item.unit || "—",
      quantity: formatQty(item.quantity),
      price: item.cost_price == null ? "—" : formatAmount(item.cost_price),
      total: item.total_amount == null ? "—" : formatAmount(item.total_amount),
      author: item.created_by_name || "—",
      reason: item.reason || "—",
      status: accepted ? "Принято" : "Черновик",
      accepted,
      isAutomatic: item.is_automatic ?? null,
      archiveState: ACTIVE,
    };
  }

  return { id: item.id, archiveState: ACTIVE };
}

// Текстовый индекс строки для поиска по таблице (incoming/outgoing/waste и т.п.).
// Был утерян при рефакторе (остался «висячий» unreachable return внутри
// mapWarehouseReadRow) — из-за чего visibleRows с данными падал ReferenceError.
function rowSearchText(row) {
  return Object.values(row).filter((value) => typeof value !== "object").join(" ").toLowerCase();
}

function statusTone(status) {
  if (["Проведено", "Принято", "Завершено", "Активно", "Норма"].includes(status)) return "green";
  if (["Черновик", "В ожидании", "Низкий остаток"].includes(status)) return "orange";
  if (["Отменено", "Нет в наличии"].includes(status)) return "red";
  return "gray";
}

// Приходные документы за период (общий docRange, фильтр по regDate
// с фолбэком на дату документа — как в visibleRows).
function filterDocsByPeriod(docs, fromISO, toISO) {
  return (Array.isArray(docs) ? docs : []).filter((row) => {
    const iso = row.regDate || docDateToISO(row.date);
    if (!fromISO && !toISO) return true;
    if (!iso) return false;
    if (fromISO && iso < fromISO) return false;
    if (toISO && iso > toISO) return false;
    return true;
  });
}

// Сводка приходных документов по складам как Остаток: склады из справочника
// (с нулями), затем склады только из документов. Продукт/Товар — по строкам
// listPurchaseDetails (есть product_id → Товар), сумма = qty×cost_price; без деталей
// total документа падает в Продукт, чтобы сумма не терялась.
function aggregatePurchaseSummary(docs, details, warehouses) {
  const accById = new Map();
  const ensure = (key, name) => {
    if (!accById.has(key)) {
      accById.set(key, { id: key.startsWith("name:") ? key.slice(5) : key, key, name: name || "—", product: 0, tovar: 0 });
    }
    return accById.get(key);
  };
  (Array.isArray(warehouses) ? warehouses : []).forEach((wh) => {
    if (!wh?.id) return;
    ensure(String(wh.id), wh.name || "—");
  });
  (Array.isArray(docs) ? docs : []).forEach((row) => {
    const rawId = String(row.warehouseId || "");
    const key = rawId || `name:${row.warehouse || "—"}`;
    const acc = ensure(key, row.warehouse || "—");
    if ((!acc.name || acc.name === "—") && row.warehouse && row.warehouse !== "—") acc.name = row.warehouse;
    const lines = details[row.id];
    if (Array.isArray(lines) && lines.length > 0) {
      lines.forEach((it) => {
        const sum = (Number(it?.quantity) || 0) * (Number(it?.cost_price) || 0);
        if (it?.product_id) acc.tovar += sum;
        else acc.product += sum;
      });
    } else {
      const num = Number(String(row.total || "0").replace(/[^\d]/g, "")) || 0;
      acc.product += num;
    }
  });
  return Array.from(accById.values()).map((r) => ({ ...r, raw: r.product + r.tovar }));
}

// Детализация склада по приходным документам: строки → категории
// (ingredient.category, fallback «Без категории»), итоги
// Всего/Продукты/Товары. Группировку делает groupFn (общий groupLines).
function buildPurchaseDetail(docs, details, ingredientById, groupFn) {
  const lines = [];
  (Array.isArray(docs) ? docs : []).forEach((row) => {
    const docId = row.id;
    const items = Array.isArray(details[docId]) ? details[docId] : [];
    const docRegisteredAt = (() => {
      const formatted = formatDocDateTime(row.registeredAt);
      if (formatted && formatted !== "—") return formatted;
      return formatDocDate(row.date);
    })();
    items.forEach((it, idx) => {
      const ing = it?.ingredient_id && ingredientById ? ingredientById.get(String(it.ingredient_id)) : null;
      const qty = Number(it?.quantity) || 0;
      const cost = Number(it?.cost_price) || 0;
      const isTovar = Boolean(it?.product_id);
      const name = (it?.name) || ing?.name || (isTovar
        ? `Товар ${String(it?.ingredient_id || docId).slice(0, 8)}`
        : `Сырьё ${String(it?.ingredient_id || docId).slice(0, 8)}`);
      lines.push({
        key: `${docId}-${String(it?.id || idx)}`,
        ingredientId: it?.ingredient_id ? String(it.ingredient_id) : "",
        name,
        category: String(ing?.category || "").trim() || "Без категории",
        qty,
        unit: it?.unit || ing?.unit || "кг",
        sum: qty * cost,
        isTovar,
        registeredAt: docRegisteredAt,
      });
    });
  });
  lines.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const productLines = lines.filter((l) => !l.isTovar);
  const tovarLines = lines.filter((l) => l.isTovar);
  const sumQty = (arr) => arr.reduce((acc, line) => acc + line.qty, 0);
  const sumSum = (arr) => arr.reduce((acc, line) => acc + line.sum, 0);
  return {
    lines,
    productGroups: groupFn(productLines),
    tovarGroups: groupFn(tovarLines),
    totalQty: sumQty(lines),
    totalSum: sumSum(lines),
    productQty: sumQty(productLines),
    productSum: sumSum(productLines),
    tovarQty: sumQty(tovarLines),
    tovarSum: sumSum(tovarLines),
  };
}

// Сводка расходных документов по складам как Остаток. Продукт/Товар —
// совпадением шаблона (имя/ед.изм) с карточками sale (у расхода нет
// product_id); без деталей total документа падает в Продукт.
function aggregateExpenseSummary(docs, details, warehouses, ingById, saleKeys) {
  const keys = saleKeys instanceof Set ? saleKeys : new Set();
  const accById = new Map();
  const ensure = (key, name) => {
    if (!accById.has(key)) {
      accById.set(key, { id: key.startsWith("name:") ? key.slice(5) : key, key, name: name || "—", product: 0, tovar: 0 });
    }
    return accById.get(key);
  };
  (Array.isArray(warehouses) ? warehouses : []).forEach((wh) => {
    if (!wh?.id) return;
    ensure(String(wh.id), wh.name || "—");
  });
  (Array.isArray(docs) ? docs : []).forEach((row) => {
    const rawId = String(row.warehouseId || "");
    const key = rawId || `name:${row.warehouse || "—"}`;
    const acc = ensure(key, row.warehouse || "—");
    if ((!acc.name || acc.name === "—") && row.warehouse && row.warehouse !== "—") acc.name = row.warehouse;
    const lines = details[row.id];
    if (Array.isArray(lines) && lines.length > 0) {
      lines.forEach((it) => {
        const sum = (Number(it?.quantity) || 0) * (Number(it?.cost_price) || 0);
        if (keys.size > 0) {
          const ing = it?.ingredient_id && ingById ? ingById.get(String(it.ingredient_id)) : null;
          const name = String(it?.name ?? ing?.name ?? "").trim().toLowerCase();
          const unit = String(it?.unit ?? ing?.unit ?? "").trim().toLowerCase();
          if (keys.has(`${name}||${unit}`)) acc.tovar += sum;
          else acc.product += sum;
        } else {
          acc.product += sum;
        }
      });
    } else {
      const num = Number(String(row.total || "0").replace(/[^\d]/g, "")) || 0;
      acc.product += num;
    }
  });
  return Array.from(accById.values()).map((r) => ({ ...r, raw: r.product + r.tovar }));
}

// Детализация склада по расходным документам за период (склад + regDate).
function buildExpenseDetail(docs, selectedKey, fromISO, toISO, details, ingById, saleKeys, groupFn) {
  const keys = saleKeys instanceof Set ? saleKeys : new Set();
  const lines = [];
  (Array.isArray(docs) ? docs : []).forEach((row) => {
    const rawId = String(row.warehouseId || "");
    const key = rawId || `name:${row.warehouse || "—"}`;
    if (key !== String(selectedKey) && String(row.warehouseId || "") !== String(selectedKey)) return;
    const iso = row.regDate || docDateToISO(row.date);
    if (fromISO || toISO) {
      if (!iso) return;
      if (fromISO && iso < fromISO) return;
      if (toISO && iso > toISO) return;
    }
    const docRegisteredAt = (() => {
      const formatted = formatDocDateTime(row.registeredAt);
      if (formatted && formatted !== "—") return formatted;
      return formatDocDate(row.date);
    })();
    const items = Array.isArray(details[row.id]) ? details[row.id] : [];
    items.forEach((it, idx) => {
      const ing = it?.ingredient_id && ingById ? ingById.get(String(it.ingredient_id)) : null;
      const qty = Number(it?.quantity) || 0;
      const cost = Number(it?.cost_price) || 0;
      const name = String(it?.name ?? "").trim();
      const unit = String(it?.unit ?? ing?.unit ?? "").trim() || "кг";
      const tovarKey = `${String(it?.name ?? ing?.name ?? "").trim().toLowerCase()}||${unit.toLowerCase()}`;
      lines.push({
        key: `${row.id}-${String(it?.id || idx)}`,
        ingredientId: it?.ingredient_id ? String(it.ingredient_id) : "",
        name: name || ing?.name || "—",
        category: String(ing?.category || "").trim() || "Без категории",
        qty,
        unit,
        sum: qty * cost,
        isTovar: keys.size > 0 && keys.has(tovarKey),
        registeredAt: docRegisteredAt,
      });
    });
  });
  lines.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const productLines = lines.filter((l) => !l.isTovar);
  const tovarLines = lines.filter((l) => l.isTovar);
  const sumQty = (arr) => arr.reduce((acc, line) => acc + line.qty, 0);
  const sumSum = (arr) => arr.reduce((acc, line) => acc + line.sum, 0);
  return {
    lines,
    productGroups: groupFn(productLines),
    tovarGroups: groupFn(tovarLines),
    totalQty: sumQty(lines),
    totalSum: sumSum(lines),
    productQty: sumQty(productLines),
    productSum: sumSum(productLines),
    tovarQty: sumQty(tovarLines),
    tovarSum: sumSum(tovarLines),
  };
}

// Авто-расход от продаж по техкартам: продано_порций × норма_на_порцию.
// Пример: мясо 100 кг, плов 0.2 кг/порция, продано 20 → 4 кг, остаток 96 кг.
// Источники: строки отчёта по блюдам (product_id + quantity) + рецепты
// продуктов (ingredients: ingredient_id/quantity/warehouse_id) + справочник
// ингредиентов (имя/категория/ед.изм/себестоимость). Возвращает линии в том же
// формате, что buildExpenseDetail (isTovar=false — это сырьё/Продукт).
export function buildSaleExpenseLines(dishItems, products, ingById, mainWarehouseId, periodLabel) {
  const ingMap = ingById instanceof Map ? ingById : new Map();
  const byProductId = new Map();
  (Array.isArray(products) ? products : []).forEach((p) => {
    if (p?.id != null) byProductId.set(String(p.id), p);
  });
  const acc = new Map();
  (Array.isArray(dishItems) ? dishItems : []).forEach((dish) => {
    const soldQty = Number(dish?.quantity) || 0;
    if (!(soldQty > 0)) return;
    const product = byProductId.get(String(dish?.product_id || dish?.id || ""));
    if (!product) return;
    const recipe = Array.isArray(product?.ingredients) ? product.ingredients : [];
    recipe.forEach((line) => {
      const perPortion = Number(line?.quantity) || 0;
      if (!(perPortion > 0)) return;
      const ingredientId = line?.ingredient_id ? String(line.ingredient_id) : "";
      if (!ingredientId) return;
      const amount = perPortion * soldQty;
      if (!(amount > 0)) return;
      const ing = ingMap.get(ingredientId) || null;
      const cost = Number(ing?.purchase_price ?? 0) || 0;
      const key = `sale-${String(product.id)}-${ingredientId}`;
      const prev = acc.get(key);
      const whKey = line?.warehouse_id ? String(line.warehouse_id) : (mainWarehouseId || "");
      if (prev) {
        prev.qty += amount;
        prev.sum += amount * cost;
        return;
      }
      acc.set(key, {
        key,
        ingredientId,
        name: (line?.ingredient_name || ing?.name || "—"),
        category: String(ing?.category || "").trim() || "Без категории",
        qty: amount,
        unit: (line?.unit || ing?.unit || "кг"),
        sum: amount * cost,
        isTovar: false,
        warehouseKey: whKey,
        dishName: product?.name || "",
        registeredAt: periodLabel || "Продажа",
      });
    });
  });
  return Array.from(acc.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
}

// Расход по складу: один продукт — одна строка. Раньше каждый расходный
// документ/продажа рисовали свою строку, и «Мясо» повторялось столько раз,
// сколько было списаний. Здесь строки складываются в продукт, а блюда из
// авто-расхода по техкартам (поле dishes из /stock/outgoing-report) — в
// разбивку под стрелкой.
//
// Списание продажи без блюд — это не ручной документ: заказ мог быть удалён
// или техкарту переписали и ингредиента в ней больше нет. Причину отдаёт
// бэкенд (dishesReason), и такие строки идут отдельными подписями
// («Заказ удалён» / «Нет в техкарте»), а ручной документ — «Ручным расходом».
// Если техкарту переписали, но заказ жив, бэкенд присылает проданные блюда
// (dishesCandidates) — показываем их третьим уровнем: блюдо видно даже
// спустя месяц после правки рецепта.
const UNLINKED_REASONS = ["order_deleted", "not_in_recipe"];

// Подписи причин, почему у списания продажи нет блюда.
const UNLINKED_REASON_LABEL = {
  order_deleted: "Заказ удалён",
  not_in_recipe: "Нет в техкарте",
  other: "Без разбивки",
};

export function aggregateExpenseProducts(lines) {
  const map = new Map();
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const name = String(line?.name || "—");
    const unit = String(line?.unit || "").trim();
    const key = `${name.toLowerCase()}||${unit.toLowerCase()}`;
    const acc = map.get(key) || {
      key,
      name,
      unit,
      category: String(line?.category || "").trim() || "Без категории",
      qty: 0,
      sum: 0,
      dishes: [],
      manual: [],
      manualQty: 0,
      manualSum: 0,
      unlinked: [],
      unlinkedQty: 0,
      unlinkedSum: 0,
      // Причина → {count, qty, sum}. Без причины — "other" (старый бэкенд).
      unlinkedReasons: {},
    };
    const qty = Number(line?.qty) || 0;
    const sum = Number(line?.sum) || 0;
    acc.qty += qty;
    acc.sum += sum;
    const dishes = Array.isArray(line?.dishes) ? line.dishes : [];
    if (dishes.length > 0) {
      const totalDishQty = dishes.reduce((total, dish) => total + (Number(dish?.qty) || 0), 0);
      const totalCents = Math.round(sum * 100);
      let allocatedCents = 0;
      let allocatedQty = 0;
      dishes.forEach((dish, index) => {
        const dishName = String(dish?.name || "—");
        const dishQty = Number(dish?.qty) || 0;
        // Split each movement at its actual cost before merging different costs.
        // The final share absorbs rounding pennies, preserving the total.
        allocatedQty += dishQty;
        const cents = totalDishQty > 0
          ? (index === dishes.length - 1 ? totalCents : Math.round(totalCents * allocatedQty / totalDishQty)) - allocatedCents
          : 0;
        allocatedCents += cents;
        const found = acc.dishes.find((item) => item.name === dishName);
        if (found) {
          found.qty += dishQty;
          found.sum = Math.round(found.sum * 100 + cents) / 100;
        } else acc.dishes.push({ name: dishName, qty: dishQty, sum: cents / 100 });
      });
    } else if (String(line?.source || "") === "sale") {
      acc.unlinked.push({ ...line, qty, sum });
      acc.unlinkedQty += qty;
      acc.unlinkedSum += sum;
      const reason = UNLINKED_REASONS.includes(line?.dishesReason) ? line.dishesReason : "other";
      const bucket = acc.unlinkedReasons[reason] || { count: 0, qty: 0, sum: 0, candidates: [], candidatesTotal: 0 };
      bucket.count += 1;
      bucket.qty += qty;
      bucket.sum += sum;
      // Техкарту переписали, но заказ жив: бэкенд присылает проданные блюда
      // заказа. Долю на блюдо уже не восстановить, поэтому показываем только
      // состав заказа («Плов — продано 2»), без выдуманных килограммов.
      // Порции считаем по заказам, а не по движениям: у одного заказа бывает
      // несколько списаний (дозаказ), и в каждом лежит весь состав заказа —
      // иначе «Шашлык» задвоился бы вместе с числом движений.
      const orderKey = String(line?.orderId || line?.key || "");
      (Array.isArray(line?.dishesCandidates) ? line.dishesCandidates : []).forEach((candidate) => {
        const candidateName = String(candidate?.name || "—");
        const portions = Number(candidate?.qty) || 0;
        let known = bucket.candidates.find((item) => item.name === candidateName);
        if (!known) {
          known = { name: candidateName, orders: {} };
          bucket.candidates.push(known);
        }
        if (known.orders[orderKey] === undefined) known.orders[orderKey] = portions;
      });
      bucket.candidatesTotal = Math.max(bucket.candidatesTotal, Number(line?.dishesCandidatesTotal) || 0);
      acc.unlinkedReasons[reason] = bucket;
    } else {
      acc.manual.push({ ...line, qty, sum });
      acc.manualQty += qty;
      acc.manualSum += sum;
    }
    map.set(key, acc);
  });
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      isProduct: true,
      dishes: item.dishes.sort((a, b) => b.qty - a.qty),
      // Порции по заказам → к показу: сумма по разным заказам.
      unlinkedReasons: Object.fromEntries(Object.entries(item.unlinkedReasons).map(([reason, bucket]) => [
        reason,
        {
          ...bucket,
          candidates: (bucket.candidates || [])
            .map((candidate) => ({
              name: candidate.name,
              portions: Object.values(candidate.orders || {}).reduce((total, portions) => total + portions, 0),
            }))
            .sort((a, b) => b.portions - a.portions),
        },
      ])),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// «1 блюдо / 2 блюда / 5 блюд» — подпись в служебной колонке строки продукта.
function dishCountLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} блюдо`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} блюда`;
  return `${count} блюд`;
}

// Keep rows mounted through both transition directions. Grid tracks interpolate
// content height without measuring the whole table on every animation frame.
export function ExpenseDisclosureRow({ visible, children, className = "" }) {
  const [expanded, setExpanded] = useState(false);
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    let frame;
    let nextFrame;
    let timer;
    if (visible) {
      setPresent(true);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setExpanded(true));
      });
    } else {
      setExpanded(false);
      timer = setTimeout(() => setPresent(false), 280);
    }
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); clearTimeout(timer); };
  }, [visible]);
  if (!present) return null;
  return (
    <tr hidden={!present} aria-hidden={!visible} inert={!visible ? true : undefined}
      className={`${className} wh-expense-reveal${expanded ? " is-open" : ""}`}>
      {Children.map(children, (cell) => cloneElement(cell, {},
        <div className="wh-expense-reveal__track"><div className="wh-expense-reveal__clip">
          <div className="wh-expense-reveal__content">{cell.props.children}</div>
        </div></div>,
      ))}
    </tr>
  );
}

function WarehousePage({ initialSection = "incoming", warehouseId, onOpenWarehouse, startCreating = false, onOpenCreate, onCloseCreate, detailDocId = "", onOpenDocDetail, focusIngredientId = "" }) {
  const section = normalizeSection(initialSection);
  const config = warehouseConfigs[section] || warehouseConfigs.incoming;
  const unavailableMessage = sectionUnavailableMessages[section] || "";
  const mutation = sectionMutations[section] || null;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState(ACTIVE);
  const [draftFilters, setDraftFilters] = useState({ search: "", warehouse: "", supplier: "", status: "", receiver: "", category: "", author: "", from: "", to: "" });
  const [filters, setFilters] = useState(draftFilters);
  // Период документов (Приход/Расход + журнал) — тот же canonical-пикер,
  // что в отчётах: пресет/диапазон применяется через ОК и реально режет
  // список по дате документа. По умолчанию Сегодня, как в отчётах.
  const [docRange, setDocRangeState] = useState(() => initialDocRange(section));
  const setDocRange = (next) => {
    const value = typeof next === "function" ? next(docRange) : next;
    cachedDocRangeSection = section;
    cachedDocRangeValue = value;
    if (section === "outgoing") {
      const params = new URLSearchParams(window.location.search);
      params.set("date_from", docDateToISO(value.start));
      params.set("date_to", docDateToISO(value.end));
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}${window.location.hash}`);
    }
    setDocRangeState(value);
  };
  const handleDocRange = (range) => {
    setDocRange({
      preset: range?.preset || "",
      start: range?.start || todayDDMM(),
      end: range?.end || range?.start || todayDDMM(),
    });
  };
  // Общий контрол периода журналов: один и тот же пикер в полосе фильтров
  // (Приход/Расход) и в шапке списка «Добавить продуктов» (у журнала своей
  // полосы фильтров нет — только шапка dish-catalog-header).
  const docRangeControl = (
    <ReportDateRangePicker
      variant="canonical"
      animateExit
      value={docRange}
      onChange={handleDocRange}
      buttonAriaLabel={t("report_period.documents")}
    />
  );
  // reloadKey форсит перезагрузку списка после мутаций (создание/проведение/удаление).
  const [reloadKey, setReloadKey] = useState(0);
  // Дравер прихода + его справочники (склады/ингредиенты грузим лениво при открытии).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [refData, setRefData] = useState({ warehouses: [], ingredients: [] });
  const [refLoaded, setRefLoaded] = useState(false);
  // id документа, по которому идёт проведение/удаление — блокирует его кнопки.
  const [busyId, setBusyId] = useState(null);
  // V36: сырьё остатков + склады (для сводки по складам и модалки склада).
  const [stockRaw, setStockRaw] = useState({ items: [], warehouses: [] });
  // Период остатков — полный диапазон как в отчётах (пресет + начало +
  // конец, по умолчанию Сегодня). Кнопка показывает диапазон («12.10.2026 –
  // 13.10.2026»), как в Отчётах. Данные — всегда срез на КОНЕЦ диапазона:
  // "" = текущие остатки, YYYY-MM-DD = срез на конец дня (as-of, считается
  // бэкендом по движениям). Исторический срез — read-only.
  const [stockRange, setStockRange] = useState(() => {
    const today = todayDDMM();
    return { preset: "Сегодня", start: today, end: today };
  });
  // as-of из конца диапазона (будущее зажимаем в текущие).
  const asOf = useMemo(() => {
    const next = stockRangeToAsOf(stockRange);
    return !next || next >= todayStr() ? "" : next;
  }, [stockRange]);
  const asOfDated = Boolean(asOf);
  // Множество ingredient_id, считающихся Товарами: строки, пришедшие из
  // приходов с product_id (Товар из «Добавить продуктов»), плюс совпавшие
  // по имени/ед.изм с карточками sale. Остальное — Продукты.
  const [tovarIngredientIds, setTovarIngredientIds] = useState(() => new Set());
  const [whModal, setWhModal] = useState(null);
  const [whSaving, setWhSaving] = useState(false);
  const [whError, setWhError] = useState("");
  // Детализация Остатка (как ZimZim, без Excel/поиска): клик по названию
  // склада открывает разбивку Всего/Сырьё/категории/позиции. Ингредиенты
  // подгружаем лениво — для имён/категорий строк (stock даёт только id).
  const [selectedWhId, setSelectedWhId] = useState(null);
  // Приход — сводка по складам как Остаток: склады + строки документов
  // (docId → items из listPurchaseDetails). Продукт/Товар делим
  // по строкам: есть product_id → Товар, иначе Продукт; сумма = qty×cost_price.
  const [incomingWarehouses, setIncomingWarehouses] = useState([]);
  const [incomingDetails, setIncomingDetails] = useState({});
  // Выбранный склад сводки Прихода (детализация — его документы за период).
  // Кнопки Назад в шапке нет — возврат стрелкой топбара (pushState + popstate),
  // как у stock (там возврат через роут).
  const [selectedIncomingWhId, setSelectedIncomingWhId] = useState(null);
  // Расход — сводка по складам как Приход: склады + строки документов
  // (docId → items из listExpenseDetails). У строк расхода нет product_id,
  // Товар отделяем совпадением шаблона по имени/ед.изм с карточками sale.
  const [outgoingWarehouses, setOutgoingWarehouses] = useState([]);
  const [outgoingDetails, setOutgoingDetails] = useState({});
  const [outgoingIngById, setOutgoingIngById] = useState(() => new Map());
  const [outgoingSaleKeys, setOutgoingSaleKeys] = useState(() => new Set());
  const [selectedOutgoingWhId, setSelectedOutgoingWhId] = useState(null);
  // Авто-расход от продаж по техкартам (проданные порции × норма):
  // строки отчёта по блюдам + рецепты продуктов за тот же период.
  const [saleError, setSaleError] = useState("");
  const [persistedOutgoing, setPersistedOutgoing] = useState(null);
  // V42: инвентаризация — свой список (шапки проверок) для секции
  // inventory и встроенной таблицы в Приходе. Модалка Создать — ниже.
  const [invRows, setInvRows] = useState([]);
  const [invLoading, setInvLoading] = useState(false);
  const [invError, setInvError] = useState("");
  const [invModalOpen, setInvModalOpen] = useState(false);
  // Просмотр корректировок проверки: клик по строке таблицы открывает
  // компактную модалку (Дата регистрации / Название / Корректировка).
  const [detailCheck, setDetailCheck] = useState(null);
  // Роутный режим: /stock/:warehouseId — выбранный склад приходит пропсом
  // (стрелка топбара navigate(-1) возвращает на список через историю).
  // Без роута (тесты/алиасы) — прежнее внутреннее состояние.
  const activeWhId = warehouseId !== undefined ? warehouseId : selectedWhId;
  const [detailIngredients, setDetailIngredients] = useState([]);
  const [detailIngLoaded, setDetailIngLoaded] = useState(false);
  const [expandedCats, setExpandedCats] = useState({});
  // Категории в фазе закрытия (строки ещё видны 200мс с анимацией).
  const [closingCats, setClosingCats] = useState({});
  // Второй уровень дерева Расхода: раскрытые продукты (одна строка на продукт,
  // под стрелкой — какие блюда его израсходовали). Ключ включает категорию,
  // чтобы одинаковые имена в разных категориях не раскрывались вместе.
  const [expandedProducts, setExpandedProducts] = useState({});
  const closeTimers = useRef({});
  // Переход из колокольчика дефицита: ?ingredient=<id> раскрывает ровно ту
  // категорию, где лежит это сырьё. Применяем один раз на id — иначе ручное
  // сворачивание пользователем тут же отменялось бы повторным раскрытием.
  const focusAppliedRef = useRef("");
  const [focusScrollId, setFocusScrollId] = useState("");
  // Добавить продуктов: раскрытая строка прихода + таблица продуктов
  // (Продукты из /inventory/ingredients + Товары-реализация из /inventory/products).
  // Просмотр состава прихода: отдельный экран (.../incoming-journal/:docId),
  // открывается кликом по строке списка. Только чтение — backend не правит
  // строки существующего документа. Стрелка топбара возвращается на список.
  // История строки внутри подкатегории: тот же readOnly-экран, но без смены
  // роута (detailDocId — прямой заход по ссылке). Выход — назад топбара.
  const [localDocId, setLocalDocId] = useState(null);
  const activeDocId = detailDocId || localDocId;
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(Boolean(activeDocId));
  // Backend без позиций в GET detail (старый код без DetailResponse):
  // состав показать не из чего — говорим это прямо, а не «продукты не добавлены».
  const [docItemsUnavailable, setDocItemsUnavailable] = useState(false);
  const [docProducts, setDocProducts] = useState([]);
  const [docProductsLoading, setDocProductsLoading] = useState(false);
  const [docProductsLoaded, setDocProductsLoaded] = useState(false);
  const [docPriceMap, setDocPriceMap] = useState({});
  const [docQtyMap, setDocQtyMap] = useState({});
  // id склада → название (фолбэк для старых документов без warehouse_name).
  const [whNameById, setWhNameById] = useState({});
  // Режим «ввожу итоговую сумму» — один на всю таблицу.
  // Выкл: Цена + Кол-во → Сумма. Вкл: Кол-во + Сумма → Цена автоматом.
  // При переключении введённые данные переносятся в другую колонку,
  // поэтому ничего не пропадает; уже заполненное не перезаписывается.
  const [createTotalMode, setCreateTotalMode] = useState(false);
  const [docTotalMap, setDocTotalMap] = useState({});
  // Создание прихода таблицей (вместо бокового drawer): полноэкранная
  // таблица как на макете — структура второго фото, дизайн начальной таблицы.
  // Роут-вариант (startCreating + onOpenCreate/onCloseCreate): открытие
  // создания пушит .../create в историю, поэтому стрелка топбара
  // (navigate(-1)) возвращается на список. Без пропсов — локальный фолбэк.
  const [creating, setCreating] = useState(!!startCreating);
  const [createSupplier, setCreateSupplier] = useState("");
  const [createWarehouseId, setCreateWarehouseId] = useState("");
  const [createDate, setCreateDate] = useState(() => webDayKey());
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  // Поставщики из Настройки → Клиенты → Поставщики (GET /crm/counterparties,
  // type=supplier). Грузятся отдельно от refData — нужны только созданию.
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  // Фильтр таблицы создания как в Блюдах: раскрывающаяся панель
  // с живым поиском — Поисковик, Тип (Продукт/Товар), Категория.
  const [createFiltersOpen, setCreateFiltersOpen] = useState(false);
  const [createSearch, setCreateSearch] = useState("");
  const [createType, setCreateType] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const beginRequest = useLatestRequest();
  // Смена секции сбрасывает выбранный склад Прихода (детализация не
  // перетекает между разделами; мутации через reloadKey — не сбрасывают).
  useEffect(() => {
    setSelectedIncomingWhId(null);
    setSelectedOutgoingWhId(null);
    setSelectedInventoryWhId(null);
    setSelectedExpenseInventoryWhId(null);
    setDetailCheck(null);
    setExpandedCats({});
    setClosingCats({});
  }, [section]);

  // Продукты для таблицы создания прихода: шаблоны из «Продуктов»
  // (/inventory/ingredients, Тип Продукт) + Товары-реализация
  // (/inventory/products product_type sale, Тип Товар). Товар backend сам
  // автопривяжет к шаблону при сохранении (см. create_purchase), поэтому
  // складской учёт по нему ведётся как обычно. Название и ед. изм строки —
  // из карточки, руками задаются количество и цена.
  // Подсказка цены — purchase_price (средняя себестоимость из движений).
  const loadDocProducts = async (force = false) => {
    if (!force && (docProductsLoaded || docProductsLoading)) return;
    setDocProductsLoading(true);
    try {
      const [ingRes, prodRes] = await Promise.all([
        nomenclatureService.listIngredients().catch(() => ({ data: [] })),
        catalogService.listProducts({ params: { include_all: true } }).catch(() => ({ data: [] })),
      ]);
      const ings = Array.isArray(ingRes.data) ? ingRes.data : ingRes.data?.items || [];
      const prods = Array.isArray(prodRes.data) ? prodRes.data : prodRes.data?.items || [];
      const activeIngs = ings.filter((r) => r?.is_active !== false);
      const saleProds = prods.filter((p) => String(p?.product_type || "dish") === "sale" && p?.is_active !== false);
      const mapped = [
        ...activeIngs.map((r) => ({
          key: `ing-${r.id}`,
          ingredientId: r.id,
          productId: null,
          category: r.category || "Без категории",
          name: r.name || "—",
          type: "Продукт",
          unit: r.unit || "кг",
          basePrice: Number(r.purchase_price ?? 0) || 0,
        })),
        ...saleProds.map((p) => ({
          key: `sale-${p.id}`,
          ingredientId: null,
          productId: p.id,
          category: p.category_name || "Без категории",
          name: p.name || "—",
          type: "Товар",
          unit: p.unit || "шт",
          basePrice: Number(p.price ?? 0) || 0,
        })),
      ];
      setDocProducts(mapped);
      // Подставляем только последнюю ЦЕНУ (вчера ввели — сегодня уже в поле).
      // Количество и сумму НЕ восстанавливаем — каждый приход вводится заново.
      // Битых/отрицательных значений из хранилища не берём.
      const lastValues = readPurchaseLastValues();
      const prices = {};
      const qtys = {};
      const totals = {};
      mapped.forEach((m) => {
        const saved = lastValues[m.key] || {};
        prices[m.key] = savedDocNumber(saved.price);
        qtys[m.key] = "";
        totals[m.key] = "";
      });
      setDocPriceMap(prices);
      setDocQtyMap(qtys);
      setDocTotalMap(totals);
      setDocProductsLoaded(true);
    } catch {
      setDocProducts([]);
      setDocProductsLoaded(true);
    } finally {
      setDocProductsLoading(false);
    }
  };

  // Просмотр документа: грузим шапку + строки + справочники и раскладываем
  // всё в те же состояния, что у создания — экран один в один как Создать,
  // только в таблице продукты этого документа (не весь каталог).
  useEffect(() => {
    if (!activeDocId || section !== "incoming-journal") return undefined;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    setDocItemsUnavailable(false);
    Promise.all([
      warehouseService.getPurchase(activeDocId).catch((err) => ({ error: err })),
      warehouseService.listIngredients().catch(() => ({ data: [] })),
      warehouseService.listWarehouses().catch(() => ({ data: [] })),
      settingsService.listResource("clients").catch(() => ({ data: [] })),
    ]).then(([docRes, ingRes, whRes, supRes]) => {
      if (cancelled) return;
      if (docRes && docRes.error) {
        const detail = docRes.error?.response?.data?.detail;
        setDetailError(typeof detail === "string" ? detail : "Не удалось загрузить состав документа.");
        setDetailLoading(false);
        return;
      }
      const doc = (docRes && docRes.data) || {};
      const ingData = ingRes && ingRes.data;
      const ings = Array.isArray(ingData) ? ingData : (ingData && ingData.items) || [];
      const ingById = new Map();
      ings.forEach((ing) => {
        if (ing && ing.id) ingById.set(String(ing.id), ing);
      });
      const whData = whRes && whRes.data;
      const whs = Array.isArray(whData) ? whData : (whData && whData.items) || [];
      const supData = supRes && supRes.data;
      const supItems = Array.isArray(supData) ? supData : (supData && supData.items) || [];
      setRefData({ warehouses: whs, ingredients: ings });
      setRefLoaded(true);
      setSuppliers(
        supItems
          .filter((item) => item && (item.type === "supplier" || item.kind === "supplier"))
          .map((item) => ({
            id: item.id,
            name: item.full_name || item.name || "",
            phone: item.phone || "",
          }))
          .filter((item) => item.name),
      );
      setSuppliersLoaded(true);
      setDocItemsUnavailable(!Array.isArray(doc.items));
      const items = Array.isArray(doc.items) ? doc.items : [];
      const mapped = items.map((item, idx) => {
        const ing = item && item.ingredient_id ? ingById.get(String(item.ingredient_id)) : null;
        return {
          key: `doc-${String(item.id || idx)}`,
          ingredientId: item.ingredient_id || null,
          productId: item.product_id || null,
          category: (ing && ing.category) || "Без категории",
          name: (item && item.name) || "—",
          type: item && (item.product_id || !item.ingredient_id) ? "Товар" : "Продукт",
          unit: (item && item.unit) || "кг",
          basePrice: Number((item && item.cost_price) ?? 0) || 0,
        };
      });
      setDocProducts(mapped);
      const prices = {};
      const qtys = {};
      const totals = {};
      mapped.forEach((m, idx) => {
        const src = items[idx] || {};
        prices[m.key] = src.cost_price == null ? "" : String(src.cost_price);
        qtys[m.key] = src.quantity == null ? "" : String(src.quantity);
        totals[m.key] = src.total == null ? "" : String(src.total);
      });
      setDocPriceMap(prices);
      setDocQtyMap(qtys);
      setDocTotalMap(totals);
      setDocProductsLoaded(true);
      setCreateSupplier(doc.supplier || "");
      setCreateWarehouseId(doc.warehouse_id ? String(doc.warehouse_id) : "");
      if (doc.date) setCreateDate(doc.date);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDocId, section]);

  const ensureCreateData = async (forceCatalog = false) => {
    loadDocProducts(forceCatalog);
    if (!refLoaded) {
      try {
        const [whRes, ingRes] = await Promise.all([
          warehouseService.listWarehouses(),
          warehouseService.listIngredients(),
        ]);
        setRefData({ warehouses: whRes.data || [], ingredients: ingRes.data || [] });
        setRefLoaded(true);
      } catch {
        // склады не загрузились — селект покажет пусто, ошибку покажем при сохранении
      }
    }
    if (!suppliersLoaded && !suppliersLoading) {
      setSuppliersLoading(true);
      try {
        const { data } = await settingsService.listResource("clients");
        const items = Array.isArray(data) ? data : data?.items || [];
        setSuppliers(
          items
            .filter((item) => item && (item.type === "supplier" || item.kind === "supplier"))
            .map((item) => ({
              id: item.id,
              name: item.full_name || item.name || "",
              phone: item.phone || "",
            }))
            .filter((item) => item.name),
        );
        setSuppliersLoaded(true);
      } catch {
        // селект поставщика покажет «Поставщики недоступны»
      } finally {
        setSuppliersLoading(false);
      }
    }
  };

  const openCreateTable = () => {
    if (onOpenCreate) {
      onOpenCreate();
      return;
    }
    // Баг: после просмотра строки (localDocId) состояния деталей
    // (docProducts/цены/кол-ва/поставщик/склад/дата) прилипали к созданию —
    // открывалась «таблица» из 1 позиции документа вместо полного каталога.
    // Поэтому всегда сбрасываем detail и форму создания и форсим каталог.
    setLocalDocId(null);
    setDetailError("");
    setDocItemsUnavailable(false);
    setCreateSupplier("");
    setCreateWarehouseId("");
    setCreateDate(() => webDayKey());
    setCreateTotalMode(false);
    setCreateSearch("");
    setCreateType("");
    setCreateCategory("");
    setCreateFiltersOpen(false);
    setDocProducts([]);
    setDocPriceMap({});
    setDocQtyMap({});
    setDocTotalMap({});
    setDocProductsLoaded(false);
    setDocProductsLoading(false);
    setCreateError("");
    pushJournalHistory();
    setCreating(true);
    ensureCreateData(true);
  };

  const closeCreateTable = () => {
    if (createSaving) return;
    if (onCloseCreate) {
      onCloseCreate();
      return;
    }
    setCreating(false);
    setCreateError("");
  };

  // Прямой заход на .../create (или refresh): грузим справочники и продукты.
  useEffect(() => {
    if (startCreating) {
      setCreateError("");
      ensureCreateData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCreating]);

  // Встроенные экраны журнала (создание/история) роут не меняют — пушим
  // запись истории, чтобы назад топбара возвращал к списку, а не уводил
  // из подкатегории. Закрытие встроенного экрана — по popstate ниже.
  const pushJournalHistory = () => {
    try {
      window.history.pushState({ whJournalInline: true }, "", window.location.href);
    } catch {
      // не браузер — игнор
    }
  };
  useEffect(() => {
    if (section !== "incoming-journal") return undefined;
    const onPopState = () => {
      setCreating(false);
      setLocalDocId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [section]);

  // Стрелка топбара из детализаций Прихода — назад на главный экран
  // «Приход товаров» (закрываем внутренние экраны по popstate).
  useEffect(() => {
    if (section !== "incoming") return undefined;
    const onPopState = () => {
      setSelectedIncomingWhId(null);
      setSelectedInventoryWhId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [section]);

  // Стрелка топбара из детализаций Расхода — назад на главный экран
  // «Расход товаров» (закрываем внутренние экраны по popstate).
  useEffect(() => {
    if (section !== "outgoing") return undefined;
    const onPopState = () => {
      setSelectedOutgoingWhId(null);
      setSelectedExpenseInventoryWhId(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [section]);

  const parseDocNumber = (raw) => {
    const text = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
    if (text === "") return 0;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : NaN;
  };

  // Показ чисел: группировка тысяч пробелами + обрезка нулей в хвосте дроби.
  // Backend отдаёт Decimal строкой ("100000.0000" → "100 000", "100.0000" →
  // "100"). Сырое значение в state не трогаем — только отображение.
  const formatSumInput = (raw) => {
    const cleaned = String(raw ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
    if (cleaned === "") return "";
    if (!/^\d*\.?\d{0,6}$/.test(cleaned)) return String(raw ?? "");
    const dot = cleaned.indexOf(".");
    const intRaw = dot === -1 ? cleaned : cleaned.slice(0, dot);
    const fracRaw = dot === -1 ? "" : cleaned.slice(dot + 1);
    const fracPart = fracRaw.replace(/0+$/, "");
    const grouped = (intRaw === "" ? "0" : intRaw).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    if (fracPart) return `${grouped}.${fracPart}`;
    // Точку держим только пока её печатают ("100." → "100."). Хвост из нулей
    // ("100.0000") — это целое, точку убираем ("100").
    if (fracRaw === "") return dot === -1 ? grouped : `${grouped}.`;
    return grouped;
  };

  // Итоговые цифры строки в обоих режимах: обычный (Цена + Кол-во → Сумма)
  // и обратный (Кол-во + Сумма → Цена). Неактивна, пока Кол-во = 0.
  const resolveRowNumbers = (p) => {
    const qty = parseDocNumber(docQtyMap[p.key]);
    if (!Number.isFinite(qty) || qty <= 0) return { qty: 0, price: 0, total: 0, active: false };
    if (createTotalMode) {
      const entered = parseDocNumber(docTotalMap[p.key]);
      const total = Number.isFinite(entered) ? entered : 0;
      const price = Math.round(total / qty);
      return { qty, price, total, active: true };
    }
    const price = parseDocNumber(docPriceMap[p.key]);
    const safePrice = Number.isFinite(price) ? price : 0;
    return { qty, price: safePrice, total: safePrice * qty, active: true };
  };

  const createTotal = useMemo(() => {
    let sum = 0;
    docProducts.forEach((p) => {
      sum += resolveRowNumbers(p).total;
    });
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docProducts, docPriceMap, docQtyMap, docTotalMap, createTotalMode]);

  // Переключение галочки с переносом данных: пустые клетки другой колонки
  // заполняются из уже введённых (цена×кол-во или сумма/кол-во),
  // заполненные вручную не трогаем.
  const applyTotalMode = (next) => {
    if (next) {
      setDocTotalMap((cur) => {
        const map = { ...cur };
        docProducts.forEach((p) => {
          if (String(map[p.key] ?? "") !== "") return;
          const price = parseDocNumber(docPriceMap[p.key]);
          const qty = parseDocNumber(docQtyMap[p.key]);
          if (Number.isFinite(price) && Number.isFinite(qty) && qty > 0 && price > 0) {
            map[p.key] = String(price * qty);
          }
        });
        return map;
      });
    } else {
      setDocPriceMap((cur) => {
        const map = { ...cur };
        docProducts.forEach((p) => {
          if (String(map[p.key] ?? "") !== "") return;
          const total = parseDocNumber(docTotalMap[p.key]);
          const qty = parseDocNumber(docQtyMap[p.key]);
          if (Number.isFinite(total) && Number.isFinite(qty) && qty > 0 && total > 0) {
            map[p.key] = String(Math.round(total / qty));
          }
        });
        return map;
      });
    }
    setCreateTotalMode(next);
  };

  const supplierOptions = useMemo(() => (
    suppliers.map((item) => ({ value: item.name, label: item.name }))
  ), [suppliers]);

  // Создание поставщика прямо из селекта: POST /crm/counterparties
  // {full_name, type:"supplier"}, затем — в живой список и автовыбор.
  const handleCreateSupplier = async (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw new Error("Введите название.");
    const { data } = await settingsService.createResource("clients", {
      full_name: trimmed,
      type: "supplier",
    });
    const itemName = String(data?.full_name || data?.name || trimmed);
    const item = { id: data?.id, name: itemName, phone: data?.phone || "" };
    setSuppliers((current) => (
      current.some((entry) => entry.name === itemName) ? current : [...current, item]
    ));
    setCreateSupplier(itemName);
    return item;
  };

  const createWarehouseOptions = useMemo(() => (
    (Array.isArray(refData.warehouses) ? refData.warehouses : []).map((wh) => ({
      value: String(wh.id),
      label: wh.name || "—",
    }))
  ), [refData.warehouses]);

  // В просмотре выбранное значение обязано показаться, даже если его нет
  // в справочниках (удалён/не загрузился) — подмешиваем из документа.
  const supplierOpts = useMemo(() => {
    if (!activeDocId || !createSupplier || supplierOptions.some((o) => o.value === createSupplier)) return supplierOptions;
    return [...supplierOptions, { value: createSupplier, label: createSupplier }];
  }, [supplierOptions, createSupplier, activeDocId]);

  const warehouseOpts = useMemo(() => {
    if (!activeDocId || !createWarehouseId || createWarehouseOptions.some((o) => o.value === createWarehouseId)) {
      return createWarehouseOptions;
    }
    return [...createWarehouseOptions, { value: createWarehouseId, label: createWarehouseId }];
  }, [createWarehouseOptions, createWarehouseId, activeDocId]);

  const createCategoryOptions = useMemo(() => {
    const set = new Set();
    docProducts.forEach((p) => {
      const value = String(p?.category || "").trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [docProducts]);

  const visibleCreateProducts = useMemo(() => {
    const searchTerm = String(createSearch || "").trim().toLowerCase();
    return docProducts.filter((p) => {
      if (createType && p.type !== createType) return false;
      if (createCategory && String(p.category || "") !== createCategory) return false;
      if (searchTerm) {
        const haystack = `${p.name || ""} ${p.category || ""}`.toLowerCase();
        if (!haystack.includes(searchTerm)) return false;
      }
      return true;
    });
  }, [docProducts, createSearch, createType, createCategory]);

  const clearCreateFilters = () => {
    setCreateSearch("");
    setCreateType("");
    setCreateCategory("");
  };

  const handleCreateSave = async () => {
    if (createSaving) return;
    if (!createWarehouseId) {
      setCreateError("Выберите склад.");
      return;
    }
    // Без количества И цены оприходовать нельзя: строка попадает в документ
    // только при qty > 0 и price > 0 (в режиме суммы — total > 0).
    // Продукт ссылается на шаблон (ingredient_id), Товар — на карточку
    // реализации (product_id, шаблон backend автопривяжет сам).
    const items = [];
    const lastPatch = {};
    docProducts.forEach((p) => {
      const row = resolveRowNumbers(p);
      if (!row.active || !(row.price > 0)) return;
      // Запоминаем только ЦЕНУ — в следующий раз поле цены уже заполнено,
      // а количество всегда пустое (вводится заново каждый приход).
      lastPatch[p.key] = {
        price: String(row.price),
        qty: "",
        total: "",
      };
      if (p.ingredientId) {
        items.push({
          name: p.name,
          ingredient_id: p.ingredientId,
          quantity: row.qty,
          unit: p.unit || "кг",
          cost_price: row.price,
        });
      } else if (p.productId) {
        items.push({
          name: p.name,
          product_id: p.productId,
          quantity: row.qty,
          unit: p.unit || "шт",
          cost_price: row.price,
        });
      }
    });
    if (!items.length) {
      setCreateError("Укажите количество и цену хотя бы для одного продукта.");
      return;
    }
    setCreateSaving(true);
    setCreateError("");
    try {
      await warehouseService.createPurchase({
        supplier: createSupplier.trim() || null,
        warehouse_id: createWarehouseId,
        warehouse_name:
          (Array.isArray(refData.warehouses) ? refData.warehouses : []).find(
            (wh) => String(wh.id) === String(createWarehouseId),
          )?.name || null,
        date: createDate || null,
        note: null,
        items,
      });
      writePurchaseLastValues(lastPatch);
      if (onCloseCreate) {
        onCloseCreate();
        return;
      }
      setCreating(false);
      setCreateSupplier("");
      setCreateWarehouseId("");
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setCreateError(typeof detail === "string" ? detail : "Не удалось сохранить приход.");
    } finally {
      setCreateSaving(false);
    }
  };

  // Enter в полях строки (цена/кол-во/сумма) — тот же Сохранить, что кнопка:
  // оператор вводит количество и фиксирует документ без мыши.
  // Гарды внутри handleCreateSave (склад, непустые строки, saving) те же.
  const submitCreateOnEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleCreateSave();
  };

  useEffect(() => {
    const request = beginRequest();
    if (unavailableMessage) {
      setRows([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const onError = (err) => {
      if (!request.isCurrent() || isAbortError(err)) return;
      setRows([]);
      setError(err.response?.data?.detail || "Не удалось загрузить складские данные.");
      setLoading(false);
    };

    if (section === "stock") {
      // Сводка по складам: остатки + склады, агрегация — в warehouseSummary.
      // С asOf бэкенд отдаёт срез на конец дня (replay движений).
      // Товары отделяем от Продуктов: ingredient_id, встречавшийся в приходах
      // с product_id, плюс совпавший по имени/ед.изм с карточкой sale.
      const safeList = (fn) => {
        try {
          const out = fn();
          return Promise.resolve(out).catch(() => ({ data: [] }));
        } catch {
          return Promise.resolve({ data: [] });
        }
      };
      Promise.all([
        warehouseService.listStock({
          signal: request.signal,
          ...(asOf ? { params: { as_of: asOf } } : {}),
        }),
        warehouseService.listWarehouses({ signal: request.signal }),
        safeList(() => warehouseService.list("incoming", { signal: request.signal })),
        safeList(() => catalogService.listProducts()),
        safeList(() => warehouseService.listIngredients({ signal: request.signal })),
      ])
        .then(async ([stockRes, whRes, purchRes, prodRes, ingRes]) => {
          if (!request.isCurrent()) return;
          const stockData = stockRes.data;
          const whData = whRes.data;
          setStockRaw({
            items: Array.isArray(stockData) ? stockData : stockData?.items || [],
            warehouses: Array.isArray(whData) ? whData : whData?.items || [],
          });
          // --- множество Товаров ---
          const tovar = new Set();
          try {
            const ingData = ingRes?.data;
            const ings = Array.isArray(ingData) ? ingData : ingData?.items || [];
            const prodData = prodRes?.data;
            const prods = Array.isArray(prodData) ? prodData : prodData?.items || [];
            const saleKeys = new Set(
              prods
                .filter((p) => String(p?.product_type || "sale") === "sale" && p?.is_active !== false)
                .map((p) => `${String(p?.name || "").trim().toLowerCase()}||${String(p?.unit || "").trim().toLowerCase()}`),
            );
            ings.forEach((ing) => {
              if (!ing?.id) return;
              const key = `${String(ing?.name || "").trim().toLowerCase()}||${String(ing?.unit || "").trim().toLowerCase()}`;
              if (saleKeys.has(key)) tovar.add(String(ing.id));
            });
            const purchData = purchRes?.data;
            const headers = Array.isArray(purchData) ? purchData : purchData?.items || [];
            const ids = headers.map((h) => h?.id).filter(Boolean);
            // Один пакетный запрос на весь список вместо 60 параллельных
            // getPurchase: признак «Товар» нужен по всем документам, а не по
            // первым 60, иначе классификация молча врёт на длинной истории.
            const detailsRes = await safeList(() => warehouseService.listPurchaseDetails(ids));
            const detailDocs = Array.isArray(detailsRes?.data) ? detailsRes.data : [];
            detailDocs.forEach((doc) => {
              const items = Array.isArray(doc?.items) ? doc.items : [];
              items.forEach((it) => {
                if (it?.product_id && it?.ingredient_id) tovar.add(String(it.ingredient_id));
              });
            });
          } catch {
            // множество необязательно — без него всё считается Продуктами
          }
          if (!request.isCurrent()) return;
          setTovarIngredientIds(tovar);
          setRows([]);
          setLoading(false);
        })
        .catch(onError);
      return;
    }

    if (section === "incoming") {
      // Сводка Прихода по складам: те же GET /warehouse/purchases (бэк дату
      // не фильтрует — режем на клиенте по registered_at как сейчас), склады
      // из /warehouse/list, детали строк одним батчем listPurchaseDetails
      // для деления Продукт/Товар). Период применяется клиентом в мемоизации
      // ниже (incomingSummary), поэтому перезагрузка по смене периода не нужна.
      const safeList = (fn) => {
        try {
          const out = fn();
          return Promise.resolve(out).catch(() => ({ data: [] }));
        } catch {
          return Promise.resolve({ data: [] });
        }
      };
      Promise.all([
        warehouseService.list("incoming", { signal: request.signal }),
        safeList(() => warehouseService.listWarehouses({ signal: request.signal })),
      ])
        .then(async ([listRes, whRes]) => {
          if (!request.isCurrent()) return;
          const listData = listRes?.data;
          const items = Array.isArray(listData) ? listData : listData?.items || [];
          setRows(items.map((item) => mapWarehouseReadRow("incoming", item)));
          const whData = whRes?.data;
          const whList = Array.isArray(whData) ? whData : whData?.items || [];
          if (!request.isCurrent()) return;
          setIncomingWarehouses(whList);
          setLoading(false);
          // Детали строк для Продукт/Товар (есть product_id → Товар) — одним
          // пакетным запросом на весь список, а не по запросу на документ.
          const ids = items.map((h) => h?.id).filter(Boolean);
          const detailsRes = await safeList(() => warehouseService.listPurchaseDetails(ids));
          if (!request.isCurrent()) return;
          const map = {};
          (Array.isArray(detailsRes?.data) ? detailsRes.data : []).forEach((doc) => {
            if (doc?.id) map[doc.id] = Array.isArray(doc.items) ? doc.items : [];
          });
          setIncomingDetails(map);
        })
        .catch(onError);
      return;
    }

    if (section === "outgoing") {
      // Сводка Расхода по складам как Приход: те же GET /warehouse/expenses
      // (бэк дату не фильтрует — режем на клиенте по registered_at), склады
      // из /warehouse/list, детали строк одним батчем listExpenseDetails.
      // Товар/Продукт — совпадением шаблона с карточками sale (у расхода нет
      // product_id), справочники тянем здесь же. Период применяется клиентом
      // в мемоизации ниже (outgoingSummary).
      const safeList = (fn) => {
        try {
          const out = fn();
          return Promise.resolve(out).catch(() => ({ data: [] }));
        } catch {
          return Promise.resolve({ data: [] });
        }
      };
      Promise.all([
        warehouseService.list("outgoing", { signal: request.signal }),
        safeList(() => warehouseService.listWarehouses({ signal: request.signal })),
        safeList(() => warehouseService.listIngredients({ signal: request.signal })),
        safeList(() => catalogService.listProducts()),
      ])
        .then(async ([listRes, whRes, ingRes, prodRes]) => {
          if (!request.isCurrent()) return;
          const listData = listRes?.data;
          const items = Array.isArray(listData) ? listData : listData?.items || [];
          setRows(items.map((item) => mapWarehouseReadRow("outgoing", item)));
          const whData = whRes?.data;
          const whList = Array.isArray(whData) ? whData : whData?.items || [];
          if (!request.isCurrent()) return;
          setOutgoingWarehouses(whList);
          const ingData = ingRes?.data;
          const ings = Array.isArray(ingData) ? ingData : ingData?.items || [];
          const ingMap = new Map();
          ings.forEach((ing) => {
            if (ing?.id) ingMap.set(String(ing.id), ing);
          });
          setOutgoingIngById(ingMap);
          const prodData = prodRes?.data;
          const prods = Array.isArray(prodData) ? prodData : prodData?.items || [];
          setOutgoingSaleKeys(new Set(
            prods
              .filter((p) => String(p?.product_type || "sale") === "sale" && p?.is_active !== false)
              .map((p) => `${String(p?.name || "").trim().toLowerCase()}||${String(p?.unit || "").trim().toLowerCase()}`),
          ));
          // Рецепты для авто-расхода от продаж (техкарты: норма на порцию).
          setLoading(false);
          const ids = items.map((h) => h?.id).filter(Boolean);
          // Пакетный состав расходов: один запрос вместо N поштучных.
          const detailsRes = await safeList(() => warehouseService.listExpenseDetails(ids));
          if (!request.isCurrent()) return;
          const map = {};
          (Array.isArray(detailsRes?.data) ? detailsRes.data : []).forEach((doc) => {
            if (doc?.id) map[doc.id] = Array.isArray(doc.items) ? doc.items : [];
          });
          setOutgoingDetails(map);
        })
        .catch(onError);
      return;
    }

    if (section === "write-off-categories") {
      // Категорий как сущности в бэкенде нет — агрегируем документы списания
      // по полю category на клиенте (сколько документов и позиций в каждой).
      warehouseService.list("write-off", { signal: request.signal })
        .then(({ data }) => {
          if (!request.isCurrent()) return;
          const items = Array.isArray(data) ? data : data?.items || [];
          const byCategory = new Map();
          items.forEach((item) => {
            const name = item.category || "Без категории";
            const acc = byCategory.get(name) || { docs: 0, positions: 0 };
            acc.docs += 1;
            acc.positions += Number(item.items_count) || 0;
            byCategory.set(name, acc);
          });
          const catRows = Array.from(byCategory.entries()).map(([name, agg], idx) => ({
            id: `cat-${idx}`,
            category: name,
            count: String(agg.docs),
            positions: String(agg.positions),
            archiveState: ACTIVE,
          }));
          setRows(catRows);
          setLoading(false);
        })
        .catch(onError);
      return;
    }

    Promise.resolve().then(() => warehouseService.list(section, { signal: request.signal }))
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((item) => mapWarehouseReadRow(section, item)));
        setLoading(false);
      })
      .catch(onError);

    // Журнал: подтягиваем справочник складов для строк, у которых backend
    // не вернул название (старые документы без warehouse_name).
    if (section === "incoming-journal") {
      warehouseService.listWarehouses({ signal: request.signal })
        .then((res) => {
          if (!request.isCurrent()) return;
          const data = res?.data;
          const list = Array.isArray(data) ? data : data?.items || [];
          const map = {};
          list.forEach((wh) => {
            if (wh?.id) map[String(wh.id)] = wh.name || "—";
          });
          setWhNameById(map);
        })
        .catch(() => {
          // справочник необязателен — backend и так подставляет названия
        });
    }
  }, [beginRequest, section, unavailableMessage, reloadKey, asOf]);

  // V42: список инвентаризаций — для секции inventory. Период режем
  // клиентом (invVisible ниже), перезагрузка — по reloadKey
  // (после создания/удаления).
  useEffect(() => {
    if (section !== "inventory") return;
    let cancelled = false;
    setInvLoading(true);
    setInvError("");
    warehouseService.list("inventory")
      .then(({ data }) => {
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setInvRows(items.map((item) => mapWarehouseReadRow("inventory", item)));
        setInvLoading(false);
      })
      .catch((err) => {
        if (cancelled || isAbortError(err)) return;
        setInvRows([]);
        setInvError(err.response?.data?.detail || "Не удалось загрузить инвентаризации.");
        setInvLoading(false);
      });
    return () => { cancelled = true; };
  }, [section, reloadKey]);

  // The same persisted-movement report feeds the dashboard and this table.
  // Never reconstruct historical costs from today's recipes/prices on failure.
  useEffect(() => {
    if (section !== "outgoing") return;
    let cancelled = false;
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    setSaleError("");
    setPersistedOutgoing(null);
    warehouseService.listOutgoingReport(fromISO, toISO)
      .then(({ data }) => {
        if (cancelled) return;
        setPersistedOutgoing(readOutgoingReport(data));
      })
      .catch((err) => {
        if (cancelled || isAbortError(err)) return;
        setPersistedOutgoing(null);
        const detail = err?.response?.data?.detail;
        setSaleError(typeof detail === "string" ? detail : "Не удалось загрузить фактический расход. Требуется обновлённый backend.");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, docRange.start, docRange.end, reloadKey]);

  // Лениво тянем справочники для дравера (приход/расход/отход) — только при
  // первом открытии. Драйвер выбирается по секции при рендере (см. ниже).
  const openDrawer = async () => {
    if (!mutation) return;
    setSaveError("");
    setDrawerOpen(true);
    if (refLoaded) return;
    try {
      const [whRes, ingRes] = await Promise.all([
        warehouseService.listWarehouses(),
        warehouseService.listIngredients(),
      ]);
      setRefData({ warehouses: whRes.data || [], ingredients: ingRes.data || [] });
      setRefLoaded(true);
    } catch {
      // Справочники не загрузились — селекты в дравере будут пустыми,
      // пользователь увидит это сам; форму не блокируем жёстко.
    }
  };

  const handleCreate = async (payload) => {
    if (!mutation) return;
    setSaving(true);
    setSaveError("");
    try {
      await mutation.create(payload);
      setDrawerOpen(false);
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setSaveError(typeof detail === "string" ? detail : `Не удалось сохранить ${mutation.createLabel}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async (id) => {
    if (!id || busyId || !mutation) return;
    if (!window.confirm(mutation.acceptConfirm)) return;
    setBusyId(id);
    setError("");
    try {
      await mutation.accept(id);
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Не удалось провести документ.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!id || busyId || !mutation) return;
    if (!window.confirm(mutation.deleteConfirm)) return;
    setBusyId(id);
    setError("");
    try {
      await mutation.remove(id);
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Не удалось удалить документ.");
    } finally {
      setBusyId(null);
    }
  };

  // V42: удаление инвентаризации — своей мутацией (во встроенной таблице
  // Прихода mutation указывает на приход, поэтому общий handleDelete
  // здесь не подходит). Сейчас из UI недоступно (колонка Действия убрана
  // по требованию OWNER) — оставлено для API/будущего возврата кнопки.
  // eslint-disable-next-line no-unused-vars
  const handleDeleteInventory = async (id) => {
    const invMutation = sectionMutations.inventory;
    if (!id || busyId || !invMutation) return;
    if (!window.confirm(invMutation.deleteConfirm)) return;
    setBusyId(id);
    setInvError("");
    try {
      await invMutation.remove(id);
      setReloadKey((key) => key + 1);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setInvError(typeof detail === "string" ? detail : "Не удалось удалить инвентаризацию.");
    } finally {
      setBusyId(null);
    }
  };

  const computedSummary = useMemo(() => {
    if (!config.summary || loading || error) return null;
    const activeRows = rows.filter((r) => r.archiveState === ACTIVE);
    const totalCount = activeRows.length;
    const totalSum = activeRows.reduce((sum, r) => {
      const num = Number(String(r.total || "0").replace(/[^\d]/g, ""));
      return sum + num;
    }, 0);
    const uniqueSuppliers = new Set(activeRows.map((r) => r.supplier).filter(Boolean)).size;
    const uniqueWarehouses = new Set(activeRows.map((r) => r.warehouse).filter(Boolean)).size;
    const drafts = activeRows.filter((r) => (r.status || "").toLowerCase().includes("черновик")).length;
    const completed = activeRows.filter((r) => /проведено|завершено/i.test(r.status || "")).length;
    const pending = activeRows.filter((r) => /ожидани/i.test(r.status || "")).length;
    const lowStock = activeRows.filter((r) => (
      /низк/i.test(r.status || "")
      || (Number.isFinite(Number(r.stock)) && Number.isFinite(Number(r.minStock)) && Number(r.stock) < Number(r.minStock))
    )).length;
    const hasWasteMode = activeRows.some((r) => r.isAutomatic != null || r.mode || r.source);
    const automaticWaste = activeRows.filter((r) => r.isAutomatic === true || /авто|automatic/i.test(`${r.mode || ""} ${r.source || ""}`)).length;
    const manualWaste = activeRows.filter((r) => r.isAutomatic === false || /ручн|manual/i.test(`${r.mode || ""} ${r.source || ""}`)).length;

    return config.summary.map((item) => {
      if (item.label.includes("Всего")) return { ...item, value: String(totalCount) };
      if (item.label.includes("Сумма") || item.label.includes("стоимость")) return { ...item, value: `${totalSum.toLocaleString("ru-RU")} UZS` };
      if (item.label.includes("Поставщик")) return { ...item, value: String(uniqueSuppliers) };
      if (item.label.includes("Черновик")) return { ...item, value: String(drafts) };
      if (item.label.includes("Позиций") || item.label.includes("Товаров") || item.label.includes("Категорий")) return { ...item, value: String(totalCount) };
      if (item.label === "Проведено") return { ...item, value: String(completed) };
      if (item.label === "В ожидании") return { ...item, value: String(pending) };
      if (item.label === "Низкий остаток") return { ...item, value: String(lowStock) };
      if (item.label === "Складов") return { ...item, value: String(uniqueWarehouses) };
      if (item.label === "Автоотход") return { ...item, value: activeRows.length && !hasWasteMode ? "—" : String(automaticWaste) };
      if (item.label === "Ручной отход") return { ...item, value: activeRows.length && !hasWasteMode ? "—" : String(manualWaste) };
      return { ...item, value: "—" };
    });
  }, [rows, config.summary, error, loading]);

  const visibleRows = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const useDocRange = DOC_RANGE_SECTIONS.includes(section);
    const fromISO = useDocRange ? docDateToISO(docRange.start) : "";
    const toISO = useDocRange ? docDateToISO(docRange.end) : "";

    return rows.filter((row) => {
      const matchesTab = !config.tabs || row.archiveState === activeTab;
      const matchesSearch = !query || rowSearchText(row).includes(query);
      const matchesFilters = Object.entries(filters).every(([key, value]) => {
        if (!value || key === "search") return true;
        return String(row[key] || "").toLowerCase().includes(String(value).toLowerCase());
      });
      // Период как в отчётах: документ виден, только если его ДАТА
      // РЕГИСТРАЦИИ внутри выбранного диапазона (строки YYYY-MM-DD).
      // Фолбэк — дата поступления (старые документы без registered_at).
      const matchesRange = !useDocRange || (() => {
        const iso = row.regDate || docDateToISO(row.date);
        if (!fromISO && !toISO) return true;
        if (!iso) return false;
        if (fromISO && iso < fromISO) return false;
        if (toISO && iso > toISO) return false;
        return true;
      })();
      return matchesTab && matchesSearch && matchesFilters && matchesRange;
    });
  }, [activeTab, config.tabs, filters, rows, section, docRange]);

  // V42: видимые инвентаризации — фильтр по дате регистрации (docRange).
  const invVisible = useMemo(() => {
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return invRows.filter((row) => {
      const iso = row.regDate;
      if (!fromISO && !toISO) return true;
      if (!iso) return false;
      if (fromISO && iso < fromISO) return false;
      if (toISO && iso > toISO) return false;
      return true;
    });
  }, [invRows, docRange]);

  // V36: сводка остатков по складам — строка на склад:
  // Продукты/Товары = Σ qty×cost_price его stock-строк по принадлежности
  // к множеству Товаров; Сумма = Продукты + Товары; Итого — снизу.
  const warehouseSummary = useMemo(() => {
    if (section !== "stock") return [];
    const list = Array.isArray(stockRaw.warehouses) ? stockRaw.warehouses : [];
    const items = Array.isArray(stockRaw.items) ? stockRaw.items : [];
    const sumByWh = new Map();
    items.forEach((item) => {
      const key = String(item?.warehouse_id || "");
      if (!key) return;
      const sum = (Number(item?.quantity) || 0) * (Number(item?.cost_price) || 0);
      const acc = sumByWh.get(key) || { product: 0, tovar: 0 };
      if (tovarIngredientIds.has(String(item?.ingredient_id || ""))) acc.tovar += sum;
      else acc.product += sum;
      sumByWh.set(key, acc);
    });
    return list.map((wh) => {
      const acc = sumByWh.get(String(wh.id)) || { product: 0, tovar: 0 };
      return {
        id: wh.id,
        name: wh.name || "—",
        product: acc.product,
        tovar: acc.tovar,
        raw: acc.product + acc.tovar,
        is_active: wh.is_active !== false,
      };
    });
  }, [section, stockRaw, tovarIngredientIds]);

  const warehouseGrandTotal = useMemo(
    () => warehouseSummary.reduce((acc, row) => acc + row.raw, 0),
    [warehouseSummary],
  );
  const warehouseGrandProduct = useMemo(
    () => warehouseSummary.reduce((acc, row) => acc + row.product, 0),
    [warehouseSummary],
  );
  const warehouseGrandTovar = useMemo(
    () => warehouseSummary.reduce((acc, row) => acc + row.tovar, 0),
    [warehouseSummary],
  );

  // Приход — сводка по складам как Остаток: суммируем ВСЕ приходные документы
  // за выбранный период (общий docRange, фильтр по regDate как в visibleRows).
  // Продукт/Товар — по строкам listPurchaseDetails: есть product_id → Товар,
  // иначе Продукт; сумма = qty×cost_price. Без деталей (ошибка) — total
  // документа падает в Продукт, чтобы сумма не терялась.
  const incomingSummary = useMemo(() => {
    if (section !== "incoming") return [];
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return aggregatePurchaseSummary(filterDocsByPeriod(rows, fromISO, toISO), incomingDetails, incomingWarehouses);
  }, [section, rows, incomingDetails, incomingWarehouses, docRange]);

  const incomingGrandProduct = useMemo(
    () => incomingSummary.reduce((acc, row) => acc + row.product, 0),
    [incomingSummary],
  );
  const incomingGrandTovar = useMemo(
    () => incomingSummary.reduce((acc, row) => acc + row.tovar, 0),
    [incomingSummary],
  );
  const incomingGrandTotal = useMemo(
    () => incomingSummary.reduce((acc, row) => acc + row.raw, 0),
    [incomingSummary],
  );

  // Документы выбранного склада Прихода за период (детализация сводки).
  const incomingDetailRows = useMemo(() => {
    if (section !== "incoming" || !selectedIncomingWhId) return [];
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return rows.filter((row) => {
      const rawId = String(row.warehouseId || "");
      const key = rawId || `name:${row.warehouse || "—"}`;
      if (key !== String(selectedIncomingWhId) && String(row.warehouseId || "") !== String(selectedIncomingWhId)) return false;
      const iso = row.regDate || docDateToISO(row.date);
      if (!fromISO && !toISO) return true;
      if (!iso) return false;
      if (fromISO && iso < fromISO) return false;
      if (toISO && iso > toISO) return false;
      return true;
    });
  }, [section, rows, selectedIncomingWhId, docRange]);

  // Разбивка выбранного склада: строки stock + справочник ингредиентов.
  // Всего = Продукты + Товары (два компонента сводки).
  // Всего-количество = Σ qty (как в референсе; единицы смешанные — честно
  // показываем сумму чисел, а не конвертацию). Группировка — по
  // ingredient.category (free-text, fallback «Без категории»), отдельно
  // продуктовые и товарные группы для дерева категорий со стрелкой.
  const ingredientById = useMemo(() => {
    const map = new Map();
    (Array.isArray(detailIngredients) ? detailIngredients : []).forEach((ing) => {
      if (ing?.id) map.set(String(ing.id), ing);
    });
    return map;
  }, [detailIngredients]);

  const groupLines = (lines) => {
    const groupsMap = new Map();
    lines.forEach((line) => {
      const acc = groupsMap.get(line.category) || { name: line.category, qty: 0, sum: 0, lines: [] };
      acc.qty += line.qty;
      acc.sum += line.sum;
      acc.lines.push(line);
      groupsMap.set(line.category, acc);
    });
    return Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  };

  // Детализация Прихода как в Остатке, но ТОЛЬКО первичный приход (без
  // расхода): строки документов склада за период из incomingDetails
  // (listPurchaseDetails). Категории — из справочника ингредиентов, как в stock.
  const incomingWhDetail = useMemo(() => {
    if (section !== "incoming" || !selectedIncomingWhId) return null;
    const summaryRow = incomingSummary.find((w) => String(w.key) === String(selectedIncomingWhId));
    return {
      warehouse: summaryRow || { id: selectedIncomingWhId, name: "Склад" },
      ...buildPurchaseDetail(incomingDetailRows, incomingDetails, ingredientById, groupLines),
    };
  }, [section, selectedIncomingWhId, incomingSummary, incomingDetailRows, incomingDetails, ingredientById]);

  // Клик по складу Прихода — как openWhDetail: сброс дерева категорий.
  const openIncomingDetail = (key) => {
    setExpandedCats({});
    setClosingCats({});
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    // Детализация Прихода роут не меняет — пушим запись истории, чтобы
    // стрелка топбара (history.back) возвращала на главный экран
    // «Приход товаров», а не уводила из подкатегории.
    try {
      window.history.pushState({ whIncomingDetail: true }, "", window.location.href);
    } catch {
      // не браузер — игнор
    }
    setSelectedIncomingWhId(key);
  };

  // Инвентаризация в карточке Прихода: только проведённые автодокументы
  // излишков (supplier «Инвентаризация») — та же сводка/детализация, что
  // у Прихода, за тот же период. Недостачи живут в Расходе, черновики
  // без расхождений документов не создают.
  const [selectedInventoryWhId, setSelectedInventoryWhId] = useState(null);
  const inventoryPurchaseRows = useMemo(() => {
    if (section !== "incoming") return [];
    return rows.filter((row) => row.supplier === "Инвентаризация" && row.accepted);
  }, [section, rows]);
  const inventorySummary = useMemo(() => {
    if (section !== "incoming") return [];
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return aggregatePurchaseSummary(filterDocsByPeriod(inventoryPurchaseRows, fromISO, toISO), incomingDetails, incomingWarehouses);
  }, [section, inventoryPurchaseRows, incomingDetails, incomingWarehouses, docRange]);
  const inventoryGrandProduct = useMemo(
    () => inventorySummary.reduce((acc, row) => acc + row.product, 0),
    [inventorySummary],
  );
  const inventoryGrandTovar = useMemo(
    () => inventorySummary.reduce((acc, row) => acc + row.tovar, 0),
    [inventorySummary],
  );
  const inventoryGrandTotal = useMemo(
    () => inventorySummary.reduce((acc, row) => acc + row.raw, 0),
    [inventorySummary],
  );
  const inventoryDetailRows = useMemo(() => {
    if (section !== "incoming" || !selectedInventoryWhId) return [];
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return inventoryPurchaseRows.filter((row) => {
      const rawId = String(row.warehouseId || "");
      const key = rawId || `name:${row.warehouse || "—"}`;
      if (key !== String(selectedInventoryWhId) && String(row.warehouseId || "") !== String(selectedInventoryWhId)) return false;
      const iso = row.regDate || docDateToISO(row.date);
      if (!fromISO && !toISO) return true;
      if (!iso) return false;
      if (fromISO && iso < fromISO) return false;
      if (toISO && iso > toISO) return false;
      return true;
    });
  }, [section, inventoryPurchaseRows, selectedInventoryWhId, docRange]);
  const inventoryWhDetail = useMemo(() => {
    if (section !== "incoming" || !selectedInventoryWhId) return null;
    const summaryRow = inventorySummary.find((w) => String(w.key) === String(selectedInventoryWhId));
    return {
      warehouse: summaryRow || { id: selectedInventoryWhId, name: "Склад" },
      ...buildPurchaseDetail(inventoryDetailRows, incomingDetails, ingredientById, groupLines),
    };
  }, [section, selectedInventoryWhId, inventorySummary, inventoryDetailRows, incomingDetails, ingredientById]);
  const openInventoryDetail = (key) => {
    setExpandedCats({});
    setClosingCats({});
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    // Как openIncomingDetail: пушим запись истории, чтобы стрелка топбара
    // (history.back) возвращала на главный экран «Приход товаров».
    try {
      window.history.pushState({ whInventoryDetail: true }, "", window.location.href);
    } catch {
      // не браузер — игнор
    }
    setSelectedInventoryWhId(key);
  };

  // Actual sale/expense movements at their frozen cost and posting date.
  // Inventory shortages remain isolated in the separate card below.
  const outgoingSummary = useMemo(() => {
    if (section !== "outgoing") return [];
    return persistedOutgoing?.rows || [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, persistedOutgoing]);

  const outgoingGrandProduct = useMemo(
    () => outgoingSummary.reduce((acc, row) => acc + row.product, 0),
    [outgoingSummary],
  );
  const outgoingGrandTovar = useMemo(
    () => outgoingSummary.reduce((acc, row) => acc + row.tovar, 0),
    [outgoingSummary],
  );
  const outgoingGrandTotal = useMemo(
    () => outgoingSummary.reduce((acc, row) => acc + row.raw, 0),
    [outgoingSummary],
  );

  // Детализация Расхода как в Остатке, но ТОЛЬКО расход за период:
  // Uses the exact same lines as the report's warehouse totals.
  const outgoingWhDetail = useMemo(() => {
    if (section !== "outgoing" || !selectedOutgoingWhId) return null;
    const summaryRow = outgoingSummary.find((w) => String(w.key) === String(selectedOutgoingWhId));
    const lines = (persistedOutgoing?.lines || []).filter((line) => String(line.warehouseKey) === String(selectedOutgoingWhId))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    const productLines = lines.filter((l) => !l.isTovar);
    const tovarLines = lines.filter((l) => l.isTovar);
    const sumQty = (arr) => arr.reduce((acc, line) => acc + (Number(line.qty) || 0), 0);
    const sumSum = (arr) => arr.reduce((acc, line) => acc + (Number(line.sum) || 0), 0);
    return {
      warehouse: summaryRow || { id: selectedOutgoingWhId, name: "Склад" },
      lines,
      // Группируем по категориям уже СВЁРНУТЫЕ продукты: одна строка на продукт,
      // внутри — разбивка по блюдам для стрелки.
      productGroups: groupLines(aggregateExpenseProducts(productLines)),
      tovarGroups: groupLines(aggregateExpenseProducts(tovarLines)),
      totalQty: sumQty(lines),
      totalSum: sumSum(lines),
      productQty: sumQty(productLines),
      productSum: sumSum(productLines),
      tovarQty: sumQty(tovarLines),
      tovarSum: sumSum(tovarLines),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, selectedOutgoingWhId, outgoingSummary, persistedOutgoing]);

  const openOutgoingDetail = (key) => {
    setExpandedCats({});
    setClosingCats({});
    setExpandedProducts({});
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    // Как в Приходе: пушим запись истории, чтобы стрелка топбара
    // (history.back) возвращала на главный экран «Расход товаров».
    try {
      window.history.pushState({ whOutgoingDetail: true }, "", window.location.href);
    } catch {
      // не браузер — игнор
    }
    setSelectedOutgoingWhId(key);
  };

  // Инвентаризация в карточке Расхода: только проведённые автодокументы
  // недостач (receiver «Инвентаризация») — та же сводка/детализация, что
  // у Расхода, за тот же период. Излишки живут в Приходе.
  const [selectedExpenseInventoryWhId, setSelectedExpenseInventoryWhId] = useState(null);
  const expenseInventoryRows = useMemo(() => {
    if (section !== "outgoing") return [];
    return rows.filter((row) => row.receiver === "Инвентаризация" && row.accepted);
  }, [section, rows]);
  const expenseInventorySummary = useMemo(() => {
    if (section !== "outgoing") return [];
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return aggregateExpenseSummary(
      filterDocsByPeriod(expenseInventoryRows, fromISO, toISO),
      outgoingDetails, outgoingWarehouses, outgoingIngById, outgoingSaleKeys,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, expenseInventoryRows, outgoingDetails, outgoingWarehouses, outgoingIngById, outgoingSaleKeys, docRange]);
  const expenseInventoryGrandProduct = useMemo(
    () => expenseInventorySummary.reduce((acc, row) => acc + row.product, 0),
    [expenseInventorySummary],
  );
  const expenseInventoryGrandTovar = useMemo(
    () => expenseInventorySummary.reduce((acc, row) => acc + row.tovar, 0),
    [expenseInventorySummary],
  );
  const expenseInventoryGrandTotal = useMemo(
    () => expenseInventorySummary.reduce((acc, row) => acc + row.raw, 0),
    [expenseInventorySummary],
  );
  const expenseInventoryWhDetail = useMemo(() => {
    if (section !== "outgoing" || !selectedExpenseInventoryWhId) return null;
    const summaryRow = expenseInventorySummary.find((w) => String(w.key) === String(selectedExpenseInventoryWhId));
    const fromISO = docDateToISO(docRange.start);
    const toISO = docDateToISO(docRange.end);
    return {
      warehouse: summaryRow || { id: selectedExpenseInventoryWhId, name: "Склад" },
      ...buildExpenseDetail(expenseInventoryRows, selectedExpenseInventoryWhId, fromISO, toISO, outgoingDetails, outgoingIngById, outgoingSaleKeys, groupLines),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, selectedExpenseInventoryWhId, expenseInventorySummary, expenseInventoryRows, outgoingDetails, outgoingIngById, outgoingSaleKeys, docRange]);
  const openExpenseInventoryDetail = (key) => {
    setExpandedCats({});
    setClosingCats({});
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    // Как в Приходе: пушим запись истории, чтобы стрелка топбара
    // (history.back) возвращала на главный экран «Расход товаров».
    try {
      window.history.pushState({ whExpenseInventoryDetail: true }, "", window.location.href);
    } catch {
      // не браузер — игнор
    }
    setSelectedExpenseInventoryWhId(key);
  };

  const whDetail = useMemo(() => {
    if (section !== "stock" || !activeWhId) return null;
    const warehouse = warehouseSummary.find((w) => String(w.id) === String(activeWhId));
    const items = (Array.isArray(stockRaw.items) ? stockRaw.items : []).filter(
      (item) => String(item?.warehouse_id) === String(activeWhId),
    );
    const lines = items.map((item) => {
      const ing = ingredientById.get(String(item?.ingredient_id));
      const qty = Number(item?.quantity) || 0;
      const cost = Number(item?.cost_price) || 0;
      const isTovar = tovarIngredientIds.has(String(item?.ingredient_id || ""));
      return {
        key: String(item?.ingredient_id || item?.id || Math.random()),
        ingredientId: item?.ingredient_id ? String(item.ingredient_id) : "",
        name: ing?.name || (isTovar ? `Товар ${String(item?.ingredient_id || "").slice(0, 8)}` : `Сырьё ${String(item?.ingredient_id || "").slice(0, 8)}`),
        category: String(ing?.category || "").trim() || "Без категории",
        qty,
        unit: item?.unit || ing?.unit || "кг",
        sum: qty * cost,
        isTovar,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const productLines = lines.filter((l) => !l.isTovar);
    const tovarLines = lines.filter((l) => l.isTovar);
    return {
      warehouse: warehouse || { id: activeWhId, name: "Склад", raw: 0, product: 0, tovar: 0, is_active: true },
      lines,
      groups: groupLines(lines),
      productGroups: groupLines(productLines),
      tovarGroups: groupLines(tovarLines),
      totalQty: lines.reduce((acc, line) => acc + line.qty, 0),
      totalSum: lines.reduce((acc, line) => acc + line.sum, 0),
      productQty: productLines.reduce((acc, line) => acc + line.qty, 0),
      productSum: productLines.reduce((acc, line) => acc + line.sum, 0),
      tovarQty: tovarLines.reduce((acc, line) => acc + line.qty, 0),
      tovarSum: tovarLines.reduce((acc, line) => acc + line.sum, 0),
    };
  }, [section, activeWhId, stockRaw, warehouseSummary, ingredientById, tovarIngredientIds]);

  // Клик по дефициту в колокольчике: раскрываем ОДНУ категорию — ту, в
  // которой лежит это сырьё на этом складе, остальные остаются закрытыми.
  // Категорию и вид (Продукты/Товары) берём из самой строки остатка: в
  // уведомлении их нет, а угадывание по имени дало бы неверный ключ дерева.
  useEffect(() => {
    if (section !== "stock" || !focusIngredientId || !whDetail) return;
    const target = String(focusIngredientId);
    if (focusAppliedRef.current === target) return;
    const line = whDetail.lines.find((item) => item.ingredientId === target);
    // Строки нет — сырьё уже списано/перемещено: склад открыт как есть,
    // без выдуманной категории.
    if (!line) return;
    focusAppliedRef.current = target;
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    setClosingCats({});
    setExpandedCats({ [`${line.isTovar ? "tovar" : "product"}:${line.category}`]: true });
    setFocusScrollId(target);
  }, [section, focusIngredientId, whDetail]);

  // Подводим раскрытую строку к экрану: категорий на складе может быть
  // много, и нужная иначе остаётся ниже среза. Ждём коммита раскрытия.
  useEffect(() => {
    if (!focusScrollId) return;
    const row = document.querySelector(`[data-ingredient-id="${focusScrollId}"]`);
    if (!row) return;
    if (typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    setFocusScrollId("");
  }, [focusScrollId, expandedCats]);

  const openWhDetail = (row) => {
    setExpandedCats({});
    setClosingCats({});
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
    setSelectedWhId(row.id);
    if (onOpenWarehouse) onOpenWarehouse(row);
  };

  // Имена/категории позиций детализации — лениво при открытии (клик или
  // прямой заход на /stock/:warehouseId). Ошибка → fallback по id, суммы те же.
  // Приход: та же детализация нужна для разбивки по категориям (только приход,
  // без расхода) — грузим при выбранном складе Прихода.
  useEffect(() => {
    const needStock = section === "stock" && activeWhId;
    const needIncoming = section === "incoming" && (selectedIncomingWhId || selectedInventoryWhId);
    if ((!needStock && !needIncoming) || detailIngLoaded) return;
    let cancelled = false;
    warehouseService.listIngredients()
      .then(({ data }) => {
        if (cancelled) return;
        setDetailIngredients(Array.isArray(data) ? data : data?.items || []);
        setDetailIngLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailIngredients([]);
        setDetailIngLoaded(true);
      });
    return () => { cancelled = true; };
  }, [section, activeWhId, selectedIncomingWhId, selectedInventoryWhId, detailIngLoaded]);

  const toggleWhCat = (key) => {
    // Категории по умолчанию закрыты: отсутствующий ключ = закрыто.
    // Закрытие — с анимацией 200мс: сначала флаг closing, размонтирование
    // строк — по таймеру. Повторный клик в фазе закрытия отменяет таймер.
    if (expandedCats[key] === true) {
      setClosingCats((current) => ({ ...current, [key]: true }));
      if (closeTimers.current[key]) clearTimeout(closeTimers.current[key]);
      closeTimers.current[key] = setTimeout(() => {
        setExpandedCats((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setClosingCats((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        delete closeTimers.current[key];
      }, 200);
      return;
    }
    if (closeTimers.current[key]) {
      clearTimeout(closeTimers.current[key]);
      delete closeTimers.current[key];
    }
    setClosingCats((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setExpandedCats((current) => ({ ...current, [key]: true }));
  };

  // Чистка таймеров закрытия при размонтировании.
  useEffect(() => () => {
    Object.values(closeTimers.current).forEach((timer) => clearTimeout(timer));
    closeTimers.current = {};
  }, []);

  const openWhCreate = () => {
    setWhError("");
    setWhModal({ mode: "create", row: null });
  };

  const openWhEdit = (row) => {
    setWhError("");
    setWhModal({ mode: "edit", row });
  };

  const openWhDelete = (row) => {
    setWhError("");
    setWhModal({ mode: "delete", row });
  };

  const closeWhModal = () => {
    if (whSaving) return;
    setWhModal(null);
    setWhError("");
  };

  const submitWhModal = async (payload) => {
    if (!whModal || whSaving) return;
    setWhSaving(true);
    setWhError("");
    try {
      if (whModal.mode === "delete") {
        await warehouseService.deleteWarehouse(whModal.row.id);
      } else {
        const name = String(payload?.name || "").trim();
        if (!name) {
          setWhError("Укажите название.");
          return;
        }
        const body = { name, is_active: payload?.is_active !== false };
        if (whModal.mode === "edit") {
          await warehouseService.updateWarehouse(whModal.row.id, body);
        } else {
          await warehouseService.createWarehouse(body);
        }
      }
      setWhModal(null);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setWhError(err.response?.data?.detail || "Не удалось сохранить склад.");
    } finally {
      setWhSaving(false);
    }
  };

  // Кнопка периода как в отчётах (тот же canonical-пикер, тот же радиус
  // 10px и та же анимация открытия/закрытия owner-report-panel-in/out):
  // в state кладём ВЕСЬ выбранный диапазон (как dateRange в OrdersReportPage),
  // поэтому кнопка и подсветка пресета совпадают с отчётами 1:1.
  // Данные при этом — срез на конец диапазона (asOf выше).
  // Пресеты — черновик до ОК (без applyPresetOnSelect), по умолчанию "Сегодня".
  // animateExit даёт ту же анимацию открытия/закрытия, что в отчётах
  // (owner-report-panel-in/out через .report-period-picker--animated).
  // Оставляем неконтролируемое открытие (как раньше): для одиночного пикера
  // склада очереди панелей из отчётов не нужны.
  const handleAsOfRange = (range) => {
    // Выбранный пресет сохраняем как есть (включая неделю/месяц/год с концом
    // сегодня) — иначе подсветка и диапазон на кнопке слетят на "Сегодня".
    // Ручной выбор даты пикер и так отдаёт с preset "".
    setStockRange({
      preset: range?.preset || "",
      start: range?.start || todayDDMM(),
      end: range?.end || range?.start || todayDDMM(),
    });
  };
  const asOfControl = (
    <ReportDateRangePicker
      variant="canonical"
      animateExit
      value={{
        preset: stockRange.preset,
        start: stockRange.start,
        end: stockRange.end,
        startTime: "00:00",
        endTime: "00:00",
        timeTouched: false,
      }}
      onChange={handleAsOfRange}
      buttonAriaLabel={t("pages.warehousepage.stock_on_date")}
    />
  );

  // V42: таблица инвентаризаций как «Добавить продуктов»: №/Склад/Дата
  // регистрации/Комментарий. Без действий (только просмотр и создание).
  // Период режет invVisible, создание — модалкой сверху (setInvModalOpen).
  const renderInventoryTable = (label) => {
    const empty = !invLoading && !invError && invVisible.length === 0;
    return (
      <div className={`settings-table-wrapper dish-grid-wrap${empty ? " is-empty" : ""}`}>
        <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.table_scroll", { label })} tabIndex={0}>
          <table className="settings-table dish-grid-table warehouse-journal-table wh-inventory-table" aria-label={label}>
            <thead>
              <tr>
                <th>№</th>
                <th>{t("pages.warehousepage.sklad")}</th>
                <th>{t("pages.warehousepage.data_registratsii")}</th>
                <th>{t("pages.warehousepage.kommentariy")}</th>
              </tr>
            </thead>
            <tbody>
              {invVisible.map((row, index) => {
                return (
                  <tr
                    key={row.id || index}
                    className="wh-journal-row"
                    onClick={() => { if (row.id) setDetailCheck(row); }}
                  >
                    <td>{index + 1}</td>
                    <td>{row.warehouse}</td>
                    <td>{row.registeredAt}</td>
                    <td className="wh-inventory-col-comment">{row.comment}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {empty ? (
          <div className="dish-empty-overlay">
            <ReportEmptyState title={t("pages.warehousepage.inventarizatsiy_poka_net")} />
          </div>
        ) : null}
      </div>
    );
  };
  const inventoryModal = invModalOpen ? (
    <InventoryModal
      onClose={() => setInvModalOpen(false)}
      onSaved={() => {
        setInvModalOpen(false);
        setReloadKey((key) => key + 1);
      }}
    />
  ) : null;

  if (unavailableMessage) {
    return (
      <div className="warehouse-page">
        <section className="warehouse-card">
          <header className="warehouse-header">
            <div className="warehouse-title-group">
              <span className="warehouse-accent-bar" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
          </header>
          <div className="warehouse-empty-cell" role="status">{t(unavailableMessage)}</div>
        </section>
      </div>
    );
  }

  // V36: Остаток — сводка по складам в шелле блюд (как ZimZim-Остаток):
  // шапка + Добавить, таблица №/Название-ссылка/Продукты/Товары/Сумма/
  // Статус-точка/Действия, Итого снизу. Клик по названию → детализация
  // склада (Всего/Продукты/Товары/дерево категорий со стрелкой, без Excel
  // и поиска — по требованию OWNER).
  if (section === "stock") {
    // Строка категории дерева детализации: стрелка + название + остатки.
    // kind разделяет ключи сворачивания продуктовых и товарных категорий.
    // Закрытие — с анимацией: строки живут ещё 200мс с классом is-closing.
    const renderWhGroup = (group, kind) => {
      // По умолчанию категории закрыты (раскрываются кликом по стрелке).
      const key = `${kind}:${group.name}`;
      const expanded = expandedCats[key] === true;
      const closing = closingCats[key] === true;
      const visible = expanded || closing;
      const label = kind === "tovar" ? `товаров ${group.name}` : `продуктов ${group.name}`;
      return [
        <tr key={`cat-${key}`} className="wh-detail-cat-row">
          <td>
            <button
              type="button"
              className="wh-detail-toggle"
              onClick={() => toggleWhCat(key)}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Свернуть" : "Развернуть"} категорию ${label}`}
            >
              <Icon name="bi-chevron-right" size={15} className={`wh-detail-toggle__chevron${expanded ? " is-open" : ""}`} aria-hidden="true" />
            </button>
            {" "}{group.name}
          </td>
          <td>{formatQty(group.qty)}</td>
          <td>{formatAmount(group.sum)}</td>
        </tr>,
        ...(visible ? group.lines.map((line, idx) => (
          <tr key={line.key} className={`wh-detail-line-row${closing ? " is-closing" : ""}`} data-ingredient-id={line.ingredientId || undefined}>
            <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{line.name}</td>
            <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{`${formatQty(line.qty)} ${line.unit}`}</td>
            <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{formatAmount(line.sum)}</td>
          </tr>
        )) : []),
      ];
    };
    if (!loading && !error && whDetail) {
      return (
        <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page">
          <section className="dish-catalog-card owner-report-surface settings-card">
            <header className="settings-header dish-catalog-header">
              <div className="settings-title-group">
                <span className="settings-accent-bar" aria-hidden="true" />
                <div>
                  <p>{t("pages.warehousepage.sklad_ostatok")}{asOfDated ? ` / ${asOfToDDMM(asOf)}` : ""}</p>
                  <h1>{whDetail.warehouse.name}</h1>
                </div>
              </div>
              <div className="settings-actions dish-header-actions">
                {asOfControl}
              </div>
            </header>
            <div className="settings-table-wrapper dish-grid-wrap">
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.warehouse_scroll", { label: t("pages.warehousepage.ostatki"), name: whDetail.warehouse.name })} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-stock-table wh-detail-table" aria-label={`Остаток склада ${whDetail.warehouse.name}`}>
                  <thead>
                    <tr>
                      <th className="wh-detail-col-name">{t("pages.warehousepage.nazvaniya")}</th>
                      <th className="wh-detail-col-qty">{t("pages.warehousepage.ostatok")}</th>
                      <th className="wh-detail-col-sum">{t("pages.warehousepage.summa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="wh-detail-total-row">
                      <td>{t("pages.warehousepage.vsego")}</td>
                      <td>{formatQty(whDetail.totalQty)}</td>
                      <td>{formatAmount(whDetail.totalSum)}</td>
                    </tr>
                    <tr className="wh-detail-total-row">
                      <td>{t("pages.warehousepage.produkty")}</td>
                      <td>{formatQty(whDetail.productQty)}</td>
                      <td>{formatAmount(whDetail.productSum)}</td>
                    </tr>
                    <tr className="wh-detail-total-row">
                      <td>{t("pages.warehousepage.tovary")}</td>
                      <td>{formatQty(whDetail.tovarQty)}</td>
                      <td>{formatAmount(whDetail.tovarSum)}</td>
                    </tr>
                    {whDetail.productGroups.length > 0 ? (
                      <tr className="wh-detail-section-row">
                        <td colSpan={3}>{t("pages.warehousepage.produkty_po_kategoriyam")}</td>
                      </tr>
                    ) : null}
                    {whDetail.productGroups.map((group) => renderWhGroup(group, "product"))}
                    {whDetail.tovarGroups.length > 0 ? (
                      <tr className="wh-detail-section-row">
                        <td colSpan={3}>{t("pages.warehousepage.tovary_po_kategoriyam")}</td>
                      </tr>
                    ) : null}
                    {whDetail.tovarGroups.map((group) => renderWhGroup(group, "tovar"))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </section>
      );
    }
    const isEmpty = !loading && !error && warehouseSummary.length === 0;
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {asOfControl}
              {asOfDated ? (
                <span className="wh-asof-note" role="status">
                 {t("pages.warehousepage.srez_na")} {asOfToDDMM(asOf)} {t("pages.warehousepage.tolko_prosmotr")}
                </span>
              ) : (
                <button type="button" className="dish-add-button" onClick={openWhCreate}>
                  <Icon name="bi-plus" size={18} /> {t("pages.warehousepage.dobavit")}
                </button>
              )}
            </div>
          </header>
          {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          {!loading && !error ? (
            <div className={`settings-table-wrapper dish-grid-wrap${isEmpty ? " is-empty" : ""}`}>
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.ostatki_po_skladam_s_prokrutkoy")} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-stock-table" aria-label={t("pages.warehousepage.ostatok_po_skladam")}>
                  <thead>
                    <tr>
                      <th className="wh-stock-col-num">№</th>
                      <th className="wh-stock-col-name">{t("pages.warehousepage.nazvanie")}</th>
                      <th className="wh-stock-col-product"><span className="wh-shift-left">{t("pages.warehousepage.produkty")}</span></th>
                      <th className="wh-stock-col-tovar">{t("pages.warehousepage.tovary")}</th>
                      <th className="wh-stock-col-sum">{t("pages.warehousepage.summa")}</th>
                      <th className="wh-stock-col-status">{t("pages.warehousepage.status")}</th>
                      <th className="wh-stock-col-actions">{t("pages.warehousepage.deystviya")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouseSummary.map((row, index) => (
                      <tr key={row.id || index}>
                        <td className="wh-stock-col-num">{index + 1}</td>
                        <td className="wh-stock-col-name">
                          <button
                            type="button"
                            className="wh-stock-link"
                            onClick={() => openWhDetail(row)}
                            aria-label={`Открыть остатки склада ${row.name}`}
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(row.product)}</span></td>
                        <td className="wh-stock-col-tovar">{formatAmount(row.tovar)}</td>
                        <td className="wh-stock-col-sum">{formatAmount(row.raw)}</td>
                        <td className="wh-stock-col-status">
                          <span className={`wh-status-dot ${row.is_active ? "is-active" : "is-archived"}`}>
                            <span className="wh-status-dot__dot" aria-hidden="true" />
                            {row.is_active ? "Активно" : "Архивировано"}
                          </span>
                        </td>
                        <td className="wh-stock-col-actions">
                          <div className="dish-row-actions">
                            <button
                              type="button"
                              onClick={() => openWhEdit(row)}
                              aria-label={t("pages.warehousepage.redaktirovat")}
                              disabled={asOfDated}
                              title={asOfDated ? "Исторический срез — только просмотр" : "Редактировать"}
                            >
                              <Icon name="bi-pencil" size={15} />
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => openWhDelete(row)}
                              aria-label={t("pages.warehousepage.udalit")}
                              title={asOfDated ? "Исторический срез — только просмотр" : "Удалить"}
                              disabled={asOfDated}
                            >
                              <Icon name="bi-trash3" size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {warehouseSummary.length > 0 ? (
                    <tfoot>
                      <tr className="wh-stock-total-row">
                        <td className="wh-stock-col-num">{t("pages.warehousepage.itogo")}</td>
                        <td className="wh-stock-col-name" />
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(warehouseGrandProduct)}</span></td>
                        <td className="wh-stock-col-tovar">{formatAmount(warehouseGrandTovar)}</td>
                        <td className="wh-stock-col-sum">{formatAmount(warehouseGrandTotal)}</td>
                        <td className="wh-stock-col-status" />
                        <td className="wh-stock-col-actions" />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
              {isEmpty ? (
                <div className="dish-empty-overlay">
                  <ReportEmptyState title={t("pages.warehousepage.sklady_poka_ne_dobavleny")} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        {whModal ? (
          <WarehouseModal
            mode={whModal.mode}
            warehouse={whModal.row}
            saving={whSaving}
            error={whError}
            onClose={closeWhModal}
            onSubmit={submitWhModal}
          />
        ) : null}
      </section>
    );
  }

  // Строка категории дерева детализации прихода/инвентаризации: стрелка +
  // название + приход/сумма. Закрытие — с анимацией (как в Остатке).
  // Дата регистрации — одна по центру между названием и приходом, только
  // в строках позиций (продукты/товары). Шапка/итоги/категории — пустая
  // ячейка, остальные колонки не трогаем.
  const renderPurchaseGroup = (group, kind) => {
    const key = `${kind}:${group.name}`;
    const expanded = expandedCats[key] === true;
    const closing = closingCats[key] === true;
    const visible = expanded || closing;
    const label = kind === "tovar" ? `товаров ${group.name}` : `продуктов ${group.name}`;
    return [
      <tr key={`cat-${key}`} className="wh-detail-cat-row">
        <td>
          <button
            type="button"
            className="wh-detail-toggle"
            onClick={() => toggleWhCat(key)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Свернуть" : "Развернуть"} категорию ${label}`}
          >
            <Icon name="bi-chevron-right" size={15} className={`wh-detail-toggle__chevron${expanded ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          {" "}{group.name}
        </td>
        <td />
        <td>{formatQty(group.qty)}</td>
        <td>{formatAmount(group.sum)}</td>
      </tr>,
      ...(visible ? group.lines.map((line, idx) => (
        <tr key={line.key} className={`wh-detail-line-row${closing ? " is-closing" : ""}`}>
          <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{line.name}</td>
          <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms`, textAlign: "center", fontSize: "13px", fontWeight: 400, color: "var(--neutral-800)" }}>{line.registeredAt || "—"}</td>
          <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{`${formatQty(line.qty)} ${line.unit}`}</td>
          <td style={{ animationDelay: closing ? "0ms" : `${idx * 45}ms` }}>{formatAmount(line.sum)}</td>
        </tr>
      )) : []),
    ];
  };

  // Внутренний экран склада как в Остатке (Всего/Продукты/Товары + дерево
  // категорий): Приход — только первичный приход, Инвентаризация — только
  // автодокументы излишков. Кнопки «← Назад» в шапке нет —
  // назад возвращает стрелка топбара (history.back + popstate ниже).
  // Детализация прихода/инвентаризации. Кнопка «← Назад» — только если передан
  // onBack (задел под другие секции); у Прихода и Инвентаризации в Приходе её нет.
  const renderPurchaseDetailScreen = ({ eyebrow, warehouseName, detail, onBack, regionLabel, tableLabel, drawer }) => (
    <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page warehouse-incoming-page">
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{eyebrow}</p>
              <h1>{warehouseName}</h1>
            </div>
          </div>
          <div className="settings-actions dish-header-actions">
            {onBack ? (
              <button type="button" className="dishes-filter-toggle" onClick={onBack}>
               {t("pages.warehousepage.nazad")}
              </button>
            ) : null}
            {docRangeControl}
          </div>
        </header>
        {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        {!loading && !error && detail ? (
          <div className="settings-table-wrapper dish-grid-wrap">
            <div className="dish-grid-scroll" role="region" aria-label={regionLabel} tabIndex={0}>
              <table className="settings-table dish-grid-table warehouse-stock-table wh-detail-table" aria-label={tableLabel}>
                <thead>
                  <tr>
                    <th className="wh-detail-col-name">{t("pages.warehousepage.nazvaniya")}</th>
                    <th aria-hidden="true" />
                    <th className="wh-detail-col-qty">{t("pages.warehousepage.prihod")}</th>
                    <th className="wh-detail-col-sum">{t("pages.warehousepage.summa")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.vsego")}</td>
                    <td />
                    <td>{formatQty(detail.totalQty)}</td>
                    <td>{formatAmount(detail.totalSum)}</td>
                  </tr>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.produkty")}</td>
                    <td />
                    <td>{formatQty(detail.productQty)}</td>
                    <td>{formatAmount(detail.productSum)}</td>
                  </tr>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.tovary")}</td>
                    <td />
                    <td>{formatQty(detail.tovarQty)}</td>
                    <td>{formatAmount(detail.tovarSum)}</td>
                  </tr>
                  {detail.productGroups.length > 0 ? (
                    <tr className="wh-detail-section-row">
                      <td colSpan={4}>{t("pages.warehousepage.produkty_po_kategoriyam")}</td>
                    </tr>
                  ) : null}
                  {detail.productGroups.map((group) => renderPurchaseGroup(group, "product"))}
                  {detail.tovarGroups.length > 0 ? (
                    <tr className="wh-detail-section-row">
                      <td colSpan={4}>{t("pages.warehousepage.tovary_po_kategoriyam")}</td>
                    </tr>
                  ) : null}
                  {detail.tovarGroups.map((group) => renderPurchaseGroup(group, "tovar"))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
      {drawer || null}
    </section>
  );

  // Приход — сводка по складам как Остаток (вместо старого списка документов):
  // №/Название-ссылка/Продукт/Товар/Сумма + Итого снизу, стили/классы как
  // warehouse-stock-table. Суммируем ВСЕ приходные документы за период
  // (общий docRange, фильтр по registered_at). Склады — из /warehouse/list,
  // те же что в Остатке. Кнопки «Новый приход +» нет. Клик по названию —
  // внутренний экран как в Остатке (Всего/Продукты/Товары + дерево категорий),
  // но ТОЛЬКО первичный приход (строки listPurchaseDetails за период, расхода нет).
  // Кнопки «← Назад» в шапке нет — назад возвращает стрелка топбара.
  if (section === "incoming") {
    const selectedIncoming = selectedIncomingWhId
      ? incomingSummary.find((w) => String(w.key) === String(selectedIncomingWhId))
      : null;
    const incomingDrawer = drawerOpen ? (
      <PurchaseDrawer
        warehouses={refData.warehouses}
        ingredients={refData.ingredients}
        saving={saving}
        error={saveError}
        onClearError={() => setSaveError("")}
        onClose={() => { if (!saving) setDrawerOpen(false); }}
        onSubmit={handleCreate}
      />
    ) : null;
    if (selectedIncoming) {
      // Детализация как в Остатке (дерево категорий со стрелкой, без Excel
      // и поиска), но ТОЛЬКО первичный приход за период — расхода здесь нет.
      const detail = incomingWhDetail;
      return renderPurchaseDetailScreen({
        eyebrow: "Склад / Приход",
        warehouseName: selectedIncoming.name,
        detail,
        // Кнопки «← Назад» здесь нет: назад возвращает стрелка топбара
        // (открытие пушит history — см. openIncomingDetail и popstate ниже).
        onBack: null,
        regionLabel: detail ? t("pages.warehousepage.warehouse_scroll", { label: t("pages.warehousepage.prihod"), name: detail.warehouse.name }) : undefined,
        tableLabel: detail ? t("pages.warehousepage.warehouse_table", { label: t("pages.warehousepage.prihod"), name: detail.warehouse.name }) : undefined,
        drawer: incomingDrawer,
      });
    }
    const selectedInventory = selectedInventoryWhId
      ? inventorySummary.find((w) => String(w.key) === String(selectedInventoryWhId))
      : null;
    if (selectedInventory) {
      // Тот же экран, но ТОЛЬКО автодокументы излишков инвентаризации.
      const detail = inventoryWhDetail;
      return renderPurchaseDetailScreen({
        eyebrow: "Склад / Инвентаризация",
        warehouseName: selectedInventory.name,
        detail,
        // Кнопки «← Назад» здесь нет: назад возвращает стрелка топбара
        // (открытие пушит history — см. openInventoryDetail и popstate выше).
        onBack: null,
        regionLabel: detail ? t("pages.warehousepage.inventory_scroll_named", { name: detail.warehouse.name }) : undefined,
        tableLabel: detail ? t("pages.warehousepage.inventory_table_named", { name: detail.warehouse.name }) : undefined,
        drawer: null,
      });
    }
    const incomingEmpty = !loading && !error && incomingSummary.length === 0;
    // Вторая карточка снизу — излишки инвентаризаций как таблица Прихода:
    // №/Название/Продукт/Товар/Сумма + Итого (только проведённые автодокументы
    // с поставщиком «Инвентаризация» за тот же период). Клик по складу —
    // внутренний экран как у Прихода. Кнопки «Создать» нет (создание —
    // в подкатегории Инвентаризация).
    const inventoryEmpty = !loading && !error && inventorySummary.length === 0;
    const incomingInventoryCard = (
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{t("pages.warehousepage.sklad")}</p>
              <h1>{t("pages.warehousepage.inventarizatsiya")}</h1>
            </div>
          </div>
        </header>
        {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        {!loading && !error ? (
          <div className={`settings-table-wrapper dish-grid-wrap${inventoryEmpty ? " is-empty" : ""}`}>
            <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.inventarizatsiya_po_skladam_s_prokrutkoy")} tabIndex={0}>
              <table className="settings-table dish-grid-table warehouse-stock-table" aria-label={t("pages.warehousepage.inventarizatsiya_po_skladam")}>
                <thead>
                  <tr>
                    <th className="wh-stock-col-num">№</th>
                    <th className="wh-stock-col-name">{t("pages.warehousepage.nazvanie")}</th>
                    <th className="wh-stock-col-product"><span className="wh-shift-left">{t("pages.warehousepage.produkt")}</span></th>
                    <th className="wh-stock-col-tovar"><span className="wh-shift-right">{t("pages.warehousepage.tovar")}</span></th>
                    <th className="wh-stock-col-sum"><span className="wh-shift-right">{t("pages.warehousepage.summa")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {inventorySummary.map((row, index) => (
                    <tr key={row.key || index}>
                      <td className="wh-stock-col-num">{index + 1}</td>
                      <td className="wh-stock-col-name">
                        <button
                          type="button"
                          className="wh-stock-link"
                          onClick={() => openInventoryDetail(row.key)}
                          aria-label={`Открыть инвентаризацию склада ${row.name}`}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(row.product)}</span></td>
                      <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(row.tovar)}</span></td>
                      <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(row.raw)}</span></td>
                    </tr>
                  ))}
                </tbody>
                {inventorySummary.length > 0 ? (
                  <tfoot>
                    <tr className="wh-stock-total-row">
                      <td className="wh-stock-col-num">{t("pages.warehousepage.itogo")}</td>
                      <td className="wh-stock-col-name" />
                      <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(inventoryGrandProduct)}</span></td>
                      <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(inventoryGrandTovar)}</span></td>
                      <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(inventoryGrandTotal)}</span></td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {inventoryEmpty ? (
              <div className="dish-empty-overlay">
                <ReportEmptyState title={t("pages.warehousepage.prihodov_ot_inventarizatsii_poka_net")} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page warehouse-incoming-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {docRangeControl}
            </div>
          </header>
          {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          {!loading && !error ? (
            <div className={`settings-table-wrapper dish-grid-wrap${incomingEmpty ? " is-empty" : ""}`}>
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.prihody_po_skladam_s_prokrutkoy")} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-stock-table" aria-label={t("pages.warehousepage.prihod_po_skladam")}>
                  <thead>
                    <tr>
                      <th className="wh-stock-col-num">№</th>
                      <th className="wh-stock-col-name">{t("pages.warehousepage.nazvanie")}</th>
                      <th className="wh-stock-col-product"><span className="wh-shift-left">{t("pages.warehousepage.produkt")}</span></th>
                      <th className="wh-stock-col-tovar"><span className="wh-shift-right">{t("pages.warehousepage.tovar")}</span></th>
                      <th className="wh-stock-col-sum"><span className="wh-shift-right">{t("pages.warehousepage.summa")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomingSummary.map((row, index) => (
                      <tr key={row.key || index}>
                        <td className="wh-stock-col-num">{index + 1}</td>
                        <td className="wh-stock-col-name">
                          <button
                            type="button"
                            className="wh-stock-link"
                            onClick={() => openIncomingDetail(row.key)}
                            aria-label={`Открыть приходы склада ${row.name}`}
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(row.product)}</span></td>
                        <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(row.tovar)}</span></td>
                        <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(row.raw)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  {incomingSummary.length > 0 ? (
                    <tfoot>
                      <tr className="wh-stock-total-row">
                        <td className="wh-stock-col-num">{t("pages.warehousepage.itogo")}</td>
                        <td className="wh-stock-col-name" />
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(incomingGrandProduct)}</span></td>
                        <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(incomingGrandTovar)}</span></td>
                        <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(incomingGrandTotal)}</span></td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
              {incomingEmpty ? (
                <div className="dish-empty-overlay">
                  <ReportEmptyState title={t("pages.warehousepage.prihodov_poka_net")} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        {incomingInventoryCard}
        {incomingDrawer}
        {inventoryModal}
      </section>
    );
  }

  // V42: подкатегория Инвентаризация — таблица как «Добавить продуктов»:
  // №/Склад/Дата регистрации/Комментарий + Создать.
  if (section === "inventory") {
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {docRangeControl}
              <button type="button" className="dish-add-button" onClick={() => setInvModalOpen(true)}>
                <Icon name="bi-plus" size={18} /> {t("pages.warehousepage.sozdat")}
              </button>
            </div>
          </header>
          {invLoading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {invError ? <div className="login-error" role="alert">{invError}</div> : null}
          {!invLoading && !invError ? renderInventoryTable(t("pages.warehousepage.inventarizatsiya")) : null}
        </section>
        {inventoryModal}
        {detailCheck ? (
          <InventoryDetailModal
            check={detailCheck}
            onClose={() => setDetailCheck(null)}
            onSaved={() => {
              setDetailCheck(null);
              setReloadKey((key) => key + 1);
            }}
          />
        ) : null}
      </section>
    );
  }

  // Отход — таблица тем же каркасом, что инвентаризация (V42): шапка
  // Склад/заголовок + только период (кнопки «Добавить» нет по требованию
  // OWNER), таблица Блюдо/Склад/Продукт/Дата регистрации/Тип отхода/
  // Значение/Кол-во отхода/Сумма — без № и без Действий, всё помещается
  // в один экран (класс wh-waste-table снимает min-width 1360). Период
  // режет visibleRows по regDate (waste в DOC_RANGE_SECTIONS). Связку
  // блюдо→продукт и поля типа/значения бэкенд отдаст позже: пока Блюдо —
  // «—», Тип отхода — категория документа, Значение — цена за единицу.
  // Таблица только для чтения (проведения/удаления из UI нет).
  if (section === "waste") {
    const wasteEmpty = !loading && !error && visibleRows.length === 0;
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {docRangeControl}
            </div>
          </header>
          {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          {!loading && !error ? (
            <div className={`settings-table-wrapper dish-grid-wrap${wasteEmpty ? " is-empty" : ""}`}>
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.othod_tovarov_s_prokrutkoy")} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-journal-table wh-inventory-table wh-waste-table" aria-label={t("pages.warehousepage.othod_tovarov")}>
                  <thead>
                    <tr>
                      <th>{t("pages.warehousepage.blyudo")}</th>
                      <th>{t("pages.warehousepage.sklad")}</th>
                      <th>{t("pages.warehousepage.produkt")}</th>
                      <th>{t("pages.warehousepage.data_registratsii")}</th>
                      <th>{t("pages.warehousepage.tip_othoda")}</th>
                      <th>{t("pages.warehousepage.znachenie")}</th>
                      <th>{t("pages.warehousepage.kol_vo_othoda")}</th>
                      <th>{t("pages.warehousepage.summa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => (
                      <tr key={row.id || index}>
                        <td>—</td>
                        <td>{row.warehouse}</td>
                        <td>{row.product}</td>
                        <td>{row.registeredAt}</td>
                        <td>{row.category}</td>
                        <td>{row.price}</td>
                        <td>{row.quantity} {row.unit}</td>
                        <td>{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {wasteEmpty ? (
                <div className="dish-empty-overlay">
                  <ReportEmptyState title={t("pages.warehousepage.othodov_poka_net")} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    );
  }

  // Строка категории дерева детализации расхода/инвентаризации недостач.
  // Дата регистрации — одна по центру между названием и расходом, только
  // в строках позиций. Шапка/итоги/категории — пустая ячейка (как в приходе).
  const renderExpenseGroup = (group, kind) => {
    const key = `${kind}:${group.name}`;
    const expanded = expandedCats[key] === true;
    const closing = closingCats[key] === true;
    const label = kind === "tovar" ? `товаров ${group.name}` : `продуктов ${group.name}`;
    const delay = (idx) => ({ animationDelay: closing ? "0ms" : `${idx * 45}ms` });
    const metaStyle = (idx) => ({
      ...delay(idx),
      textAlign: "center",
      fontSize: "13px",
      fontWeight: 400,
      color: "var(--neutral-800)",
    });

    // Продукт (после aggregateExpenseProducts): одна строка на продукт,
    // стрелка раскрывает блюда и «Ручной расход». Строка без dishes/manual —
    // прежняя документная строка (детализация недостач инвентаризации).
    const renderProductRow = (item, idx) => {
      const itemKey = `${key}:${item.key}`;
      const open = expandedProducts[itemKey] === true;
      const dishes = Array.isArray(item.dishes) ? item.dishes : [];
      const manualCount = item.manual?.length || 0;
      const unlinkedCount = item.unlinked?.length || 0;
      const docCount = manualCount + unlinkedCount;
      const hasBreakdown = dishes.length > 0 || docCount > 0;
      const rows = [
        <ExpenseDisclosureRow key={itemKey} visible={expanded && !closing} className="wh-detail-line-row">
          <td style={delay(idx)}>
            {hasBreakdown ? (
              <button
                type="button"
                className="wh-detail-toggle wh-detail-toggle--inline"
                onClick={() => setExpandedProducts((prev) => ({ ...prev, [itemKey]: prev[itemKey] !== true }))}
                aria-expanded={open}
                aria-label={`${open ? "Свернуть" : "Развернуть"} расход продукта ${item.name}`}
              >
                <Icon name="bi-chevron-right" size={13} className={`wh-detail-toggle__chevron${open ? " is-open" : ""}`} aria-hidden="true" />
              </button>
            ) : null}
            {" "}{item.name}
          </td>
          <td style={metaStyle(idx)}>
            {dishes.length > 0 ? dishCountLabel(dishes.length) : docCount > 0 ? `${docCount} док.` : "—"}
          </td>
          <td style={delay(idx)}>{`${formatQty(item.qty)} ${item.unit}`}</td>
          <td style={delay(idx)}>{formatAmount(item.sum)}</td>
        </ExpenseDisclosureRow>,
      ];
      if (hasBreakdown) {
        dishes.forEach((dish, dishIdx) => rows.push(
          <ExpenseDisclosureRow visible={expanded && !closing && open} key={`${itemKey}:dish:${dishIdx}`} className="wh-detail-line-row wh-detail-dish-row">
            <td>{dish.name}</td>
            <td />
            <td>{`${formatQty(dish.qty)} ${item.unit}`}</td>
            <td>{formatAmount(dish.sum)}</td>
          </ExpenseDisclosureRow>,
        ));
        if (unlinkedCount > 0) {
          // Причина от бэкенда: «Заказ удалён» / «Нет в техкарте». Если старый
          // ответ без причины — прежнее «Без разбивки».
          const buckets = item.unlinkedReasons || {};
          Object.entries(buckets).forEach(([reason, bucket]) => {
            rows.push(
              <ExpenseDisclosureRow visible={expanded && !closing && open} key={`${itemKey}:unlinked:${reason}`} className="wh-detail-line-row wh-detail-dish-row wh-detail-dish-row--muted">
                <td>{UNLINKED_REASON_LABEL[reason] || "Без разбивки"}</td>
                <td style={metaStyle(0)}>{bucket.count > 1 ? `${bucket.count} док.` : (item.unlinked[0]?.registeredAt || "продажа")}</td>
                <td>{`${formatQty(bucket.qty)} ${item.unit}`}</td>
                <td>{formatAmount(bucket.sum)}</td>
              </ExpenseDisclosureRow>,
            );
            // Проданные блюда заказа: техкарту переписали, но на какое блюдо
            // ушёл расход — видно. Количества на блюдо здесь нет намеренно:
            // после правки техкарты его не из чего посчитать.
            const candidates = Array.isArray(bucket.candidates) ? bucket.candidates : [];
            candidates.forEach((candidate, candidateIdx) => {
              rows.push(
                <ExpenseDisclosureRow visible={expanded && !closing && open} key={`${itemKey}:unlinked:${reason}:dish:${candidateIdx}`} className="wh-detail-line-row wh-detail-dish-row wh-detail-dish-row--muted wh-detail-dish-row--candidate">
                  <td>{candidate.name}</td>
                  <td style={metaStyle(0)}>{`продано ${formatQty(candidate.portions)}`}</td>
                  <td />
                  <td />
                </ExpenseDisclosureRow>,
              );
            });
            const hidden = (bucket.candidatesTotal || 0) - candidates.length;
            if (hidden > 0) {
              rows.push(
                <ExpenseDisclosureRow visible={expanded && !closing && open} key={`${itemKey}:unlinked:${reason}:more`} className="wh-detail-line-row wh-detail-dish-row wh-detail-dish-row--muted wh-detail-dish-row--candidate">
                  <td>{`…и ещё ${dishCountLabel(hidden)}`}</td>
                  <td />
                  <td />
                  <td />
                </ExpenseDisclosureRow>,
              );
            }
          });
        }
        if (manualCount > 0) {
          rows.push(
            <ExpenseDisclosureRow visible={expanded && !closing && open} key={`${itemKey}:manual`} className="wh-detail-line-row wh-detail-dish-row wh-detail-dish-row--manual">
              <td>{t("pages.warehousepage.ruchnoy_rashod")}</td>
              <td style={metaStyle(0)}>{manualCount > 1 ? `${manualCount} док.` : (item.manual[0]?.registeredAt || "документ")}</td>
              <td>{`${formatQty(item.manualQty)} ${item.unit}`}</td>
              <td>{formatAmount(item.manualSum)}</td>
            </ExpenseDisclosureRow>,
          );
        }
      }
      return rows;
    };

    const renderDocRow = (line, idx) => (
      <ExpenseDisclosureRow visible={expanded && !closing} key={line.key} className="wh-detail-line-row">
        <td style={delay(idx)}>{line.name}</td>
        <td style={metaStyle(idx)}>{line.registeredAt || "—"}</td>
        <td style={delay(idx)}>{`${formatQty(line.qty)} ${line.unit}`}</td>
        <td style={delay(idx)}>{formatAmount(line.sum)}</td>
      </ExpenseDisclosureRow>
    );

    return [
      <tr key={`cat-${key}`} className="wh-detail-cat-row">
        <td>
          <button
            type="button"
            className="wh-detail-toggle"
            onClick={() => setExpandedCats((current) => ({ ...current, [key]: current[key] !== true }))}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Свернуть" : "Развернуть"} категорию ${label}`}
          >
            <Icon name="bi-chevron-right" size={15} className={`wh-detail-toggle__chevron${expanded ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          {" "}{group.name}
        </td>
        <td />
        <td>{formatQty(group.qty)}</td>
        <td>{formatAmount(group.sum)}</td>
      </tr>,
      ...group.lines.flatMap((line, idx) => (line.isProduct ? renderProductRow(line, idx) : renderDocRow(line, idx))),
    ];
  };

  // Внутренний экран склада как в Остатке (Всего/Продукты/Товары + дерево
  // категорий): Расход — только расход за период, Инвентаризация — только
  // автодокументы недостач. Кнопки «← Назад» в шапке нет —
  // назад возвращает стрелка топбара (history.back + popstate ниже).
  const renderExpenseDetailScreen = ({ eyebrow, warehouseName, detail, onBack, regionLabel, tableLabel }) => (
    <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page warehouse-incoming-page">
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{eyebrow}</p>
              <h1>{warehouseName}</h1>
            </div>
          </div>
          <div className="settings-actions dish-header-actions">
            {onBack ? (
              <button type="button" className="dishes-filter-toggle" onClick={onBack}>
               {t("pages.warehousepage.nazad")}
              </button>
            ) : null}
            {docRangeControl}
          </div>
        </header>
        {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        {!loading && !error && detail ? (
          <div className="settings-table-wrapper dish-grid-wrap">
            <div className="dish-grid-scroll" role="region" aria-label={regionLabel} tabIndex={0}>
              <table className="settings-table dish-grid-table warehouse-stock-table wh-detail-table wh-expense-detail-table" aria-label={tableLabel}>
                <thead>
                  <tr>
                    <th className="wh-detail-col-name">{t("pages.warehousepage.nazvaniya")}</th>
                    <th aria-hidden="true" />
                    <th className="wh-detail-col-qty">{t("pages.warehousepage.rashod")}</th>
                    <th className="wh-detail-col-sum">{t("pages.warehousepage.summa")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.vsego")}</td>
                    <td />
                    <td>{formatQty(detail.totalQty)}</td>
                    <td>{formatAmount(detail.totalSum)}</td>
                  </tr>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.produkty")}</td>
                    <td />
                    <td>{formatQty(detail.productQty)}</td>
                    <td>{formatAmount(detail.productSum)}</td>
                  </tr>
                  <tr className="wh-detail-total-row">
                    <td>{t("pages.warehousepage.tovary")}</td>
                    <td />
                    <td>{formatQty(detail.tovarQty)}</td>
                    <td>{formatAmount(detail.tovarSum)}</td>
                  </tr>
                  {detail.productGroups.length > 0 ? (
                    <tr className="wh-detail-section-row">
                      <td colSpan={4}>{t("pages.warehousepage.produkty_po_kategoriyam")}</td>
                    </tr>
                  ) : null}
                  {detail.productGroups.map((group) => renderExpenseGroup(group, "product"))}
                  {detail.tovarGroups.length > 0 ? (
                    <tr className="wh-detail-section-row">
                      <td colSpan={4}>{t("pages.warehousepage.tovary_po_kategoriyam")}</td>
                    </tr>
                  ) : null}
                  {detail.tovarGroups.map((group) => renderExpenseGroup(group, "tovar"))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );

  // Расход — сводка по складам как Приход: №/Название-ссылка/Продукт/Товар/
  // Сумма + Итого, классы warehouse-stock-table. Клик — внутренний экран как
  // в Остатке (Всего/Продукты/Товары + дерево категорий), но ТОЛЬКО расход
  // за период. Кнопки «Новый расход +» нет (как в Приходе).
  // Кнопки «← Назад» в шапке нет — назад возвращает стрелка топбара.
  if (section === "outgoing") {
    const selectedOutgoing = selectedOutgoingWhId
      ? outgoingSummary.find((w) => String(w.key) === String(selectedOutgoingWhId))
      : null;
    if (selectedOutgoing) {
      const detail = outgoingWhDetail;
      return renderExpenseDetailScreen({
        eyebrow: "Склад / Расход",
        warehouseName: selectedOutgoing.name,
        detail,
        // Кнопки «← Назад» здесь нет: назад возвращает стрелка топбара
        // (открытие пушит history — см. openOutgoingDetail и popstate ниже).
        onBack: null,
        regionLabel: detail ? t("pages.warehousepage.warehouse_scroll", { label: t("pages.warehousepage.rashod"), name: detail.warehouse.name }) : undefined,
        tableLabel: detail ? t("pages.warehousepage.warehouse_table", { label: t("pages.warehousepage.rashod"), name: detail.warehouse.name }) : undefined,
      });
    }
    const selectedExpenseInventory = selectedExpenseInventoryWhId
      ? expenseInventorySummary.find((w) => String(w.key) === String(selectedExpenseInventoryWhId))
      : null;
    if (selectedExpenseInventory) {
      // Тот же экран, но ТОЛЬКО автодокументы недостач инвентаризации.
      const detail = expenseInventoryWhDetail;
      return renderExpenseDetailScreen({
        eyebrow: "Склад / Инвентаризация",
        warehouseName: selectedExpenseInventory.name,
        detail,
        // Кнопки «← Назад» здесь нет: назад возвращает стрелка топбара
        // (открытие пушит history — см. openExpenseInventoryDetail и popstate ниже).
        onBack: null,
        regionLabel: detail ? t("pages.warehousepage.inventory_scroll_named", { name: detail.warehouse.name }) : undefined,
        tableLabel: detail ? t("pages.warehousepage.inventory_table_named", { name: detail.warehouse.name }) : undefined,
      });
    }
    const outgoingEmpty = !loading && !error && !saleError && persistedOutgoing && outgoingSummary.length === 0;
    // Вторая карточка снизу — недостачи инвентаризаций как таблица Расхода:
    // №/Название/Продукт/Товар/Сумма + Итого (только проведённые автодокументы
    // с получателем «Инвентаризация» за тот же период). Клик по складу —
    // внутренний экран как у Расхода. Кнопки «Новый расход» нет.
    const expenseInventoryEmpty = !loading && !error && expenseInventorySummary.length === 0;
    const outgoingInventoryCard = (
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>{t("pages.warehousepage.sklad")}</p>
              <h1>{t("pages.warehousepage.inventarizatsiya")}</h1>
            </div>
          </div>
        </header>
        {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        {!loading && !error ? (
          <div className={`settings-table-wrapper dish-grid-wrap${expenseInventoryEmpty ? " is-empty" : ""}`}>
            <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.inventarizatsiya_rashodov_po_skladam_s_prokrutkoy")} tabIndex={0}>
              <table className="settings-table dish-grid-table warehouse-stock-table" aria-label={t("pages.warehousepage.inventarizatsiya_rashodov_po_skladam")}>
                <thead>
                  <tr>
                    <th className="wh-stock-col-num">№</th>
                    <th className="wh-stock-col-name">{t("pages.warehousepage.nazvanie")}</th>
                    <th className="wh-stock-col-product"><span className="wh-shift-left">{t("pages.warehousepage.produkt")}</span></th>
                    <th className="wh-stock-col-tovar"><span className="wh-shift-right">{t("pages.warehousepage.tovar")}</span></th>
                    <th className="wh-stock-col-sum"><span className="wh-shift-right">{t("pages.warehousepage.summa")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {expenseInventorySummary.map((row, index) => (
                    <tr key={row.key || index}>
                      <td className="wh-stock-col-num">{index + 1}</td>
                      <td className="wh-stock-col-name">
                        <button
                          type="button"
                          className="wh-stock-link"
                          onClick={() => openExpenseInventoryDetail(row.key)}
                          aria-label={`Открыть инвентаризацию расходов склада ${row.name}`}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(row.product)}</span></td>
                      <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(row.tovar)}</span></td>
                      <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(row.raw)}</span></td>
                    </tr>
                  ))}
                </tbody>
                {expenseInventorySummary.length > 0 ? (
                  <tfoot>
                    <tr className="wh-stock-total-row">
                      <td className="wh-stock-col-num">{t("pages.warehousepage.itogo")}</td>
                      <td className="wh-stock-col-name" />
                      <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(expenseInventoryGrandProduct)}</span></td>
                      <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(expenseInventoryGrandTovar)}</span></td>
                      <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(expenseInventoryGrandTotal)}</span></td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {expenseInventoryEmpty ? (
              <div className="dish-empty-overlay">
                <ReportEmptyState title={t("pages.warehousepage.nedostach_ot_inventarizatsii_poka_net")} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-stock-page warehouse-incoming-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.sklad")}</p>
                <h1>{t(config.title)}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {docRangeControl}
            </div>
          </header>
          {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          {!loading && !error ? (
            <div className={`settings-table-wrapper dish-grid-wrap${outgoingEmpty ? " is-empty" : ""}`}>
              {saleError ? <div className="login-error" role="alert">{saleError}</div> : null}
              {!persistedOutgoing && !saleError ? <div role="status">{t("pages.warehousepage.zagruzka_fakticheskogo_rashoda")}</div> : null}
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.rashody_po_skladam_s_prokrutkoy")} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-stock-table" aria-label={t("pages.warehousepage.rashod_po_skladam")}>
                  <thead>
                    <tr>
                      <th className="wh-stock-col-num">№</th>
                      <th className="wh-stock-col-name">{t("pages.warehousepage.nazvanie")}</th>
                      <th className="wh-stock-col-product"><span className="wh-shift-left">{t("pages.warehousepage.produkt")}</span></th>
                      <th className="wh-stock-col-tovar"><span className="wh-shift-right">{t("pages.warehousepage.tovar")}</span></th>
                      <th className="wh-stock-col-sum"><span className="wh-shift-right">{t("pages.warehousepage.summa")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {outgoingSummary.map((row, index) => (
                      <tr key={row.key || index}>
                        <td className="wh-stock-col-num">{index + 1}</td>
                        <td className="wh-stock-col-name">
                          <button
                            type="button"
                            className="wh-stock-link"
                            onClick={() => openOutgoingDetail(row.key)}
                            aria-label={`Открыть расходы склада ${row.name}`}
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(row.product)}</span></td>
                        <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(row.tovar)}</span></td>
                        <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(row.raw)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  {outgoingSummary.length > 0 ? (
                    <tfoot>
                      <tr className="wh-stock-total-row">
                        <td className="wh-stock-col-num">{t("pages.warehousepage.itogo")}</td>
                        <td className="wh-stock-col-name" />
                        <td className="wh-stock-col-product"><span className="wh-shift-left">{formatAmount(outgoingGrandProduct)}</span></td>
                        <td className="wh-stock-col-tovar"><span className="wh-shift-right">{formatAmount(outgoingGrandTovar)}</span></td>
                        <td className="wh-stock-col-sum"><span className="wh-shift-right">{formatAmount(outgoingGrandTotal)}</span></td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
              {outgoingEmpty ? (
                <div className="dish-empty-overlay">
                  <ReportEmptyState title={t("pages.warehousepage.rashodov_poka_net")} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        {outgoingInventoryCard}
      </section>
    );
  }

  // Добавить продуктов — дизайн как Блюда (dish-catalog-page):
  // шапка + Создать, таблица №/Поставщик/На склад/Дата поступления/
  // Дата регистрации/Итоговая сумма (без Действий: удаление из журнала
  // запрещено, очистка — из Настройки → Основные данные). Клик по строке
  // ведёт на отдельный экран просмотра состава документа.
  if (section === "incoming-journal") {
    // Просмотр готового прихода — то же окно, что создание: те же поля
    // и таблица, но только позиции документа и всё заблокировано.
    const readOnly = Boolean(activeDocId);
    if (readOnly && detailLoading) {
      return (
        <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page warehouse-create-page">
          <section className="dish-catalog-card owner-report-surface settings-card">
            <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_sostava")}</div>
          </section>
        </section>
      );
    }
    if (readOnly && detailError) {
      return (
        <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page warehouse-create-page">
          <section className="dish-catalog-card owner-report-surface settings-card">
            <div className="login-error" role="alert">{detailError}</div>
          </section>
        </section>
      );
    }
    if (creating || activeDocId) {
      return (
        <section className={`nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page warehouse-create-page${readOnly ? " wh-is-readonly" : ""}`}>
          <section className="dish-catalog-card owner-report-surface settings-card">
            <div className="wh-create-toolbar">
              <div className="wh-create-field wh-create-field--supplier">
                <span className="wh-create-field__label" aria-hidden="true">{t("pages.warehousepage.postavschik")}</span>
                <DishSingleSelect
                  label={t("pages.warehousepage.postavschik")}
                  placeholder={t("pages.warehousepage.vyberite_postavschika")}
                  options={supplierOpts}
                  value={supplierOpts.some((item) => item.value === createSupplier) ? createSupplier : ""}
                  onChange={readOnly ? () => {} : (next) => setCreateSupplier(next || "")}
                  disabled={readOnly}
                  loading={suppliersLoading}
                  disabledLabel={t("common.suppliers_unavailable")}
                  onCreateNew={readOnly ? null : handleCreateSupplier}
                  createLabel={t("pages.warehousepage.new_supplier")}
                />
              </div>
              <div className="wh-create-field wh-create-field--warehouse">
                <span className="wh-create-field__label" aria-hidden="true">{t("pages.warehousepage.sklad")}</span>
                <DishSingleSelect
                  label={t("pages.warehousepage.vybor_sklada")}
                  placeholder={t("pages.warehousepage.vyberite_sklad")}
                  options={warehouseOpts}
                  value={warehouseOpts.some((item) => item.value === createWarehouseId) ? createWarehouseId : ""}
                  onChange={readOnly ? () => {} : (next) => setCreateWarehouseId(next || "")}
                  disabled={readOnly || warehouseOpts.length === 0}
                  disabledLabel={t("common.warehouses_unavailable")}
                />
              </div>
              <div className="wh-create-field wh-create-field--date">
                <span className="wh-create-field__label" aria-hidden="true">{t("pages.warehousepage.data")}</span>
                <span className="wh-date-wrap">
                  <input
                    type="date"
                    value={createDate}
                    onChange={(e) => setCreateDate(e.target.value)}
                    disabled={readOnly}
                    aria-label={t("pages.warehousepage.period")}
                  />
                  <span className="wh-date-icon" aria-hidden="true">
                    <Icon name="bi-calendar3" size={17} />
                  </span>
                </span>
              </div>
              <div className="wh-create-side-group">
                <div className="wh-create-field wh-create-field--side">
                  <div className="wh-create-total-card" aria-live="polite">
                    <span>{t("pages.warehousepage.vsego")}</span>
                    <strong>{formatAmount(createTotal)}</strong>
                  </div>
                </div>
                <div className="wh-create-field wh-create-field--side">
                  <button
                    type="button"
                    className="dishes-filter-toggle"
                    aria-expanded={createFiltersOpen}
                    aria-controls="create-products-filters"
                    onClick={() => setCreateFiltersOpen((open) => !open)}
                  >
                    <Icon name="bi-sliders" size={17} /> {t("pages.warehousepage.filtrovat")}
                  </button>
                </div>
                {readOnly ? null : (
                  <div className="wh-create-field wh-create-field--side">
                    <button
                      type="button"
                      className="dish-add-button wh-create-save"
                      onClick={handleCreateSave}
                      disabled={createSaving || !createWarehouseId}
                    >
                      <Icon name="bi-check2-circle" size={18} /> {createSaving ? "Сохранение…" : "Сохранить"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className={`orders-filter-collapse dish-filter-collapse${createFiltersOpen ? " is-open" : ""}`}>
              <div className="orders-filter-collapse__inner" inert={!createFiltersOpen ? true : undefined}>
                <div className="report-filters-grid dish-filter-panel wh-create-filter-panel" id="create-products-filters" aria-label={t("pages.warehousepage.filtry_produktov_prihoda")}>
                  <label className="report-filter-input">
                    <Icon name="bi-search" size={17} />
                    <input
                      aria-label={t("pages.warehousepage.poisk_produktov")}
                      value={createSearch}
                      onChange={(event) => setCreateSearch(event.target.value)}
                      placeholder={t("pages.warehousepage.poisk")}
                    />
                  </label>
                  <DishSingleSelect
                    label={t("pages.warehousepage.tip_produktov")}
                    placeholder={t("pages.warehousepage.tip")}
                    options={[
                      { value: "Продукт", label: t("pages.warehousepage.produkt") },
                      { value: "Товар", label: t("pages.warehousepage.tovar") },
                    ]}
                    value={createType}
                    onChange={(next) => setCreateType(next || "")}
                  />
                  <DishSingleSelect
                    label={t("pages.warehousepage.kategoriya_produktov")}
                    placeholder={t("pages.warehousepage.kategoriya")}
                    options={createCategoryOptions.map((name) => ({ value: name, label: name }))}
                    value={createCategoryOptions.includes(createCategory) ? createCategory : ""}
                    onChange={(next) => setCreateCategory(next || "")}
                    disabled={createCategoryOptions.length === 0}
                    disabledLabel={t("common.categories_unavailable")}
                  />
                  <div className="report-filter-buttons dish-filter-actions">
                    <button type="button" className="report-filter-clear" onClick={clearCreateFilters}>
                      <Icon name="bi-x-circle" size={17} /> {t("pages.warehousepage.ochistit")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {createError ? <Toast kind="error" message={createError} onClose={() => setCreateError("")} /> : null}
            <div className="settings-table-wrapper dish-grid-wrap">
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.tablitsa_sozdaniya_prihoda_s_prokrutkoy")} tabIndex={0}>
                <table className={`settings-table dish-grid-table warehouse-journal-table wh-create-table${readOnly ? " wh-is-readonly" : ""}`} aria-label={t("pages.warehousepage.sozdat_prihod")}>
                  <thead>
                    <tr>
                      <th>{t("pages.warehousepage.kategoriya")}</th>
                      <th>{t("pages.warehousepage.nazvaniya")}</th>
                      <th>{t("pages.warehousepage.tip")}</th>
                      <th>{t("pages.warehousepage.tsena")}</th>
                      <th>{t("pages.warehousepage.kol_vo")}</th>
                      <th>
                        {readOnly ? (
                          <span>{t("pages.warehousepage.itogovaya_summa")}</span>
                        ) : (
                          <span className="wh-total-check">
                            <input
                              type="checkbox"
                              checked={createTotalMode}
                              onChange={(event) => applyTotalMode(event.target.checked)}
                              aria-label={t("pages.warehousepage.vvodit_itogovuyu_summu")}
                            />
                            <span>{t("pages.warehousepage.itogovaya_summa")}</span>
                          </span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {docProductsLoading ? (
                      <tr><td colSpan={6} className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_produktov")}</td></tr>
                    ) : (
                      visibleCreateProducts.map((p) => {
                        const row = resolveRowNumbers(p);
                        const isTotal = createTotalMode;
                        return (
                          <tr key={p.key}>
                            <td className="wh-doc-col-category">{p.category}</td>
                            <td className="wh-doc-col-name">{p.name}</td>
                            <td className="wh-doc-col-type">{p.type}</td>
                            <td className="wh-doc-col-price">
                              {isTotal ? (
                                <span className="wh-doc-computed">
                                  {row.qty > 0 ? formatAmount(row.price) : "—"}
                                </span>
                              ) : readOnly ? (
                                <span className="wh-doc-static">
                                  {row.active ? `${formatIntTrunc(row.price)} UZS` : "—"}
                                </span>
                              ) : (
                                <label className="wh-doc-price-field">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={formatSumInput(docPriceMap[p.key] ?? "")}
                                    placeholder="0"
                                    onChange={(e) => setDocPriceMap((cur) => ({
                                      ...cur,
                                      [p.key]: e.target.value.replace(/[\s\u00a0\u202f]/g, ""),
                                    }))}
                                    onKeyDown={submitCreateOnEnter}
                                    aria-label={`Цена ${p.name}`}
                                  />
                                  <span>UZS</span>
                                </label>
                              )}
                            </td>
                            <td className="wh-doc-col-qty">
                              {readOnly ? (
                                <span className="wh-doc-static">
                                  {row.active ? `${formatSumInput(String(row.qty))} ${p.unit}` : "—"}
                                </span>
                              ) : (
                                <label className="wh-doc-qty-field">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={formatSumInput(docQtyMap[p.key] ?? "")}
                                      placeholder="0"
                                      onChange={(e) => setDocQtyMap((cur) => ({
                                        ...cur,
                                        [p.key]: e.target.value.replace(/[\s\u00a0\u202f]/g, ""),
                                      }))}
                                      onKeyDown={submitCreateOnEnter}
                                      aria-label={`Количество ${p.name}`}
                                    />
                                  <span>{p.unit}</span>
                                </label>
                              )}
                            </td>
                            <td className="wh-doc-col-total">
                              {createTotalMode ? (
                                readOnly ? (
                                  <span className="wh-doc-static">
                                    {row.active ? `${formatIntTrunc(row.total)} UZS` : "—"}
                                  </span>
                                ) : (
                                  <label className="wh-doc-price-field">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={formatSumInput(docTotalMap[p.key] ?? "")}
                                      placeholder="0"
                                      onChange={(e) => setDocTotalMap((cur) => ({
                                        ...cur,
                                        [p.key]: e.target.value.replace(/[\s\u00a0\u202f]/g, ""),
                                      }))}
                                      onKeyDown={submitCreateOnEnter}
                                      aria-label={`Итоговая сумма ${p.name}`}
                                    />
                                    <span>UZS</span>
                                  </label>
                                )
                              ) : (
                                formatAmount(row.total)
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    {!docProductsLoading && !docProducts.length ? (
                      <tr>
                        <td colSpan={6} className="warehouse-empty-cell">
                          {readOnly && docItemsUnavailable
                            ? t("pages.warehousepage.doc_items_unavailable")
                            : t("pages.warehousepage.products_empty_hint")}
                        </td>
                      </tr>
                    ) : null}
                    {!docProductsLoading && docProducts.length > 0 && !visibleCreateProducts.length ? (
                      <tr>
                        <td colSpan={6} className="warehouse-empty-cell">
                         {t("pages.warehousepage.po_filtru_nichego_ne_naydeno")}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  {docProducts.length > 0 ? (
                    <tfoot>
                      <tr className="wh-stock-total-row">
                        <td>{t("pages.warehousepage.itogo")}</td>
                        <td />
                        <td />
                        <td />
                        <td />
                        <td>{formatAmount(createTotal)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          </section>
        </section>
      );
    }
    const journalEmpty = !loading && !error && visibleRows.length === 0;
    return (
      <section className="nomenclature-page dish-catalog-page owner-report-view warehouse-journal-page">
        <section className="dish-catalog-card owner-report-surface settings-card">
          <header className="settings-header dish-catalog-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" aria-hidden="true" />
              <div>
                <p>{t("pages.warehousepage.otchet_po_skladam")}</p>
                <h1>{t("pages.warehousepage.dobavit_produktov")}</h1>
              </div>
            </div>
            <div className="settings-actions dish-header-actions">
              {docRangeControl}
              <button type="button" className="dish-add-button" onClick={openCreateTable}>
                <Icon name="bi-plus" size={18} /> {t("pages.warehousepage.sozdat")}
              </button>
            </div>
          </header>
          {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          {!loading && !error ? (
            <div className={`settings-table-wrapper dish-grid-wrap${journalEmpty ? " is-empty" : ""}`}>
              <div className="dish-grid-scroll" role="region" aria-label={t("pages.warehousepage.tablitsa_prihodov_s_prokrutkoy")} tabIndex={0}>
                <table className="settings-table dish-grid-table warehouse-journal-table" aria-label={t("pages.warehousepage.dobavit_produktov")}>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>{t("pages.warehousepage.postavschik")}</th>
                      <th>{t("pages.warehousepage.na_sklad")}</th>
                      <th>{t("pages.warehousepage.data_postupleniya")}</th>
                      <th>{t("pages.warehousepage.data_registratsii")}</th>
                      <th>{t("pages.warehousepage.itogovaya_summa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => {
                      const clickable = Boolean(row.id);
                      return (
                        <tr
                          key={row.id || index}
                          className="wh-journal-row"
                          onClick={() => {
                            if (!row.id) return;
                            if (onOpenDocDetail) onOpenDocDetail(row.id);
                            else {
                              pushJournalHistory();
                              // Детальный просмотр — не создание: гасим режим
                              // creating и сбрасываем фильтры создания, чтобы
                              // состав документа не резался старым фильтром.
                              setCreating(false);
                              setCreateSearch("");
                              setCreateType("");
                              setCreateCategory("");
                              setCreateFiltersOpen(false);
                              setCreateError("");
                              setLocalDocId(row.id);
                            }
                          }}
                          style={{ cursor: clickable ? "pointer" : "default" }}
                        >
                          <td>{index + 1}</td>
                          <td>{row.supplier}</td>
                          <td>{row.warehouse && row.warehouse !== "—" ? row.warehouse : (whNameById[row.warehouseId] || "—")}</td>
                          <td>{row.date}</td>
                          <td>{row.registeredAt}</td>
                          <td>{row.total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {journalEmpty ? (
                <div className="dish-empty-overlay">
                  <ReportEmptyState title={t("pages.warehousepage.prihodov_poka_net")} />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    );
  }

  return (
    <div className="warehouse-page">
      <section className="warehouse-card">
        {loading ? <div className="warehouse-empty-cell" role="status">{t("pages.warehousepage.zagruzka_skladskih_dannyh")}</div> : null}        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <header className="warehouse-header">
          <div className="warehouse-title-group">
            <span className="warehouse-accent-bar" />
            <div>
              <p>{t("pages.warehousepage.sklad")}</p>
              <h1>{t(config.title)}</h1>
            </div>
          </div>
          <div className="warehouse-actions">
            {config.importExcel ? <button type="button" onClick={() => window.alert("Импорт Excel будет доступен в следующей версии")}><Icon name="bi-file-earmark-spreadsheet" size={17} />{t("pages.warehousepage.import_excel")}</button> : null}
            {config.primaryAction ? (
              mutation
                ? <button type="button" className="warehouse-primary-action" onClick={openDrawer}>{t(config.primaryAction)}</button>
                : <button type="button" className="warehouse-primary-action" disabled title={t(WAREHOUSE_WRITE_UNAVAILABLE)}>{t(config.primaryAction)}</button>
            ) : null}
          </div>
        </header>

        {computedSummary ? (
          <div className="warehouse-summary-grid">
            {computedSummary.map((item) => (
              <article className={`warehouse-summary-card warehouse-summary-card--${item.tone}`} key={t(item.label)}>
                <div>
                  <span>{t(item.label)}</span>
                  <strong>{item.value}</strong>
                </div>
                <i><Icon name={item.icon} size={25} /></i>
              </article>
            ))}
          </div>
        ) : null}

        {config.tabs ? (
          <div className="warehouse-tabs">
            <button type="button" className={activeTab === ACTIVE ? "is-active" : ""} onClick={() => setActiveTab(ACTIVE)}>{t("pages.warehousepage.aktivnye")}</button>
            <button type="button" className={activeTab === ARCHIVE ? "is-active" : ""} disabled title={t(WAREHOUSE_WRITE_UNAVAILABLE)}>{t("pages.warehousepage.arhiv")}</button>
          </div>
        ) : null}

        <div className="warehouse-filters">
          <label className="warehouse-search-control">
            <span>{t("pages.warehousepage.poisk")}</span>
            <input value={draftFilters.search} onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))} placeholder={t("pages.warehousepage.dokument_postavschik_tovar")} />
          </label>
          {DOC_RANGE_SECTIONS.includes(section) ? (
            <div className="warehouse-period-filter">
              <span>{t("pages.warehousepage.period")}</span>
              {docRangeControl}
            </div>
          ) : null}
          {(config.filters || []).map(([key, label, placeholder]) => (
            <label key={key}>
              <span>{t(label)}</span>
              <input value={draftFilters[key] || ""} onChange={(event) => setDraftFilters((current) => ({ ...current, [key]: event.target.value }))} placeholder={t(placeholder)} />
            </label>
          ))}
          <div className="warehouse-filter-actions">
            <button type="button" onClick={() => setFilters(draftFilters)}><Icon name="bi-funnel" size={15} />{t("pages.warehousepage.filtrovat")}</button>
            <button type="button" className="warehouse-clear-action" onClick={() => {
              const reset = { search: "", warehouse: "", supplier: "", status: "", receiver: "", category: "", author: "", from: "", to: "" };
              setDraftFilters(reset);
              setFilters(reset);
              setDocRange(defaultDocRange());
            }}>{t("pages.warehousepage.ochistit")}</button>
          </div>
        </div>

        <div className="warehouse-table-wrapper">
          <table className="warehouse-table">
            <thead>
              <tr>{config.columns.map((column) => <th key={column}>{t(column)}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.id || row.document || row.product || row.name}-${index}`}>
                  {renderWarehouseCells(section, row, index, config.editable, { busyId, onAccept: handleAccept, onDelete: handleDelete })}
                </tr>
              ))}
              {!loading && !error && !visibleRows.length ? <tr><td className="warehouse-empty-cell" colSpan={config.columns.length}>{t("pages.warehousepage.net_dannyh")}</td></tr> : null}
            </tbody>
          </table>
        </div>

        <footer className="warehouse-pagination">
          <span>{t("pages.warehousepage.pokazano_1")} {Math.min(visibleRows.length, 10)} {t("pages.warehousepage.iz")} {visibleRows.length}</span>
          <div>
            {[1, 2, 3, 4].map((page) => <button key={page} type="button" className={page === 1 ? "is-active" : ""}>{page}</button>)}
          </div>
          <select defaultValue="10"><option value="10">{t("pages.warehousepage.10_str")}</option><option value="20">{t("pages.warehousepage.20_str")}</option></select>
        </footer>
      </section>

      {drawerOpen ? (
        section === "outgoing" ? (
          <ExpenseDrawer
            warehouses={refData.warehouses}
            ingredients={refData.ingredients}
            saving={saving}
            error={saveError}
            onClearError={() => setSaveError("")}
            onClose={() => { if (!saving) setDrawerOpen(false); }}
            onSubmit={handleCreate}
          />
        ) : section === "waste" ? (
          <WasteDrawer
            warehouses={refData.warehouses}
            ingredients={refData.ingredients}
            saving={saving}
            error={saveError}
            onClearError={() => setSaveError("")}
            onClose={() => { if (!saving) setDrawerOpen(false); }}
            onSubmit={handleCreate}
          />
        ) : (
          <PurchaseDrawer
            warehouses={refData.warehouses}
            ingredients={refData.ingredients}
            saving={saving}
            error={saveError}
            onClearError={() => setSaveError("")}
            onClose={() => { if (!saving) setDrawerOpen(false); }}
            onSubmit={handleCreate}
          />
        )
      ) : null}
    </div>
  );
}

function renderWarehouseCells(section, row, index, editable, ctx = {}) {
  const actions = editable ? (
    <td>
      <div className="warehouse-row-actions">
        <button type="button" className="edit-action-button" disabled title={t(WAREHOUSE_WRITE_UNAVAILABLE)} aria-label={t("pages.warehousepage.redaktirovanie_nedostupno")}><Icon name="bi-pencil" size={15} /></button>
        <button type="button" className={row.archiveState === ARCHIVE ? "is-restore" : "is-danger"} disabled title={t(WAREHOUSE_WRITE_UNAVAILABLE)} aria-label={t("pages.warehousepage.arhivirovanie_nedostupno")}>
          <Icon name={row.archiveState === ARCHIVE ? "bi-recycle" : "bi-trash3"} size={15} />
        </button>
      </div>
    </td>
  ) : null;

  const status = row.status ? <span className={`warehouse-status-badge warehouse-status-badge--${statusTone(row.status)}`}>{row.status}</span> : null;

  // Живые действия по проводимому документу (приход/расход/отход): «Провести»
  // только для черновика + «Удалить». Кнопки блокируются на время мутации по
  // этой строке (busyId). Требует ctx.onAccept/onDelete из WarehousePage.
  const docActions = (acceptTitle, deleteTitle, hideAccept = false) => {
    const busy = ctx.busyId === row.id;
    return (
      <td>
        <div className="warehouse-row-actions">
          {!row.accepted && !hideAccept ? (
            <button type="button" className="is-restore" disabled={busy} onClick={() => ctx.onAccept?.(row.id)} aria-label={acceptTitle} title={acceptTitle}><Icon name="bi-check2-circle" size={15} /></button>
          ) : null}
          <button type="button" className="is-danger" disabled={busy} onClick={() => ctx.onDelete?.(row.id)} aria-label={deleteTitle} title={deleteTitle}><Icon name="bi-trash3" size={15} /></button>
        </div>
      </td>
    );
  };

  if (section === "incoming") {
    // Живые действия по документу: «Провести» (только для черновика) и «Удалить».
    return <><td>{index + 1}</td><td>{row.document}</td><td>{row.supplier}</td><td>{row.warehouse}</td><td>{row.total}</td><td>{status}</td><td>{row.date}</td>{docActions("Провести приход", "Удалить приход")}</>;
  }
  // Журнал без действий: удаление из списка запрещено (см. кастомный рендер
  // списка выше и warehouseConfigs) — только просмотр и создание.
  if (section === "incoming-journal") return <><td>{index + 1}</td><td>{row.supplier}</td><td>{row.warehouse}</td><td>{row.date}</td><td>{row.registeredAt}</td><td>{row.total}</td></>;
  if (section === "transfer") return <><td>{index + 1}</td><td>{row.document}</td><td>{row.from}</td><td>{row.to}</td><td>{row.positions}</td><td>{row.total}</td><td>{status}</td><td>{row.date}</td>{actions}</>;
  if (section === "inventory") return <><td>{row.date}</td><td>{row.warehouse}</td><td>{row.checkType}</td><td>{row.comment}</td><td>{status}</td><td>{row.author}</td></>;
  if (section === "write-off") return <><td>{row.date}</td><td>{row.category}</td><td>{row.positions}</td><td>{status}</td><td>{row.author}</td><td>{row.note}</td></>;
  if (section === "write-off-categories") return <><td>{row.category}</td><td>{row.count}</td><td>{row.positions}</td></>;
  // Авто-отход — только для отчёта (backend отклоняет ручное проведение
  // 422): кнопку «Провести» не показываем, остаётся «Удалить».
  if (section === "waste") return <><td>{row.date}</td><td>{row.category}</td><td>{row.product}</td><td>{row.unit}</td><td>{row.quantity}</td><td>{row.total}</td><td>{row.author}</td><td>{row.reason}</td>{docActions("Провести отход", "Удалить отход", row.isAutomatic === true)}</>;
  if (section === "outgoing") return <><td>{index + 1}</td><td>{row.document}</td><td>{row.receiver}</td><td>{row.warehouse}</td><td>{row.total}</td><td>{status}</td><td>{row.date}</td>{docActions("Провести расход", "Удалить расход")}</>;
  return <><td>{index + 1}</td><td>{row.document}</td><td>{row.supplier}</td><td>{row.warehouse}</td><td>{row.total}</td><td>{status}</td><td>{row.date}</td>{actions}</>;
}

export default WarehousePage;

// Роут-обёртки Остатка: список пушит :warehouseId в историю — стрелка
// топбара (navigate(-1)) возвращает на список. Кнопки «Назад» в шапке нет.
export function WarehouseStockListRoute() {
  const navigate = useNavigate();
  return (
    <WarehousePage
      initialSection="stock"
      onOpenWarehouse={(row) => navigate(encodeURIComponent(String(row.id)))}
    />
  );
}

export function WarehouseStockDetailRoute() {
  const { warehouseId } = useParams();
  // ?ingredient=<id> — заход из колокольчика дефицита: раскрыть только
  // категорию этого сырья (остальные остаются закрытыми).
  const [searchParams] = useSearchParams();
  return (
    <WarehousePage
      initialSection="stock"
      warehouseId={warehouseId || ""}
      focusIngredientId={searchParams.get("ingredient") || ""}
    />
  );
}

// Добавить продуктов: список пушит .../create — стрелка топбара
// (navigate(-1)) возвращается на список. Алиас income-log нормализуем
// на канонический incoming-journal, create-роут заведён только там.
function journalBasePath(pathname) {
  const clean = String(pathname || "").replace(/\/$/, "");
  if (clean.endsWith("/income-log")) {
    return clean.slice(0, -"/income-log".length) + "/incoming-journal";
  }
  return clean;
}

export function WarehouseJournalListRoute() {
  return (
    <WarehousePage
      initialSection="incoming-journal"
      // Создание и история строки — встроенно, без ухода из подкатегории
      // (выход — назад топбара через history; .../create и .../:docId роуты
      // живут для прямых ссылок).
    />
  );
}

export function WarehouseJournalCreateRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = String(location.pathname || "").replace(/\/create$/, "");
  return (
    <WarehousePage
      initialSection="incoming-journal"
      startCreating
      onCloseCreate={() => navigate(base || "/stock-report/incoming-journal", { replace: true })}
    />
  );
}

export function WarehouseJournalDetailRoute() {
  const { docId } = useParams();
  return <WarehousePage initialSection="incoming-journal" detailDocId={docId || ""} />;
}
