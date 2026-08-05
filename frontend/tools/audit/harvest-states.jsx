/**
 * Сбор DOM в интерактивных состояниях: свёрнутый сайдбар, раскрытое подменю,
 * открытое меню аккаунта. Без них 26% правил верхнего слоя нельзя проверить —
 * элементов в таких состояниях просто нет в снятой разметке.
 *
 * Состояния воспроизводятся кликами по реальному приложению, а не дописыванием
 * классов руками: так разметка получается настоящая, со всеми детьми.
 *
 * Инструмент аудита, не продуктовый тест.
 */
import { render, act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import App from "../../src/App";

const OUT = path.resolve(process.cwd(), ".cssaudit/dom");

const authClient = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  isAuthenticated: vi.fn(() => true),
  login: vi.fn(), loginByPhone: vi.fn(), loginByPin: vi.fn(), logout: vi.fn(),
  fetchStaffUsers: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../src/api/client", () => ({
  api: { get: authClient.get, post: authClient.post, patch: authClient.patch, delete: authClient.delete },
  default: { get: authClient.get, post: authClient.post, patch: authClient.patch, delete: authClient.delete },
  isAuthenticated: authClient.isAuthenticated,
  login: authClient.login, loginByPhone: authClient.loginByPhone,
  loginByPin: authClient.loginByPin, logout: authClient.logout,
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

const OWNER = { id: "owner", role_slugs: ["owner"], roles: ["owner"],
  email: "owner@marjon.test", full_name: "Владелец Тестов", company_id: "c1" };

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

const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
};

describe("harvest interactive states", () => {
  beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
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

  beforeEach(() => { mockApi(); });

  it("сайдбар свёрнут", async () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<App />);
    await settle();
    const collapse = container.querySelector('[title="Свернуть меню"], .brand-mark--button');
    if (collapse) { await act(async () => { fireEvent.click(collapse); await new Promise((r) => setTimeout(r, 80)); }); }
    fs.writeFileSync(path.join(OUT, "state-sidebar-collapsed.html"), container.innerHTML, "utf8");
    expect(container.innerHTML).toMatch(/dashboard-sidebar/);
  }, 60000);

  it("подменю раскрыто", async () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<App />);
    await settle();
    for (const label of ["Отчеты", "Склад", "Настройки"]) {
      const hit = screen.queryAllByText(label)[0];
      if (hit) await act(async () => { fireEvent.click(hit.closest("button") || hit); await new Promise((r) => setTimeout(r, 60)); });
    }
    fs.writeFileSync(path.join(OUT, "state-submenu-open.html"), container.innerHTML, "utf8");
    expect(container.innerHTML).toMatch(/sidebar-nav-item/);
  }, 60000);

  it("меню аккаунта открыто", async () => {
    window.history.pushState({}, "", "/");
    const { container } = render(<App />);
    await settle();
    const user = container.querySelector(".sidebar-user--button");
    if (user) await act(async () => { fireEvent.click(user); await new Promise((r) => setTimeout(r, 80)); });
    fs.writeFileSync(path.join(OUT, "state-account-open.html"), container.innerHTML, "utf8");
    expect(container.innerHTML).toMatch(/sidebar-account/);
  }, 60000);

  it("свёрнутый сайдбар плюс раскрытое подменю", async () => {
    window.history.pushState({}, "", "/warehouse/incoming");
    const { container } = render(<App />);
    await settle();
    const collapse = container.querySelector('[title="Свернуть меню"], .brand-mark--button');
    if (collapse) await act(async () => { fireEvent.click(collapse); await new Promise((r) => setTimeout(r, 80)); });
    const hit = screen.queryAllByText("Склад")[0];
    if (hit) await act(async () => { fireEvent.click(hit.closest("button") || hit); await new Promise((r) => setTimeout(r, 80)); });
    fs.writeFileSync(path.join(OUT, "state-collapsed-submenu.html"), container.innerHTML, "utf8");
    expect(container.innerHTML).toMatch(/dashboard-sidebar/);
  }, 60000);
});
