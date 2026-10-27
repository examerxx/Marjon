// Конфигурация и справочники раздела «Сотрудники» OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Значения и структуры сохранены 1:1;
// операционные роли (кассир/официант/курьер/моноблок/повар/менеджер/завсклад)
// остаются выбираемыми — веб-клиент им по-прежнему не выдаётся.
// ВАЖНО (i18n): русские строки здесь — ИДЕНТИФИКАТОРЫ, а не готовый текст.
// Переводить их на этапе импорта нельзя (значение застынет на языке бандла),
// поэтому подписи оборачиваются в t() уже в рендере.
import { t } from "../../i18n/t";

export const roleOptions = [
  { key: "cashier", label: "Кассир", title: "Кассиры" },
  { key: "waiter", label: "Официант", title: "Официанты" },
  { key: "courier", label: "Курьер", title: "Курьеры" },
  { key: "monoblock", label: "Моноблок", title: "Моноблок" },
  { key: "kitchen", label: "Повар", title: "Повара" },
  { key: "manager", label: "Менеджер", title: "Менеджеры" },
  { key: "warehouse", label: "Завсклад", title: "Завсклад" },
];

export const roleMap = roleOptions.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

export const emptyForm = {
  fullName: "",
  email: "",
  phone: "",
  phoneCountry: "UZ",
  roleKey: "",
  pin: "",
  // Сеть → филиал: моноблок привязывается к филиалу (свой десктоп-терминал).
  // "" — филиал не выбран; отправляем branch_id только когда выбран.
  branchId: "",
  password: "",
  // Принтер, закреплённый за сотрудником. Выбирается из уже добавленных
  // принтеров (раздел «Настройка принтеров»), поэтому храним id, а не IP:
  // IP можно поменять в одном месте, привязка останется рабочей.
  printerId: "",
  status: "active",
  photo: "",
  // Выбранный файл фото (загружается после сохранения, когда известен id).
  photoFile: null,
  // Тумблеры прав. Все стартуют выключенными и теперь реально сохраняются
  // (User.permissions) — раньше жили только в состоянии формы и терялись
  // при закрытии карточки, из-за чего выглядели «неработающими».
  canDeleteDishes: false,
  canChangeMarkingCode: false,
  canTakeawayAtTable: false,
  canChangeOrderType: false,
  canCloseBill: false,
  canOpenCashDrawerAfterPayment: false,
  canViewClosedOrders: false,
  canMainMonoblock: false,
  canSeeCashiers: false,
  canCookPrinter: false,
  canPrintCancel: false,
  // Матрица доступов: { [moduleKey]: { enabled, create, read, update, delete } }.
  access: {},
};

// Все ключи тумблеров одним списком — чтобы и гидратация из бэкенда, и
// сборка payload шли по одному источнику.
// ВАЖНО (дифф 21-го мерджа): список обязан покрывать cashierSwitchFields,
// waiterSwitchFields и monoblockSwitchFields. Пропущенный здесь флаг молча
// выпадает из POST /auth/users — ровно так терялись canManageOrders у
// официанта и canViewFinance/canApproveAttendance у кассира и моноблока.
export const staffPermissionFlags = [
  "canDeleteDishes",
  "canChangeMarkingCode",
  "canTakeawayAtTable",
  "canChangeOrderType",
  "canCloseBill",
  "canOpenCashDrawerAfterPayment",
  "canViewClosedOrders",
  "canManageOrders",
  "canMainMonoblock",
  "canSeeCashiers",
  "canCookPrinter",
  "canPrintCancel",
  "canViewFinance",
  "canApproveAttendance",
];

// payload для POST/PATCH /auth/users: тумблеры + матрица в одном JSON.
// PERMS-ONE-SOURCE-01: ключи тумблеров — snake_case (staffPermissionKeys),
// а не camelCase полей формы. Раньше create писал camelCase, а PATCH —
// snake_case, поэтому один и тот же включённый тумблер «не сохранялся» при
// создании и начинал работать только после повторного открытия карточки;
// матрица доступов при PATCH терялась вовсе. Теперь обе операции собирают
// словарь одной функцией.
export const staffPermissionsPayload = (form, fields = staffPermissionFlags) =>
  buildStaffPermissionsForSave(form, fields);

