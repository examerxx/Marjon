/**
 * Сборщик DOM админки: рендерит AdminApp, прокликивает всю навигацию и
 * сохраняет разметку каждого раздела в .cssaudit/domadmin/*.html.
 *
 * Инструмент аудита, не продуктовый тест.
 */
import { render, act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), ".cssaudit/domadmin");

const state = vi.hoisted(() => ({ authed: false }));
const adminApi = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve({ data: [] })),
  post: vi.fn(() => Promise.resolve({ data: {} })),
  patch: vi.fn(() => Promise.resolve({ data: {} })),
  put: vi.fn(() => Promise.resolve({ data: {} })),
  delete: vi.fn(() => Promise.resolve({ data: {} })),
  defaults: { headers: { common: {} } },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock("../../src/admin/api", () => ({
  ADMIN_API_BASE_URL: "http://127.0.0.1:8000/api/v1",
  adminApi,
  default: adminApi,
  adminLogin: vi.fn(() => Promise.resolve({ ok: true })),
  adminLogout: vi.fn(),
  isAdminAuthenticated: () => state.authed,
}));

/** Разделы навигации: сначала родители (раскрыть), затем дети. */
const GROUPS = [
  ["Дашборд", []],
  ["Организации", ["Организация", "Статус организации"]],
  ["Склад", ["Приход товаров", "Расход товаров", "Остаток", "Журнал приходов", "Отход товаров", "Инвентаризация"]],
  ["Номенклатура", ["Продукт", "Категория реализации", "Заказы", "Единица измерения"]],
  ["Справочник", ["Страны", "Регионы", "Районы"]],
  ["Услуга", ["Сотрудники", "Источник"]],
  ["Банк", ["Статистика банка", "Транзакции банка"]],
  ["Финансы", ["Денежные операции", "Категория приходов", "Категория расходов", "Способ оплаты", "История изменений"]],
  ["Настройки", ["Marjon store", "Фон для кассира", "Языки"]],
];

const slug = (s) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "");

describe("harvest admin dom", () => {
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

  beforeEach(() => {
    localStorage.clear();
    state.authed = false;
  });

  it("логин админки", async () => {
    const { default: AdminApp } = await import("../../src/admin/AdminApp.jsx");
    const { container } = render(<AdminApp />);
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    fs.writeFileSync(path.join(OUT, "admin-login.html"), container.innerHTML, "utf8");
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("все разделы админки", async () => {
    state.authed = true;
    localStorage.setItem("marjon_admin_token", "test-token");
    localStorage.setItem("marjon_admin_user", JSON.stringify({ id: "a1", email: "admin@marjon.uz", full_name: "Админ" }));
    const { default: AdminApp } = await import("../../src/admin/AdminApp.jsx");
    const { container } = render(<AdminApp />);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    fs.writeFileSync(path.join(OUT, "admin-shell.html"), container.innerHTML, "utf8");

    let saved = 1;
    for (const [group, children] of GROUPS) {
      // раскрыть группу / открыть раздел
      const hit = screen.queryAllByText(group)[0];
      if (hit) {
        await act(async () => { fireEvent.click(hit.closest("button") || hit); await new Promise((r) => setTimeout(r, 90)); });
        fs.writeFileSync(path.join(OUT, `sec-${slug(group)}.html`), container.innerHTML, "utf8");
        saved++;
      }
      for (const child of children) {
        const c = screen.queryAllByText(child)[0];
        if (!c) continue;
        await act(async () => { fireEvent.click(c.closest("button") || c); await new Promise((r) => setTimeout(r, 90)); });
        fs.writeFileSync(path.join(OUT, `sec-${slug(child)}.html`), container.innerHTML, "utf8");
        saved++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`сохранено разделов: ${saved}`);
    expect(saved).toBeGreaterThan(10);
  }, 120000);
});
