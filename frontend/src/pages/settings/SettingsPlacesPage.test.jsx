import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsService } from "../../api/settings";
import SettingsPlacesPage, { applyBranchOrder } from "./SettingsPlacesPage";

vi.mock("../../api/settings", () => ({
  settingsService: {
    listPlaces: vi.fn(),
    listBranches: vi.fn(),
    createPlace: vi.fn(() => Promise.resolve({ data: { id: "new" } })),
    updatePlace: vi.fn(() => Promise.resolve({ data: {} })),
    deactivatePlace: vi.fn(() => Promise.resolve({ data: {} })),
    reorderPlaces: vi.fn(() => Promise.resolve({ data: [] })),
    createPlaceTable: vi.fn(() => Promise.resolve({ data: { id: "nt" } })),
    updatePlaceTable: vi.fn(() => Promise.resolve({ data: {} })),
    deactivatePlaceTable: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// Fixtures mirror the ACTUAL backend contract at 26d4c50 (halls/schemas.py):
// price_amount is a NUMERIC(15,2) decimal STRING, condition is a legacy
// free-text note, nested tables arrive with include_inactive=true.
const HALLS = [
  { id: "h-zal", name: "Зал", is_active: true, branch_id: "b-main", condition: "Депозит от 200 000", percent: 10, pricing_type: "percent", price_amount: null, description: "Главный зал", tables: [
    { id: "t-z1", hall_id: "h-zal", number: 1, capacity: 4, is_active: true },
    { id: "t-z2", hall_id: "h-zal", number: 2, capacity: 2, is_active: true },
    { id: "t-z5", hall_id: "h-zal", number: 5, capacity: 6, is_active: true },
  ] },
  { id: "h-bar", name: "Бар", is_active: true, branch_id: "b-main", tables: [
    { id: "t-b1", hall_id: "h-bar", number: 1, capacity: 2, is_active: true },
    { id: "t-b5", hall_id: "h-bar", number: 5, capacity: 4, is_active: true },
  ] },
  { id: "h-bal", name: "Балкон", is_active: true, branch_id: "b-main", tables: [] },
];

const ONE_BRANCH = [{ id: "b-main", name: "Основной филиал", is_active: true }];
const TWO_BRANCHES = [
  { id: "b-main", name: "Основной филиал", is_active: true },
  { id: "b-second", name: "Второй филиал", is_active: true },
];

const ROW_DATA_HALLS = [
  { id: "h-row-zal", name: "ЗАЛ", is_active: true, branch_id: "b-main", percent: 10, pricing_type: null, price_amount: null, tables: [] },
  { id: "h-row-billiard", name: "Billiard", is_active: true, branch_id: "b-main", percent: 0, pricing_type: "hourly", price_amount: "100000.00", tables: [] },
  { id: "h-row-booking", name: "БРОН", is_active: true, branch_id: "b-main", percent: "10.0", pricing_type: "fixed", price_amount: "300000.00", tables: [] },
  { id: "h-row-bar", name: "Бар", is_active: false, branch_id: "b-main", percent: "10.5", pricing_type: "hourly", price_amount: "20000", tables: [] },
  { id: "h-row-empty", name: "Без цены", is_active: true, branch_id: "b-main", percent: null, pricing_type: "hourly", price_amount: null, condition: "Цена за час: 999000", tables: [] },
];

function mockList(data) {
  settingsService.listPlaces.mockImplementation(() => Promise.resolve({ data }));
}
function mockBranches(data) {
  settingsService.listBranches.mockImplementation(() => Promise.resolve({ data }));
}
function conflict(detail) {
  return Object.assign(new Error("Request failed with status code 409"), {
    name: "AxiosError",
    response: { status: 409, data: { detail } },
  });
}
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings/places"]}>
      <SettingsPlacesPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}
async function enterHall(name) {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: `Открыть столы: ${name}` }));
  await screen.findByRole("heading", { name });
}

// The conditional money field's label text also appears as a listbox option, so
// it is read from the field itself rather than by text.
function conditionalLabel() {
  const field = document.querySelector(".settings-form__conditional span");
  return field ? field.textContent : null;
}

