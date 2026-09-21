// Конфигурация и справочники раздела «Сотрудники» OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Значения и структуры сохранены 1:1;
// операционные роли (кассир/официант/курьер/моноблок/повар/менеджер/завсклад)
// остаются выбираемыми — веб-клиент им по-прежнему не выдаётся.
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
  password: "",
  // CASHIER-FE-01: visual-only field, never sent to backend (printer_ip handoff).
  printerIp: "",
  status: "active",
  photo: "",
};

export const getPermissionSummary = (values) => {
  const permissions = [
    values.canDeleteDishes && "Удаление блюд",
    values.canTakeawayAtTable && "Заказ на вынос",
    values.canChangeOrderType && "Изменение типа заказа",
    values.canCloseBill && "Закрытие счета",
    values.canOpenCashDrawerAfterPayment && "Открытие денежного ящика",
    values.canViewClosedOrders && "Просмотр закрытых заказов",
  ].filter(Boolean);

  return permissions.join(", ") || values.permission || "Базовый доступ";
};

export const staffAccessModules = [
  { key: "home", label: "Главная" },
  { key: "warehouse_stock", label: "Склады (Остаток товаров)" },
  { key: "goods_income", label: "Приход товаров" },
  { key: "goods_expense", label: "Расход товаров" },
  { key: "income_log", label: "Журнал приходов" },
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
  { key: "raw_materials", label: "Сырьё" },
  { key: "raw_categories", label: "Категории сырья" },
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

export function mapStaffUser(user) {
  const roleKey = user.role_slug || user.role_slugs?.[0] || "cashier";
  return {
    id: user.id,
    fullName: user.name || user.email?.split("@")[0] || "—",
    email: user.email || "",
    phone: user.phone || "",
    roleKey,
    status: user.is_active !== false ? "active" : "archived",
    pin: "",
    password: "",
    photo: user.avatar_url || "",
  };
}