export function buildStaffPermissionsForSave(form, fields = []) {
  const base =
    form?.permissions && typeof form.permissions === "object" ? { ...form.permissions } : {};
  for (const field of fields) {
    const key = staffPermissionKeys[field];
    if (!key) continue;
    const value = form?.[field];
    if (typeof value !== "boolean") continue;
    // false пишем только когда право раньше было выдано: у легаси-сотрудника
    // отсутствие ключа означает allow-all (can() в десктопе), и явный false
    // молча отозвал бы права, которых владелец не снимал. Снятый тумблер при
    // этом обязан сохраниться — иначе «выключил, а оно снова включено».
    const wasGranted = base[key] === true || base[field] === true;
    if (value === true || wasGranted) base[key] = value;
    // Легаси-ключ в camelCase удаляем: он читается как «выдано» и перебил бы
    // только что снятый тумблер.
    if (field in base) delete base[field];
  }
  // Матрица — полная правда формы: заменяем целиком, иначе снятые галочки
  // оставались бы в старом словаре и «возвращались» после перезагрузки.
  const modules = form?.access && typeof form.access === "object" ? form.access : {};
  const enabledModules = {};
  Object.entries(modules).forEach(([moduleKey, value]) => {
    if (!value || typeof value !== "object") return;
    if (!value.enabled) return;
    enabledModules[moduleKey] = { ...value };
  });
  if (Object.keys(enabledModules).length) base.modules = enabledModules;
  else delete base.modules;
  return base;
}

export const getPermissionSummary = (values) => {
  // Подписи переводим здесь, а не в конфиге: функция вызывается из рендера,
  // поэтому t() видит актуальный язык. Русский литерал остаётся в коде как
  // идентификатор права и как фолбэк для ключей, которых ещё нет в словаре.
  const permissions = [
    values.canDeleteDishes && t("staff.perm.delete_dishes"),
    // WAITER-01: waiter-only switch, truthful summary like other form-state permissions.
    values.canChangeMarkingCode && t("staff.perm.change_marking_code"),
    values.canTakeawayAtTable && t("staff.perm.takeaway_at_table"),
    values.canChangeOrderType && t("staff.perm.change_order_type"),
    values.canCloseBill && t("staff.perm.close_bill"),
    values.canManageOrders && t("staff.perm.manage_orders"),
    values.canOpenCashDrawerAfterPayment && t("staff.perm.open_cash_drawer"),
    values.canViewClosedOrders && t("staff.perm.view_closed_orders"),
    values.canViewFinance && t("staff.perm.view_finance"),
    values.canApproveAttendance && t("staff.perm.approve_attendance"),
  ].filter(Boolean);

  return permissions.join(", ") || values.permission || t("staff.base_access");
};

// Тумблеры формы → ключи легаси-JSON User.permissions на бэкенде.
// Те же ключи читают десктопные гейты can()/must() (can_close_bill —
// закрытие счёта, can_manage_orders — PIN-подтверждение отмены/переноса
// у официанта) и require_permission_or_admin на API.
export const staffPermissionKeys = {
  canDeleteDishes: "can_delete_dishes",
  canChangeMarkingCode: "can_change_marking_code",
  canTakeawayAtTable: "can_takeaway_at_table",
  canChangeOrderType: "can_change_order_type",
  canCloseBill: "can_close_bill",
  canOpenCashDrawerAfterPayment: "can_open_cash_drawer_after_payment",
  canViewClosedOrders: "can_view_closed_orders",
  canManageOrders: "can_manage_orders",
  canMainMonoblock: "can_main_monoblock",
  canSeeCashiers: "can_see_cashiers",
  canCookPrinter: "can_cook_printer",
  canPrintCancel: "can_print_cancel",
  // DESK-PERM-01: панели десктопа «Финансы» и «Посещаемость». Флаги читает
  // desktop/src/shared/permissions.js (must(...)), поэтому без них кнопки на
  // терминале не появлялись ни у одной роли — включить их было негде.
  canViewFinance: "can_view_finance",
  canApproveAttendance: "can_approve_attendance",
};