// Phase 5C-5.2: "Доп. цена" is a Marjon custom listbox, not a native <select>.
// These helpers drive it the way a user does — open the panel, click a row.
function pricingTrigger() {
  return document.getElementById("hall-pricing-select");
}
function branchTrigger() {
  return document.getElementById("hall-branch-select");
}
function openPricing() {
  fireEvent.click(pricingTrigger());
  return document.querySelector("#hall-pricing-select-listbox");
}
function choosePricing(label) {
  openPricing();
  fireEvent.click(screen.getByRole("option", { name: label }));
}
const PRICING_LABEL = { fixed: "Дополнительная цена", hourly: "Цена за час" };
function selectPricing(value) {
  choosePricing(PRICING_LABEL[value]);
}
function clearPricing() {
  fireEvent.click(screen.getByRole("button", { name: "Убрать доп. цену" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList(HALLS);
  mockBranches(ONE_BRANCH);
});

// placeholder-tests

describe("SettingsPlacesPage — places list", () => {
  it("renders real places with counts, no accordion tables inline, no demo data", async () => {
    renderPage();
    await screen.findByText("Зал");
    const header = document.querySelector(".settings-header");
    expect(within(header).getByText("Настройки")).toBeInTheDocument();
    expect(within(header).getByRole("heading", { name: "Места" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Добавить место" })).toBeInTheDocument();
    expect(screen.queryByText("Управление залами и столами")).toBeNull();
    expect(screen.getByText("Бар")).toBeInTheDocument();
    expect(screen.getByText("Балкон")).toBeInTheDocument();
    expect(screen.getByText("3 стола")).toBeInTheDocument();
    expect(screen.getByText("2 стола")).toBeInTheDocument();
    expect(screen.getByText("0 столов")).toBeInTheDocument();
    // list view must NOT render a tables grid inline (drill-down, not accordion)
    expect(screen.queryByText("№ стола")).not.toBeInTheDocument();
    ["ЗАЛЛ", "КАБИНА", "Billiard", "БРОН"].forEach((d) => expect(screen.queryByText(d)).not.toBeInTheDocument());
    // no table id leaks
    expect(document.body.textContent).not.toContain("t-z1");
  });

  it("drills into a place by canonical Hall.id and uses the shared Settings header", async () => {
    await enterHall("Зал");
    const header = document.querySelector(".settings-header");
    expect(within(header).getByText("Настройки")).toBeInTheDocument();
    expect(within(header).getByRole("heading", { name: "Зал" })).toBeInTheDocument();
    expect(screen.queryByText("Столы — Зал")).toBeNull();
    expect(screen.queryByText("Управление столами выбранного места")).toBeNull();
    expect(screen.queryByRole("button", { name: "Места" })).toBeNull();
    expect(screen.getByTestId("location-search")).toHaveTextContent("?hall_id=h-zal");
    // other halls no longer listed (we are in the tables view)
    expect(screen.queryByText("Бар")).not.toBeInTheDocument();
    const region = document.body;
    expect(within(region).getAllByText("Редактировать").length).toBeGreaterThan(0);
  });

  it("top-level empty state has no center CTA, only the top-right create button", async () => {
    mockList([]);
    renderPage();
    expect(await screen.findByText("Мест пока нет")).toBeInTheDocument();
    // the central "Добавить первое место" CTA was removed
    expect(screen.queryByRole("button", { name: "Добавить первое место" })).toBeNull();
    // the only primary create action is the top-right button
    expect(screen.getByRole("button", { name: "Добавить место" })).toBeInTheDocument();
  });

  it("error + retry", async () => {
    settingsService.listPlaces.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
    await screen.findByText("Зал");
    expect(settingsService.listPlaces).toHaveBeenCalledTimes(2);
  });

  it("deletes a hall via the confirm modal and refreshes", async () => {
    renderPage();
    await screen.findByText("Зал");
    const action = screen.getAllByRole("button", { name: "Удалить место" })[0];
    expect(action.querySelector(".lucide-trash-2")).toBeInTheDocument();
    expect(action.querySelector(".lucide-octagon-x")).toBeNull();
    // Trash opens the confirmation modal — it does NOT delete on click.
    fireEvent.click(action);
    await screen.findByRole("heading", { name: "Удалить место?" });
    expect(settingsService.deactivatePlace).not.toHaveBeenCalled();
    // Confirming sends exactly one delete and refetches.
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deactivatePlace).toHaveBeenCalledWith("h-zal"));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });
});

describe("SettingsPlacesPage — Place row canonical metadata", () => {
  function row(name) {
    return screen.getByText(name, { exact: true }).closest(".settings-place");
  }

  beforeEach(() => { mockList(ROW_DATA_HALLS); });

  it("starts directly with the larger Place information and preserves table counts", async () => {
    renderPage();
    await screen.findByText("ЗАЛ", { exact: true });
    expect(document.querySelector(".settings-place .settings-place__icon")).toBeNull();
    expect(document.querySelector(".settings-place .lucide-map-pin")).toBeNull();
    expect(document.querySelector(".settings-place__chevron")).toBeNull();
    expect(screen.queryByRole("button", { name: "Перейти к столам: ЗАЛ" })).toBeNull();
    expect(within(row("ЗАЛ")).getByText("0 столов")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить место" })).toBeInTheDocument();
  });

  it("formats canonical percent including zero and meaningful decimals", async () => {
    renderPage();
    await screen.findByText("ЗАЛ", { exact: true });
    expect(within(row("ЗАЛ")).getByText("10 %")).toBeInTheDocument();
    expect(within(row("Billiard")).getByText("0 %")).toBeInTheDocument();
    expect(within(row("БРОН")).getByText("10 %")).toBeInTheDocument();
    expect(within(row("Бар")).getByText("10.5 %")).toBeInTheDocument();
    expect(row("БРОН")).not.toHaveTextContent("10.0 %");
    expect(row("Без цены")).not.toHaveTextContent("%");
  });

  it("shows structured fixed/hourly prices, never condition, with no per-row request", async () => {
    renderPage();
    await screen.findByText("ЗАЛ", { exact: true });
    expect(row("Billiard")).toHaveTextContent("Цена за час: 100 000 UZS");
    expect(row("БРОН")).toHaveTextContent("Дополнительная цена: 300 000 UZS");
    expect(row("Бар")).toHaveTextContent("Цена за час: 20 000 UZS");
    expect(row("Без цены")).not.toHaveTextContent("UZS");
    expect(document.body).not.toHaveTextContent("999000");
    expect(settingsService.listPlaces).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPlacesPage — place drawer (free-text name)", () => {
  it("add place uses a text input (never a dropdown) and accepts custom names", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const nameInput = screen.getByPlaceholderText("Введите название места");
    expect(nameInput.tagName).toBe("INPUT");
    // there is no preset hall-name <select> in the drawer
    const form = document.querySelector(".settings-form");
    expect(within(form).queryByDisplayValue("Зал")).toBeNull();
    fireEvent.change(nameInput, { target: { value: "VIP-зал" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "VIP-зал" })));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });

  it("edit place populates the name as editable text", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const nameInput = screen.getByPlaceholderText("Введите название места");
    expect(nameInput.tagName).toBe("INPUT");
    expect(nameInput).toHaveValue("Зал");
  });

  // Portal proof: the drawer is a top-level modal (createPortal → document.body),
  // NOT a descendant of the page subtree (which is inside .dashboard-content in
  // the app shell). This is what frees it from the shell stacking context.
  it("renders the drawer via a body portal, outside the page subtree", async () => {
    const { container } = renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const drawer = document.querySelector(".settings-drawer");
    expect(drawer).toBeInTheDocument();
    // escaped the rendered page subtree entirely
    expect(container.contains(drawer)).toBe(false);
    expect(document.querySelector(".settings-places-page").contains(drawer)).toBe(false);
    // portal wrapper keeps the owner-view styling scope around the drawer
    expect(drawer.closest(".settings-owner-view")).not.toBeNull();
    expect(within(drawer).getByRole("button", { name: "Добавить" })).toBeInTheDocument();
  });

  it("uses a centered aria-modal dialog (not a native browser dialog)", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const dialog = document.querySelector(".settings-modal");
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector(".settings-modal-overlay")).toBeInTheDocument();
  });

  it("has no second «Место» field and no temporary persistence helper", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    // the sole hall-name input is "Название места"; there is no separate «Место» field
    expect(within(form).getByText("Название места")).toBeInTheDocument();
    expect(within(form).queryByPlaceholderText("Введите место")).toBeNull();
    expect(within(form).queryByText("Место")).toBeNull();
    // the temporary Phase 5C helper note is gone
    expect(within(form).queryByText("Сохранение будет подключено на следующем этапе")).toBeNull();
  });

  // Phase 5C-5.1: the modal was visually simplified — no visible "*" markers.
  it("shows no visible required asterisks anywhere in the place modal", async () => {
    mockBranches(TWO_BRANCHES); // also covers the branch label
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    // reveal the conditional money field too, so its label is covered
    selectPricing("fixed");
    expect(conditionalLabel()).toBe("Дополнительная цена");
    expect(form.textContent).not.toContain("*");
  });

  it("renders service percent and Доп. цена selector; reveals the matching price field", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    expect(within(form).getByPlaceholderText("Введите %")).toBeInTheDocument();
    // no additional-price field until a type is chosen
    expect(conditionalLabel()).toBe(null);
    expect(within(form).queryByPlaceholderText("Введите цену")).toBeNull();
    // "Дополнительная цена" (fixed) reveals the fixed-price field
    selectPricing("fixed");
    expect(conditionalLabel()).toBe("Дополнительная цена");
    expect(within(form).getByPlaceholderText("Введите цену")).toBeInTheDocument();
    // switching to "Цена за час" (hourly) swaps the conditional field
    selectPricing("hourly");
    expect(conditionalLabel()).toBe("Цена за час");
    // clearing via the × control hides it again
    clearPricing();
    expect(conditionalLabel()).toBe(null);
    expect(within(form).queryByPlaceholderText("Введите цену")).toBeNull();
  });

  // §3/§4: the control is a Marjon DOM listbox, and the hint is trigger text —
  // it must never appear as a selectable row in the panel.
  it("«Выберите...» is trigger-only text, never an option in the panel", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");

    // the native <select> is gone from this modal entirely
    expect(form.querySelector("select")).toBeNull();

    const trigger = pricingTrigger();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // closed state shows the hint, styled as a placeholder
    expect(trigger.textContent).toBe("Выберите...");
    expect(trigger.className).toContain("is-placeholder");
    // nothing is rendered until it is opened
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();

    const panel = openPricing();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("role", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", "hall-pricing-select-listbox");

    // exactly the two real pricing kinds, and no hint row
    const options = within(panel).getAllByRole("option");
    expect(options.map((o) => o.textContent.replace(/\s+$/, ""))).toEqual([
      "Дополнительная цена", "Цена за час",
    ]);
    expect(within(panel).queryByText("Выберите...")).toBeNull();

    // mouse selection commits the canonical value, not the label
    fireEvent.click(options[1]);
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();
    expect(pricingTrigger().textContent).toBe("Цена за час");
    expect(pricingTrigger().className).not.toContain("is-placeholder");
    expect(conditionalLabel()).toBe("Цена за час");
  });

  it("dropdown supports keyboard selection, Escape and outside click", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const trigger = pricingTrigger();

    // ArrowDown opens the panel and marks an active row
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    let panel = document.querySelector("#hall-pricing-select-listbox");
    expect(panel).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-activedescendant", "hall-pricing-select-opt-0");

    // ArrowDown moves down, ArrowUp wraps back
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(pricingTrigger()).toHaveAttribute("aria-activedescendant", "hall-pricing-select-opt-1");
    fireEvent.keyDown(pricingTrigger(), { key: "ArrowUp" });
    expect(pricingTrigger()).toHaveAttribute("aria-activedescendant", "hall-pricing-select-opt-0");

    // Enter commits the active row
    fireEvent.keyDown(pricingTrigger(), { key: "Enter" });
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();
    expect(pricingTrigger().textContent).toBe("Дополнительная цена");

    // Escape closes the panel WITHOUT closing the modal or losing the value
    fireEvent.keyDown(pricingTrigger(), { key: "ArrowDown" });
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeInTheDocument();
    fireEvent.keyDown(pricingTrigger(), { key: "Escape" });
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();
    expect(document.querySelector(".settings-modal")).toBeInTheDocument();
    expect(pricingTrigger().textContent).toBe("Дополнительная цена");

    // outside click closes it too, keeping the chosen value
    fireEvent.click(pricingTrigger());
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();
    expect(pricingTrigger().textContent).toBe("Дополнительная цена");

    // Tab closes as well
    fireEvent.click(pricingTrigger());
    fireEvent.keyDown(pricingTrigger(), { key: "Tab" });
    expect(document.querySelector("#hall-pricing-select-listbox")).toBeNull();
  });

  it("selected row is marked aria-selected in the panel", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    selectPricing("hourly");
    const panel = openPricing();
    const options = within(panel).getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1].className).toContain("is-selected");
  });

  // Phase 5C-5.2 status control. The switch is interactive in BOTH modes.
  // HallCreate cannot express is_active, so "create as inactive" becomes
  // POST (active) → PATCH {is_active:false} on the returned canonical id.
  it("create mode offers a real, interactive status switch", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const field = document.querySelector(".settings-form .settings-toggle-field");
    expect(within(field).getByText("Статус")).toBeInTheDocument();
    const toggle = field.querySelector("input[type=checkbox]");
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    expect(within(field).getByText("Активен")).toBeInTheDocument();

    // flipping it updates the label both ways
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(within(field).getByText("Неактивен")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(within(field).getByText("Активен")).toBeInTheDocument();
  });

  it("status label carries the semantic active/inactive class and a fixed width", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const field = document.querySelector(".settings-form .settings-toggle-field");
    const label = field.querySelector(".settings-switch__label");
    const toggle = field.querySelector("input[type=checkbox]");

    // Same is-active / is-inactive contract the main Places rows use, so the
    // colour comes from one place rather than a second hardcoded pair.
    expect(label).toHaveClass("is-active");
    fireEvent.click(toggle);
    expect(label).toHaveClass("is-inactive");
    expect(label).not.toHaveClass("is-active");
    fireEvent.click(toggle);
    expect(label).toHaveClass("is-active");

    // Geometry stability: the label reserves the wider word's width, so
    // toggling cannot shift the switch inside the space-between row.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/owner/settings.css", "utf8");
    const rule = css.match(/\.settings-owner-view \.settings-switch__label \{[^}]*\}/s);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/min-width:\s*\d+px/);
    // And the colours match the main-screen badge contract exactly.
    const badgeActive = css.match(/\.settings-places-page \.settings-status-badge\.is-active \{[^}]*\}/s)[0];
    const badgeInactive = css.match(/\.settings-places-page \.settings-status-badge\.is-inactive \{[^}]*\}/s)[0];
    const labelActive = css.match(/\.settings-switch__label\.is-active \{[^}]*\}/s)[0];
    const labelInactive = css.match(/\.settings-switch__label\.is-inactive \{[^}]*\}/s)[0];
    const color = (block) => block.match(/color:\s*([^;]+);/)[1].trim();
    expect(color(labelActive)).toBe(color(badgeActive));
    expect(color(labelInactive)).toBe(color(badgeInactive));
  });

  it("create with status ON: POST only, and is_active is never sent", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    fireEvent.change(screen.getByPlaceholderText("Введите название места"), { target: { value: "Терраса" } });
    fireEvent.click(within(document.querySelector(".settings-form")).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    // HallCreate has no is_active field, so it must never appear in the payload
    expect(settingsService.createPlace.mock.calls[0][0]).not.toHaveProperty("is_active");
    // an active create needs no follow-up PATCH
    expect(settingsService.updatePlace).not.toHaveBeenCalled();
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });

  it("create with status OFF: POST then PATCH the returned Hall.id inactive", async () => {
    settingsService.createPlace.mockResolvedValueOnce({ data: { id: "h-created", name: "Терраса", is_active: true } });
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Терраса" } });
    fireEvent.click(form.querySelector(".settings-switch input[type=checkbox]"));
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));

    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    expect(settingsService.createPlace.mock.calls[0][0]).not.toHaveProperty("is_active");
    // identity comes from the server's canonical id, never from the name
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledWith("h-created", { is_active: false }));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("create with status OFF: a failed follow-up PATCH is reported truthfully", async () => {
    settingsService.createPlace.mockResolvedValueOnce({ data: { id: "h-created" } });
    settingsService.updatePlace.mockRejectedValueOnce(conflict("Филиал неактивен"));
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Терраса" } });
    fireEvent.click(form.querySelector(".settings-switch input[type=checkbox]"));
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));

    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledTimes(1));
    // the place DOES exist and IS active — say so, never claim it was archived
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Филиал неактивен");
    // canonical state is refetched rather than guessed
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toContain("AxiosError");
  });

  it("edit mode status switch toggles and is sent on save", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    const toggle = form.querySelector(".settings-switch input[type=checkbox]");
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    expect(within(form).getByText("Активен")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(within(form).getByText("Неактивен")).toBeInTheDocument();

    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledTimes(1));
    expect(settingsService.updatePlace.mock.calls[0][1]).toHaveProperty("is_active", false);
  });

  // §2: the persistent orange zero-branch block was rejected by the user and
  // must not come back in any form.
  it("shows no zero-branch warning banner, even with zero branches", async () => {
    mockBranches([]);
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    expect(within(form).queryByText(/Нет активного филиала/)).toBeNull();
    expect(form.querySelector(".settings-inactive-note")).toBeNull();
    // the form starts directly with the name field
    const firstLabel = form.querySelector(".settings-form__body label span, .settings-form__body .settings-field__label");
    expect(firstLabel.textContent).toBe("Название места");
    // no branch selector for the zero-branch case, and nothing is fabricated
    expect(document.getElementById("hall-branch-select")).toBeNull();
    expect(within(form).getByRole("button", { name: "Добавить" })).toBeEnabled();
  });

  // Guard on the whole entry path: type into every field, submit, and prove a
  // complete canonical payload leaves the form.
  it("supports the full entry flow: name + percent + price → create", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");

    const name = within(form).getByPlaceholderText("Введите название места");
    fireEvent.change(name, { target: { value: "Терраса" } });
    expect(name).toHaveValue("Терраса");

    const percent = within(form).getByPlaceholderText("Введите %");
    fireEvent.change(percent, { target: { value: "7" } });
    expect(percent).toHaveValue("7");

    selectPricing("hourly");
    const price = within(form).getByPlaceholderText("Введите цену");
    fireEvent.change(price, { target: { value: "75000" } });
    expect(price).toHaveValue("75 000");

    const submit = within(form).getByRole("button", { name: "Добавить" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledWith({
      name: "Терраса", percent: 7, pricing_type: "hourly", price_amount: "75000",
    }));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });

  it("Escape closes the modal", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    expect(document.querySelector(".settings-modal")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".settings-modal")).toBeNull());
  });
});

