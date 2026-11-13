import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsService } from "../../api/settings";
import SettingsPaymentMethodsPage, {
  formToPayload,
  mapRow,
  paymentTypeLabel,
  resetPaymentMethodsCacheForTest,
} from "./SettingsPaymentMethodsPage";

vi.mock("../../api/settings", () => ({
  settingsService: {
    listResource: vi.fn(),
    createResource: vi.fn(() => Promise.resolve({ data: { id: "new", name: "Новый", type: "cash", sort: 9, status: true } })),
    updateResource: vi.fn(() => Promise.resolve({ data: {} })),
    deleteResource: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// Fixtures mirror the real /finance/payment-types response contract: canonical
// `type` codes, `sort`/`status` with owner-app `sort_order`/`is_active` mirrors.
const METHODS = [
  { id: "m-cash", name: "Касса", type: "cash", sort: 1, status: true, sort_order: 1, is_active: true },
  { id: "m-card", name: "Банк-карта", type: "card", sort: 2, status: true, sort_order: 2, is_active: true },
  { id: "m-payme", name: "Онлайн-оплата", type: "payme", sort: 3, status: false, sort_order: 3, is_active: false },
  { id: "m-legacy", name: "Старый VIP", type: "vip_legacy", sort: 4, status: true },
];

function mockList(items) {
  settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items } }));
}

function conflict(detail) {
  return Object.assign(new Error("Request failed with status code 409"), {
    name: "AxiosError",
    response: { status: 409, data: detail ? { detail } : {} },
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/settings/payment-methods"]}>
      <SettingsPaymentMethodsPage />
    </MemoryRouter>,
  );
}

// Session cache is module state: reset between tests so each starts with no cache.
beforeEach(() => {
  resetPaymentMethodsCacheForTest();
});

describe("payment-method helpers (canonical contract)", () => {
  it("maps canonical codes to Russian labels and passes unknown values through", () => {
    expect(paymentTypeLabel("cash")).toBe("Наличные");
    expect(paymentTypeLabel("card")).toBe("Карта");
    expect(paymentTypeLabel("payme")).toBe("Payme");
    expect(paymentTypeLabel("click")).toBe("Click");
    expect(paymentTypeLabel("uzum")).toBe("Uzum");
    expect(paymentTypeLabel("loyalty")).toBe("Лояльность");
    expect(paymentTypeLabel("mixed")).toBe("Смешанный");
    // Unknown / legacy value renders raw, never crashes.
    expect(paymentTypeLabel("vip_legacy")).toBe("vip_legacy");
    expect(paymentTypeLabel("")).toBe("—");
    expect(paymentTypeLabel(null)).toBe("—");
  });

  it("maps a backend row reading sort/status (and their owner-app mirrors)", () => {
    expect(mapRow({ id: "1", name: "Карта", type: "card", sort: 2, status: false })).toEqual({
      id: "1", name: "Карта", type: "card", sort: 2, active: false, isSystem: false,
    });
    expect(mapRow({ id: "2", name: "Наличные", type: "cash", sort_order: 5, is_active: true })).toEqual({
      id: "2", name: "Наличные", type: "cash", sort: 5, active: true, isSystem: false,
    });
  });

  it("builds a canonical payload and rejects invalid input without an API call", () => {
    expect(formToPayload({ sort: "3", name: " Карта ", type: "card", active: true })).toEqual({
      name: "Карта", sort: 3, type: "card", status: true,
    });
    expect(formToPayload({ sort: "1", name: "X", type: "", active: false })).toEqual({
      name: "X", sort: 1, type: null, status: false,
    });
    expect(formToPayload({ sort: "abc", name: "X", type: "cash", active: true })).toBeNull();
    expect(formToPayload({ sort: "1", name: "   ", type: "cash", active: true })).toBeNull();
  });
});

describe("SettingsPaymentMethodsPage — states", () => {
  beforeEach(() => {
    settingsService.listResource.mockReset();
  });

  it("renders the Staff/Reports header (kicker, title, primary button)", async () => {
    mockList(METHODS);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Способ оплаты" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить способ оплаты" })).toBeInTheDocument();
  });

  it("shows a loading state and never flashes the empty state while loading", async () => {
    let resolve;
    settingsService.listResource.mockImplementation(
      () => new Promise((r) => { resolve = () => r({ data: { items: METHODS } }); }),
    );
    renderPage();
    expect(screen.getByText("Загрузка...")).toBeInTheDocument();
    expect(screen.queryByText("Способов оплаты пока нет")).toBeNull();
    resolve();
    expect(await screen.findByText("Касса")).toBeInTheDocument();
  });

  it("shows the canonical PNG empty state (title only, no guidance/controls)", async () => {
    mockList([]);
    const { container } = renderPage();
    expect(await screen.findByText("Способов оплаты пока нет")).toBeInTheDocument();
    // Guidance line is intentionally removed (Reports-style: title only).
    expect(screen.queryByText(/Добавьте первый способ оплаты/)).toBeNull();
    expect(container.querySelector(".owner-report-empty-image")).not.toBeNull();
    // No fabricated demo methods leak into an empty backend list.
    expect(screen.queryByText("NAXT")).toBeNull();
    expect(screen.queryByText("UzumBank")).toBeNull();
    // Staff-family empty table: header row stays visible, tbody holds only
    // the PNG empty cell (no fabricated rows).
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Сорт")).toBeInTheDocument();
    // Exactly ONE primary Add action (header) — no duplicate CTA in the panel.
    expect(screen.getAllByRole("button", { name: "Добавить способ оплаты" })).toHaveLength(1);
    // Search + type filter controls are gone entirely.
    expect(screen.queryByLabelText("Поиск способа оплаты")).toBeNull();
    expect(screen.queryByLabelText("Фильтр по типу")).toBeNull();
  });

  it("shows an error (with retry) on load failure and does not turn it into an empty list", async () => {
    settingsService.listResource.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { data: { detail: "Сервис недоступен" } } }),
    );
    renderPage();
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(screen.queryByText("Способов оплаты пока нет")).toBeNull();
    mockList(METHODS);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Касса")).toBeInTheDocument();
  });
});