// Собирает словарь тумблеров для POST/PATCH /auth/users из состояния формы.
// Стартуем с сырого словаря записи (form.permissions — правда бэкенда,
// подложенная mapStaffUser), поверх кладём явные boolean полей роли.
// Нетронутые (undefined) не шлём; если трогать было нечего и базы нет —
// undefined (ключ опускаем, колонку не трогаем).
export function buildStaffPermissions(form, fields) {
  const built = buildStaffPermissionsForSave(form, fields);
  return Object.keys(built).length ? built : undefined;
}

// Читает тумблер из ответа бэкенда: новый путь — словарь permissions,
// старый — плоские can_* поля (фолбэк на «правду будущего» из API).
// Возвращаем true либо undefined (НЕ false): словарь false означает
// явный запрет, и отдавать его как «не трогали» нельзя, а превращать
// отсутствие права в false нельзя тем более — при сохранении это
// записало бы явные false и отозвало бы allow-all режим can() у
// легаси-сотрудников без словаря прав.
export function readStaffPermission(user, field) {
  const key = staffPermissionKeys[field];
  const dict = user?.permissions;
  if (dict && typeof dict === "object") {
    if (dict[key] === true) return true;
    // Легаси-словари, записанные старым create (camelCase): сотрудники,
    // созданные до PERMS-ONE-SOURCE-01, хранят ключи полей формы. Без этой
    // ветки их тумблеры «гасли» бы после первого же открытия карточки.
    if (dict[field] === true) return true;
  }
  if (user?.[key] === true) return true;
  if (user?.[field] === true) return true;
  return undefined;
}

// WAITER-01: product drawer switch contracts. Cashier frozen at 7 total
// (Статус + 6). Waiter exactly 6 total (Статус + 5, incl. marking code and
// order management). Тумблеры персистятся в User.permissions на бэкенде;
// только Статус (is_active) шёл раньше — теперь уходит весь словарь.
export const cashierSwitchFields = [
  "canDeleteDishes",
  "canTakeawayAtTable",
  "canChangeOrderType",
  "canCloseBill",
  "canOpenCashDrawerAfterPayment",
  "canViewClosedOrders",
  // DESK-PERM-01: панели десктопа, доступные кассиру на терминале.
  "canViewFinance",
  "canApproveAttendance",
];

export const waiterSwitchFields = [
  "canDeleteDishes",
  "canChangeMarkingCode",
  "canTakeawayAtTable",
  "canChangeOrderType",
  "canManageOrders",
];

// MONOBLOCK-01: 5 primary controls (Статус + 4). Тумблеры персистятся в
// User.permissions на бэкенде вместе с остальными ролями.
export const monoblockSwitchFields = [
  "canMainMonoblock",
  "canSeeCashiers",
  "canCookPrinter",
  "canPrintCancel",
  // DESK-PERM-01: моноблок — основной терминал заведения, ему нужны обе панели.
  "canViewFinance",
  "canApproveAttendance",
];

// KITCHEN-01: повар (роль kitchen). В карточке — только то, что реально
// читают гейты кухни: печать на принтер повара и печать отмены заказа.
// Остальные тумблеры кассира повару не нужны и только путали владельца.
export const kitchenSwitchFields = [
  "canCookPrinter",
  "canPrintCancel",
];