describe("SettingsPlacesPage — tables view", () => {
  it("renders tables for the selected hall without a hall column or ids", async () => {
    await enterHall("Зал");
    expect(screen.getByText("№1")).toBeInTheDocument();
    expect(screen.getByText("№5")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("t-z5");
  });

  it("empty Tables state has one header CTA and it opens the create modal", async () => {
    await enterHall("Балкон");
    expect(screen.getByText("Столов пока нет")).toBeInTheDocument();
    expect(screen.getByText("Добавьте первый стол для этого места.")).toBeInTheDocument();
    const actions = screen.getAllByRole("button", { name: "Добавить стол" });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toBe(document.querySelector(".settings-header .settings-actions button"));
    fireEvent.click(actions[0]);
    expect(await screen.findByRole("dialog", { name: "Добавить стол" })).toBeInTheDocument();
  });

  it("add table drawer shows hall context and has NO hall selector", async () => {
    await enterHall("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить стол" }));
    const form = document.querySelector(".settings-form");
    expect(within(form).getByText("Добавить стол")).toBeInTheDocument();
    expect(within(form).getByText(/Место:/)).toBeInTheDocument();
    expect(within(form).queryByRole("combobox")).toBeNull(); // no hall dropdown (create mode)
    expect(screen.getByPlaceholderText("Введите номер")).toBeInTheDocument();
  });

  it("edit table populates number & capacity", async () => {
    await enterHall("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    const number = within(form).getByText("Номер стола").parentElement.querySelector("input");
    expect(number).toHaveValue("1");
  });

  it("«Действия» is the last header cell and is right-aligned over the buttons", async () => {
    await enterHall("Зал");
    const head = document.querySelector(".settings-tbl__head");
    const heads = [...head.querySelectorAll("span")].map((s) => s.textContent);
    // Header order matches the row cell order, actions last.
    expect(heads).toEqual(["№ стола", "Вместимость", "Статус", "Действия"]);
    const row = document.querySelector(".settings-tbl__row:not(.settings-tbl__head)");
    expect(row.lastElementChild).toHaveClass("settings-tbl__act");

    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/owner/settings.css", "utf8");
    // The actions cell is flex-end; its header must be right-aligned to sit
    // above the buttons instead of at the far left of that elastic column.
    expect(css).toMatch(/\.settings-tbl__act \{[^}]*justify-content:\s*flex-end/s);
    expect(css).toMatch(/\.settings-tbl__head > span:last-child \{\s*text-align:\s*right/);
    // Header and data rows must share the same track geometry: same inline
    // padding, and a transparent (not removed) border so the columns line up.
    const headRule = css.match(/\.settings-tbl__head \{[^}]*\}/s)[0];
    const rowRule = css.match(/\.settings-tbl__row \{[^}]*\}/s)[0];
    expect(headRule).toMatch(/padding:\s*2px 14px/);
    expect(rowRule).toMatch(/padding:\s*12px 14px/);
    expect(headRule).toMatch(/border:\s*1px solid transparent/);
  });

  it("deactivate table calls the service with hall + table ids", async () => {
    await enterHall("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Деактивировать стол" })[0]);
    await waitFor(() => expect(settingsService.deactivatePlaceTable).toHaveBeenCalledWith("h-zal", "t-z1"));
  });

  it("create table from the selected hall targets the correct hall id", async () => {
    await enterHall("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить стол" }));
    fireEvent.change(screen.getByPlaceholderText("Введите номер"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlaceTable).toHaveBeenCalledWith(
      "h-zal", expect.objectContaining({ number: 9 })));
  });
});

