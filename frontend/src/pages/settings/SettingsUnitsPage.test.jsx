import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { settingsService } from "../../api/settings";
import SettingsUnitsPage, { formToPayload, mapRow, resetUnitsCacheForTest } from "./SettingsUnitsPage";

vi.mock("../../api/settings", () => ({
  settingsService: {
    listResource: vi.fn(),
    createResource: vi.fn(() => Promise.resolve({ data: { id: "new" } })),
    updateResource: vi.fn(() => Promise.resolve({ data: {} })),
    deleteResource: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

const UNITS = [
  { id: "u-g", name: "Граммы", short_name: "г", sort: 1, status: true },
  { id: "u-kg", name: "Килограммы", short_name: "кг", sort: 2, status: false },
];

const EXPECTED_HEADERS = ["Сорт", "Название", "Короткое название", "Статус", "Действия"];

function conflict(status, detail) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    name: "AxiosError",
    response: { status, data: { detail } },
  });
}

// Session cache is module state: reset between tests so each starts with no cache.
beforeEach(() => {
  resetUnitsCacheForTest();
});

describe("SettingsUnitsPage — table contract (no mock rows)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
  });

  it("renders header/title with teal Add action, exact 5 columns", async () => {
    render(<SettingsUnitsPage />);
    expect(await screen.findByText("Единица измерения")).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Добавить единицу измерения" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(EXPECTED_HEADERS);
  });

  it("renders real backend rows, never hardcoded demo rows", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: [] }));
    render(<SettingsUnitsPage />);
    expect(await screen.findByText("Единиц измерения пока нет")).toBeInTheDocument();
    expect(screen.queryByText("gramm")).toBeNull();
    expect(screen.queryByText("Порция (пр)")).toBeNull();
  });

  it("maps rows truthfully with dot status badges", async () => {
    render(<SettingsUnitsPage />);
    const row = (await screen.findByText("Граммы")).closest("tr");
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells[1]).toBe("Граммы");
    expect(cells[2]).toBe("г");
    const badge = within(row).getByText("Активен");
    expect(badge.classList.contains("settings-status-badge")).toBe(true);
    expect(badge.querySelector(".settings-status-badge__dot")).not.toBeNull();
    const archived = (await screen.findByText("Килограммы")).closest("tr");
    expect(within(archived).getByText("Неактивен")).toBeInTheDocument();
  });

  it("shows inline sort inputs bound to server values", async () => {
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    const inputs = document.querySelectorAll(".settings-inline-input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("1");
  });

  it("shows loading without premature empty, error without fake empty", async () => {
    let resolveGet;
    settingsService.listResource.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
    render(<SettingsUnitsPage />);
    expect(await screen.findByText("Загрузка...")).toBeInTheDocument();
    expect(screen.queryByText("Единиц измерения пока нет")).not.toBeInTheDocument();
    resolveGet({ data: [] });
    expect(await screen.findByText("Единиц измерения пока нет")).toBeInTheDocument();
    expect(document.querySelector(".owner-report-empty-image")).not.toBeNull();
  });

  it("renders backend failure as error with retry", async () => {
    settingsService.listResource.mockRejectedValueOnce(new Error("offline"));
    render(<SettingsUnitsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.queryByText("Единиц измерения пока нет")).not.toBeInTheDocument();
  });
});

describe("SettingsUnitsPage — add/edit modal contract", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
  });

  it("add modal has exactly Название/Короткое название/Статус, no Сорт", async () => {
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getByRole("button", { name: "Добавить единицу измерения" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Добавить единицу измерения")).toBeInTheDocument();
    expect(within(dialog).getByText("Название")).toBeInTheDocument();
    expect(within(dialog).getByText("Короткое название")).toBeInTheDocument();
    expect(within(dialog).getByText("Статус")).toBeInTheDocument();
    expect(within(dialog).queryByText("Сорт")).toBeNull();
    expect(within(dialog).queryByText("Сорт")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Сохранить" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toBeInTheDocument();
  });

  it("edit modal pre-fills row values with matching title", async () => {
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Редактировать/ })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Редактировать единицу измерения")).toBeInTheDocument();
    const inputs = within(dialog).getAllByRole("textbox");
    expect(inputs[0].value).toBe("Граммы");
    expect(inputs[1].value).toBe("г");
  });

  it("formToPayload includes status and rejects invalid forms", () => {
    expect(formToPayload({ name: "Литр", shortName: "л", active: true })).toEqual({
      name: "Литр",
      short_name: "л",
      status: true,
    });
    expect(formToPayload({ name: "Литр", shortName: "л", active: false }).status).toBe(false);
    expect(formToPayload({ name: "  ", shortName: "л", active: true })).toBeNull();
    expect(formToPayload({ name: "Литр", shortName: "  ", active: true })).toBeNull();
  });

  it("mapRow keeps canonical fields without fabrication", () => {
    expect(mapRow({ id: "x", name: "Шт", short_name: "шт", sort: 3, status: false })).toEqual({
      id: "x",
      sort: 3,
      name: "Шт",
      shortName: "шт",
      active: false,
    });
  });
});

