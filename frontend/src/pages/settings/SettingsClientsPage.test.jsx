import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { settingsService } from "../../api/settings";
import BackButton from "../../components/BackButton";
import SettingsClientsPage from "./SettingsClientsPage";

vi.mock("../../api/settings", () => ({
  settingsService: {
    listResource: vi.fn(),
    createResource: vi.fn(),
    updateResource: vi.fn(),
    deleteResource: vi.fn(),
  },
}));

vi.mock("../../../api/finance", () => ({
  financeService: { listCounterpartyTransactions: vi.fn(() => Promise.resolve({ data: { items: [], total: 0, page: 1, size: 200, pages: 1 } })) },
}));

const SERVER_ROWS = [
  { id: "c1", full_name: "Real Client", phone: "+998901112233", balance: 0, type: "client" },
  { id: "s1", full_name: "Real Supplier", phone: "+998902223344", balance: 5, type: "supplier" },
  { id: "e1", full_name: "Real Employee", phone: "+998903334455", balance: 0, type: "employee" },
  { id: "o1", full_name: "Real Other", phone: "+14155552671", balance: 0, type: "other" },
  { id: "l1", full_name: "Legacy Row", phone: "23423423423", balance: 0, type: "other" },
];

function renderClients(initialEntries = ["/settings/clients"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <SettingsClientsPage />
    </MemoryRouter>,
  );
}

function renderClientsWithTopbarBack(initialEntries = ["/settings/clients"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <BackButton />
      <SettingsClientsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsService.listResource.mockResolvedValue({ data: { items: SERVER_ROWS } });
  settingsService.createResource.mockImplementation(async (resource, payload) => ({ data: { ...payload, id: "new-1", name: payload.full_name } }));
  settingsService.updateResource.mockImplementation(async (resource, id, payload) => ({ data: { id, ...payload, name: payload.full_name } }));
  settingsService.deleteResource.mockResolvedValue({ data: {} });
});