describe("SettingsPlacesPage — modal micro-interactions", () => {
  async function openAddPlace() {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    return document.querySelector(".settings-form");
  }

  it("formats the price with thousands spaces while keeping a raw numeric value", async () => {
    const form = await openAddPlace();
    selectPricing("fixed");
    const price = within(form).getByPlaceholderText("Введите цену");
    fireEvent.change(price, { target: { value: "1000" } });
    expect(price).toHaveValue("1 000");
    fireEvent.change(price, { target: { value: "100000" } });
    expect(price).toHaveValue("100 000");
    fireEvent.change(price, { target: { value: "1000000" } });
    expect(price).toHaveValue("1 000 000");
    // stray spaces / letters are stripped from the raw value
    fireEvent.change(price, { target: { value: "1 2a3" } });
    expect(price).toHaveValue("123");
    // submit → canonical price_amount is raw digits, never the grouped string
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "VIP" } });
    fireEvent.change(price, { target: { value: "12500000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "VIP", pricing_type: "fixed", price_amount: "12500000" })));
  });

  // Phase 5C-2: the monetary value belongs to the structured price_amount
  // column. condition is a legacy human-readable note and must never be
  // written from this form — otherwise a price edit silently destroys it.
  it("sends price_amount and never writes condition (fixed)", async () => {
    const form = await openAddPlace();
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "VIP" } });
    selectPricing("fixed");
    fireEvent.change(within(form).getByPlaceholderText("Введите цену"), { target: { value: "1000000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    const payload = settingsService.createPlace.mock.calls[0][0];
    expect(payload.price_amount).toBe("1000000");
    expect(payload.pricing_type).toBe("fixed");
    expect(payload).not.toHaveProperty("condition");
    // decimal-safe string, not a binary float
    expect(typeof payload.price_amount).toBe("string");
  });

  it("sends price_amount for hourly pricing too", async () => {
    const form = await openAddPlace();
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Бильярд" } });
    selectPricing("hourly");
    fireEvent.change(within(form).getByPlaceholderText("Введите цену"), { target: { value: "75000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledWith(
      expect.objectContaining({ pricing_type: "hourly", price_amount: "75000" })));
    expect(settingsService.createPlace.mock.calls[0][0]).not.toHaveProperty("condition");
  });

  it("editing a price does not overwrite an existing legacy condition note", async () => {
    mockList([{ id: "h1", name: "VIP", is_active: true, branch_id: "b-main", pricing_type: "fixed", price_amount: "250000.00", condition: "Депозит от 200 000", tables: [] }]);
    renderPage();
    await screen.findByText("VIP");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    fireEvent.change(within(form).getByPlaceholderText("Введите цену"), { target: { value: "300000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledTimes(1));
    const [, payload] = settingsService.updatePlace.mock.calls[0];
    expect(payload.price_amount).toBe("300000");
    expect(payload).not.toHaveProperty("condition");
  });

  // Phase 5C-2 distinguishes "omitted" from "explicitly null", so clearing the
  // extra-price option must send both fields as null or stale pricing survives.
  it("clearing the extra-price option sends explicit nulls", async () => {
    mockList([{ id: "h1", name: "VIP", is_active: true, branch_id: "b-main", pricing_type: "fixed", price_amount: "250000.00", tables: [] }]);
    renderPage();
    await screen.findByText("VIP");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    clearPricing();
    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledTimes(1));
    const [id, payload] = settingsService.updatePlace.mock.calls[0];
    expect(id).toBe("h1");
    expect(payload).toHaveProperty("pricing_type", null);
    expect(payload).toHaveProperty("price_amount", null);
  });

  it("does not thousands-format the service percent", async () => {
    const form = await openAddPlace();
    const percent = within(form).getByPlaceholderText("Введите %");
    fireEvent.change(percent, { target: { value: "10" } });
    expect(percent).toHaveValue("10");
  });

  it("percent is optional and its label carries no required asterisk", async () => {
    const form = await openAddPlace();
    // percent label has no `*` (optional canonical behavior)
    expect(within(form).getByText("% обслуживания в заведении")).toBeInTheDocument();
    // name only, no percent → create succeeds; percent sent as null (never fabricated)
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Терраса" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    const payload = settingsService.createPlace.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({ name: "Терраса" }));
    expect(payload).not.toHaveProperty("place");
    expect(payload).not.toHaveProperty("location");
    expect(payload.percent).toBeNull();
  });

  it("restores a grouped price from price_amount, not from condition", async () => {
    mockList([{ id: "h1", name: "VIP", is_active: true, branch_id: "b-main", pricing_type: "fixed", price_amount: "250000.00", condition: "Депозит от 200 000", tables: [] }]);
    renderPage();
    await screen.findByText("VIP");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    // the NUMERIC(15,2) ".00" tail is dropped; the note is never parsed as money
    expect(within(form).getByPlaceholderText("Введите цену")).toHaveValue("250 000");
  });

  it("leaves the amount field empty when price_amount is null", async () => {
    mockList([{ id: "h1", name: "VIP", is_active: true, branch_id: "b-main", pricing_type: "fixed", price_amount: null, condition: "Цена за час: 100 000", tables: [] }]);
    renderPage();
    await screen.findByText("VIP");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    // legacy condition text must NOT be resurrected into the money input
    expect(within(form).getByPlaceholderText("Введите цену")).toHaveValue("");
  });

  it("Отмена plays the exit phase, then unmounts (single close path)", async () => {
    renderPage();
    await screen.findByText("Зал");
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
      expect(document.querySelector(".settings-modal")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
      // still mounted while the exit animation plays
      expect(document.querySelector(".settings-modal-overlay.is-closing")).toBeInTheDocument();
      expect(document.querySelector(".settings-modal")).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      expect(document.querySelector(".settings-modal")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Phase 5C-4 lifecycle (include_inactive + reactivation) ────────────────

const ARCHIVE_HALLS = [
  { id: "h-live", name: "Зал", is_active: true, branch_id: "b-main", tables: [
    { id: "t-l1", hall_id: "h-live", number: 1, capacity: 4, is_active: true },
    { id: "t-l2", hall_id: "h-live", number: 2, capacity: 2, is_active: false },
  ] },
  { id: "h-arch", name: "Архив", is_active: false, branch_id: "b-main", tables: [
    { id: "t-a1", hall_id: "h-arch", number: 1, capacity: 4, is_active: false },
    { id: "t-a3", hall_id: "h-arch", number: 3, capacity: 6, is_active: false },
  ] },
];

describe("SettingsPlacesPage — inactive lifecycle", () => {
  beforeEach(() => { mockList(ARCHIVE_HALLS); });

  it("requests the archive: Places listing sends include_inactive=true", async () => {
    renderPage();
    await screen.findByText("Зал");
    expect(settingsService.listPlaces).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ include_inactive: true }) }));
  });

  it("shows inactive halls with a textual status, not colour alone", async () => {
    renderPage();
    await screen.findByText("Архив");
    const row = screen.getByText("Архив").closest(".settings-place");
    expect(within(row).getByText("Неактивен")).toBeInTheDocument();
    expect(row.querySelector(".settings-status-badge__dot")).toBeInTheDocument();
    const live = screen.getByText("Зал").closest(".settings-place");
    expect(within(live).getByText("Активен")).toBeInTheDocument();
    expect(live.querySelector(".settings-status-badge__dot")).toBeInTheDocument();
    // Phase 5C-5.5: archived rows use the same canonical trash action as every
    // other Hall row; reactivation remains available through the edit switch.
    expect(within(row).queryByRole("button", { name: "Активировать место" })).toBeNull();
    const remove = within(row).getByRole("button", { name: "Удалить место" });
    expect(remove.querySelector(".lucide-trash-2")).toBeInTheDocument();
  });

  it("hall count reflects ACTIVE tables only even though the archive is loaded", async () => {
    renderPage();
    await screen.findByText("Зал");
    // h-live has 1 active + 1 archived table
    expect(screen.getByText("1 стол")).toBeInTheDocument();
    // h-arch has 2 archived tables and no active ones
    expect(screen.getByText("0 столов")).toBeInTheDocument();
  });

  it("inactive tables are listed and individually reactivatable", async () => {
    await enterHall("Зал");
    expect(screen.getByText("№1")).toBeInTheDocument();
    expect(screen.getByText("№2")).toBeInTheDocument();
    const rows = document.querySelectorAll(".settings-tbl__row:not(.settings-tbl__head)");
    expect(rows).toHaveLength(2);
    // the archived one exposes reactivate; the active one exposes deactivate
    expect(screen.getByRole("button", { name: "Активировать стол" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Деактивировать стол" })).toBeInTheDocument();
  });

  it("deletes a hall via the confirm modal and refetches", async () => {
    renderPage();
    await screen.findByText("Зал");
    const row = screen.getByText("Зал").closest(".settings-place");
    fireEvent.click(within(row).getByRole("button", { name: "Удалить место" }));
    await screen.findByRole("heading", { name: "Удалить место?" });
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deactivatePlace).toHaveBeenCalledWith("h-live"));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });

  it("inactive-row trash also uses the confirm modal + canonical delete", async () => {
    renderPage();
    await screen.findByText("Архив");
    const row = screen.getByText("Архив").closest(".settings-place");
    fireEvent.click(within(row).getByRole("button", { name: "Удалить место" }));
    await screen.findByRole("heading", { name: "Удалить место?" });
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deactivatePlace).toHaveBeenCalledWith("h-arch"));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
    expect(settingsService.updatePlace).not.toHaveBeenCalled();
  });

  // §19: the backend deliberately does NOT resurrect child tables, so the UI
  // must render the refetched truth rather than an optimistic restore.
  it("hall reactivation never optimistically reactivates its tables", async () => {
    settingsService.listPlaces
      .mockImplementationOnce(() => Promise.resolve({ data: ARCHIVE_HALLS }))
      .mockImplementation(() => Promise.resolve({ data: [
        ARCHIVE_HALLS[0],
        { ...ARCHIVE_HALLS[1], is_active: true },
    ] }));
    renderPage();
    await screen.findByText("Архив");
    const row = screen.getByText("Архив").closest(".settings-place");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    const form = document.querySelector(".settings-form");
    const toggle = form.querySelector(".settings-switch input[type=checkbox]");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledWith(
      "h-arch", expect.objectContaining({ is_active: true })));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const row = screen.getByText("Архив").closest(".settings-place");
      expect(within(row).getByText("Активен")).toBeInTheDocument();
    });
    // both tables are still archived → the active count stayed at zero
    expect(screen.getAllByText("0 столов").length).toBeGreaterThan(0);
    // and nothing tried to flip a table
    expect(settingsService.updatePlaceTable).not.toHaveBeenCalled();
  });
});

