import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import DashboardLayout from "./components/DashboardLayout";
import LoginPage from "./pages/LoginPage";
import OwnerDashboard from "./pages/OwnerDashboard";
import OrdersPage from "./pages/OrdersPage";
import MenuPage from "./pages/MenuPage";
import StaffPage from "./pages/StaffPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import FinancePage from "./pages/FinancePage";
import PlaceholderPage from "./pages/PlaceholderPage";
import SectionPage from "./pages/SectionPage";
import StaffRolePage from "./pages/StaffRolePage";
import WaiterPage from "./pages/WaiterPage";
import KitchenPage from "./pages/KitchenPage";
import ZReportPage from "./pages/ZReportPage";
import WarehousePage from "./pages/WarehousePage";
import { isAuthenticated } from "./api/client";

function ProtectedRoute({ children }) {
  return isAuthenticated() ? children : <Navigate to="/login" replace />;
}

/* Role-based route guard — redirects non-admin roles to their dedicated pages */
function RoleGuard({ children, allowed }) {
  const user = JSON.parse(localStorage.getItem("marjon_user") || "{}");
  const role = user?.role_slugs?.[0] || (user?.is_superadmin ? "superadmin" : "owner");
  if (allowed && !allowed.includes(role)) {
    if (role === "waiter") return <Navigate to="/waiter" replace />;
    if (role === "kitchen") return <Navigate to="/kitchen" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/waiter", element: <ProtectedRoute><WaiterPage /></ProtectedRoute> },
  { path: "/waiter/new", element: <ProtectedRoute><WaiterPage mode="new" /></ProtectedRoute> },
  { path: "/waiter/order/:orderId", element: <ProtectedRoute><WaiterPage mode="order" /></ProtectedRoute> },
  { path: "/waiter/orders", element: <ProtectedRoute><WaiterPage mode="orders" /></ProtectedRoute> },
  { path: "/kitchen", element: <ProtectedRoute><KitchenPage /></ProtectedRoute> },
  {
    path: "/",
    element: <ProtectedRoute><RoleGuard allowed={["owner","superadmin","manager","cashier","monoblock"]}><DashboardLayout /></RoleGuard></ProtectedRoute>,
    children: [
      { index: true, element: <OwnerDashboard /> },
      { path: "warehouse", element: <WarehousePage /> },
      { path: "warehouse/stock-in", element: <WarehousePage initialSection="incoming" /> },
      { path: "warehouse/stock-out", element: <WarehousePage initialSection="expense" /> },
      { path: "warehouse/balance", element: <WarehousePage initialSection="balance" /> },
      { path: "warehouse/income-log", element: <WarehousePage initialSection="incoming-log" /> },
      { path: "warehouse/transfer", element: <WarehousePage initialSection="transfer" /> },
      { path: "warehouse/inventory", element: <WarehousePage initialSection="inventory" /> },
      { path: "warehouse/write-off", element: <WarehousePage initialSection="write-off" /> },
      { path: "warehouse/write-off-categories", element: <WarehousePage initialSection="write-off" /> },
      { path: "warehouse/waste", element: <WarehousePage initialSection="waste" /> },
      { path: "reports", element: <AnalyticsPage /> },
      { path: "reports/z-report", element: <ZReportPage /> },
      { path: "reports/orders", element: <SectionPage eyebrow="Отчеты" title="Отчёт по заказам" description="Аналитика заказов по статусам, каналам и периодам." items={[{ title: "Заказы", text: "Количество, сумма и средний чек по заказам.", icon: "bi-receipt" }, { title: "Статусы", text: "Новые, оплаченные, отменённые и завершённые заказы.", icon: "bi-list-check" }, { title: "Фильтры", text: "Период, филиал, касса, официант и канал продаж.", icon: "bi-funnel" }]} /> },
      { path: "reports/tables", element: <SectionPage eyebrow="Отчеты" title="Отчёт по столам" description="Загрузка столов, оборот и эффективность посадки." items={[{ title: "Загрузка зала", text: "Процент занятости и пиковые часы.", icon: "bi-grid-3x3-gap" }, { title: "Оборот стола", text: "Сколько заказов проходит через каждый стол.", icon: "bi-arrow-repeat" }, { title: "Выручка", text: "Продажи и средний чек по столам.", icon: "bi-graph-up-arrow" }]} /> },
      { path: "reports/waiters", element: <SectionPage eyebrow="Отчеты" title="Отчёт по официантам" description="Продажи, скорость и качество работы официантов." items={[{ title: "Продажи", text: "Выручка и количество заказов по официантам.", icon: "bi-person-lines-fill" }, { title: "Средний чек", text: "Сравнение эффективности персонала.", icon: "bi-bar-chart" }, { title: "Сервис", text: "Скорость обслуживания и закрытия заказов.", icon: "bi-stopwatch" }]} /> },
      { path: "reports/dishes", element: <SectionPage eyebrow="Отчеты" title="Отчёт по блюдам" description="Продажи блюд, популярность и вклад в выручку." items={[{ title: "Топ блюд", text: "Самые продаваемые позиции меню.", icon: "bi-stars" }, { title: "Количество", text: "Продажи по штукам, категориям и периодам.", icon: "bi-123" }, { title: "Маржинальность", text: "Выручка и прибыльность блюд.", icon: "bi-pie-chart" }]} /> },
      { path: "reports/cancelled-dishes", element: <SectionPage eyebrow="Отчеты" title="Отчёт по отмененным блюдам" description="Анализ отмен, возвратов и причин списания блюд." items={[{ title: "Отмены", text: "Какие блюда отменяются чаще всего.", icon: "bi-x-octagon" }, { title: "Причины", text: "Ошибка заказа, кухня, клиент или отсутствие товара.", icon: "bi-tags" }, { title: "Потери", text: "Сумма отмен и влияние на выручку.", icon: "bi-graph-down" }]} /> },
      { path: "reports/debtors-creditors", element: <SectionPage eyebrow="Отчеты" title="Дебиторы и кредиторы" description="Контроль задолженностей гостей, поставщиков и партнёров." items={[{ title: "Дебиторы", text: "Кто должен ресторану и на какую сумму.", icon: "bi-arrow-down-left-circle" }, { title: "Кредиторы", text: "Обязательства ресторана перед поставщиками.", icon: "bi-arrow-up-right-circle" }, { title: "Сроки", text: "Контроль просроченных платежей и оплат.", icon: "bi-calendar-check" }]} /> },
      { path: "users", element: <StaffRolePage role="all" /> },
      { path: "users/cashier", element: <StaffRolePage role="cashier" /> },
      { path: "users/waiter", element: <StaffRolePage role="waiter" /> },
      { path: "users/monoblock", element: <StaffRolePage role="monoblock" /> },
      { path: "users/kitchen", element: <StaffRolePage role="kitchen" /> },
      { path: "users/manager", element: <StaffRolePage role="manager" /> },
      { path: "settings", element: <PlaceholderPage eyebrow="Settings" title="Настройки" text="Здесь будут параметры ресторана, филиалов и доступа." /> },
      { path: "settings/clients", element: <SectionPage eyebrow="Настройки" title="Клиенты" description="Настройка клиентской базы и правил обслуживания гостей." items={[{ title: "Карточки клиентов", text: "Контакты, история заказов и заметки по гостям.", icon: "bi-person-vcard" }, { title: "Группы", text: "Сегменты гостей, скидки и условия обслуживания.", icon: "bi-people" }, { title: "Лояльность", text: "Бонусы, накопления и персональные предложения.", icon: "bi-gift" }]} /> },
      { path: "settings/place", element: <SectionPage eyebrow="Настройки" title="Место" description="Настройка залов, столов и рабочих зон ресторана." items={[{ title: "Залы", text: "Основной зал, летняя зона, VIP и другие пространства.", icon: "bi-grid-3x3-gap" }, { title: "Столы", text: "Номера столов, вместимость и расположение.", icon: "bi-layout-wtf" }, { title: "Зоны", text: "Назначение официантов и зон обслуживания.", icon: "bi-diagram-3" }]} /> },
      { path: "settings/payment-methods", element: <SectionPage eyebrow="Настройки" title="Способ оплаты" description="Управление доступными способами оплаты заказов." items={[{ title: "Наличные", text: "Приём наличных и правила округления.", icon: "bi-cash-coin" }, { title: "Карта", text: "Терминалы, эквайринг и безналичные оплаты.", icon: "bi-credit-card" }, { title: "Комбинированная оплата", text: "Оплата одним заказом несколькими способами.", icon: "bi-intersect" }]} /> },
      { path: "settings/units", element: <SectionPage eyebrow="Настройки" title="Единица измерения" description="Единицы измерения для склада, меню и техкарт." items={[{ title: "Вес", text: "Килограмм, грамм и другие весовые единицы.", icon: "bi-speedometer2" }, { title: "Объём", text: "Литр, миллилитр и напитки по объёму.", icon: "bi-droplet" }, { title: "Штуки", text: "Поштучный учёт товаров и полуфабрикатов.", icon: "bi-123" }]} /> },
      { path: "settings/profile", element: <SectionPage eyebrow="Настройки" title="Настройка профиля" description="Профиль ресторана, бренд и основные данные компании." items={[{ title: "Данные ресторана", text: "Название, адрес, контакты и реквизиты.", icon: "bi-building" }, { title: "Брендинг", text: "Логотип, цветовая схема и оформление документов.", icon: "bi-palette" }, { title: "Доступ", text: "Права владельца и параметры безопасности.", icon: "bi-shield-lock" }]} /> },
      { path: "settings/printers", element: <SectionPage eyebrow="Настройки" title="Настройка принтеров" description="Принтеры чеков, кухни и рабочих станций." items={[{ title: "Кассовый принтер", text: "Печать фискальных и клиентских чеков.", icon: "bi-printer" }, { title: "Кухонный принтер", text: "Маршрутизация заказов по цехам и станциям.", icon: "bi-printer-fill" }, { title: "Проверка связи", text: "Тестовая печать и статус устройств.", icon: "bi-wifi" }]} /> },
      { path: "settings/receipt", element: <SectionPage eyebrow="Настройки" title="Настройка чека" description="Шаблон клиентского чека и параметры печати." items={[{ title: "Шапка чека", text: "Логотип, ресторан, адрес и контакты.", icon: "bi-card-heading" }, { title: "Состав", text: "Позиции, скидки, сервисный сбор и налоги.", icon: "bi-receipt" }, { title: "Нижний блок", text: "QR, благодарность и дополнительная информация.", icon: "bi-qr-code" }]} /> },
      { path: "settings/chef-receipt", element: <SectionPage eyebrow="Настройки" title="Настройка чека повара" description="Формат кухонного чека для приготовления заказов." items={[{ title: "Позиции", text: "Блюда, модификаторы и комментарии клиента.", icon: "bi-list-check" }, { title: "Станции", text: "Разделение по горячему цеху, салатам и напиткам.", icon: "bi-columns-gap" }, { title: "Приоритет", text: "Время заказа, стол и срочность приготовления.", icon: "bi-stopwatch" }]} /> },
      { path: "settings/support", element: <SectionPage eyebrow="Настройки" title="Тех. поддержка" description="Обращения, диагностика и связь с поддержкой Marjon." items={[{ title: "Заявка", text: "Создайте обращение по проблеме или вопросу.", icon: "bi-life-preserver" }, { title: "Диагностика", text: "Проверка соединения, устройств и синхронизации.", icon: "bi-activity" }, { title: "Контакты", text: "Каналы связи и история обращений.", icon: "bi-chat-dots" }]} /> },
      { path: "finance", element: <FinancePage /> },
      { path: "finance/operations", element: <SectionPage eyebrow="Финансы" title="Денежные операции" description="Контроль приходов, расходов и движений денежных средств." items={[{ title: "Новая операция", text: "Добавьте приход, расход или внутреннее движение.", icon: "bi-plus-circle" }, { title: "Касса и счета", text: "Отслеживайте деньги по кассам, картам и счетам.", icon: "bi-wallet2" }, { title: "История", text: "Фильтры по дате, типу операции и ответственному.", icon: "bi-clock-history" }]} /> },
      { path: "finance/income-categories", element: <SectionPage eyebrow="Финансы" title="Категория приходов" description="Справочник категорий для учета входящих денежных средств." items={[{ title: "Продажи", text: "Выручка ресторана, доставка и дополнительные услуги.", icon: "bi-graph-up-arrow" }, { title: "Прочие приходы", text: "Возвраты от поставщиков, бонусы и компенсации.", icon: "bi-arrow-down-left-circle" }, { title: "Структура", text: "Группировка приходов для отчётов и аналитики.", icon: "bi-diagram-3" }]} /> },
      { path: "finance/expense-categories", element: <SectionPage eyebrow="Финансы" title="Категория расходов" description="Справочник категорий для контроля затрат ресторана." items={[{ title: "Закупки", text: "Продукты, ингредиенты и складские расходы.", icon: "bi-basket" }, { title: "Операционные расходы", text: "Аренда, зарплата, сервисы и обслуживание.", icon: "bi-receipt" }, { title: "Контроль затрат", text: "Анализ расходов по категориям и периодам.", icon: "bi-pie-chart" }]} /> },
      { path: "nomenclature", element: <MenuPage /> },
      { path: "nomenclature/dishes", element: <MenuPage /> },
      { path: "nomenclature/raw-materials", element: <SectionPage eyebrow="Номенклатура" title="Сырьё" description="Список ингредиентов и товаров для склада и техкарт." items={[{ title: "Ингредиенты", text: "Мясо, овощи, специи, напитки и другие позиции.", icon: "bi-basket" }, { title: "Единицы", text: "Вес, объём и поштучный учёт сырья.", icon: "bi-rulers" }, { title: "Остатки", text: "Связь сырья со складом и минимальными остатками.", icon: "bi-box-seam" }]} /> },
      { path: "nomenclature/semi-finished", element: <SectionPage eyebrow="Номенклатура" title="Полуфабрикаты" description="Заготовки и производственные позиции для кухни." items={[{ title: "Заготовки", text: "Соусы, тесто, фарш и другие полуфабрикаты.", icon: "bi-cup-hot" }, { title: "Состав", text: "Сырьё и нормы расхода для производства.", icon: "bi-list-check" }, { title: "Производство", text: "Контроль выпуска и списания ингредиентов.", icon: "bi-gear-wide-connected" }]} /> },
      { path: "nomenclature/dish-categories", element: <SectionPage eyebrow="Номенклатура" title="Категория блюд" description="Группы меню для блюд и продаж." items={[{ title: "Основные группы", text: "Салаты, горячее, напитки, десерты и другие разделы.", icon: "bi-grid" }, { title: "Порядок", text: "Сортировка категорий в меню и POS.", icon: "bi-sort-down" }, { title: "Видимость", text: "Управление отображением категорий для каналов продаж.", icon: "bi-eye" }]} /> },
      { path: "nomenclature/raw-categories", element: <SectionPage eyebrow="Номенклатура" title="Категория сырья" description="Группы сырья для склада, закупок и аналитики." items={[{ title: "Складские группы", text: "Мясо, молочка, овощи, бакалея и прочие категории.", icon: "bi-boxes" }, { title: "Закупки", text: "Удобная группировка для поставщиков и приходов.", icon: "bi-truck" }, { title: "Контроль", text: "Анализ остатков и расхода по группам сырья.", icon: "bi-graph-up" }]} /> },
      { path: "nomenclature/semi-finished-categories", element: <SectionPage eyebrow="Номенклатура" title="Категория полуфабрикатов" description="Группы заготовок и производственных позиций." items={[{ title: "Цеха", text: "Горячий цех, холодный цех, выпечка и заготовки.", icon: "bi-columns-gap" }, { title: "Состав", text: "Категории для техкарт и норм производства.", icon: "bi-diagram-3" }, { title: "Учёт", text: "Контроль движения полуфабрикатов по кухне.", icon: "bi-clipboard-data" }]} /> },
      { path: "nomenclature/sales-categories", element: <SectionPage eyebrow="Номенклатура" title="Категория реализации" description="Категории для продаж, отчётов и каналов реализации." items={[{ title: "Каналы", text: "Зал, доставка, самовывоз и дополнительные продажи.", icon: "bi-shop" }, { title: "Отчёты", text: "Группировка реализации для аналитики и финансов.", icon: "bi-file-earmark-bar-graph" }, { title: "Правила", text: "Настройки видимости и применения категорий.", icon: "bi-sliders" }]} /> },
      { path: "store", element: <OrdersPage /> },
      { path: "reviews", element: <PlaceholderPage eyebrow="Reviews" title="Отзывы" text="Раздел отзывов будет показывать обратную связь клиентов." /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "menu", element: <MenuPage /> },
      { path: "staff", element: <StaffPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