describe("SettingsUnitsPage — truthful 403/409 behavior (no fake persistence)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
  });

  async function openAddAndFill() {
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getByRole("button", { name: "Добавить единицу измерения" }));
    const dialog = await screen.findByRole("dialog");
    const inputs = within(dialog).getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Метр" } });
    fireEvent.change(inputs[1], { target: { value: "м" } });
    return dialog;
  }

  it("403 create keeps modal open with owner-limitation error, adds no row", async () => {
    settingsService.createResource.mockRejectedValueOnce(conflict(403, "Forbidden"));
    const dialog = await openAddAndFill();
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await within(dialog).findByText("Изменение единиц измерения пока недоступно для владельца.")).toBeInTheDocument();
    expect(screen.queryByText("Метр")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("403 edit keeps canonical values, no fake status flip", async () => {
    settingsService.updateResource.mockRejectedValueOnce(conflict(403, "Forbidden"));
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Редактировать/ })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(
      within(dialog).getByText("Изменение единиц измерения пока недоступно для владельца."),
    ).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("403 inline sort reverts to server value with truthful error", async () => {
    settingsService.updateResource.mockRejectedValueOnce(conflict(403, "Forbidden"));
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    const input = document.querySelectorAll(".settings-inline-input")[0];
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    await waitFor(() => expect(
      screen.getAllByText("Изменение единиц измерения пока недоступно для владельца.").length,
    ).toBeGreaterThan(0));
    expect(input.value).toBe("1");
  });

  it("403 delete keeps the row with truthful error", async () => {
    settingsService.deleteResource.mockRejectedValueOnce(conflict(403, "Forbidden"));
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Удалить/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(
      screen.getAllByText("Изменение единиц измерения пока недоступно для владельца.").length,
    ).toBeGreaterThan(0));
    expect(screen.getAllByText("Граммы").length).toBeGreaterThan(0);
  });

  it("delete confirm flow removes only after backend confirm; 409 message ready", async () => {
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Удалить/ })[0]);
    expect(await screen.findByText("Удалить единицу измерения?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByText("Граммы")).not.toBeInTheDocument());
  });

  it("409 delete surfaces the referenced-unit message and keeps the row", async () => {
    settingsService.deleteResource.mockRejectedValueOnce(
      conflict(409, "Единица измерения используется и не может быть удалена."),
    );
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Удалить/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(
      screen.getByText("Единица измерения используется и не может быть удалена."),
    ).toBeInTheDocument());
    expect(screen.getByText("Граммы")).toBeInTheDocument();
  });
});

