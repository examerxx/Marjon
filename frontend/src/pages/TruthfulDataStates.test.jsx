import { readdirSync, readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategories } from "../api/categories";
import { api } from "../api/client";
import { getCustomerTemplate, saveCustomerTemplate } from "../api/receipt";
import { readStoredProfile, updateStoredProfile } from "../utils/profileCache";
import AnalyticsPage from "./AnalyticsPage";
import CategoriesPage from "./CategoriesPage";
import FinanceTransactionsPage from "./FinanceTransactionsPage";
import MenuPage from "./MenuPage";
import OrdersPage from "./OrdersPage";
import OrdersReportPage from "./OrdersReportPage";
import OwnerDashboard from "./OwnerDashboard";
import StaffActivityPage from "./StaffActivityPage";
import StaffRolePage from "./StaffRolePage";
import WarehousePage from "./WarehousePage";

vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatMoney: (value) => `${Number(value).toLocaleString("ru-RU")} UZS`,
  formatNumber: (value) => Number(value).toLocaleString("ru-RU"),
}));

vi.mock("chart.js", () => {
  class ChartMock {
    static register = vi.fn();

    destroy() {}
  }

  return {
    Chart: ChartMock,
    CategoryScale: {},
    Filler: {},
    LineController: {},
    LineElement: {},
    LinearScale: {},
    PointElement: {},
    Tooltip: {},
  };
});

vi.mock("react-router-dom", () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useOutletContext: () => ({ selectedDate: "2026-08-12" }),
}));