describe("SettingsPaymentMethodsPage — table & type/status presentation", () => {
  beforeEach(() => mockList(METHODS));

  it("renders columns Сорт | Название | Статус | Действия as plain text (sort is not an input)", async () => {
    renderPage();
    const cashName = await screen.findByText("Касса");
    const row = cashName.closest("tr");
    // Sort is rendered as plain text, never a readOnly <input>.
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(within(row).getByText("1")).toBeInTheDocument();
    // Edit + delete actions are present and labelled.
    expect(within(row).getByRole("button", { name: /Редактировать/ })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /Удалить/ })).toBeInTheDocument();
  });

  it("shows no type column and lets a default method change status without deletion", async () => {
    mockList([{ id: "builtin", name: "Наличными", type: "cash", sort: 1, status: true, is_system: true }]);
    settingsService.updateResource.mockResolvedValueOnce({
      data: { id: "company-copy", name: "Наличными", sort: 1, type: "cash", status: false, is_system: true },
    });
    renderPage();
    const toggle = await screen.findByRole("switch", { name: "Наличными" });
    expect(screen.queryByRole("columnheader", { name: "Тип" })).toBeNull();
    expect(within(toggle.closest("tr")).queryByRole("button", { name: /Удалить/ })).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Наличными" })).not.toBeChecked());
    expect(settingsService.updateResource).toHaveBeenCalledWith("paymentMethods", "builtin", { status: false });
  });

  it("shows Активен / Неактивен status badges (text, not colour alone)", async () => {
    renderPage();
    await screen.findByText("Касса");
    const activeRow = screen.getByText("Касса").closest("tr");
    expect(within(activeRow).getByText("Активен")).toBeInTheDocument();
    const inactiveRow = screen.getByText("Онлайн-оплата").closest("tr");
    expect(within(inactiveRow).getByText("Неактивен")).toBeInTheDocument();
  });

  it("shows a coloured status dot alongside the status text", async () => {
    renderPage();
    await screen.findByText("Касса");
    const activeRow = screen.getByText("Касса").closest("tr");
    const badge = within(activeRow).getByText("Активен").closest(".settings-status-badge");
    expect(badge.querySelector(".settings-status-badge__dot")).not.toBeNull();
  });

  it("renders no search or type-filter controls above the table", async () => {
    renderPage();
    await screen.findByText("Касса");
    expect(screen.queryByLabelText("Поиск способа оплаты")).toBeNull();
    expect(screen.queryByLabelText("Фильтр по типу")).toBeNull();
  });
});