describe("SettingsClientsPage (counterparties V1)", () => {
  it("renders the OWNER heading and never hardcoded demo rows", async () => {
    const { container } = renderClients();
    expect(await screen.findByRole("heading", { name: "Клиенты" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    // Settings outer shell + staff inner primitives.
    expect(container.querySelector(".settings-card")).not.toBeNull();
    expect(container.querySelector(".settings-header .settings-title-group")).not.toBeNull();
    expect(container.querySelector(".staff-tabs.staff-tabs--slider")).not.toBeNull();
    expect(container.querySelector(".staff-table")).not.toBeNull();
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledWith("clients", expect.anything()));
    for (const fake of ["abduraxim", "Sardorga", "XIYNOVI", "Xowim", "Zafar", "Bozor", "SARDORKASSA"]) {
      expect(screen.queryByText(fake)).toBeNull();
    }
    expect(screen.getByText("Real Client")).toBeInTheDocument();
  });

  it("renders columns in order with an active status badge", async () => {
    const { container } = renderClients();
    await screen.findByText("Real Client");
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    expect(headers).toEqual(["ФИО", "Номер телефона", "Статус", "История транзакций", "Действия"]);
    // Local display state: default "Активный" badge with a dot.
    const row = screen.getByText("Real Client").closest("tr");
    const cells = [...row.querySelectorAll("td")].map((td) => td.textContent.trim());
    expect(cells[2]).toBe("Активный");
    const badge = row.querySelector(".settings-status-badge.is-active");
    expect(badge).not.toBeNull();
    expect(badge.querySelector(".settings-status-badge__dot")).not.toBeNull();
    // Actions cell pinned right.
    const actionsCell = row.lastChild;
    expect(actionsCell.querySelector(".staff-actions")).not.toBeNull();
  });

  it("titles the add modal by counterparty type", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    expect(await screen.findByRole("heading", { name: "Добавить клиента" })).toBeInTheDocument();
  });

  it("titles the edit modal by counterparty type", async () => {
    renderClients();
    await screen.findByText("Real Client");
    const row = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    expect(await screen.findByRole("heading", { name: "Редактировать клиента" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Поставщики" }));
    const supplierRow = screen.getByText("Real Supplier").closest("tr");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(within(supplierRow).getByRole("button", { name: "Редактировать" }));
    expect(await screen.findByRole("heading", { name: "Редактировать поставщика" })).toBeInTheDocument();
  });

  it("opens Add as a CENTERED Payment-Methods modal, not a right drawer", async () => {
    const { container } = renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    // Exact Payment Methods modal primitives.
    expect(dialog.classList.contains("settings-modal")).toBe(true);
    // Portaled to document.body (same as Payment Methods), so query document.
    expect(document.querySelector(".settings-drawer.settings-modal-overlay")).not.toBeNull();
    expect(document.querySelector(".settings-drawer__backdrop")).not.toBeNull();
    // No right-drawer shell: the modal card is centered, never full-height.
    expect(dialog.classList.contains("settings-form")).toBe(true);
    expect(screen.getByText("Новая запись")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeInTheDocument();
    // X closes, overlay closes.
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens Edit in the SAME centered modal shell", async () => {
    const { container } = renderClients();
    await screen.findByText("Real Client");
    const row = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.classList.contains("settings-modal")).toBe(true);
    expect(document.querySelector(".settings-drawer.settings-modal-overlay")).not.toBeNull();
    expect(screen.getByText("Редактирование")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/ФИО/)).toHaveValue("Real Client");
  });

  it("hides the redundant Type dropdown but keeps the tab type in the payload", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: "Поставщики" }));
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByRole("heading", { name: "Добавить поставщика" })).toBeInTheDocument();
    // No Type dropdown (the status select is a combobox too — scope by label).
    expect(within(dialog).queryByLabelText("Тип контрагента")).toBeNull();
    expect(within(dialog).queryByText("Тип контрагента")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "New Supplier" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    expect(settingsService.createResource).toHaveBeenCalledWith("clients", expect.objectContaining({ type: "supplier" }));
  });

  it("uses the Staff split phone: separate country control + separate number input", async () => {
    renderClients();
    await screen.findByText("Real Client");
    const uzRow = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(uzRow).getByRole("button", { name: "Редактировать" }));
    const dialog = await screen.findByRole("dialog");
    // SAME Staff classes: split field, country pill trigger, digits input.
    const split = dialog.querySelector(".staff-phone-field.staff-phone-field--split");
    expect(split).not.toBeNull();
    const country = dialog.querySelector(".staff-phone-country.staff-phone-country--pill");
    expect(country).not.toBeNull();
    expect(country.textContent).toContain("+998");
    expect(country.querySelector("img")).not.toBeNull();
    const digits = within(dialog).getByLabelText("Номер телефона без кода страны");
    expect(digits).not.toBeNull();
    expect(country.compareDocumentPosition(digits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Existing UZ value prefills as local digits with Staff masking.
    expect(digits).toHaveValue("(90) 111-22-33");
    // Country menu is a fixed overlay popover (portaled to document.body),
    // never clipped by the modal scroll container.
    expect(dialog.querySelector(".staff-phone-country-menu")).toBeNull();
    fireEvent.click(country);
    const menu = document.querySelector("body > .staff-phone-country-menu");
    expect(menu).not.toBeNull();
    expect(menu.style.position).toBe("fixed");
    expect(Number(menu.style.zIndex)).toBeGreaterThanOrEqual(10001);
    expect(document.querySelectorAll("body > .staff-phone-country-menu button").length).toBeGreaterThanOrEqual(8);
    // Own scroll: the Staff menu rule carries its own bounded scroll, so the
    // modal never grows or scrolls when the popover opens (CSS-source oracle:
    // jsdom applies no stylesheets, same practice as the Staff suites).
    const { readFileSync } = await import("node:fs");
    const overrides = readFileSync(`${process.cwd()}/src/styles/react-overrides.css`, "utf8");
    const menuRule = overrides.match(/\.staff-phone-country-menu \{[^}]*\}/);
    expect(menuRule).not.toBeNull();
    expect(menuRule[0]).toContain("overflow: auto");
    expect(menuRule[0]).toContain("max-height: 250px");
    // Footer stays visible while the menu is open.
    expect(within(dialog).getByRole("button", { name: "Сохранить" })).toBeVisible();
  });

  it("closes the country popover by outside click and by Escape (modal stays)", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const country = dialog.querySelector(".staff-phone-country--pill");
    fireEvent.click(country);
    expect(document.querySelector("body > .staff-phone-country-menu")).not.toBeNull();
    // Outside click closes the menu, not the modal.
    fireEvent.mouseDown(document.body);
    expect(document.querySelector("body > .staff-phone-country-menu")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // Escape closes the menu first; the modal survives.
    fireEvent.click(country);
    expect(document.querySelector("body > .staff-phone-country-menu")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("body > .staff-phone-country-menu")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // A second Escape closes the modal itself.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("country dropdown interaction never submits, never calls APIs, never remounts", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    // Valid name so ANY accidental submit would actually POST.
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "No Submit Guy" } });
    const listCalls = settingsService.listResource.mock.calls.length;
    const country = dialog.querySelector(".staff-phone-country--pill");
    // Repeat open/close: same modal node every time (no remount).
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(country);
      expect(document.querySelector("body > .staff-phone-country-menu")).not.toBeNull();
      expect(screen.queryByRole("dialog")).toBe(dialog);
      fireEvent.click(country);
      expect(document.querySelector("body > .staff-phone-country-menu")).toBeNull();
      expect(screen.queryByRole("dialog")).toBe(dialog);
    }
    // Option clicks are type="button": no submit, no API.
    fireEvent.click(country);
    const menu = document.querySelector("body > .staff-phone-country-menu");
    for (const option of menu.querySelectorAll("button")) {
      expect(option.getAttribute("type")).toBe("button");
    }
    fireEvent.click(within(menu).getByRole("option", { name: /Турция/ }));
    expect(settingsService.createResource).not.toHaveBeenCalled();
    expect(settingsService.listResource.mock.calls.length).toBe(listCalls);
    expect(screen.queryByRole("dialog")).toBe(dialog);
  });

  it("updates the dial code from the portaled country list (Turkey → +90)", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.querySelector(".staff-phone-country--pill"));
    const menu = document.querySelector("body > .staff-phone-country-menu");
    fireEvent.click(within(menu).getByRole("option", { name: /Турция/ }));
    expect(document.querySelector("body > .staff-phone-country-menu")).toBeNull();
    expect(dialog.querySelector(".staff-phone-country--pill")?.textContent).toContain("+90");
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "Turkish Guy" } });
    fireEvent.change(within(dialog).getByLabelText("Номер телефона без кода страны"), { target: { value: "5321234567" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    expect(settingsService.createResource).toHaveBeenCalledWith("clients", expect.objectContaining({ phone: "+905321234567" }));
  });

  it("preserves a non-UZ number on edit and saves the canonical value", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: "Другие" }));
    const intlRow = await screen.findByText("Real Other");
    fireEvent.click(within(intlRow.closest("tr")).getByRole("button", { name: "Редактировать" }));
    const dialog = await screen.findByRole("dialog");
    // Country inferred (US +1), digits shown locally — original never forced to +998.
    expect(dialog.querySelector(".staff-phone-country--pill")?.textContent).toContain("+1");
    // Exact Staff masking pattern for the subscriber digits.
    expect(within(dialog).getByLabelText("Номер телефона без кода страны")).toHaveValue("(41) 555-52-671");
    // Edit also defaults the local-only status (row carries the table dash).
    expect(within(dialog).getByRole("combobox", { name: "Статус" })).toHaveTextContent("Активный");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalledTimes(1));
    expect(settingsService.updateResource).toHaveBeenCalledWith("clients", "o1", expect.objectContaining({ phone: "+14155552671" }));
  });

  it("renders the Marjon custom status select (never native) with 2 exact options", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    // No native select anywhere in the Add modal (type dropdown is hidden).
    expect(dialog.querySelector("select")).toBeNull();
    // Shared MarjonSelect primitive under the phone field, in modal order.
    const trigger = within(dialog).getByRole("combobox", { name: "Статус" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Активный");
    expect(trigger.closest(".settings-select")).not.toBeNull();
    const labels = [...dialog.querySelectorAll(
      ".settings-form__grid > label > span, .settings-form__grid > .settings-field > label",
    )].map((el) => el.textContent);
    expect(labels).toEqual(["ФИО / название", "Номер телефона", "Статус"]);
    // Floating portal menu with exactly the requested options.
    fireEvent.click(trigger);
    const menu = document.querySelector("body .settings-select__menu");
    expect(menu).not.toBeNull();
    // Nested scope markers: strict-descendant selectors in the shared
    // stylesheet require .settings-owner-view ABOVE .settings-select__portal
    // (one div with both classes never matches `.a .b`).
    expect(document.querySelector("body .settings-owner-view .settings-select__portal .settings-select__menu")).toBe(menu);
    expect(menu.style.position).toBe("fixed");
    expect(Number(menu.style.zIndex)).toBeGreaterThanOrEqual(10001);
    const options = [...menu.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(["Активный", "Не активный"]);
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.textContent)).toEqual(["Активный"]);
    // Keyboard: ArrowDown + Enter commits through the primitive.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger).toHaveTextContent("Не активный");
    expect(document.querySelector("body .settings-select__menu")).toBeNull();
    // Escape closes the menu, never the modal.
    fireEvent.click(trigger);
    expect(document.querySelector("body .settings-select__menu")).not.toBeNull();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(document.querySelector("body .settings-select__menu")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // Outside click closes the menu, never the modal.
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(document.querySelector("body .settings-select__menu")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("keeps the status form-local: never in payload, shown as badge, reset on reopen", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const trigger = within(dialog).getByRole("combobox", { name: "Статус" });
    fireEvent.click(trigger);
    fireEvent.click(document.querySelector("body .settings-select__menu li:last-child [role='option']"));
    expect(trigger).toHaveTextContent("Не активный");
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "Status Guy" } });
    fireEvent.change(within(dialog).getByLabelText("Номер телефона без кода страны"), { target: { value: "901234567" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    // STATUS_PERSISTED = NO on backend: exact canonical payload, no status key.
    expect(settingsService.createResource).toHaveBeenCalledWith("clients", {
      full_name: "Status Guy",
      phone: "+998901234567",
      type: "client",
    });
    // Table shows the chosen option as a local badge with a dot.
    const row = await screen.findByText("Status Guy");
    const cells = [...row.closest("tr").querySelectorAll("td")].map((td) => td.textContent.trim());
    expect(cells[2]).toBe("Не активный");
    expect(row.closest("tr").querySelector(".settings-status-badge.is-inactive .settings-status-badge__dot")).not.toBeNull();
    // Reopening resets to the visual default: nothing was stored on the server.
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByRole("combobox", { name: "Статус" })).toHaveTextContent("Активный");
  });

  it("shows exactly Список пуст when there is nothing to list", async () => {
    settingsService.listResource.mockResolvedValueOnce({ data: { items: [] } });
    renderClients();
    expect(await screen.findByText("Список пуст")).toBeInTheDocument();
  });

  it("filters rows by tab", async () => {
    renderClients();
    await screen.findByText("Real Client");
    expect(screen.queryByText("Real Supplier")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Поставщики" }));
    expect(screen.getByText("Real Supplier")).toBeInTheDocument();
    expect(screen.queryByText("Real Client")).toBeNull();
  });

  it("formats canonical UZ phones in the table but keeps raw values for search", async () => {
    renderClients();
    await screen.findByText("Real Client");
    // Display: Staff parenthesized mask, canonical untouched underneath.
    expect(screen.getByText("+998 (90) 111-22-33")).toBeInTheDocument();
    expect(screen.queryByText("+998901112233")).toBeNull();
    // Raw search still matches the canonical digits.
    const search = screen.getByRole("searchbox", { name: "Поиск" });
    fireEvent.change(search, { target: { value: "901112233" } });
    expect(screen.getByText("Real Client")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "(90) 111" } });
    expect(screen.queryByText("Real Client")).toBeNull();
  });

  it("leaves legacy and international phones byte-identical in the table", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: "Другие" }));
    // Legacy dirty data is never forced into Uzbek shape.
    expect(screen.getByText("23423423423")).toBeInTheDocument();
    // Valid international number preserved as stored.
    expect(screen.getByText("+14155552671")).toBeInTheDocument();
  });

  it("scopes the Clients title treatment (600, slightly smaller) without touching other pages", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/styles/owner/settings.css`, "utf8");
    const idx = css.indexOf(".clients-directory-page .settings-title-group h1");
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = css.slice(idx, css.indexOf("}", idx));
    expect(block).toContain("font-weight: 600");
    expect(block).toContain("clamp(24px, 2.4vw, 28px)");
    // Clients scope only: no payment-methods/places/printers selectors here.
    expect(block).not.toMatch(/payment-methods|places|printer|printers/);
  });

  it("centers the STATUS column through real column alignment (no hacks)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/src/styles/owner/settings.css`, "utf8");
    expect(css).toContain(".clients-directory-page:not(.client-statement-page) .staff-table th:nth-child(3)");
    expect(css).toContain(".clients-directory-page:not(.client-statement-page) .staff-table td:nth-child(3)");
    expect(css).toMatch(/\.clients-directory-page:not\(\.client-statement-page\)[^{]*\{\s*text-align: center;\s*\}/);
    // No offset hacks inside the rule block itself.
    const idx = css.indexOf(".clients-directory-page:not(.client-statement-page)");
    const end = css.indexOf("}", idx);
    const window = css.slice(idx, end);
    expect(window).not.toMatch(/margin-left|translate|padding-left/);
  });

  it("searches by name and phone within the loaded data", async () => {
    renderClients();
    await screen.findByText("Real Client");
    const search = screen.getByRole("searchbox", { name: "Поиск" });
    fireEvent.change(search, { target: { value: "supplier" } });
    expect(screen.queryByText("Real Client")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Поставщики" }));
    expect(screen.getByText("Real Supplier")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Клиенты" }));
    fireEvent.change(search, { target: { value: "901112233" } });
    expect(screen.getByText("Real Client")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "000000" } });
    expect(screen.queryByText("Real Client")).toBeNull();
  });

  it("creates with a normalized phone payload and keeps the tab", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "New Guy" } });
    fireEvent.change(within(dialog).getByLabelText("Номер телефона без кода страны"), { target: { value: "901234567" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    expect(settingsService.createResource).toHaveBeenCalledWith("clients", {
      full_name: "New Guy",
      phone: "+998901234567",
      type: "client",
    });
    expect(await screen.findByText("New Guy")).toBeInTheDocument();
  });

  it("rejects an empty name without POST", async () => {
    renderClients();
    await screen.findByText("Real Client");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Номер телефона без кода страны"), { target: { value: "901234567" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(settingsService.createResource).not.toHaveBeenCalled();
  });

  it("edits through PATCH with existing values", async () => {
    renderClients();
    await screen.findByText("Real Client");
    const row = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/ФИО/)).toHaveValue("Real Client");
    fireEvent.change(within(dialog).getByLabelText(/ФИО/), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalledWith("clients", "c1", expect.objectContaining({ full_name: "Renamed" })));
  });

  it("requires confirmation before delete", async () => {
    renderClients();
    await screen.findByText("Real Client");
    const row = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: "Удалить" }));
    expect(settingsService.deleteResource).not.toHaveBeenCalled();
    expect(screen.getByText("Удалить контрагента?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Да" }));
    await waitFor(() => expect(settingsService.deleteResource).toHaveBeenCalledWith("clients", "c1"));
    expect(screen.queryByText("Real Client")).toBeNull();
  });

  it("shows a truthful error state when the list fails", async () => {
    settingsService.listResource.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { data: { detail: "Сервис недоступен" } } }),
    );
    renderClients();
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(screen.queryByText("Real Client")).toBeNull();
  });

  it("opens history inside the SAME settings-card shell with no local back button", async () => {
    const { container } = renderClients();
    await screen.findByText("Real Client");
    const row = screen.getByText("Real Client").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: /История транзакций/ }));
    expect(await screen.findByText("История транзакций")).toBeInTheDocument();
    // V11: redundant texts removed — period lives in the period button only.
    expect(screen.queryByText("Акт сверки")).toBeNull();
    expect(screen.queryByText((_, element) => element?.textContent?.startsWith("за период:"))).toBeNull();
    expect(screen.queryByText(/Текущий баланс/)).toBeNull();
    // Kept header: name + phone.
    expect(screen.getByRole("heading", { name: "Real Client" })).toBeInTheDocument();
    // SAME Settings outer shell as the directory — no custom narrow card.
    expect(container.querySelector(".settings-card")).not.toBeNull();
    expect(container.querySelector(".client-statement-card")).toBeNull();
    // No local history back button: topbar Back owns the return.
    expect(screen.queryByRole("button", { name: /Назад/ })).toBeNull();
    expect(screen.queryByText("← Клиенты")).toBeNull();
    // Toolbar: slider modes + Reports period picker, no counterparty filter.
    expect(container.querySelector(".client-statement-right .staff-tabs.staff-tabs--slider")).not.toBeNull();
    expect(container.querySelector(".client-statement-right .staff-tabs__indicator")).not.toBeNull();
    expect(container.querySelector(".client-statement-right .report-period-picker")).not.toBeNull();
    expect(container.querySelectorAll("select").length).toBe(0);
  });

  it.each([
    ["Клиенты", "Клиенты", "Real Client"],
    ["Поставщики", "Поставщики", "Real Supplier"],
    ["Сотрудники", "Сотрудники", "Real Employee"],
    ["Другие", "Другие", "Real Other"],
  ])("topbar Back restores the source tab: %s → history → back", async (tabLabel, _tab, rowName) => {
    const { container } = renderClientsWithTopbarBack();
    await screen.findByText("Real Client");
    if (tabLabel !== "Клиенты") fireEvent.click(screen.getByRole("button", { name: tabLabel }));
    const row = await screen.findByText(rowName);
    fireEvent.click(within(row.closest("tr")).getByRole("button", { name: /История транзакций/ }));
    expect(await screen.findByText("История транзакций")).toBeInTheDocument();
    expect(screen.queryByText("Акт сверки")).toBeNull();
    // The global/topbar back button (aria-label "Назад").
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    // Directory is back with the SOURCE tab active (filter + visual pill).
    expect(await screen.findByRole("heading", { name: "Клиенты" })).toBeInTheDocument();
    expect(container.querySelector(".client-statement-page")).toBeNull();
    const tabButton = screen.getByRole("button", { name: tabLabel });
    expect(tabButton.className).toMatch("is-active");
    expect(screen.getByText(rowName)).toBeInTheDocument();
  });
});