describe("truthful production data states", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders actual category data returned by the backend", async () => {
    getCategories.mockResolvedValue({
      data: [{ id: "real-category", name: "Backend category", slug: "backend-category", is_active: true }],
    });

    render(<CategoriesPage />);

    expect(await screen.findByText("Backend category")).toBeInTheDocument();
    expect(screen.queryByText("Категорий пока нет.")).not.toBeInTheDocument();
  });

  it("renders a successful empty category response as empty", async () => {
    getCategories.mockResolvedValue({ data: [] });

    render(<CategoriesPage />);

    expect(await screen.findByText("Категорий пока нет.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders category failure as error without demo or successful-empty fallback", async () => {
    getCategories.mockRejectedValue(new Error("offline"));

    render(<CategoriesPage />);

    expect(await screen.findByText("Не удалось загрузить категории.")).toBeInTheDocument();
    expect(screen.queryByText("Категорий пока нет.")).not.toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
  });

  it("builds menu sales only from actual backend responses", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/pos/orders") {
        return Promise.resolve({ data: [{ id: "order-1", status: "completed", items: [{ product_id: "product-1", name: "Backend dish", quantity: 2, total: 180000 }] }] });
      }
      if (path === "/inventory/products") {
        return Promise.resolve({ data: [{ id: "product-1", name: "Backend dish", category_id: "category-1" }] });
      }
      return Promise.resolve({ data: [{ id: "category-1", name: "Backend menu" }] });
    });

    render(<MenuPage />);

    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    expect(screen.getAllByText("Backend menu")).toHaveLength(2);
  });

  it("keeps menu success-empty distinct from failure", async () => {
    api.get.mockResolvedValue({ data: [] });

    render(<MenuPage />);

    expect(await screen.findByText("Продажи не найдены.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not generate menu products or fake zero KPIs after an API failure", async () => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<MenuPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить продажи.");
    expect(screen.queryByText("Продажи не найдены.")).not.toBeInTheDocument();
    expect(screen.queryByText(/UZS/)).not.toBeInTheDocument();
  });

  it("renders an empty orders report only for a successful empty response", async () => {
    api.get.mockResolvedValue({ data: [] });

    render(<OrdersReportPage />);

    expect(await screen.findByText("Заказов не найдено")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders report failure as error instead of a successful empty report", async () => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<OrdersReportPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить отчёт по заказам.");
    expect(screen.queryByText("По выбранным фильтрам заказов не найдено")).not.toBeInTheDocument();
  });

  it("does not render APP finance errors as real zero income or expense", async () => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<FinanceTransactionsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить финансовые транзакции.");
    expect(screen.getAllByText("Недоступно")).toHaveLength(2);
    expect(screen.queryByText("0 UZS")).not.toBeInTheDocument();
  });

  it("does not render simulated dashboard money after a failed production request", async () => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<OwnerDashboard />);

    expect(await screen.findByText("Dashboard недоступен")).toBeInTheDocument();
    expect(screen.getByText("Не удалось загрузить dashboard данные.")).toBeInTheDocument();
    expect(screen.queryByText(/UZS/)).not.toBeInTheDocument();
  });

  it("does not treat the warehouse directory endpoint as authoritative product stock", async () => {
    render(<WarehousePage initialSection="stock" />);

    expect(await screen.findByRole("status")).toHaveTextContent("Товарные остатки недоступны до завершения Inventory Core.");
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByText("Нет данных")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 UZS/)).not.toBeInTheDocument();
  });

  it.each([
    ["inventory", "Инвентаризация недоступна до завершения Inventory Core."],
    ["write-off", "Документы списания недоступны"],
    ["write-off-categories", "Категории списания недоступны"],
    ["waste", "Отходы товаров недоступны"],
  ])("does not call an API for deferred warehouse section %s", async (section, message) => {
    render(<WarehousePage initialSection={section} />);

    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("maps confirmed purchase response fields exactly and keeps UUID mutations disabled", async () => {
    api.get.mockResolvedValue({
      data: [{
        id: "9c6082b6-3ab1-4d36-9a4c-87cd8bb4e7d5",
        number: "PUR-42",
        supplier: "Backend Supplier",
        warehouse_name: "Backend Warehouse",
        total_amount: 125000,
        status: "draft",
        date: "2026-08-12",
        items_count: 3,
      }],
    });

    render(<WarehousePage initialSection="incoming" />);

    expect(await screen.findByText("PUR-42")).toBeInTheDocument();
    expect(screen.getByText("Backend Supplier")).toBeInTheDocument();
    expect(screen.getByText("Backend Warehouse")).toBeInTheDocument();
    expect(screen.getAllByText(/125[\s\u00a0]?000 UZS/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Редактирование недоступно" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Архивирование недоступно" })).toBeDisabled();
    expect(api.get).toHaveBeenCalledWith("/warehouse/purchases", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it.each([
    [AnalyticsPage, "Не удалось загрузить аналитику.", "Данных по продажам за этот день нет."],
    [OrdersPage, "Не удалось загрузить заказы.", "Заказов за этот день нет."],
    [StaffActivityPage, "Не удалось загрузить данные активности сотрудников.", "Истории входов пока нет."],
  ])("renders %p request failure without a successful-empty claim", async (Page, errorText, emptyText) => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<Page />);

    expect(await screen.findByRole("alert")).toHaveTextContent(errorText);
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
  });

  it.each([
    [AnalyticsPage, "Данных по продажам за этот день нет."],
    [OrdersPage, "Заказов за этот день нет."],
    [StaffActivityPage, "Истории входов пока нет."],
  ])("renders %p successful empty response as empty", async (Page, emptyText) => {
    api.get.mockResolvedValue({ data: [] });

    render(<Page />);

    expect(await screen.findByText(emptyText)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows staff load failure as an error rather than a confirmed empty directory", async () => {
    api.get.mockRejectedValue(new Error("offline"));

    render(<StaffRolePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить сотрудников.");
    expect(screen.queryByText("Сотрудники не найдены")).not.toBeInTheDocument();
  });

  it("archives and restores staff only through confirmed backend mutations", async () => {
    api.get.mockResolvedValue({ data: [{
      id: "staff-uuid",
      name: "Backend Employee",
      email: "employee@example.com",
      phone: "998901234567",
      role_slug: "cashier",
      is_active: true,
    }] });
    api.delete.mockResolvedValue({ data: {} });
    api.patch.mockResolvedValue({ data: { id: "staff-uuid", is_active: true } });

    render(<StaffRolePage />);
    expect(await screen.findByText("Backend Employee")).toBeInTheDocument();
    expect(screen.getByText("Недоступно до BI-06")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Archive"));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/auth/users/staff-uuid"));
    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Backend Employee")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Restore"));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/auth/users/staff-uuid", { is_active: true }));
  });

  it("does not move staff to archive when the backend mutation fails", async () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [{
      id: "staff-uuid",
      name: "Still Active",
      email: "active@example.com",
      role_slug: "cashier",
      is_active: true,
    }] });
    api.delete.mockRejectedValue(new Error("offline"));

    render(<StaffRolePage />);
    expect(await screen.findByText("Still Active")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Archive"));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(screen.getByText("Still Active")).toBeInTheDocument();
  });

  it("scopes cached profile artifacts by authenticated user identity", () => {
    updateStoredProfile("user-a", { name: "User A local", photo: "data:image/png;base64,user-a" });
    updateStoredProfile("user-b", { name: "User B local", photo: "data:image/png;base64,user-b" });

    expect(readStoredProfile("user-a")).toEqual({ name: "User A local", photo: "data:image/png;base64,user-a" });
    expect(readStoredProfile("user-b")).toEqual({ name: "User B local", photo: "data:image/png;base64,user-b" });
    expect(readStoredProfile()).toEqual({});
    expect(localStorage.getItem("marjon_profile_settings")).toBeNull();
  });

  it("does not read a local receipt template when backend loading fails", async () => {
    localStorage.setItem("marjon_receipt_template", JSON.stringify({ restaurantName: "Local fake" }));
    api.get.mockRejectedValue(new Error("offline"));

    await expect(getCustomerTemplate({ name: "Backend org" })).rejects.toThrow("offline");
  });

  it("does not claim or persist server receipt success when PATCH fails", async () => {
    localStorage.setItem("marjon_receipt_template", JSON.stringify({ restaurantName: "Existing draft" }));
    api.patch.mockRejectedValue(new Error("save failed"));

    await expect(saveCustomerTemplate({ restaurantName: "Unsaved server value" })).rejects.toThrow("save failed");
    expect(JSON.parse(localStorage.getItem("marjon_receipt_template"))).toEqual({ restaurantName: "Existing draft" });
  });

  it("keeps covered production source paths disconnected from hidden fallbacks", () => {
    const ownerSource = readFileSync(`${process.cwd()}/src/pages/OwnerDashboard.jsx`, "utf8");
    const adminDirectory = `${process.cwd()}/src/admin`;
    const adminSource = readdirSync(adminDirectory)
      .filter((file) => /^Admin.*\.jsx$/.test(file) && !file.includes(".test."))
      .map((file) => readFileSync(`${adminDirectory}/${file}`, "utf8"))
      .join("\n");
    const warehouseSource = readFileSync(`${process.cwd()}/src/pages/WarehousePage.jsx`, "utf8");
    const staffRoleSource = readFileSync(`${process.cwd()}/src/pages/StaffRolePage.jsx`, "utf8");
    const sidebarSource = readFileSync(`${process.cwd()}/src/components/Sidebar.jsx`, "utf8");
    const settingsProfileSource = readFileSync(`${process.cwd()}/src/pages/settings/SettingsProfilePage.jsx`, "utf8");
    const orgContextSource = readFileSync(`${process.cwd()}/src/context/OrgContext.jsx`, "utf8");
    const settingsResourceSource = readFileSync(`${process.cwd()}/src/pages/settings/SettingsResourcePage.jsx`, "utf8");
    const reportSources = [
      "OrdersReportPage.jsx",
      "TablesReportPage.jsx",
      "WaitersReportPage.jsx",
      "DishesReportPage.jsx",
      "CancelledDishesReportPage.jsx",
      "DebtorsCreditorsReportPage.jsx",
    ].map((file) => readFileSync(`${process.cwd()}/src/pages/${file}`, "utf8"));

    expect(ownerSource).not.toContain('api.get("/reports/incomes"');
    expect(ownerSource).not.toContain('api.get("/reports/consumption"');
    expect(ownerSource).not.toContain('api.get("/reports/storage-balances"');
    expect(ownerSource).not.toContain('api.get("/inventory/stock"');
    expect((ownerSource.match(/mergeDashboardWithSimulation\(/g) || [])).toHaveLength(1);
    expect((ownerSource.match(/mergeWarehouseReportsWithSimulation\(/g) || [])).toHaveLength(1);
    expect((ownerSource.match(/buildSimulatedRevenueSales\(/g) || [])).toHaveLength(1);
    expect(adminSource).not.toContain("demoOrganizationDirectoryRows");
    expect(adminSource).not.toContain("demoTransactions");
    expect(adminSource).not.toContain("demo-marjon-0001");
    expect(adminSource).not.toContain("Демо-оборот");
    expect(adminSource).not.toContain("ADMIN_DASHBOARD_DEMO_MODE");
    expect(adminSource).not.toMatch(/WO-\d+/);
    expect(adminSource).not.toMatch(/INV-\d+/);
    expect(warehouseSource).not.toContain("Приход #IN-220");
    expect(warehouseSource).not.toContain("18 450 000 UZS");
    expect(warehouseSource).not.toContain('stock: "/warehouse/list"');
    expect(warehouseSource).not.toContain('"write-off-categories": "/warehouse/write-offs"');
    expect(warehouseSource).not.toContain('waste: "/warehouse/write-offs"');
    expect(warehouseSource).not.toContain("api.post(");
    expect(warehouseSource).not.toContain("api.patch(");
    expect(warehouseSource).not.toContain("api.delete(");
    expect(warehouseSource).not.toContain("typeof editingId");
    expect(staffRoleSource).toContain("staffService.deleteCompanyUser(id)");
    expect(staffRoleSource).toContain("staffService.updateCompanyUser(id, { is_active: true })");
    expect(sidebarSource).not.toContain('"marjon_profile_settings"');
    expect(settingsProfileSource).not.toContain('"marjon_profile_settings"');
    expect(orgContextSource).not.toContain('"marjon_org_cache"');
    expect(settingsResourceSource).not.toContain("Сальдо начальное");
    expect(settingsResourceSource).not.toContain("Заказ №39957057");
    reportSources.forEach((source) => {
      expect(source).toContain('setError("")');
      expect(source).toMatch(/catch\([^)]*\)[\s\S]*setError\(/);
      expect(source).toMatch(/if \(error\) return|!error\s*&&\s*!rows\.length|!error\s*&&\s*!visibleRows\.length/);
    });
  });
});
