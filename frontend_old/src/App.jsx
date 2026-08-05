import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";
import { PageLoader } from "./components/Loader";
import DashboardLayout from "./components/DashboardLayout";
import LoginPage from "./pages/LoginPage";
import StaffLoginPage from "./pages/auth/StaffLoginPage";
import PinLoginPage from "./pages/auth/PinLoginPage";
import OwnerDashboard from "./pages/OwnerDashboard";
import OrdersPage from "./pages/OrdersPage";
import MenuPage from "./pages/MenuPage";
import StaffPage from "./pages/StaffPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import FinanceTransactionsPage from "./pages/FinanceTransactionsPage";
import FinanceIncomeCategoriesPage from "./pages/FinanceIncomeCategoriesPage";
import FinanceExpenseCategoriesPage from "./pages/FinanceExpenseCategoriesPage";
import OrdersReportPage from "./pages/OrdersReportPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import SectionPage from "./pages/SectionPage";
import StaffRolePage from "./pages/StaffRolePage";
import StaffActivityPage from "./pages/StaffActivityPage";
import NomenclaturePage from "./pages/NomenclaturePage";
import CategoriesPage from "./pages/CategoriesPage";
import WaiterPage from "./pages/WaiterPage";
import WaitersReportPage from "./pages/WaitersReportPage";
import TablesReportPage from "./pages/TablesReportPage";
import DishesReportPage from "./pages/DishesReportPage";
import CancelledDishesReportPage from "./pages/CancelledDishesReportPage";
import DebtorsCreditorsReportPage from "./pages/DebtorsCreditorsReportPage";
import KitchenPage from "./pages/KitchenPage";
import ZReportPage from "./pages/ZReportPage";
import WarehousePage from "./pages/WarehousePage";
import SettingsClientsPage from "./pages/settings/SettingsClientsPage";
import SettingsPlacesPage from "./pages/settings/SettingsPlacesPage";
import SettingsPaymentMethodsPage from "./pages/settings/SettingsPaymentMethodsPage";
import SettingsUnitsPage from "./pages/settings/SettingsUnitsPage";
import SettingsProfilePage from "./pages/settings/SettingsProfilePage";
import SettingsPrintersPage from "./pages/settings/SettingsPrintersPage";
import SettingsReceiptPage from "./pages/settings/ReceiptSettingsPage";
import SettingsKitchenReceiptPage from "./pages/settings/ChefReceiptSettingsPage";
import { AuthProvider } from "./context/AuthContext";
import { OrgProvider } from "./context/OrgContext";
import { ThemeProvider } from "./context/ThemeContext";
import { useAuth } from "./hooks/useAuth";

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/login/staff", element: <StaffLoginPage /> },
  { path: "/login/pin/:employeeId", element: <PinLoginPage /> },
  { path: "/waiter", element: <ProtectedRoute><WaiterPage /></ProtectedRoute> },
  { path: "/waiter/new", element: <ProtectedRoute><WaiterPage mode="new" /></ProtectedRoute> },
  { path: "/waiter/order/:orderId", element: <ProtectedRoute><WaiterPage mode="order" /></ProtectedRoute> },
  { path: "/waiter/orders", element: <ProtectedRoute><WaiterPage mode="orders" /></ProtectedRoute> },
  { path: "/kitchen", element: <ProtectedRoute><KitchenPage /></ProtectedRoute> },
  {
    path: "/",
    element: <ProtectedRoute><DashboardLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <OwnerDashboard /> },
      { path: "warehouse", element: <Navigate to="/warehouse/incoming" replace /> },
      { path: "warehouse/incoming", element: <WarehousePage initialSection="incoming" /> },
      { path: "warehouse/outgoing", element: <WarehousePage initialSection="outgoing" /> },
      { path: "warehouse/stock", element: <WarehousePage initialSection="stock" /> },
      { path: "warehouse/incoming-journal", element: <WarehousePage initialSection="incoming-journal" /> },
      { path: "warehouse/stock-in", element: <WarehousePage initialSection="incoming" /> },
      { path: "warehouse/stock-out", element: <WarehousePage initialSection="outgoing" /> },
      { path: "warehouse/balance", element: <WarehousePage initialSection="stock" /> },
      { path: "warehouse/income-log", element: <WarehousePage initialSection="incoming-journal" /> },
      { path: "warehouse/transfer", element: <WarehousePage initialSection="transfer" /> },
      { path: "warehouse/inventory", element: <WarehousePage initialSection="inventory" /> },
      { path: "warehouse/write-off", element: <WarehousePage initialSection="write-off" /> },
      { path: "warehouse/write-off-categories", element: <WarehousePage initialSection="write-off-categories" /> },
      { path: "warehouse/waste", element: <WarehousePage initialSection="waste" /> },
      { path: "stock-report", element: <Navigate to="/stock-report/incoming" replace /> },
      { path: "stock-report/incoming", element: <WarehousePage initialSection="incoming" /> },
      { path: "stock-report/outgoing", element: <WarehousePage initialSection="outgoing" /> },
      { path: "stock-report/stock", element: <WarehousePage initialSection="stock" /> },
      { path: "stock-report/incoming-journal", element: <WarehousePage initialSection="incoming-journal" /> },
      { path: "stock-report/transfer", element: <WarehousePage initialSection="transfer" /> },
      { path: "stock-report/inventory", element: <WarehousePage initialSection="inventory" /> },
      { path: "stock-report/write-off", element: <WarehousePage initialSection="write-off" /> },
      { path: "stock-report/write-off-categories", element: <WarehousePage initialSection="write-off-categories" /> },
      { path: "stock-report/waste", element: <WarehousePage initialSection="waste" /> },
      { path: "reports", element: <AnalyticsPage /> },
      { path: "reports/z-report", element: <ZReportPage /> },
      { path: "reports/orders", element: <OrdersReportPage /> },
      { path: "reports/tables", element: <TablesReportPage /> },
      { path: "reports/waiters", element: <WaitersReportPage /> },
      { path: "reports/dishes", element: <DishesReportPage /> },
      { path: "reports/cancelled-dishes", element: <CancelledDishesReportPage /> },
      { path: "reports/debtors-creditors", element: <DebtorsCreditorsReportPage /> },
      { path: "users", element: <StaffRolePage role="all" /> },
      { path: "users/cashier", element: <StaffRolePage role="cashier" /> },
      { path: "users/waiter", element: <StaffRolePage role="waiter" /> },
      { path: "users/courier", element: <StaffRolePage role="courier" /> },
      { path: "users/couriers", element: <StaffRolePage role="courier" /> },
      { path: "users/kuryer", element: <StaffRolePage role="courier" /> },
      { path: "users/delivery", element: <StaffRolePage role="courier" /> },
      { path: "users/monoblock", element: <StaffRolePage role="monoblock" /> },
      { path: "users/kitchen", element: <StaffRolePage role="kitchen" /> },
      { path: "users/manager", element: <StaffRolePage role="manager" /> },
      { path: "users/warehouse", element: <StaffRolePage role="warehouse" /> },
      { path: "users/login-history", element: <StaffActivityPage type="login-history" /> },
      { path: "users/attendance", element: <StaffActivityPage type="attendance" /> },
      { path: "settings", element: <Navigate to="/settings/clients" replace /> },
      { path: "settings/clients", element: <SettingsClientsPage /> },
      { path: "settings/places", element: <SettingsPlacesPage /> },
      { path: "settings/place", element: <SettingsPlacesPage /> },
      { path: "settings/payment-methods", element: <SettingsPaymentMethodsPage /> },
      { path: "settings/units", element: <SettingsUnitsPage /> },
      { path: "settings/profile", element: <SettingsProfilePage /> },
      { path: "settings/printers", element: <SettingsPrintersPage /> },
      { path: "settings/receipt", element: <SettingsReceiptPage /> },
      { path: "settings/kitchen-receipt", element: <SettingsKitchenReceiptPage /> },
      { path: "settings/chef-receipt", element: <SettingsKitchenReceiptPage /> },
      { path: "settings/support", element: <SectionPage eyebrow="Настройки" title="Тех. поддержка" description="Обращения, диагностика и связь с поддержкой Marjon." items={[{ title: "Заявка", text: "Создайте обращение по проблеме или вопросу.", icon: "bi-life-preserver" }, { title: "Диагностика", text: "Проверка соединения, устройств и синхронизации.", icon: "bi-activity" }, { title: "Контакты", text: "Каналы связи и история обращений.", icon: "bi-chat-dots" }]} /> },
      { path: "finance", element: <Navigate to="/finance/transactions" replace /> },
      { path: "finance/transactions", element: <FinanceTransactionsPage /> },
      { path: "finance/operations", element: <FinanceTransactionsPage /> },
      { path: "finance/income-categories", element: <FinanceIncomeCategoriesPage /> },
      { path: "finance/expense-categories", element: <FinanceExpenseCategoriesPage /> },
      { path: "finance/debtors-creditors", element: <DebtorsCreditorsReportPage /> },
      { path: "nomenclature", element: <Navigate to="/nomenclature/dishes" replace /> },
      { path: "nomenclature/dishes", element: <NomenclaturePage type="dishes" /> },
      { path: "nomenclature/menu", element: <MenuPage /> },
      { path: "nomenclature/raw-materials", element: <NomenclaturePage type="raw" /> },
      { path: "nomenclature/semi-finished", element: <NomenclaturePage type="semi" /> },
      { path: "nomenclature/dish-categories", element: <CategoriesPage type="dishes" /> },
      { path: "nomenclature/raw-categories", element: <CategoriesPage type="raw" /> },
      { path: "nomenclature/semi-finished-categories", element: <CategoriesPage type="semi" /> },
      { path: "nomenclature/sales-categories", element: <CategoriesPage type="sales" /> },
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
  return (
    <ThemeProvider>
      <AuthProvider>
        <OrgProvider>
          <RouterProvider router={router} />
        </OrgProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
