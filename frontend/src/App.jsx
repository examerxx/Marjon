import { useMemo } from "react";
import { Navigate, RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import { PageLoader } from "./components/Loader";
import DashboardLayout from "./components/DashboardLayout";
import LoginPage from "./pages/LoginPage";
import OwnerDashboard from "./pages/OwnerDashboard";
import OrdersPage from "./pages/OrdersPage";
import StorePage from "./pages/StorePage";
import MenuPage from "./pages/MenuPage";
import StaffPage from "./pages/StaffPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import SettingsPlaceholderPage from "./pages/settings/SettingsPlaceholderPage";
import OrdersReportPage from "./pages/OrdersReportPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import StaffRolePage from "./pages/StaffRolePage";
import StaffActivityPage from "./pages/StaffActivityPage";
import NomenclaturePage from "./pages/NomenclaturePage";
import SalesCatalogPage from "./pages/nomenclature/SalesCatalogPage";
import CategoriesPage from "./pages/CategoriesPage";
import StopListPage from "./pages/nomenclature/StopListPage";
import WaitersReportPage from "./pages/WaitersReportPage";
import TablesReportPage from "./pages/TablesReportPage";
import DishesReportPage from "./pages/DishesReportPage";
import CancelledDishesReportPage from "./pages/CancelledDishesReportPage";
import DebtorsCreditorsReportPage from "./pages/DebtorsCreditorsReportPage";
import FinanceStubPage from "./pages/finance/FinanceStubPage";
import ZReportPage from "./pages/ZReportPage";
import WarehousePage, { WarehouseJournalCreateRoute, WarehouseJournalDetailRoute, WarehouseJournalListRoute, WarehouseStockDetailRoute, WarehouseStockListRoute } from "./pages/WarehousePage";
import SettingsClientsPage from "./pages/settings/SettingsClientsPage";
import SettingsBranchesPage from "./pages/settings/SettingsBranchesPage";
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
import { canAccessPath, canAccessSection, isOwnerWebUser } from "./utils/permissions";
import { t } from "./i18n/t";

function ProtectedRoute({ children, sectionKey = "" }) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isOwnerWebUser(user)) return <Navigate to="/login" replace />;

  const allowed = sectionKey
    ? canAccessSection(user, sectionKey)
    : canAccessPath(user, location.pathname);

  if (!allowed) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export function createAppRouter() {
  return createBrowserRouter([
  { path: "/index.html", element: <Navigate to="/" replace /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/login/staff/*", element: <Navigate to="/login" replace /> },
  { path: "/login/pin/:employeeId/*", element: <Navigate to="/login" replace /> },
  { path: "/waiter/*", element: <Navigate to="/login" replace /> },
  { path: "/kitchen/*", element: <Navigate to="/login" replace /> },
  {
    path: "/",
    element: <ProtectedRoute><DashboardLayout /></ProtectedRoute>,
    children: [
      { index: true, element: <OwnerDashboard /> },
      { path: "warehouse", element: <Navigate to="/warehouse/incoming" replace /> },
      { path: "warehouse/incoming", element: <WarehousePage initialSection="incoming" /> },
      { path: "warehouse/outgoing", element: <WarehousePage initialSection="outgoing" /> },
      { path: "warehouse/stock", element: <WarehouseStockListRoute /> },
      { path: "warehouse/stock/:warehouseId", element: <WarehouseStockDetailRoute /> },
      { path: "warehouse/incoming-journal", element: <WarehouseJournalListRoute /> },
      { path: "warehouse/incoming-journal/create", element: <WarehouseJournalCreateRoute /> },
      { path: "warehouse/incoming-journal/:docId", element: <WarehouseJournalDetailRoute /> },
      { path: "warehouse/stock-in", element: <WarehousePage initialSection="incoming" /> },
      { path: "warehouse/stock-out", element: <WarehousePage initialSection="outgoing" /> },
      { path: "warehouse/balance", element: <WarehouseStockListRoute /> },
      { path: "warehouse/balance/:warehouseId", element: <WarehouseStockDetailRoute /> },
      { path: "warehouse/income-log", element: <WarehouseJournalListRoute /> },
      { path: "warehouse/transfer", element: <WarehousePage initialSection="transfer" /> },
      { path: "warehouse/inventory", element: <WarehousePage initialSection="inventory" /> },
      { path: "warehouse/write-off", element: <WarehousePage initialSection="write-off" /> },
      { path: "warehouse/write-off-categories", element: <WarehousePage initialSection="write-off-categories" /> },
      { path: "warehouse/waste", element: <WarehousePage initialSection="waste" /> },
      { path: "stock-report", element: <Navigate to="/stock-report/incoming" replace /> },
      { path: "stock-report/incoming", element: <WarehousePage initialSection="incoming" /> },
      { path: "stock-report/outgoing", element: <WarehousePage initialSection="outgoing" /> },
      { path: "stock-report/stock", element: <WarehouseStockListRoute /> },
      { path: "stock-report/stock/:warehouseId", element: <WarehouseStockDetailRoute /> },
      { path: "stock-report/incoming-journal", element: <WarehouseJournalListRoute /> },
      { path: "stock-report/incoming-journal/create", element: <WarehouseJournalCreateRoute /> },
      { path: "stock-report/incoming-journal/:docId", element: <WarehouseJournalDetailRoute /> },
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
      { path: "settings/branches", element: <SettingsBranchesPage /> },
      { path: "settings/places", element: <SettingsPlacesPage /> },
      { path: "settings/place", element: <SettingsPlacesPage /> },
      { path: "settings/payment-methods", element: <SettingsPaymentMethodsPage /> },
      { path: "settings/units", element: <SettingsUnitsPage /> },
      { path: "settings/profile", element: <SettingsProfilePage /> },
      { path: "settings/printers", element: <SettingsPrintersPage /> },
      { path: "settings/receipt", element: <SettingsReceiptPage /> },
      { path: "settings/kitchen-receipt", element: <SettingsKitchenReceiptPage /> },
      { path: "settings/chef-receipt", element: <SettingsKitchenReceiptPage /> },
      { path: "settings/support", element: <FinanceStubPage title={t("app.teh_podderzhka")} /> },
      { path: "finance", element: <Navigate to="/finance/transactions" replace /> },
      { path: "finance/transactions", element: <FinanceStubPage title={t("app.denezhnye_operatsii")} /> },
      { path: "finance/operations", element: <FinanceStubPage title={t("app.denezhnye_operatsii")} /> },
      { path: "finance/income-categories", element: <FinanceStubPage title={t("app.kategoriya_prihodov")} /> },
      { path: "finance/expense-categories", element: <FinanceStubPage title={t("app.kategoriya_rashodov")} /> },
      { path: "finance/debtors-creditors", element: <FinanceStubPage title={t("app.debitory_i_kreditory")} /> },
      { path: "nomenclature", element: <Navigate to="/nomenclature/dishes" replace /> },
      { path: "nomenclature/dishes", element: <NomenclaturePage type="dishes" /> },
      { path: "nomenclature/sales", element: <SalesCatalogPage /> },
      { path: "nomenclature/menu", element: <MenuPage /> },
      { path: "nomenclature/stop-list", element: <StopListPage /> },
      { path: "nomenclature/raw-materials", element: <NomenclaturePage type="raw" /> },
      { path: "nomenclature/semi-finished", element: <NomenclaturePage type="semi" /> },
      { path: "nomenclature/dish-categories", element: <CategoriesPage key="dishes" type="dishes" /> },
      { path: "nomenclature/raw-categories", element: <CategoriesPage key="raw" type="raw" /> },
      { path: "nomenclature/semi-finished-categories", element: <CategoriesPage key="semi" type="semi" /> },
      { path: "nomenclature/sales-categories", element: <CategoriesPage key="sales" type="sales" /> },
      { path: "store", element: <StorePage /> },
      { path: "reviews", element: <PlaceholderPage eyebrow="Reviews" title={t("app.otzyvy")} text={t("app.razdel_otzyvov")} /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "menu", element: <MenuPage /> },
      { path: "staff", element: <StaffPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
    ],
  },
]);
}

export default function App() {
  const router = useMemo(() => createAppRouter(), []);

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