// CASHIER-PARITY-01 (Phase 1): manager + warehouse reuse the exact Cashier
// permission matrix source (staffAccessModules below, all 50 modules, same
// count/text/order). No role-specific curated lists: the previous
// managerMatrixModules / warehouseMatrixModules subsets were removed as the
// wrong contract. Matrix switches stay FRONTEND PREPARED ONLY
// (BACKEND_HANDOFF_REQUIRED): interactive drawer state, never sent to
// backend, never stored in localStorage/sessionStorage. HR deliberately
// excluded (REFERENCE_ELEMENT_REJECTED) — staffAccessModules has no HR key.
// Primary product-drawer switches (Статус отдельно) персистятся через
// buildStaffPermissions; матрица — нет.

export const staffAccessModules = [
  { key: "home", label: "Главная" },
  { key: "warehouse_stock", label: "Склады (Остаток товаров)" },
  { key: "goods_income", label: "Приход товаров" },
  { key: "goods_expense", label: "Расход товаров" },
  { key: "income_log", label: "Добавить продуктов" },
  { key: "transfers", label: "Перемещения" },
  { key: "supplier_returns", label: "Возврат поставщику" },
  { key: "inventory", label: "Инвентаризация" },
  { key: "write_off", label: "Списание" },
  { key: "write_off_categories", label: "Категории списания" },
  { key: "z_report", label: "Z-отчет" },
  { key: "orders_report", label: "Отчет по заказам" },
  { key: "tables_report", label: "Отчет по столам" },
  { key: "waiters_report", label: "Отчет по официантам" },
  { key: "dishes_report", label: "Отчет по блюдам" },
  { key: "couriers_report", label: "Отчет по курьерам" },
  { key: "deleted_dishes_report", label: "Отчет по удаленным блюдам" },
  { key: "debtors_creditors", label: "Дебиторы и Кредиторы" },
  { key: "cashflow", label: "Денежный поток" },
  { key: "cashier", label: "Кассир" },
  { key: "waiter", label: "Официант" },
  { key: "monoblock", label: "Моноблок" },
  { key: "cook", label: "Повар" },
  { key: "manager", label: "Менеджер" },
  { key: "warehouse_manager", label: "Завсклад" },
  { key: "attendance", label: "Посещаемость" },
  { key: "courier", label: "Курьер" },
  { key: "clients", label: "Клиенты" },
  { key: "suppliers", label: "Поставщик" },
  { key: "places", label: "Места" },
  { key: "payment_methods", label: "Способы оплаты" },
  { key: "units", label: "Ед. измерения" },
  { key: "profile_settings", label: "Настройка профиля" },
  { key: "printer_settings", label: "Настройка принтеров" },
  { key: "banners", label: "Баннеры" },
  { key: "playlists", label: "Плейлисты" },
  { key: "devices", label: "Устройства" },
  { key: "cash_operations", label: "Денежные операции" },
  { key: "income_expense_categories", label: "Категории приход-расходов" },
  { key: "dishes", label: "Блюда" },
  { key: "dish_categories", label: "Категории блюда (меню)" },
  { key: "raw_materials", label: "Продукты" },
  { key: "raw_categories", label: "Категории продуктов" },
  { key: "semi_finished", label: "Полуфабрикаты" },
  { key: "semi_finished_categories", label: "Категории полуфабрикатов" },
  { key: "sales_categories", label: "Категории реализации" },
  { key: "call_center", label: "Call Center" },
  { key: "booking", label: "Брон" },
  { key: "order_edit", label: "Заказы (изменить, удалить)" },
  { key: "order_types", label: "Заказы (типы)", actions: ["takeaway", "table", "delivery", "new"] },
];

export const staffAccessActions = [
  { key: "create", label: "Создать" },
  { key: "read", label: "Читать" },
  { key: "update", label: "Обновлять" },
  { key: "delete", label: "Удалить" },
];

export const staffOrderTypeActions = [
  { key: "takeaway", label: "На вынос" },
  { key: "table", label: "На стол" },
  { key: "delivery", label: "Доставка" },
  { key: "new", label: "Новый" },
];