describe("SettingsPlacesPage — inactive hall tables subview", () => {
  beforeEach(() => { mockList(ARCHIVE_HALLS); });

  it("keeps table creation blocked without an inactive warning banner or CTA", async () => {
    await enterHall("Архив");
    const addTable = screen.getByRole("button", { name: "Добавить стол" });
    expect(addTable).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Добавить стол" })).toHaveLength(1);
    expect(document.querySelector(".settings-inactive-note")).toBeNull();
    expect(screen.queryByText(/Место неактивно/)).toBeNull();
    expect(screen.queryByText(/Сначала активируйте место/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Активировать место" })).toBeNull();
  });

  it("archived tables stay visible but their reactivation control is disabled", async () => {
    await enterHall("Архив");
    expect(screen.getByText("№1")).toBeInTheDocument();
    expect(screen.getByText("№3")).toBeInTheDocument();
    screen.getAllByRole("button", { name: "Активировать стол" }).forEach((button) => {
      expect(button).toBeDisabled();
    });
    expect(settingsService.updatePlaceTable).not.toHaveBeenCalled();
  });

  it("reactivates a table under an ACTIVE hall via PATCH is_active", async () => {
    await enterHall("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Активировать стол" }));
    await waitFor(() => expect(settingsService.updatePlaceTable).toHaveBeenCalledWith(
      "h-live", "t-l2", { is_active: true }));
    await waitFor(() => expect(settingsService.listPlaces).toHaveBeenCalledTimes(2));
  });
});

