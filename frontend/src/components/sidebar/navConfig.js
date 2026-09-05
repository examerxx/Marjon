// Навигация и языки бокового меню OWNER.
// Вынесено из Sidebar.jsx (FE-07B) как отдельная конфигурация — данные без логики.
// Порядок, ключи, метки, иконки и маршруты сохранены без изменений.

export const sidebarLanguages = [
  {
    code: "uz",
    label: "Узбекский",
    native: "O'zbekcha",
    short: "UZ",
    flagUrl: "https://upload.wikimedia.org/wikipedia/commons/8/84/Flag_of_Uzbekistan.svg",
  },
  {
    code: "ru",
    label: "Русский",
    native: "Русский",
    short: "RU",
    flagUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f3/Flag_of_Russia.svg",
  },
  {
    code: "en",
    label: "Английский",
    native: "English",
    short: "EN",
    flagUrl: "https://upload.wikimedia.org/wikipedia/en/a/ae/Flag_of_the_United_Kingdom.svg",
  },
];

export const navItems = [
  { key: "dashboard", label: "Дашборд", icon: "bi-bar-chart-line", to: "/" },
  {
    key: "reports",
    label: "Отчеты",
    icon: "bi-file-earmark-bar-graph",
    to: "/reports",
    children: [
      { key: "z-report", label: "Z - Отчёт", to: "/reports/z-report", icon: "bi-receipt-cutoff" },
      { key: "orders", label: "Отчёт по заказам", to: "/reports/orders", icon: "bi-receipt" },
      { key: "waiters", label: "Отчёт по официантам", to: "/reports/waiters", icon: "bi-person-lines-fill" },
      { key: "dishes", label: "Отчёт по блюдам", to: "/reports/dishes", icon: "bi-stars" },
      { key: "tables", label: "Отчёт по столам", to: "/reports/tables", icon: "bi-grid-3x3-gap" },
      { key: "cancelled-dishes", label: "Отчёт по отмененным блюдам", to: "/reports/cancelled-dishes", icon: "bi-x-octagon" },
    ],
  },
  {
    key: "users",
    label: "Сотрудники",
    icon: "bi-people",
    to: "/users",
    children: [
      { key: "cashier", label: "Кассир", to: "/users/cashier", icon: "bi-cash-coin" },
      { key: "waiter", label: "Официант", to: "/users/waiter", icon: "bi-person" },
      { key: "courier", label: "Курьер", to: "/users/courier", icon: "bi-send" },
      { key: "monoblock", label: "Моноблок", to: "/users/monoblock", icon: "bi-pc-display" },
      { key: "kitchen", label: "Повар", to: "/users/kitchen", icon: "bi-chef-hat" },
      { key: "manager", label: "Менеджер", to: "/users/manager", icon: "bi-person-gear" },
      { key: "warehouse", label: "Завсклад", to: "/users/warehouse", icon: "bi-box-seam" },
      { key: "login-history", label: "История входа", to: "/users/login-history", icon: "bi-clock-history" },
      { key: "attendance", label: "Посещаемость", to: "/users/attendance", icon: "bi-calendar-check" },
    ],
  },
  {
    key: "nomenclature",
    label: "Меню",
    icon: "bi-boxes",
    to: "/nomenclature",
    children: [
      { key: "dishes", label: "Блюда", to: "/nomenclature/dishes", icon: "bi-cup-hot" },
      { key: "dish-categories", label: "Категория блюд", to: "/nomenclature/dish-categories", icon: "bi-grid" },
      { key: "menu", label: "Продажа", to: "/nomenclature/menu", icon: "bi-journal-bookmark" },
      { key: "stop-list", label: "Стоп-лист", to: "/nomenclature/stop-list", icon: "bi-x-octagon" },
    ],
  },
  {
    key: "warehouse",
    label: "Склад",
    icon: "bi-box-seam",
    to: "/warehouse",
    children: [
      { key: "raw-materials", label: "Сырьё", to: "/nomenclature/raw-materials", icon: "bi-basket" },
      { key: "raw-categories", label: "Категория сырья", to: "/nomenclature/raw-categories", icon: "bi-boxes" },
      { key: "semi-finished", label: "Полуфабрикаты", to: "/nomenclature/semi-finished", icon: "bi-box" },
      { key: "semi-finished-categories", label: "Категория полуфабрикатов", to: "/nomenclature/semi-finished-categories", icon: "bi-diagram-3" },
    ],
  },
  {
    key: "warehouse-report",
    label: "Отчёт по складам",
    icon: "bi-file-earmark-bar-graph",
    to: "/stock-report",
    children: [
      { key: "incoming-journal", label: "Журнал приходов", to: "/stock-report/incoming-journal", icon: "bi-clock-history" },
      { key: "incoming", label: "Приход товаров", to: "/stock-report/incoming", icon: "bi-box-arrow-in-down" },
      { key: "outgoing", label: "Расход товаров", to: "/stock-report/outgoing", icon: "bi-box-arrow-up" },
      { key: "stock", label: "Остаток", to: "/stock-report/stock", icon: "bi-boxes" },
      { key: "transfer", label: "Перемещение", to: "/stock-report/transfer", icon: "bi-arrow-left-right" },
      { key: "inventory", label: "Инвентаризация", to: "/stock-report/inventory", icon: "bi-clipboard-check" },
      { key: "write-off", label: "Списание", to: "/stock-report/write-off", icon: "bi-trash3" },
      { key: "write-off-categories", label: "Категории списания", to: "/stock-report/write-off-categories", icon: "bi-tags" },
      { key: "waste", label: "Отход товаров", to: "/stock-report/waste", icon: "bi-recycle" },
    ],
  },
  {
    key: "finance",
    label: "Финансы",
    icon: "bi-wallet2",
    to: "/finance",
    children: [
      { key: "transactions", label: "Денежные операции", to: "/finance/transactions", icon: "bi-cash-stack" },
      { key: "income-categories", label: "Категория приходов", to: "/finance/income-categories", icon: "bi-arrow-down-left-circle" },
      { key: "expense-categories", label: "Категория расходов", to: "/finance/expense-categories", icon: "bi-arrow-up-right-circle" },
      { key: "debtors-creditors", label: "Дебиторы и кредиторы", to: "/finance/debtors-creditors", icon: "bi-wallet2" },
    ],
  },
  {
    key: "settings",
    label: "Настройки",
    icon: "bi-gear",
    to: "/settings",
    children: [
      { key: "clients", label: "Клиенты", to: "/settings/clients", icon: "bi-person-fill" },
      { key: "places", label: "Место", to: "/settings/places", icon: "bi-geo-alt" },
      { key: "payment-methods", label: "Способ оплаты", to: "/settings/payment-methods", icon: "bi-credit-card" },
      { key: "units", label: "Единица измерения", to: "/settings/units", icon: "bi-rulers" },
      { key: "profile", label: "Настройка профиля", to: "/settings/profile", icon: "bi-person-gear" },
      { key: "printers", label: "Настройка принтеров", to: "/settings/printers", icon: "bi-printer" },
      { key: "receipt", label: "Настройка чека", to: "/settings/receipt", icon: "bi-receipt" },
      { key: "kitchen-receipt", label: "Настройка чека повара", to: "/settings/kitchen-receipt", icon: "bi-cup-hot" },
    ],
  },
];
