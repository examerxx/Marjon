import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { settingsService } from "../../api/settings";
import { warehouseService } from "../../api/warehouse";
import { ordersService } from "../../api/orders";
import { authService } from "../../api/auth";
import { useAuth } from "../../context/AuthContext";
import SettingsProfilePage from "./SettingsProfilePage";
import { profileSections } from "./profile/profileSections";

const profileCss = readFileSync(
  join(process.cwd(), "src", "styles", "react-overrides.css"),
  "utf8",
);
const viewportCss = readFileSync(join(process.cwd(), "src", "pages", "settings", "settingsProfileViewport.css"), "utf8");

// V1: ровно 4 внутренние секции, у каждой свой контент.
// Поля без backend-поддержки рисуются, но не отправляются и не дают
// ложного успеха; деструктивных мутаций нет.
vi.mock("../../api/settings", () => ({
  settingsService: {
    getCompanyProfile: vi.fn(),
    updateCompanyProfile: vi.fn(),
  },
}));

vi.mock("../../api/warehouse", () => ({
  warehouseService: {
    list: vi.fn(),
    deletePurchase: vi.fn(),
  },
}));

vi.mock("../../api/orders", () => ({
  ordersService: {
    purge: vi.fn(),
  },
}));
vi.mock("../../api/auth", () => ({ authService: { changePassword: vi.fn(), updateProfile: vi.fn(), getProfilePhoto: vi.fn() } }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const COMPANY = {
  name: "Мой ресторан",
  phone: "+998901234567",
  address: "Ташкент",
  inn: "123456789",
  currency: "UZS",
  waiter_service_percent: 10,
  day_start_hour: 5,
  vat_rate: 12,
};

function navButtons() {
  return document.querySelector(".company-profile-nav");
}

function sectionLabels() {
  return [...navButtons().querySelectorAll("button span")].map((el) => el.textContent);
}

async function renderPage() {
  const view = render(<SettingsProfilePage />);
  await screen.findByText("Основные данные", { selector: ".company-profile-nav button span" });
  return view;
}

async function goTo(label) {
  const nav = navButtons();
  const button = [...nav.querySelectorAll("button")].find((el) => el.textContent === label);
  fireEvent.click(button);
  await waitFor(() => {
    expect(document.querySelector(".company-profile-content h1")).toHaveTextContent(label);
  });
}

describe("SettingsProfilePage V3 — success toast и truthful имя", () => {
  it("anchors only the desktop profile frame and confines scrolling inside it", () => {
    expect(viewportCss).toContain("@media (min-width: 1025px)");
    expect(viewportCss).toContain(".dashboard-content:has(> .company-profile-page)");
    expect(viewportCss).toContain("overflow: clip");
    expect(viewportCss).toContain("height: calc(100dvh - 110px)");
    expect(viewportCss).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(viewportCss).toContain("overflow-y: auto");
    expect(viewportCss).toContain("scrollbar-gutter: stable");
    expect(viewportCss).not.toContain("!important");
  });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { id: "owner-1", full_name: "Владелец" } });
    settingsService.getCompanyProfile.mockResolvedValue({ data: { ...COMPANY } });
    settingsService.updateCompanyProfile.mockResolvedValue({ data: { ...COMPANY } });
    authService.changePassword.mockResolvedValue({});
    authService.getProfilePhoto.mockResolvedValue({ data: { image: "data:image/webp;base64,AAA" } });
    authService.updateProfile.mockImplementation(async ({ name, file }) => {
      const profile = { ...useAuth().user, name, ...(file ? { avatar_url: "/media/confirmed.webp" } : {}) };
      useAuth.mockReturnValue({ user: profile });
      return { data: profile };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function saveBasic() {
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Профиль сохранён.");
  }

  it("success виден 4с, уходит к 5с и размонтируется", async () => {
    await renderPage();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const banner = screen.getByText("Профиль сохранён.").closest(".marjon-toast");
    expect(banner.className).not.toContain("is-leaving");
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Профиль сохранён.")).toBeInTheDocument();
    expect(screen.getByText("Профиль сохранён.").closest(".marjon-toast").className).not.toContain("is-leaving");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByText("Профиль сохранён.").closest(".marjon-toast").className).toContain("is-leaving");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByText("Профиль сохранён.")).not.toBeInTheDocument();
  });

  it("повторный Save перезапускает 5-секундный таймер", async () => {
    await renderPage();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    screen.getByText("Профиль сохранён.");
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Профиль сохранён.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByText("Профиль сохранён.")).not.toBeInTheDocument();
  });

  it("failed Save не показывает success", async () => {
    await renderPage();
    authService.updateProfile.mockRejectedValueOnce({ response: { data: { detail: "Ошибка сервера" } } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Ошибка сервера");
    expect(screen.queryByText("Профиль сохранён.")).not.toBeInTheDocument();
  });

  it("Cancel и смена секции очищают success сразу", async () => {
    await renderPage();
    await saveBasic();
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.queryByText("Профиль сохранён.")).not.toBeInTheDocument();
    await saveBasic();
    await goTo("Другие настройки");
    expect(screen.queryByText("Профиль сохранён.")).not.toBeInTheDocument();
  });

  it("saves the profile name to the self-profile backend, not the company", async () => {
    useAuth.mockReturnValue({ user: { id: "owner-1", name: "Анвар" } });
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "Жахонгир Бахтиёров" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Профиль сохранён.");
    expect(authService.updateProfile).toHaveBeenCalledWith({ name: "Жахонгир Бахтиёров", file: null });
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem("marjon_profile_settings:owner-1") || "{}");
    expect(stored.profileName).toBeUndefined();
  });

  it("имя профиля сохраняется после повторного открытия, отмена возвращает сохранённое", async () => {
    const view = await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "  ДУКШОП  " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Профиль сохранён.");
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "Не сохранять" } });
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.getByPlaceholderText("Введите имя профиля")).toHaveValue("ДУКШОП");
    view.unmount();
    await renderPage();
    expect(screen.getByPlaceholderText("Введите имя профиля")).toHaveValue("ДУКШОП");
  });

  it("loads the server photo instead of local cache and previews a replacement", async () => {
    const photo = "data:image/png;base64,AAA";
    localStorage.setItem("marjon_profile_settings:owner-1", JSON.stringify({ photo }));
    useAuth.mockReturnValue({ user: { id: "owner-1", name: "Владелец", avatar_url: "/media/avatar.webp" } });
    await renderPage();
    await waitFor(() => expect(screen.getByAltText("Лого профиля")).toHaveAttribute("src", "data:image/webp;base64,AAA"));
    const file = new File(["pixels"], "avatar.png", { type: "image/png" });
    const input = document.querySelector('.company-profile-identity input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByAltText("Лого профиля").getAttribute("src")).toMatch(/^data:image\/png/);
    });
    // Имя профиля не влияет на фото-состояние.
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "Жахонгир" } });
    expect(screen.getByAltText("Лого профиля").getAttribute("src")).toMatch(/^data:image\/png/);
  });

  it("внутреннее меню содержит 5 секций (4 профиля + QR-меню)", async () => {
    await renderPage();
    expect(sectionLabels()).toEqual([
      "Основные данные",
      "Основные настройки",
      "Другие настройки",
      "Настройка профиля",
      "QR-меню",
    ]);
  });

  it("sends the selected photo file with the name and accepts only server-confirmed success", async () => {
    await renderPage();
    const file = new File(["fixture"], "avatar.png", { type: "image/png" });
    fireEvent.change(document.querySelector('.company-profile-identity input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("Лого профиля").getAttribute("src")).toMatch(/^data:image\/png/));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Профиль сохранён.");
    expect(authService.updateProfile).toHaveBeenCalledWith({ name: "Владелец", file });
    await waitFor(() => expect(authService.getProfilePhoto).toHaveBeenCalled());
  });

  it("does not show success or cache a name when backend validation fails", async () => {
    authService.updateProfile.mockRejectedValueOnce({ response: { status: 422, data: { detail: [{ msg: "Invalid name" }] } } });
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "Не сохранять" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText(/Не удалось сохранить профиль/);
    expect(screen.queryByText("Профиль сохранён.")).toBeNull();
    expect(localStorage.getItem("marjon_profile_settings:owner-1")).toBeNull();
  });

  it("удалённые секции отсутствуют", async () => {
    await renderPage();
    const labels = sectionLabels();
    [
      "Настройки для чека",
      "Настройки кассира",
      "Настройки для онлайн меню",
      "Скидки",
      "Чек конструктор",
      "Импорт",
      "Telegram бот настройки",
      "Старая версия",
    ].forEach((label) => expect(labels).not.toContain(label));
  });

  it("Основные данные: точный набор полей без лишнего", async () => {
    await renderPage();
    const content = document.querySelector(".company-profile-content");
    expect(within(content).queryByText("Лого компании")).not.toBeInTheDocument();
    expect(within(content).getByText("Лого профиля")).toBeInTheDocument();
    expect(within(content).getByText("Имя профиля")).toBeInTheDocument();
    expect(within(content).getByPlaceholderText("Введите имя профиля")).toBeInTheDocument();
    expect(within(content).queryByPlaceholderText("Название компании")).not.toBeInTheDocument();
    expect(within(content).queryByPlaceholderText("Введите адрес")).not.toBeInTheDocument();
    expect(within(content).queryByPlaceholderText("123456789")).not.toBeInTheDocument();
    expect(within(content).queryByText(/Очистка удаляет данные без возможности восстановления/)).not.toBeInTheDocument();
    expect(within(content).getByRole("button", { name: /Очистить все отчеты/ })).toBeInTheDocument();
    // В V1 здесь нет телефона/валюты/обслуги/начала дня.
    expect(within(content).queryByText("Телефон")).not.toBeInTheDocument();
    expect(within(content).queryByText("Валюта")).not.toBeInTheDocument();
    expect(within(content).queryByText(/Доля обслуги/)).not.toBeInTheDocument();
    expect(within(content).queryByText(/Сброс нумерации/)).not.toBeInTheDocument();
  });

  it("Лого профиля: заголовок сверху, Очистить скрыта, имя — широким рядом", async () => {
    await renderPage();
    const main = document.querySelector(".company-profile-main");
    const html = main.innerHTML;
    expect(html).not.toContain("Лого компании");
    const identity = document.querySelector(".company-profile-identity");
    expect(identity).toBeInTheDocument();
    const title = identity.querySelector(".company-profile-identity-title");
    const row = identity.querySelector(".company-profile-identity-row");
    const actions = identity.querySelector(".company-profile-logo-actions");
    const nameLabel = identity.querySelector(".company-profile-identity-name");
    // Заголовок блока — над логотипом.
    expect(title.textContent).toBe("Лого профиля");
    expect(title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.querySelector("img[alt='Лого профиля']")).toBeInTheDocument();
    expect(actions.textContent).toContain("Заменить");
    // Кнопки Очистить для профиля нет вообще.
    expect([...identity.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Очистить");
    // Имя — отдельным полем в том же ряду (шире прежней колонки 430px).
    expect(nameLabel.querySelector("input[placeholder='Введите имя профиля']")).toBeInTheDocument();
    expect(identity.textContent).not.toContain("Отображается в боковом меню");
    expect(identity.textContent).not.toContain("Требуется backend");
  });

  it("внутренние секции: согласованные иконки одного семейства, фон #f4f7fc", async () => {
    expect(profileSections.map((s) => s.icon)).toEqual([
      "bi-journal-text",
      "bi-sliders",
      "bi-list-check",
      "bi-person-gear",
      "bi-qr-code",
    ]);
    await renderPage();
    const buttons = [...document.querySelectorAll(".company-profile-nav button")];
    expect(buttons).toHaveLength(5);
    // Все иконки рендерятся (Icon не вернул null) и одинакового размера.
    buttons.forEach((button) => {
      const svg = button.querySelector("svg");
      expect(svg).toBeInTheDocument();
      expect(svg.getAttribute("width")).toBe("18");
    });
    const navRule = profileCss.match(/\.company-profile-nav \{[^}]*\}/)?.[0] || "";
    expect(navRule).toContain("background: #f4f7fc");
  });

  it("sends a changed personal name only to the self-profile API", async () => {
    useAuth.mockReturnValue({ user: { id: "owner-1", name: "Анвар" } });
    await renderPage();
    expect(screen.getByPlaceholderText("Введите имя профиля")).toHaveValue("Анвар");
    fireEvent.change(screen.getByPlaceholderText("Введите имя профиля"), { target: { value: "Новое имя" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(authService.updateProfile).toHaveBeenCalledWith({ name: "Новое имя", file: null }));
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it("шапка использует accepted Settings primitive", async () => {
    await renderPage();
    const header = document.querySelector(".company-profile-header");
    expect(header.querySelector(".settings-title-group")).toBeInTheDocument();
    expect(header.querySelector(".settings-accent-bar")).toBeInTheDocument();
    expect(within(header).getByText("Настройки")).toBeInTheDocument();
    expect(document.querySelector(".company-profile-title")).not.toBeInTheDocument();
    expect(document.querySelector(".company-profile-accent")).not.toBeInTheDocument();
  });

  it("активна ровно одна секция; старая синяя активная стилистика удалена из CSS", async () => {
    await renderPage();
    expect(document.querySelectorAll(".company-profile-nav button.is-active")).toHaveLength(1);
    await goTo("Другие настройки");
    const active = [...document.querySelectorAll(".company-profile-nav button.is-active")];
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Другие настройки");
    // Старое: бледно-синий фон + синяя левая граница + navy Save.
    const activeRule = profileCss.match(/\.company-profile-nav button\.is-active \{[^}]*\}/)?.[0] || "";
    expect(activeRule).toContain("background: var(--owner-accent, #1fc9c9)");
    expect(activeRule).toContain("color: #ffffff");
    expect(activeRule).not.toContain("inset");
    expect(activeRule).not.toContain("#eef5ff");
    expect(activeRule).not.toContain("#0d55ca");
    expect(profileCss).not.toContain("inset 4px 0 0 #1f80ff");
    expect(profileCss).not.toContain("background: #053f9d");
    // V4: кнопки секций — радиус 22px и мягкий transition без transform.
    const navRule = profileCss.match(/\.company-profile-nav button \{[^}]*\}/)?.[0] || "";
    expect(navRule).toContain("border-radius: 22px");
    expect(navRule).toContain("transition: background-color 180ms");
    expect(navRule).not.toContain("transform");
  });

  it("personal save does not rewrite unchanged company metadata", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await screen.findByText("Профиль сохранён.");
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it("Опасные кнопки: две половины — отчеты слева, история продуктов справа", async () => {
    await renderPage();
    const row = document.querySelector(".company-profile-danger-row");
    expect(row).toBeInTheDocument();
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Очистить все отчеты"),
      expect.stringContaining("Очистить историю продуктов"),
    ]);
    buttons.forEach((b) => expect(b).toBeEnabled());
  });

  it("Уточняющее окно: Отмена ничего не удаляет", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Очистить все отчеты" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("company-clear-confirm");
    expect(within(dialog).getByText("Очистить все отчеты?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ordersService.purge).not.toHaveBeenCalled();
    expect(warehouseService.list).not.toHaveBeenCalled();
    expect(warehouseService.deletePurchase).not.toHaveBeenCalled();
  });

  it("Очистка отчетов: подтверждение в окне удаляет все заказы через purge", async () => {
    await renderPage();
    ordersService.purge.mockResolvedValue({
      data: { orders: 5, items: 9, payments: 3, fiscal_receipts: 1, delivery_orders: 0, loyalty_detached: 0 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Очистить все отчеты" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(ordersService.purge).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Отчёты очищены: удалено заказов: 5, платежей: 3/)).toBeInTheDocument();
    expect(warehouseService.deletePurchase).not.toHaveBeenCalled();
  });

  it("Очистка истории продуктов: окно, удаление приходов и чистка памяти цен", async () => {
    localStorage.setItem(
      "marjon:purchase-last-values:v1",
      JSON.stringify({ "ing-1": { price: "100", qty: "1", total: "" } }),
    );
    warehouseService.list.mockResolvedValue({ data: [{ id: "d1" }, { id: "d2" }] });
    warehouseService.deletePurchase.mockResolvedValue({});
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Очистить историю продуктов" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Очистить историю продуктов?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(warehouseService.deletePurchase).toHaveBeenCalledTimes(2));
    expect(warehouseService.deletePurchase).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/История продуктов очищена: удалено документов: 2/)).toBeInTheDocument();
    expect(localStorage.getItem("marjon:purchase-last-values:v1")).toBeNull();
    expect(ordersService.purge).not.toHaveBeenCalled();
  });

  it("очистка отчётов: ошибка API не выдаётся за успех", async () => {
    ordersService.purge.mockRejectedValueOnce({ response: { data: { detail: "Forbidden" } } });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Очистить все отчеты" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Очистить" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Не удалось очистить отчёты: Forbidden");
    expect(screen.queryByText(/Отчёты очищены:/)).toBeNull();
  });

  it("история продуктов: показывает частичное удаление при отказе одного запроса", async () => {
    warehouseService.list.mockResolvedValueOnce({ data: [{ id: "ok" }, { id: "denied" }] });
    warehouseService.deletePurchase.mockResolvedValueOnce({}).mockRejectedValueOnce({ response: { status: 403 } });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Очистить историю продуктов" }));
    const dialog = await screen.findByRole("dialog");
    expect(warehouseService.deletePurchase).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Очистить" }));
    expect(await screen.findByRole("status")).toHaveTextContent("удалено 1 из 2 (ошибок: 1)");
  });

  it("Основные настройки: только три оставшихся поля без серых подписей", async () => {
    await renderPage();
    await goTo("Основные настройки");
    const content = document.querySelector(".company-profile-content");
    expect(within(content).getByText("Начало дня")).toBeInTheDocument();
    expect(within(content).getByText("Пароль для удаления блюд")).toBeInTheDocument();
    expect(within(content).getByText("Показывать кнопку поддержки")).toBeInTheDocument();
    for (const label of ["Пароль для удаления блюд после пречека", "Пароль при смене официанта", "Пароль для восстановления заказа", "Цена доставки", "НДС с сервису (%)"]) {
      expect(within(content).queryByText(label)).not.toBeInTheDocument();
    }
    expect(content.querySelectorAll(".company-profile-main-settings em")).toHaveLength(0);
  });

  it("Основные настройки: отправляются только day_start_hour и vat_rate", async () => {
    await renderPage();
    await goTo("Основные настройки");
    const content = document.querySelector(".company-profile-content");
    const passwordInputs = within(content).getAllByPlaceholderText("Введите пароль");
    expect(passwordInputs).toHaveLength(1);
    fireEvent.change(passwordInputs[0], { target: { value: "secret123" } });
    fireEvent.click(within(document.querySelector(".company-profile-header")).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateCompanyProfile).toHaveBeenCalled());
    const payload = settingsService.updateCompanyProfile.mock.calls[0][0];
    expect(payload).toEqual({ day_start_hour: 5, vat_rate: 12 });
    expect(JSON.stringify(payload)).not.toContain("secret123");
    expect(screen.getByText("Основные настройки сохранены.")).toBeInTheDocument();
  });

  it("Другие настройки: ровно 3 типа заказа, без Telegram и нижних параметров", async () => {
    await renderPage();
    await goTo("Другие настройки");
    const content = document.querySelector(".company-profile-content");
    expect(within(content).getByText("На стол")).toBeInTheDocument();
    expect(within(content).getByText("На вынос")).toBeInTheDocument();
    expect(within(content).getByText("Доставка")).toBeInTheDocument();
    expect(within(content).queryByText(/Телеграм|Telegram/i)).not.toBeInTheDocument();
    expect(within(content).queryByText("Другие параметры")).not.toBeInTheDocument();
    expect(within(content).queryByText(/1 стол 1 официант/)).not.toBeInTheDocument();
    expect(within(content).queryByText(/ID карт/)).not.toBeInTheDocument();
  });

  it("Другие настройки: тогл сохраняется через PATCH order_types", async () => {
    await renderPage();
    await goTo("Другие настройки");
    const header = document.querySelector(".company-profile-header");
    const save = within(header).getByRole("button", { name: "Сохранить" });
    expect(save).not.toBeDisabled();
    const toggle = screen.getByRole("checkbox", { name: "Доставка" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(save);
    await waitFor(() => expect(settingsService.updateCompanyProfile).toHaveBeenCalled());
    expect(settingsService.updateCompanyProfile).toHaveBeenCalledWith({
      order_types: { dine_in: true, takeaway: true, delivery: false },
    });
    expect(await screen.findByText("Типы заказа сохранены.")).toBeInTheDocument();
  });

  it("Другие настройки: серверные значения грузятся, Отменить откатывает к ним", async () => {
    settingsService.getCompanyProfile.mockResolvedValue({
      data: { ...COMPANY, order_types: { dine_in: false, takeaway: true, delivery: true } },
    });
    await renderPage();
    await goTo("Другие настройки");
    expect(screen.getByRole("checkbox", { name: "На стол" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "На стол" }));
    expect(screen.getByRole("checkbox", { name: "На стол" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.getByRole("checkbox", { name: "На стол" })).not.toBeChecked();
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it("Настройка профиля: текущий пароль, новый пароль и подтверждение", async () => {
    await renderPage();
    await goTo("Настройка профиля");
    const content = document.querySelector(".company-profile-content");
    expect(within(content).getByPlaceholderText("Введите текущий пароль")).toHaveAttribute("autocomplete", "current-password");
    expect(content.querySelectorAll(".company-profile-password-form em")).toHaveLength(0);
    expect(viewportCss).toContain("font-size: 15px");
    expect(within(content).getByPlaceholderText("Введите новый пароль")).toBeInTheDocument();
    expect(within(content).getByPlaceholderText("Повторите новый пароль")).toBeInTheDocument();
    expect(within(content).getByRole("button", { name: "Сохранить" })).toBeInTheDocument();
    // Шапочных Отменить/Сохранить у этой секции нет.
    expect(document.querySelector(".company-profile-header .company-profile-actions")).not.toBeInTheDocument();
  });

  it("Настройка профиля: несовпадение блокируется без мутаций", async () => {
    await renderPage();
    await goTo("Настройка профиля");
    fireEvent.change(screen.getByPlaceholderText("Введите текущий пароль"), { target: { value: "OldPassword1" } });
    fireEvent.change(screen.getByPlaceholderText("Введите новый пароль"), { target: { value: "Password1" } });
    fireEvent.change(screen.getByPlaceholderText("Повторите новый пароль"), { target: { value: "Password2" } });
    fireEvent.click(document.querySelector(".company-profile-password-actions .company-profile-save"));
    expect(await screen.findByText("Пароли не совпадают.")).toBeInTheDocument();
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it("смена пароля: реальный API, очистка полей, без сохранения секретов в браузере", async () => {
    await renderPage();
    await goTo("Настройка профиля");
    fireEvent.change(screen.getByPlaceholderText("Введите текущий пароль"), { target: { value: "OldPassword1" } });
    fireEvent.change(screen.getByPlaceholderText("Введите новый пароль"), { target: { value: "Password1" } });
    fireEvent.change(screen.getByPlaceholderText("Повторите новый пароль"), { target: { value: "Password1" } });
    fireEvent.click(document.querySelector(".company-profile-password-actions .company-profile-save"));
    expect(await screen.findByText(/Пароль изменён/)).toBeInTheDocument();
    expect(authService.changePassword).toHaveBeenCalledWith({ current_password: "OldPassword1", new_password: "Password1", confirm_password: "Password1" });
    expect(screen.getByPlaceholderText("Введите текущий пароль")).toHaveValue("");
    expect(screen.getByPlaceholderText("Введите новый пароль")).toHaveValue("");
    expect(screen.getByPlaceholderText("Повторите новый пароль")).toHaveValue("");
    expect(JSON.stringify(localStorage)).not.toContain("Password1");
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
  });

  it("смена пароля: двойное нажатие, ошибка сервера и отсутствие ложного успеха", async () => {
    let reject;
    authService.changePassword.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    await renderPage();
    await goTo("Настройка профиля");
    for (const [placeholder, value] of [["Введите текущий пароль", "WrongOld1"], ["Введите новый пароль", "Password1"], ["Повторите новый пароль", "Password1"]]) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
    const save = screen.getByRole("button", { name: "Сохранить" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(authService.changePassword).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    await act(async () => reject({ response: { data: { detail: "Текущий пароль указан неверно." } } }));
    expect(await screen.findByText("Текущий пароль указан неверно.")).toBeInTheDocument();
    expect(screen.queryByText(/Пароль изменён/)).toBeNull();
    expect(save).toBeEnabled();
    await goTo("Основные данные");
    await goTo("Настройка профиля");
    expect(screen.getByPlaceholderText("Введите текущий пароль")).toHaveValue("");
  });

  it("каждая секция рендерит только свой контент", async () => {
    await renderPage();
    // basic: нет контента main/other/profile
    expect(screen.queryByText("Начало дня")).not.toBeInTheDocument();
    expect(screen.queryByText("На вынос")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Введите новый пароль")).not.toBeInTheDocument();
    // main: нет basic-контента
    await goTo("Основные настройки");
    expect(screen.queryByPlaceholderText("Название компании")).not.toBeInTheDocument();
    expect(screen.queryByText("Лого компании")).not.toBeInTheDocument();
    // other: нет basic/main-контента
    await goTo("Другие настройки");
    expect(screen.queryByPlaceholderText("Название компании")).not.toBeInTheDocument();
    expect(screen.queryByText("Начало дня")).not.toBeInTheDocument();
    // profile: нет чужого контента
    await goTo("Настройка профиля");
    expect(screen.queryByPlaceholderText("Название компании")).not.toBeInTheDocument();
    expect(screen.queryByText("Начало дня")).not.toBeInTheDocument();
    expect(screen.queryByText("Доставка")).not.toBeInTheDocument();
  });
});


describe("SettingsProfilePage — название заведения", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useAuth.mockReturnValue({ user: { id: "owner-1", full_name: "Владелец" }, applyProfile: vi.fn() });
    settingsService.getCompanyProfile.mockResolvedValue({ data: { ...COMPANY } });
    settingsService.updateCompanyProfile.mockImplementation(async (payload) => ({ data: { ...COMPANY, ...payload } }));
    authService.getProfilePhoto.mockResolvedValue({ data: { image: "data:image/webp;base64,AAA" } });
    authService.updateProfile.mockImplementation(async ({ name }) => ({ data: { id: "owner-1", name } }));
  });

  it("в «Основных данных» есть поле «Название заведения» с текущим названием компании", async () => {
    await renderPage();
    const input = await screen.findByPlaceholderText("Введите название заведения");
    await waitFor(() => expect(input).toHaveValue("Мой ресторан"));
    expect(screen.getByText("Это название видят гости в QR-меню")).toBeInTheDocument();
  });

  it("новое название уходит на сервер как название компании", async () => {
    await renderPage();
    const input = await screen.findByPlaceholderText("Введите название заведения");
    await waitFor(() => expect(input).toHaveValue("Мой ресторан"));
    fireEvent.change(input, { target: { value: "  Сардор  " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateCompanyProfile).toHaveBeenCalled());
    expect(settingsService.updateCompanyProfile.mock.calls[0][0]).toMatchObject({ name: "Сардор" });
  });

  it("пустое название не сохраняется", async () => {
    await renderPage();
    const input = await screen.findByPlaceholderText("Введите название заведения");
    await waitFor(() => expect(input).toHaveValue("Мой ресторан"));
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText(/Укажите название заведения/)).toBeInTheDocument();
    expect(settingsService.updateCompanyProfile).not.toHaveBeenCalled();
    expect(authService.updateProfile).not.toHaveBeenCalled();
  });
});