describe("SettingsPlacesPage — 409 handling", () => {
  it("shows the duplicate-number conflict on the form and keeps the input", async () => {
    mockList(ARCHIVE_HALLS);
    settingsService.createPlaceTable.mockRejectedValueOnce(
      conflict("Стол с таким номером уже существует в этом месте"));
    await enterHall("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить стол" }));
    fireEvent.change(screen.getByPlaceholderText("Введите номер"), { target: { value: "7" } });
    fireEvent.click(document.querySelector(".settings-form__footer button[type=submit]"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Стол с таким номером уже существует в этом месте");
    // raw axios noise never reaches the UI
    expect(document.body.textContent).not.toContain("AxiosError");
    expect(document.body.textContent).not.toContain("status code 409");
    // the modal stays open with the entered value intact
    const number = screen.getByPlaceholderText("Введите номер");
    expect(number).toHaveValue("7");
    // the conflict is tied to the number field, and clears as soon as it changes
    expect(number).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(number, { target: { value: "8" } });
    expect(number).not.toHaveAttribute("aria-invalid");
  });

  it("does not mislabel a non-duplicate 409 as a duplicate number", async () => {
    mockList(ARCHIVE_HALLS);
    settingsService.updatePlaceTable.mockRejectedValueOnce(
      conflict("Место неактивно — сначала активируйте место"));
    await enterHall("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    fireEvent.click(document.querySelector(".settings-form__footer button[type=submit]"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Место неактивно — сначала активируйте место");
    expect(alert).not.toHaveTextContent("уже существует");
    // and it is NOT attributed to the number field
    const number = document.querySelector(".settings-form input[placeholder='Введите номер']")
      || screen.getByText("Номер стола").parentElement.querySelector("input");
    expect(number).not.toHaveAttribute("aria-invalid");
  });

  it("surfaces the branch conflict from a failed hall reactivation", async () => {
    mockList(ARCHIVE_HALLS);
    settingsService.updatePlace.mockRejectedValueOnce(conflict("Филиал неактивен"));
    renderPage();
    await screen.findByText("Архив");
    const row = screen.getByText("Архив").closest(".settings-place");
    fireEvent.click(within(row).getByRole("button", { name: "Редактировать" }));
    const form = document.querySelector(".settings-form");
    fireEvent.click(form.querySelector(".settings-switch input[type=checkbox]"));
    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Филиал неактивен");
    expect(document.body.textContent).not.toContain("AxiosError");
  });

  it("surfaces «Укажите филиал» from a failed create without inventing a branch", async () => {
    settingsService.createPlace.mockRejectedValueOnce(conflict("Укажите филиал"));
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Новое" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Укажите филиал");
  });
});

