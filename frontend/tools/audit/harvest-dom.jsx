/**
 * Сборщик DOM: рендерит все страницы кафе-панели в jsdom и сохраняет разметку
 * в .cssaudit/dom/*.html. Нужен как база для расчёта каскада на реальном дереве.
 *
 * Это инструмент аудита, не продуктовый тест.
 */
import { render, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import App from "../../src/App";

const OUT = path.resolve(process.cwd(), ".cssaudit/dom");

const authClient = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  isAuthenticated: vi.fn(() => true),
  login: vi.fn(),
  loginByPhone: vi.fn(),
  loginByPin: vi.fn(),
  logout: vi.fn(),
  fetchStaffUsers: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../src/api/client", () => ({
  api: {
    get: authClient.get,
    post: authClient.post,
    patch: authClient.patch,
    delete: authClient.delete,
  },
  default: {
    get: authClient.get,
    post: authClient.post,
    patch: authClient.patch,
    delete: authClient.delete,
  },
  isAuthenticated: authClient.isAuthenticated,
  login: authClient.login,
  loginByPhone: authClient.loginByPhone,
  loginByPin: authClient.loginByPin,
  logout: authClient.logout,
  fetchStaffUsers: authClient.fetchStaffUsers,
  formatMoney: (v, c = "UZS") => `${Number(v || 0)} ${c}`,
  formatNumber: (v) => String(Number(v || 0)),
}));

vi.mock("../../src/api/receipt", () => ({
  printKitchenReceipt: vi.fn(() => Promise.resolve()),
  printOrderReceipt: vi.fn(() => Promise.resolve()),
  fetchReceiptTemplate: vi.fn(() => Promise.resolve(null)),
  saveReceiptTemplate: vi.fn(() => Promise.resolve()),
  fetchKitchenReceiptTemplate: vi.fn(() => Promise.resolve(null)),
  saveKitchenReceiptTemplate: vi.fn(() => Promise.resolve()),
  printTestReceipt: vi.fn(() => Promise.resolve()),
  printTestKitchenReceipt: vi.fn(() => Promise.resolve()),
}));

const OWNER = {
  id: "owner",
  role_slugs: ["owner"],
  roles: ["owner"],
  email: "owner@marjon.test",
  full_name: "Владелец Тестов",
  company_id: "c1",
};

const ROUTES = [
  ["login", "/login"],
  ["login-staff", "/login/staff"],
  ["dashboard", "/"],
  ["orders", "/orders"],
  ["menu", "/menu"],
  ["nomenclature-dishes", "/nomenclature/dishes"],
  ["nomenclature-raw", "/nomenclature/raw-materials"],
  ["nomenclature-menu", "/nomenclature/menu"],
  ["categories-dishes", "/nomenclature/dish-categories"],
  ["categories-sales", "/nomenclature/sales-categories"],
  ["warehouse-incoming", "/warehouse/incoming"],
  ["warehouse-outgoing", "/warehouse/outgoing"],
  ["warehouse-stock", "/warehouse/stock"],
  ["warehouse-journal", "/warehouse/incoming-journal"],
  ["warehouse-transfer", "/warehouse/transfer"],
  ["warehouse-inventory", "/warehouse/inventory"],
  ["warehouse-writeoff", "/warehouse/write-off"],
  ["warehouse-writeoff-cat", "/warehouse/write-off-categories"],
  ["warehouse-waste", "/warehouse/waste"],
  ["reports", "/reports"],
  ["report-z", "/reports/z-report"],
  ["report-orders", "/reports/orders"],
  ["report-tables", "/reports/tables"],
  ["report-waiters", "/reports/waiters"],
  ["report-dishes", "/reports/dishes"],
  ["report-cancelled", "/reports/cancelled-dishes"],
  ["report-debtors", "/reports/debtors-creditors"],
  ["users-all", "/users"],
  ["users-cashier", "/users/cashier"],
  ["users-login-history", "/users/login-history"],
  ["users-attendance", "/users/attendance"],
  ["settings-clients", "/settings/clients"],
  ["settings-places", "/settings/places"],
  ["settings-payments", "/settings/payment-methods"],
  ["settings-units", "/settings/units"],
  ["settings-profile", "/settings/profile"],
  ["settings-printers", "/settings/printers"],
  ["settings-receipt", "/settings/receipt"],
  ["settings-kitchen-receipt", "/settings/kitchen-receipt"],
  ["settings-support", "/settings/support"],
  ["finance-transactions", "/finance/transactions"],
  ["finance-income-cat", "/finance/income-categories"],
  ["finance-expense-cat", "/finance/expense-categories"],
  ["staff", "/staff"],
  ["analytics", "/analytics"],
  ["waiter", "/waiter"],
  ["waiter-new", "/waiter/new"],
  ["waiter-orders", "/waiter/orders"],
  ["kitchen", "/kitchen"],
  ["store", "/store"],
  ["reviews", "/reviews"],
];

function mockApi() {
  localStorage.setItem("access_token", "test-token");
  authClient.isAuthenticated.mockReturnValue(true);
  authClient.get.mockImplementation((url) => {
    if (url === "/auth/me") return Promise.resolve({ data: OWNER });
    if (typeof url === "string" && url.includes("dashboard")) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
  authClient.post.mockResolvedValue({ data: {} });
  authClient.patch.mockResolvedValue({ data: {} });
  authClient.delete.mockResolvedValue({ data: {} });
}

describe("harvest dom", () => {
  beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
    // Chart.js не работает в jsdom — глушим canvas
    HTMLCanvasElement.prototype.getContext = () => ({
      canvas: { width: 300, height: 150 },
      clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {},
      stroke() {}, save() {}, restore() {}, translate() {}, rotate() {},
      measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }),
      setTransform() {}, scale() {}, moveTo() {}, lineTo() {}, closePath() {},
      fillText() {}, strokeText() {}, drawImage() {}, putImageData() {},
      getImageData: () => ({ data: [] }), createPattern: () => null, rect() {}, clip() {},
    });
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    }));
  });

  beforeEach(() => {
    mockApi();
  });

  it.each(ROUTES)("рендерит %s", async (name, pathname) => {
    window.history.pushState({}, "", pathname);
    let html = "";
    try {
      const { container } = render(<App />);
      // дать эффектам и промисам отработать
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 60));
      });
      html = container.innerHTML;
    } catch (err) {
      html = `<!-- RENDER ERROR: ${String(err && err.message).slice(0, 400)} -->`;
    }
    fs.writeFileSync(path.join(OUT, `${name}.html`), html, "utf8");
    expect(typeof html).toBe("string");
  });
});