// Короткий отображаемый номер сотрудника. Канонический id в бэкенде — UUID
// (длинный, не для глаз), отдельного числового бизнес-id у User нет. Выводим
// стабильный 5-значный номер, детерминированно производный от UUID: один и тот
// же сотрудник всегда получает один и тот же номер. Это ТОЛЬКО для отображения
// в колонке «ID» — ключи списка, действия и запросы по-прежнему идут по
// настоящему user.id. Диапазон 10000–99999 → всегда ровно 5 цифр.
export function shortStaffId(id) {
  const raw = String(id ?? "");
  if (!raw) return "—";
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    // FNV-подобное смешивание в беззнаковом 32-битном диапазоне.
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return String(10000 + (hash % 90000));
}

export function mapStaffUser(user) {
  const roleKey = user.role_slug || user.role_slugs?.[0] || "cashier";
  const perms = user.permissions && typeof user.permissions === "object" ? user.permissions : {};
  const modules = perms.modules && typeof perms.modules === "object" ? perms.modules : {};
  // Тумблеры и матрица приходят из User.permissions тем же ключом, каким
  // живут в форме, поэтому карточка открывается в сохранённом состоянии.
  const flags = {};
  staffPermissionFlags.forEach((key) => {
    // Читаем оба формата ключей: новые записи — snake_case, старые —
    // camelCase (до PERMS-ONE-SOURCE-01 create писал camelCase).
    flags[key] = readStaffPermission(user, key) === true;
  });
  return {
    id: user.id,
    fullName: user.name || user.email?.split("@")[0] || "—",
    email: user.email || "",
    phone: user.phone || "",
    roleKey,
    status: user.is_active !== false ? "active" : "archived",
    // Тумблеры владельца: читаем из словаря permissions ответа бэкенда
    // (GET /auth/users после проброса). Нет словаря — все OFF, честно.
    // ...flags — тот же словарь через staffPermissionFlags (общий список),
    // readStaffPermission добавляет фолбэк на плоские can_* поля API.
    ...flags,
    canDeleteDishes: readStaffPermission(user, "canDeleteDishes"),
    canChangeMarkingCode: readStaffPermission(user, "canChangeMarkingCode"),
    canTakeawayAtTable: readStaffPermission(user, "canTakeawayAtTable"),
    canChangeOrderType: readStaffPermission(user, "canChangeOrderType"),
    canCloseBill: readStaffPermission(user, "canCloseBill"),
    canOpenCashDrawerAfterPayment: readStaffPermission(user, "canOpenCashDrawerAfterPayment"),
    canViewClosedOrders: readStaffPermission(user, "canViewClosedOrders"),
    canManageOrders: readStaffPermission(user, "canManageOrders"),
    canMainMonoblock: readStaffPermission(user, "canMainMonoblock"),
    canSeeCashiers: readStaffPermission(user, "canSeeCashiers"),
    canCookPrinter: readStaffPermission(user, "canCookPrinter"),
    canPrintCancel: readStaffPermission(user, "canPrintCancel"),
    canViewFinance: readStaffPermission(user, "canViewFinance"),
    canApproveAttendance: readStaffPermission(user, "canApproveAttendance"),
    // Сохранённая матрица доступов (perms.modules) — карточка открывается
    // в том состоянии, в котором владелец её оставил.
    access: modules,
    printerId: user.printer_id || "",
    pin: "",
    // Привязка сотрудника к филиалу (сеть → филиал). "" у веб-владельца и у
    // непривязанных аккаунтов; конкретный id — сотрудник закреплён за филиалом.
    branchId: user.branch_id || "",
    password: "",
    photo: user.avatar_url || "",
    // Сырой словарь прав бэкенда для merge при сохранении: тумблеры формы
    // кладутся поверх него (см. buildStaffPermissions), чтобы правка имени
    // не затирала чужие ключи. В UI не рендерится, в прочие payload не идёт.
    permissions:
      user.permissions && typeof user.permissions === "object" ? { ...user.permissions } : undefined,
  };
}