describe("SettingsPlacesPage — branch UX", () => {
  it("single active branch → no selector, and branch_id is omitted", async () => {
    mockBranches(ONE_BRANCH);
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    expect(branchTrigger()).toBeNull();
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Терраса" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    // the backend resolves the sole active branch server-side
    expect(settingsService.createPlace.mock.calls[0][0]).not.toHaveProperty("branch_id");
  });

  it("multiple active branches → selector required, canonical Branch.id sent", async () => {
    mockBranches(TWO_BRANCHES);
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    expect(within(form).getByText("Филиал")).toBeInTheDocument();
    expect(branchTrigger()).not.toBeNull();
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "VIP" } });

    // submitting without a choice is refused locally — no silent branches[0]
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Выберите филиал");
    expect(settingsService.createPlace).not.toHaveBeenCalled();

    fireEvent.click(branchTrigger());
    fireEvent.click(screen.getByRole("option", { name: "Второй филиал" }));
    expect(branchTrigger().textContent).toBe("Второй филиал");
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "VIP", branch_id: "b-second" })));
    // identity is the canonical UUID, never an array index
    const { branch_id: sent } = settingsService.createPlace.mock.calls[0][0];
    expect(sent).toBe("b-second");
    expect(Number.isInteger(Number(sent))).toBe(false);
  });

  it("inactive branches are not offered", async () => {
    mockBranches([...TWO_BRANCHES, { id: "b-dead", name: "Закрытый филиал", is_active: false }]);
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    fireEvent.click(branchTrigger());
    const panel = document.querySelector("#hall-branch-select-listbox");
    expect(within(panel).queryByRole("option", { name: "Закрытый филиал" })).toBeNull();
    expect(within(panel).getByRole("option", { name: "Второй филиал" })).toBeInTheDocument();
  });

  it("zero branches → no selector, no fabricated branch, backend stays authoritative", async () => {
    mockBranches([]);
    settingsService.createPlace.mockRejectedValueOnce(
      conflict("Не настроен филиал. Создайте филиал, чтобы добавить место."));
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Добавить место" }));
    const form = document.querySelector(".settings-form");
    expect(branchTrigger()).toBeNull();
    fireEvent.change(within(form).getByPlaceholderText("Введите название места"), { target: { value: "Зал 2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(settingsService.createPlace).toHaveBeenCalledTimes(1));
    expect(settingsService.createPlace.mock.calls[0][0]).not.toHaveProperty("branch_id");
    expect(await screen.findByRole("alert")).toHaveTextContent("Не настроен филиал");
  });

  // HallUpdate has no branch_id, so edit mode must not offer reassignment.
  it("edit mode never offers branch reassignment", async () => {
    mockBranches(TWO_BRANCHES);
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    const form = document.querySelector(".settings-form");
    expect(branchTrigger()).toBeNull();
    // shown read-only for context only
    expect(within(form).getByText(/Филиал:/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updatePlace).toHaveBeenCalledTimes(1));
    expect(settingsService.updatePlace.mock.calls[0][1]).not.toHaveProperty("branch_id");
  });
});

// ── Phase 5C-6B: branch-scoped drag-and-drop ordering ──────────────────────
// jsdom cannot perform a real pixel drag (dnd-kit needs layout rects the
// happy-path browser oracle provides), so these cover the structure, the
// branch isolation, the grip affordance, and that non-drag interactions never
// touch the reorder endpoint. The actual drag→payload→optimistic→rollback flow
// is exercised in tools/browser/settings-places.spec.js (contract replay).

describe("applyBranchOrder (optimistic reorder merge)", () => {
  const A = { id: "A", branch_id: "b1" };
  const B = { id: "B", branch_id: "b1" };
  const C = { id: "C", branch_id: "b1" };
  const D = { id: "D", branch_id: "b1" };

  it("reorders a branch block in place (A B C D → A D B C)", () => {
    const out = applyBranchOrder([A, B, C, D], "b1", [A, D, B, C]);
    expect(out.map((h) => h.id)).toEqual(["A", "D", "B", "C"]);
  });

  it("never moves halls of OTHER branches", () => {
    const X = { id: "X", branch_id: "b2" };
    const Y = { id: "Y", branch_id: "b2" };
    // Interleaved input; b1 block is replaced contiguously, b2 kept intact.
    const out = applyBranchOrder([A, X, B, Y], "b1", [B, A]);
    const b2 = out.filter((h) => h.branch_id === "b2").map((h) => h.id);
    expect(b2).toEqual(["X", "Y"]);
    expect(out.filter((h) => h.branch_id === "b1").map((h) => h.id)).toEqual(["B", "A"]);
  });
});
// DND_APPEND

describe("SettingsPlacesPage — DnD structure & isolation", () => {
  beforeEach(() => {
    mockList(HALLS);
    mockBranches(ONE_BRANCH);
  });

  it("renders halls in backend order with a reorder grip per row", async () => {
    renderPage();
    await screen.findByText("Зал");
    const names = Array.from(document.querySelectorAll(".settings-place__name")).map((n) => n.textContent);
    expect(names).toEqual(["Зал", "Бар", "Балкон"]);
    // Each row exposes an accessible, keyboard-focusable reorder handle.
    for (const name of ["Зал", "Бар", "Балкон"]) {
      expect(screen.getByRole("button", { name: `Переместить место: ${name}` })).toBeInTheDocument();
    }
  });

  it("single branch → one sortable group, no branch label", async () => {
    renderPage();
    await screen.findByText("Зал");
    expect(document.querySelectorAll(".settings-places-group").length).toBe(1);
    expect(document.querySelector(".settings-places-group__label")).toBeNull();
  });

  it("clicking a row still navigates to Tables and never reorders", async () => {
    renderPage();
    const probe = screen.getByTestId("location-search");
    fireEvent.click(await screen.findByRole("button", { name: "Открыть столы: Бар" }));
    await waitFor(() => expect(probe.textContent).toContain("hall_id=h-bar"));
    expect(settingsService.reorderPlaces).not.toHaveBeenCalled();
  });

  it("Редактировать opens the editor and never reorders", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    await screen.findByRole("heading", { name: "Редактировать место" });
    expect(settingsService.reorderPlaces).not.toHaveBeenCalled();
  });

  it("Trash opens the delete modal and never reorders", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить место" })[0]);
    await screen.findByRole("heading", { name: "Удалить место?" });
    expect(settingsService.reorderPlaces).not.toHaveBeenCalled();
  });
});

