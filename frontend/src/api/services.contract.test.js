import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { financeService } from "./finance";
import { analyticsService, reportsService } from "./reports";
import { adminApi } from "../admin/api";
import { hqService } from "../admin/hqService";
import { authService } from "./auth";
import { settingsService } from "./settings";
import { staffService } from "./staff";
import { catalogService } from "./catalog";
import { ordersService } from "./orders";
import { warehouseService } from "./warehouse";
import { dashboardService } from "./dashboard";
import { printKitchenReceipt, printOrderReceipt } from "./receipt";
import { exchangeRatesService } from "./exchangeRates";

vi.mock("./client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock("../admin/api", () => ({
  adminApi: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe("Web domain service contracts", () => {
  beforeEach(() => {
    const response = { data: { ok: true }, status: 200, headers: { trace: "one" } };
    api.get.mockResolvedValue(response);
    api.post.mockResolvedValue(response);
    api.patch.mockResolvedValue(response);
    api.delete.mockResolvedValue(response);
    adminApi.get.mockResolvedValue(response);
  });

  describe("finance", () => {
    it("preserves transaction filters and the Axios response", async () => {
      const expected = await api.get();
      api.get.mockClear();
      const response = await financeService.listTransactions({
        dateFrom: "2026-08-01",
        dateTo: "2026-08-13",
        direction: "expense",
      });
      expect(api.get).toHaveBeenCalledWith("/finance/transactions", {
        params: { date_from: "2026-08-01", date_to: "2026-08-13", direction: "expense" },
      });
      expect(response).toBe(expected);
    });

    it("preserves exact create and PATCH bodies", async () => {
      const create = { amount: 10, direction: "income", payment_type_id: "pay-1" };
      const update = { amount: 12, direction: "expense", comment: "real", category_id: "cat-1" };
      await financeService.createTransaction(create);
      await financeService.updateTransaction("tx-1", update);
      expect(api.post).toHaveBeenCalledWith("/finance/transactions", create);
      expect(api.patch).toHaveBeenCalledWith("/finance/transactions/tx-1", update);
      expect(update).not.toHaveProperty("date");
      expect(update).not.toHaveProperty("payment_type_id");
      expect(update).not.toHaveProperty("counterparty_id");
    });

    it("keeps reference UUID endpoints and propagates failures", async () => {
      await financeService.listPaymentTypes();
      await financeService.listTransactionCategories("income");
      await financeService.listCounterparties();
      expect(api.get).toHaveBeenNthCalledWith(1, "/finance/payment-types", { params: { page: 1, size: 200 } });
      expect(api.get).toHaveBeenNthCalledWith(2, "/finance/transaction-categories", { params: { kind: "income" } });
      expect(api.get).toHaveBeenNthCalledWith(3, "/finance/counterparties", { params: { page: 1, size: 200 } });
      const error = new Error("finance unavailable");
      api.get.mockRejectedValueOnce(error);
      await expect(financeService.listTransactions()).rejects.toBe(error);
    });

    it("omits an empty category query config exactly", async () => {
      await financeService.listTransactionCategories();
      expect(api.get).toHaveBeenCalledWith("/finance/transaction-categories");
    });
  });

  describe("reports and analytics", () => {
    it("keeps the authoritative Z-report endpoint (single date and period modes)", async () => {
      await reportsService.getZReport({ date: "2026-08-13" });
      expect(api.get).toHaveBeenCalledWith("/analytics/z-report", { params: { date: "2026-08-13" } });
      await reportsService.getZReport({ date_from: "2026-08-01", date_to: "2026-08-31" });
      expect(api.get).toHaveBeenCalledWith("/analytics/z-report", { params: { date_from: "2026-08-01", date_to: "2026-08-31" } });
    });

    it.each([
      ["orders", reportsService.listOrders, "/reports/orders"],
      ["tables", reportsService.listTables, "/reports/tables"],
      ["waiters", reportsService.listWaiters, "/reports/waiters"],
      ["dishes", reportsService.listDishes, "/reports/dishes"],
      ["cancelled", reportsService.listCancelledDishes, "/reports/cancelled"],
      ["debt-credit", reportsService.listDebtCredit, "/reports/debt-credit"],
    ])("maps %s range parameters", async (_, request, endpoint) => {
      await request("2026-08-01", "2026-08-13");
      expect(api.get).toHaveBeenLastCalledWith(endpoint, {
        params: { date_from: "2026-08-01", date_to: "2026-08-13" },
      });
    });

    it("maps the four supported Tables filters and keeps Place UI-only", async () => {
      await reportsService.listTables("2026-08-01", "2026-08-13", {
        filters: {
          tableNumber: "  12A  ", waiterId: "waiter-1", paymentMethod: "cash",
          cashierId: "cashier-1", placeId: "unsupported-place",
        },
      });
      expect(api.get).toHaveBeenLastCalledWith("/reports/tables", {
        params: {
          date_from: "2026-08-01", date_to: "2026-08-13", table_number: "12A",
          waiter_id: "waiter-1", payment_method: "cash", cashier_id: "cashier-1",
        },
      });

      await reportsService.getTablesFilters();
      expect(api.get).toHaveBeenLastCalledWith("/reports/tables/filters", {});
    });

    it("maps dashboard analytics without fallback data", async () => {
      await analyticsService.getDashboard("2026-08-13");
      await analyticsService.listSales("2026-08-01", "2026-08-13");
      await analyticsService.listTopProducts({ limit: 5, dateFrom: "2026-08-13", dateTo: "2026-08-13" });
      expect(api.get).toHaveBeenNthCalledWith(1, "/analytics/dashboard", { params: { date: "2026-08-13" } });
      expect(api.get).toHaveBeenNthCalledWith(2, "/analytics/sales", { params: { date_from: "2026-08-01", date_to: "2026-08-13" } });
      expect(api.get).toHaveBeenNthCalledWith(3, "/analytics/products/top", { params: { date_from: "2026-08-13", date_to: "2026-08-13", limit: 5 } });
    });
  });

  describe("HQ", () => {
    it("uses only the canonical HQ client and preserves responses", async () => {
      const response = { data: { items: [{ id: "org-1" }] }, status: 200 };
      adminApi.get.mockResolvedValueOnce(response);
      await expect(hqService.listOrganizations({ size: 5, status: "active" })).resolves.toBe(response);
      expect(adminApi.get).toHaveBeenCalledWith("/organizations", { params: { size: 5, status: "active" } });
      expect(api.get).not.toHaveBeenCalled();
    });

    it.each([
      ["products", "/products"],
      ["categories", "/categories"],
      ["orders", "/orders"],
      ["units", "/units"],
      ["organizationStatuses", "/organization-statuses"],
    ])("owns the %s section endpoint", async (key, endpoint) => {
      await hqService.listSection(key);
      expect(adminApi.get).toHaveBeenLastCalledWith(endpoint, { params: { size: 100 } });
    });

    it("rejects unknown HQ section keys without an HTTP call", () => {
      expect(() => hqService.listSection("unknown")).toThrow(TypeError);
    });

    it("propagates HQ errors unchanged", async () => {
      const error = new Error("hq unavailable");
      adminApi.get.mockRejectedValueOnce(error);
      await expect(hqService.getDashboardKpis()).rejects.toBe(error);
    });
  });

  describe("settings", () => {
    it.each([
      ["clients", "/crm/counterparties"],
      ["places", "/halls"],
      ["paymentMethods", "/finance/payment-types"],
      ["units", "/units"],
      ["printers", "/printers"],
    ])("owns the %s resource endpoint", async (resource, endpoint) => {
      await settingsService.listResource(resource);
      expect(api.get).toHaveBeenLastCalledWith(endpoint);
    });

    it("preserves mutations, responses, and transport failures", async () => {
      const payload = { name: "Real company" };
      const expected = { data: payload, status: 200 };
      api.patch.mockResolvedValueOnce(expected);
      await expect(settingsService.updateCompanyProfile(payload)).resolves.toBe(expected);
      expect(api.patch).toHaveBeenCalledWith("/companies/me", payload);
      await settingsService.updateResource("units", "unit-1", payload);
      await settingsService.deleteResource("printers", "printer-1");
      expect(api.patch).toHaveBeenLastCalledWith("/units/unit-1", payload);
      expect(api.delete).toHaveBeenCalledWith("/printers/printer-1");
      expect(() => settingsService.listResource("unknown")).toThrow(TypeError);
      const error = new Error("settings unavailable");
      api.get.mockRejectedValueOnce(error);
      await expect(settingsService.getCompanyProfile()).rejects.toBe(error);
    });
  });

  describe("auth and staff", () => {
    it("keeps auth profile on the APP client", async () => {
      await authService.getCurrentUser();
      expect(api.get).toHaveBeenCalledWith("/auth/me");
    });

    it("owns company-user and HR employee mutations", async () => {
      const user = { email: "owner@example.test", role_slug: "cashier" };
      const employee = { user_id: "user-1", branch_id: "branch-1" };
      await staffService.createCompanyUser(user);
      await staffService.updateUserPin("user-1", "1234");
      await staffService.createEmployee(employee);
      await staffService.updateEmployee("employee-1", { position: "Cashier" });
      expect(api.post).toHaveBeenNthCalledWith(1, "/auth/users", user);
      expect(api.patch).toHaveBeenNthCalledWith(1, "/auth/users/user-1/pin", { pin: "1234" });
      expect(api.post).toHaveBeenNthCalledWith(2, "/hr/employees", employee);
      expect(api.patch).toHaveBeenNthCalledWith(2, "/hr/employees/employee-1", { position: "Cashier" });
    });

    it("maps declared activity keys and propagates failures", async () => {
      await staffService.listActivity("attendance");
      await staffService.listActivity("login-history");
      expect(api.get).toHaveBeenNthCalledWith(1, "/hr/attendance");
      expect(api.get).toHaveBeenNthCalledWith(2, "/hr/login-history");
      expect(() => staffService.listActivity("unknown")).toThrow(TypeError);
      const error = new Error("staff unavailable");
      api.get.mockRejectedValueOnce(error);
      await expect(staffService.listEmployees()).rejects.toBe(error);
    });
  });

  describe("catalog, orders, and warehouse reads", () => {
    it("owns product and category contracts without payload changes", async () => {
      const product = { name: "Real product", price: 42000, unit: "kg" };
      const category = { name: "Real category", slug: "real-category" };
      await catalogService.listProducts();
      await catalogService.createProduct(product);
      await catalogService.updateProduct("product-1", product);
      await catalogService.createCategory(category);
      expect(api.get).toHaveBeenCalledWith("/inventory/products");
      expect(api.post).toHaveBeenNthCalledWith(1, "/inventory/products", product);
      expect(api.patch).toHaveBeenCalledWith("/inventory/products/product-1", product);
      expect(api.post).toHaveBeenNthCalledWith(2, "/inventory/categories", category);
    });

    it("keeps order query semantics and raw responses", async () => {
      const expected = { data: [{ id: "order-1" }], status: 200 };
      api.get.mockResolvedValueOnce(expected);
      await expect(ordersService.list({ date: "2026-08-13" })).resolves.toBe(expected);
      expect(api.get).toHaveBeenCalledWith("/pos/orders", { params: { date: "2026-08-13" } });
      await ordersService.list();
      expect(api.get).toHaveBeenLastCalledWith("/pos/orders");
    });

    it("allows only confirmed warehouse reads and propagates errors", async () => {
      await warehouseService.list("incoming");
      await warehouseService.list("transfer");
      expect(api.get).toHaveBeenNthCalledWith(1, "/warehouse/purchases");
      expect(api.get).toHaveBeenNthCalledWith(2, "/warehouse/transfers");
      expect(() => warehouseService.list("stock")).toThrow(TypeError);
      const error = new Error("warehouse unavailable");
      api.get.mockRejectedValueOnce(error);
      await expect(warehouseService.list("incoming")).rejects.toBe(error);
    });
  });

  describe("dashboard orchestration", () => {
    it("requests the accepted OWNER overview sources with exact filters", async () => {
      await dashboardService.loadOwnerOverview({
        selectedDate: "2026-08-13",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-13",
      });
      expect(api.get).toHaveBeenCalledWith("/analytics/dashboard", { params: { date: "2026-08-13" } });
      expect(api.get).toHaveBeenCalledWith("/analytics/sales", { params: { date_from: "2026-08-01", date_to: "2026-08-13" } });
      expect(api.get).toHaveBeenCalledWith("/analytics/products/top", { params: { date_from: "2026-08-13", date_to: "2026-08-13", limit: 5 } });
      expect(api.get).toHaveBeenCalledWith("/settings/places");
      expect(api.get).toHaveBeenCalledWith("/finance/transactions", { params: { date_from: "2026-08-13", date_to: "2026-08-13" } });
    });

    it("rejects when an authoritative dashboard source fails", async () => {
      const error = new Error("dashboard unavailable");
      api.get.mockRejectedValueOnce(error);
      await expect(dashboardService.loadOwnerOverview({
        selectedDate: "2026-08-13",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-13",
      })).rejects.toBe(error);
    });
  });

  describe("receipt and printer", () => {
    it("owns print endpoints and propagates printer failures", async () => {
      await printOrderReceipt("order-1");
      await printKitchenReceipt("order-2");
      expect(api.post).toHaveBeenNthCalledWith(1, "/printers/print/orders/order-1/receipt", {});
      expect(api.post).toHaveBeenNthCalledWith(2, "/printers/print/orders/order-2/kitchen", {});
      const error = new Error("printer unavailable");
      api.post.mockRejectedValueOnce(error);
      await expect(printOrderReceipt("order-3")).rejects.toBe(error);
    });
  });

  describe("external exchange rates", () => {
    it("owns the CBU URL and propagates fetch failures", async () => {
      const response = { ok: true, json: vi.fn().mockResolvedValue([{ Rate: "12500" }]) };
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fetchMock);
      try {
        await expect(exchangeRatesService.get("USD")).resolves.toEqual([{ Rate: "12500" }]);
        expect(fetchMock).toHaveBeenCalledWith(
          "https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/",
          { signal: undefined },
        );
        const error = new Error("CBU unavailable");
        fetchMock.mockRejectedValueOnce(error);
        await expect(exchangeRatesService.get("RUB")).rejects.toBe(error);
        await expect(exchangeRatesService.get("EUR")).rejects.toThrow(TypeError);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