describe("SettingsUnitsPage — empty table keeps the shell (Payment Methods family)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: [] }));
  });

  it("keeps all 5 headers visible with PNG/title inside tbody, colspan 5", async () => {
    render(<SettingsUnitsPage />);
    expect(await screen.findByText("Единиц измерения пока нет")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(EXPECTED_HEADERS);
    const emptyCell = document.querySelector("td.pm-empty-cell");
    expect(emptyCell).not.toBeNull();
    expect(emptyCell.getAttribute("colspan")).toBe("5");
    expect(emptyCell.querySelector(".owner-report-empty-image")).not.toBeNull();
    // Title lives inside the table body cell.
    expect(within(emptyCell).getByText("Единиц измерения пока нет")).toBeInTheDocument();
  });

  it("has no guidance paragraph and no duplicate Add CTA", async () => {
    render(<SettingsUnitsPage />);
    await screen.findByText("Единиц измерения пока нет");
    expect(screen.queryByText(/Добавьте первую единицу/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Добавить единицу измерения" })).toHaveLength(1);
  });

  it("loading never shows the PNG empty state", async () => {
    let resolveGet;
    settingsService.listResource.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
    render(<SettingsUnitsPage />);
    expect(await screen.findByText("Загрузка...")).toBeInTheDocument();
    expect(document.querySelector(".owner-report-empty-image")).toBeNull();
    resolveGet({ data: [] });
    expect(await screen.findByText("Единиц измерения пока нет")).toBeInTheDocument();
  });
});

describe("SettingsUnitsPage — session cache (stale-while-revalidate, memory only)", () => {
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

  function renderPage() {
    return render(<SettingsUnitsPage />);
  }

  it("first visit with no cache shows truthful loading", async () => {
    const resolveGet = deferredList();
    renderPage();
    expect(await screen.findByText("Загрузка...")).toBeInTheDocument();
    expect(screen.queryByText("Граммы")).toBeNull();
    resolveGet(UNITS);
    expect(await screen.findByText("Граммы")).toBeInTheDocument();
  });

  it("revisit after rows success renders instantly, no flash, background GET runs", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
    const first = renderPage();
    expect(await first.findByText("Граммы")).toBeInTheDocument();
    expect(settingsService.listResource).toHaveBeenCalledTimes(1);
    first.unmount();
    const resolveGet = deferredList();
    renderPage();
    expect(screen.queryByText("Загрузка...")).toBeNull();
    expect(screen.getByText("Граммы")).toBeInTheDocument();
    resolveGet(UNITS);
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Граммы")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("revisit after empty success shows table-shell empty instantly", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: [] }));
    const first = renderPage();
    expect(await first.findByText("Единиц измерения пока нет")).toBeInTheDocument();
    first.unmount();
    const resolveGet = deferredList();
    renderPage();
    expect(screen.queryByText("Загрузка...")).toBeNull();
    expect(screen.getByText("Единиц измерения пока нет")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(EXPECTED_HEADERS);
    resolveGet([]);
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Единиц измерения пока нет")).toBeInTheDocument();
  });

  it("revisit with failed refresh keeps cached rows + banner, next visit reconciles", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
    const first = renderPage();
    expect(await first.findByText("Граммы")).toBeInTheDocument();
    first.unmount();
    settingsService.listResource.mockRejectedValueOnce(new Error("boom"));
    const second = renderPage();
    expect(second.queryByText("Загрузка...")).toBeNull();
    expect(second.getByText("Граммы")).toBeInTheDocument();
    expect(await second.findByText("Не удалось обновить единицы измерения.")).toBeInTheDocument();
    expect(second.getByText("Граммы")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    second.unmount();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
    const third = renderPage();
    expect(third.getByText("Граммы")).toBeInTheDocument();
    await waitFor(() => expect(settingsService.listResource).toHaveBeenCalledTimes(3));
    expect(third.queryByText("Не удалось обновить единицы измерения.")).toBeNull();
  });

  it("failed first visit keeps truthful failure with retry, no fake empty", async () => {
    settingsService.listResource.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText("Не удалось загрузить единицы измерения.")).toBeInTheDocument();
    expect(screen.queryByText("Граммы")).toBeNull();
    expect(screen.queryByText("Единиц измерения пока нет")).toBeNull();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Граммы")).toBeInTheDocument();
  });

  it("uses no browser storage for the session cache", async () => {
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
    renderPage();
    expect(await screen.findByText("Граммы")).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("SettingsUnitsPage — 403 status-toggle truth", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    settingsService.listResource.mockImplementation(() => Promise.resolve({ data: UNITS }));
  });

  it("403 status flip keeps canonical badge, no fake changed status", async () => {
    settingsService.updateResource.mockRejectedValueOnce(conflict(403, "Forbidden"));
    render(<SettingsUnitsPage />);
    await screen.findByText("Граммы");
    fireEvent.click(screen.getAllByRole("button", { name: /Редактировать/ })[0]);
    const dialog = await screen.findByRole("dialog");
    const toggle = dialog.querySelector(".settings-switch input[type=checkbox]");
    fireEvent.click(toggle);
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(
      within(dialog).getByText("Изменение единиц измерения пока недоступно для владельца."),
    ).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("SettingsUnitsPage — visual contract locks", () => {
  it("pins teal accents, journal geometry and column alignment", () => {
    const css = readFileSync(`${process.cwd()}/src/pages/settings/SettingsUnitsPage.css`, "utf8");
    expect(css).toContain("background: #1fc9c9");
    expect(css).toContain("min-width: 640px");
    expect(css).toContain("td:nth-child(1)");
    expect(css).toContain("padding-left: 27px");
    expect(css).toContain("td:nth-child(4)");
    expect(css).toContain("padding-right: 5px");
    expect(css).toContain("justify-content: flex-end");
  });
});