describe("SettingsPlacesPage — DnD inactive + multi-branch", () => {
  it("inactive hall row is still draggable and keeps its status (no restore control)", async () => {
    mockList([
      { id: "h-on", name: "Активный", is_active: true, branch_id: "b-main", percent: null, tables: [] },
      { id: "h-off", name: "Архивный", is_active: false, branch_id: "b-main", percent: null, tables: [] },
    ]);
    mockBranches(ONE_BRANCH);
    renderPage();
    await screen.findByText("Архивный");
    // Grip present on the archived row → it participates in ordering.
    expect(screen.getByRole("button", { name: "Переместить место: Архивный" })).toBeInTheDocument();
    const offRow = document.querySelector(".settings-place.is-inactive");
    expect(offRow).not.toBeNull();
    expect(within(offRow).getByText("Неактивен")).toBeInTheDocument();
    // No restore/reactivate control returns to the main inactive row.
    expect(within(offRow).queryByRole("button", { name: "Активировать место" })).toBeNull();
  });

  it("multiple branches → isolated groups with labels, halls never mixed", async () => {
    mockList([
      { id: "a1", name: "A1", is_active: true, branch_id: "b-main", percent: null, tables: [] },
      { id: "a2", name: "A2", is_active: true, branch_id: "b-main", percent: null, tables: [] },
      { id: "b1", name: "B1", is_active: true, branch_id: "b-second", percent: null, tables: [] },
      { id: "b2", name: "B2", is_active: true, branch_id: "b-second", percent: null, tables: [] },
    ]);
    mockBranches(TWO_BRANCHES);
    renderPage();
    await screen.findByText("A1");
    const groups = document.querySelectorAll(".settings-places-group");
    expect(groups.length).toBe(2);
    // Labels disambiguate the two branches.
    const labels = Array.from(document.querySelectorAll(".settings-places-group__label")).map((l) => l.textContent);
    expect(labels).toEqual(["Основной филиал", "Второй филиал"]);
    // Each group contains only its own branch's halls (no cross-branch mixing).
    const g0 = Array.from(groups[0].querySelectorAll(".settings-place__name")).map((n) => n.textContent);
    const g1 = Array.from(groups[1].querySelectorAll(".settings-place__name")).map((n) => n.textContent);
    expect(g0).toEqual(["A1", "A2"]);
    expect(g1).toEqual(["B1", "B2"]);
  });
});

// ── Phase 5C-6D: delete confirmation modal + user-select ───────────────────

describe("SettingsPlacesPage — delete confirmation modal", () => {
  beforeEach(() => {
    mockList(HALLS);
    mockBranches(ONE_BRANCH);
  });

  async function openDeleteModal(name = "Зал") {
    renderPage();
    await screen.findByText(name);
    const row = screen.getByText(name).closest(".settings-place");
    fireEvent.click(within(row).getByRole("button", { name: "Удалить место" }));
    await screen.findByRole("heading", { name: "Удалить место?" });
  }

  it("Trash opens the modal without calling the API or navigating", async () => {
    await openDeleteModal("Зал");
    expect(settingsService.deactivatePlace).not.toHaveBeenCalled();
    expect(screen.getByText(/Вы уверены, что хотите удалить/)).toBeInTheDocument();
    expect(screen.getByTestId("location-search").textContent).not.toContain("hall_id");
  });

  it("Отмена closes the modal and changes nothing", async () => {
    await openDeleteModal("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Удалить место?" })).toBeNull());
    expect(settingsService.deactivatePlace).not.toHaveBeenCalled();
    expect(screen.getByText("Зал")).toBeInTheDocument();
  });

  it("Escape closes the modal without deleting", async () => {
    await openDeleteModal("Зал");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Удалить место?" })).toBeNull());
    expect(settingsService.deactivatePlace).not.toHaveBeenCalled();
  });

  it("backdrop click closes the modal without deleting", async () => {
    await openDeleteModal("Зал");
    fireEvent.click(document.querySelector(".settings-drawer__backdrop"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Удалить место?" })).toBeNull());
    expect(settingsService.deactivatePlace).not.toHaveBeenCalled();
  });

  it("confirm sends exactly one delete then refetches and removes the row", async () => {
    settingsService.listPlaces
      .mockResolvedValueOnce({ data: HALLS })
      .mockResolvedValue({ data: HALLS.filter((h) => h.id !== "h-zal") });
    await openDeleteModal("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deactivatePlace).toHaveBeenCalledWith("h-zal"));
    expect(settingsService.deactivatePlace).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Зал")).toBeNull());
    expect(screen.getByText("Бар")).toBeInTheDocument();
  });

  it("failure keeps the modal open, shows a normalized error, preserves the hall", async () => {
    settingsService.deactivatePlace.mockRejectedValueOnce(conflict("Место занято активным заказом"));
    await openDeleteModal("Зал");
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await screen.findByText("Место занято активным заказом");
    // Modal stays open, hall still present, no AxiosError leak.
    expect(screen.getByRole("heading", { name: "Удалить место?" })).toBeInTheDocument();
    expect(screen.getByText("Зал", { selector: ".settings-place__name" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("AxiosError");
    // Button usable again (not stuck disabled) after failure.
    expect(screen.getByRole("button", { name: "Удалить", exact: true })).toBeEnabled();
  });

  it("prevents double-submit while the delete is in flight", async () => {
    let release;
    settingsService.deactivatePlace.mockImplementation(() => new Promise((r) => { release = r; }));
    await openDeleteModal("Зал");
    const button = screen.getByRole("button", { name: "Удалить", exact: true });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(settingsService.deactivatePlace).toHaveBeenCalledTimes(1));
    release({ data: {} });
  });

  it("does not affect the Edit modal", async () => {
    renderPage();
    await screen.findByText("Зал");
    fireEvent.click(screen.getAllByRole("button", { name: "Редактировать" })[0]);
    await screen.findByRole("heading", { name: "Редактировать место" });
    // The delete confirm is a separate dialog and is not shown.
    expect(screen.queryByRole("heading", { name: "Удалить место?" })).toBeNull();
  });

  it("owns non-selectable row text in CSS (user-select: none on .settings-place)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/owner/settings.css", "utf8");
    const rule = css.match(/\.settings-place\s*\{[^}]*\}/s);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/user-select:\s*none/);
  });

  it("no longer shows the history reassurance line", async () => {
    await openDeleteModal("Зал");
    expect(screen.queryByText(/История заказов и данных будет сохранена/)).toBeNull();
    expect(document.querySelector(".settings-confirm__hint")).toBeNull();
    // The question itself and both CTAs stay.
    expect(screen.getByText(/Вы уверены, что хотите удалить/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отмена" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();
  });

  it("is vertically compact: tighter shell metrics than the Add/Edit modal", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/owner/settings.css", "utf8");
    const confirm = css.match(/\.settings-owner-view \.settings-confirm \{[^}]*\}/s);
    expect(confirm).not.toBeNull();
    // Own padding/gap, smaller than the shared .settings-modal (22px / 16px).
    expect(confirm[0]).toMatch(/padding:\s*18px 20px/);
    expect(confirm[0]).toMatch(/gap:\s*10px/);
    // Header chrome is scaled down too, and the removed hint leaves no gap.
    expect(css).toMatch(/\.settings-confirm \.settings-accent-bar \{\s*height:\s*34px/);
    expect(css).toMatch(/\.settings-confirm \.settings-form__body \{\s*gap:\s*0/);
    // The animation family is untouched.
    expect(confirm[0]).not.toMatch(/animation/);
  });
});