describe("SettingsPaymentMethodsPage — create & edit", () => {
  beforeEach(() => mockList(METHODS));

  it("presents create/edit as a centered modal that closes on Отмена", async () => {
    renderPage();
    await screen.findByText("Касса");
    fireEvent.click(screen.getByRole("button", { name: "Добавить способ оплаты" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("settings-modal");
    expect(screen.getByRole("heading", { name: "Добавить способ оплаты" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(settingsService.createResource).not.toHaveBeenCalled();
  });

  it("creates a method without a visible type field", async () => {
    renderPage();
    await screen.findByText("Касса");
    fireEvent.click(screen.getByRole("button", { name: "Добавить способ оплаты" }));
    expect(screen.queryByRole("combobox", { name: "Тип" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Сорт"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Терминал" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledWith("paymentMethods", {
      name: "Терминал", sort: 7, type: null, status: true,
    }));
  });

  it("legacy edit saved WITHOUT touching type preserves the original raw value", async () => {
    renderPage();
    await screen.findByText("Касса");
    const legacyRow = screen.getByText("Старый VIP").closest("tr");
    fireEvent.click(within(legacyRow).getByRole("button", { name: /Редактировать/ }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalled());
    expect(settingsService.updateResource).toHaveBeenCalledWith("paymentMethods", "m-legacy", {
      name: "Старый VIP", sort: 4, type: "vip_legacy", status: true,
    });
  });

  it("edits an existing method through the same drawer with prefilled fields", async () => {
    renderPage();
    await screen.findByText("Касса");
    const cardRow = screen.getByText("Банк-карта").closest("tr");
    fireEvent.click(within(cardRow).getByRole("button", { name: /Редактировать/ }));
    const nameInput = screen.getByLabelText("Название");
    expect(nameInput).toHaveValue("Банк-карта");
    fireEvent.change(nameInput, { target: { value: "Карта банка" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalled());
    expect(settingsService.updateResource).toHaveBeenCalledWith("paymentMethods", "m-card", {
      name: "Карта банка", sort: 2, type: "card", status: true,
    });
  });
});

describe("SettingsPaymentMethodsPage — delete safety", () => {
  beforeEach(() => mockList(METHODS));

  it("does not call DELETE on trash click — a confirmation modal appears first", async () => {
    renderPage();
    await screen.findByText("Касса");
    const cashRow = screen.getByText("Касса").closest("tr");
    fireEvent.click(within(cashRow).getByRole("button", { name: /Удалить «Касса»/ }));
    expect(screen.getByRole("heading", { name: "Удалить способ оплаты?" })).toBeInTheDocument();
    expect(settingsService.deleteResource).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation makes no API delete call", async () => {
    renderPage();
    await screen.findByText("Касса");
    const cashRow = screen.getByText("Касса").closest("tr");
    fireEvent.click(within(cashRow).getByRole("button", { name: /Удалить «Касса»/ }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("heading", { name: "Удалить способ оплаты?" })).toBeNull();
    expect(settingsService.deleteResource).not.toHaveBeenCalled();
    expect(screen.getByText("Касса")).toBeInTheDocument();
  });

  it("confirming calls the real delete API and removes the row on success", async () => {
    renderPage();
    await screen.findByText("Касса");
    const cashRow = screen.getByText("Касса").closest("tr");
    fireEvent.click(within(cashRow).getByRole("button", { name: /Удалить «Касса»/ }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() =>
      expect(settingsService.deleteResource).toHaveBeenCalledWith("paymentMethods", "m-cash"),
    );
    await waitFor(() => expect(screen.queryByText("Касса")).toBeNull());
  });

  it("keeps the row and shows the deactivate hint when the backend rejects with 409", async () => {
    settingsService.deleteResource.mockRejectedValueOnce(conflict());
    renderPage();
    await screen.findByText("Касса");
    const cashRow = screen.getByText("Касса").closest("tr");
    fireEvent.click(within(cashRow).getByRole("button", { name: /Удалить «Касса»/ }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(settingsService.deleteResource).toHaveBeenCalled());
    expect(
      await screen.findByText(/используется и не может быть удалён/),
    ).toBeInTheDocument();
    // Row was NOT optimistically removed.
    expect(screen.getByText("Касса")).toBeInTheDocument();
  });
});

describe("SettingsPaymentMethodsPage - session cache (stale-while-revalidate)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  function deferredList() {
    let resolveGet;
    const promise = new Promise((resolve) => { resolveGet = resolve; });
    settingsService.listResource.mockImplementation(() => promise);
    return (data) => resolveGet({ data });
  }

  it("CASE A - first visit with no cache shows truthful loading", async () => {
    const resolveGet = deferredList();
    renderPage();
    expect(await screen.findByText("Загрузка...")).toBeInTheDocument();
    expect(screen.queryByText("Касса")).not.toBeInTheDocument();
    resolveGet({ items: METHODS });
    expect(await screen.findByText("Касса")).toBeInTheDocument();
  });

  it("CASE B - revisit after rows success renders instantly, no flash, background GET runs", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items: METHODS } }));
    const first = renderPage();
    expect(await first.findByText("Касса")).toBeInTheDocument();
    expect(settingsService.listResource).toHaveBeenCalledTimes(1);
    first.unmount();
    // Second mount: slow backend this time - cached rows must already be there.
    const resolveGet = deferredList();
    renderPage();
    expect(screen.queryByText("Загрузка...")).toBeNull();
    expect(screen.getByText("Касса")).toBeInTheDocument();
    resolveGet({ items: METHODS });
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Касса")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("CASE C - revisit after empty success shows PNG empty state instantly (header + cell)", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items: [] } }));
    const first = renderPage();
    expect(await first.findByText("Способов оплаты пока нет")).toBeInTheDocument();
    first.unmount();
    const resolveGet = deferredList();
    renderPage();
    // Cached empty array: no flash, empty table present immediately.
    expect(screen.queryByText("Загрузка...")).toBeNull();
    expect(screen.getByText("Способов оплаты пока нет")).toBeInTheDocument();
    expect(screen.getByText("Сорт")).toBeInTheDocument();
    const emptyCell = document.querySelector("td.pm-empty-cell");
    expect(emptyCell).not.toBeNull();
    expect(emptyCell.getAttribute("colspan")).toBe("4");
    resolveGet({ items: [] });
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Способов оплаты пока нет")).toBeInTheDocument();
  });

  it("CASE D - revisit with failed refresh keeps cached rows + banner, next visit reconciles", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items: METHODS } }));
    const first = renderPage();
    expect(await first.findByText("Касса")).toBeInTheDocument();
    first.unmount();
    // Second mount: backend now fails - cached rows stay, refresh banner appears.
    settingsService.listResource.mockRejectedValueOnce(new Error("boom"));
    const second = renderPage();
    expect(second.queryByText("Загрузка...")).toBeNull();
    expect(second.getByText("Касса")).toBeInTheDocument();
    expect(await second.findByText("Не удалось обновить способы оплаты.")).toBeInTheDocument();
    expect(second.container.querySelector(".settings-form__error")).not.toBeNull();
    expect(second.getByText("Касса")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    second.unmount();
    // Next visit: refresh succeeds - truth stays on screen.
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items: METHODS } }));
    const third = renderPage();
    expect(third.getByText("Касса")).toBeInTheDocument();
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(3));
    expect(third.queryByText("Не удалось обновить способы оплаты.")).toBeNull();
  });

  it("CASE E - failed first visit keeps truthful failure: no rows, retry reloads", async () => {
    settingsService.listResource.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText("Не удалось загрузить способы оплаты.")).toBeInTheDocument();
    expect(screen.queryByText("Касса")).toBeNull();
    expect(screen.queryByText("Способов оплаты пока нет")).toBeNull();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: { items: METHODS } }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Касса")).toBeInTheDocument();
  });

  it("uses no browser storage for the session cache", async () => {
    mockList(METHODS);
    renderPage();
    expect(await screen.findByText("Касса")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
