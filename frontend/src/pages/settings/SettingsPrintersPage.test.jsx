import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsService } from "../../api/settings";
import SettingsPrintersPage, {
  apiMapFormToPayload,
  apiMapRow,
} from "./SettingsPrintersPage";

vi.mock("../../api/settings", () => ({
  settingsService: {
    listResource: vi.fn(),
    createResource: vi.fn(),
    updateResource: vi.fn(),
    deleteResource: vi.fn(),
  },
}));

const SERVER_PRINTERS = [
  { id: "p1", name: "Real One", printer_type: "receipt", connection_type: "network", ip_address: "192.168.1.15", port: 9100, device_path: null, paper_width: 80, branch_id: "b1", zone: "Касса", is_active: true },
  { id: "p2", name: "Real Two", printer_type: "kitchen", connection_type: "network", ip_address: "", port: 9100, device_path: null, paper_width: 80, branch_id: "b1", zone: "", is_active: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  settingsService.listResource.mockResolvedValue({ data: SERVER_PRINTERS });
  settingsService.createResource.mockImplementation(async (resource, payload) => ({ data: { id: "new-1", ...payload } }));
  settingsService.updateResource.mockImplementation(async (resource, id, payload) => ({ data: { id, name: "x", printer_type: "receipt", connection_type: "network", ip_address: "1.1.1.1", port: 9100, is_active: true, ...payload } }));
  settingsService.deleteResource.mockResolvedValue({ data: {} });
});

describe("SettingsPrintersPage (simplified V2)", () => {
  it("renders the header with Add on the right and no search", async () => {
    const { container } = render(<SettingsPrintersPage />);
    expect(await screen.findByRole("heading", { name: "Настройка принтеров" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить принтер/ })).toBeInTheDocument();
    expect(container.querySelector('input[placeholder="Поиск"]')).toBeNull();
    expect(container.querySelector(".settings-page.settings-owner-view.printers-page")).not.toBeNull();
    expect(container.querySelector(".settings-card")).not.toBeNull();
  });

  it("renders exactly № / Название / IP адрес / Тип / Статус / Действия", async () => {
    const { container } = render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    expect(headers).toEqual(["№", "Название", "IP адрес", "Тип", "Статус", "Действия"]);
    const firstRow = screen.getByText("Real One").closest("tr");
    const cells = [...firstRow.querySelectorAll("td")].map((td) => td.textContent.trim());
    expect(cells[0]).toBe("1");
    expect(cells[1]).toBe("Real One");
    expect(cells[2]).toBe("192.168.1.15");
    expect(cells[3]).toBe("Касса");
    const secondRow = screen.getByText("Real Two").closest("tr");
    expect([...secondRow.querySelectorAll("td")][2].textContent.trim()).toBe("—");
    expect([...secondRow.querySelectorAll("td")][3].textContent.trim()).toBe("Кухня");
    expect([...secondRow.querySelectorAll("td")][4].textContent.trim()).toBe("Не активен");
    expect(container.querySelector(".settings-status-badge.is-active")).not.toBeNull();
    expect(container.querySelector(".settings-status-badge.is-inactive")).not.toBeNull();
  });

  it("offers exactly the cashier/kitchen routing roles", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    const dialog = await screen.findByRole("dialog");
    const options = [...dialog.querySelectorAll("select option")].map((option) => option.textContent.trim());
    expect(options).toEqual(["Чековый (касса)", "Кухонный (повар)"]);
  });

  it("Add modal has exactly Название + IP адрес + Тип принтера + Статус toggle", async () => {
    const { container } = render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByRole("heading", { name: "Добавить принтер" })).toBeInTheDocument();
    expect(screen.getByText("Новая запись")).toBeInTheDocument();
    expect(dialog.classList.contains("settings-modal")).toBe(true);
    expect(document.querySelector(".settings-drawer.settings-modal-overlay")).not.toBeNull();
    const labels = [...dialog.querySelectorAll(".settings-form__body > label > span, .settings-form__body .settings-toggle-field > span")]
      .map((el) => el.textContent);
    expect(labels).toEqual(["Название", "IP адрес", "Тип принтера", "Статус"]);
    for (const banned of ["Тип подключения", "Филиал", "Бумага", "Зона", "Порт", "USB", "Serial", "Устройство", "Тест"]) {
      expect(within(dialog).queryByText(banned, { exact: false })).toBeNull();
    }
    expect(within(dialog).getByText("Активен")).toBeInTheDocument();
    expect(document.querySelector(".settings-form__footer")).not.toBeNull();
  });

  it("creates with canonical defaults and truthful status handling", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Название/), { target: { value: "New One" } });
    fireEvent.change(within(dialog).getByLabelText(/IP адрес/), { target: { value: "192.168.1.99" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    expect(settingsService.createResource).toHaveBeenCalledWith("printers", {
      name: "New One",
      printer_type: "receipt",
      connection_type: "network",
      ip_address: "192.168.1.99",
      port: 9100,
    });
    expect(settingsService.updateResource).not.toHaveBeenCalled();
    expect(await screen.findByText("New One")).toBeInTheDocument();
    const row = screen.getByText("New One").closest("tr");
    expect([...row.querySelectorAll("td")][4].textContent.trim()).toBe("Активен");
  });

  it("creates a kitchen printer when the cook role is chosen", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Название/), { target: { value: "Кухня-принтер" } });
    fireEvent.change(within(dialog).getByLabelText(/IP адрес/), { target: { value: "192.168.1.50" } });
    fireEvent.change(within(dialog).getByLabelText(/Тип принтера/), { target: { value: "kitchen" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledWith("printers", {
      name: "Кухня-принтер",
      printer_type: "kitchen",
      connection_type: "network",
      ip_address: "192.168.1.50",
      port: 9100,
    }));
    const row = (await screen.findByText("Кухня-принтер")).closest("tr");
    expect([...row.querySelectorAll("td")][3].textContent.trim()).toBe("Кухня");
  });

  it("Add+inactive persists through an explicit follow-up PATCH (never faked)", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Название/), { target: { value: "Off One" } });
    fireEvent.change(within(dialog).getByLabelText(/IP адрес/), { target: { value: "192.168.1.100" } });
    fireEvent.click(dialog.querySelector(".settings-switch input"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.createResource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalledWith("printers", "new-1", { is_active: false }));
    // The follow-up PATCH response drives the row: truthfully inactive.
    // (The mock echoes name:"x" — a mock artifact; the real backend returns
    // the complete object. Status comes from the PATCH response.)
    const firstRow = document.querySelector(".settings-table tbody tr");
    expect([...firstRow.querySelectorAll("td")][4].textContent.trim()).toBe("Не активен");
  });

  it("Edit prefills the fields and patches name/ip/type/status", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    const row = screen.getByText("Real One").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: /Редактировать/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByRole("heading", { name: "Редактировать принтер" })).toBeInTheDocument();
    expect(screen.getByText("Редактирование")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Название/)).toHaveValue("Real One");
    expect(within(dialog).getByLabelText(/IP адрес/)).toHaveValue("192.168.1.15");
    expect(within(dialog).getByLabelText(/Тип принтера/)).toHaveValue("receipt");
    fireEvent.change(within(dialog).getByLabelText(/IP адрес/), { target: { value: "10.0.0.9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(settingsService.updateResource).toHaveBeenCalledWith(
      "printers", "p1", { name: "Real One", ip_address: "10.0.0.9", is_active: true, printer_type: "receipt" },
    ));
    const kitchenRow = screen.getByText("Real Two").closest("tr");
    fireEvent.click(within(kitchenRow).getByRole("button", { name: /Редактировать/ }));
    const kitchenDialog = await screen.findByRole("dialog");
    expect(within(kitchenDialog).getByLabelText(/Тип принтера/)).toHaveValue("kitchen");
  });

  it("rejects empty name/IP without POST", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить принтер/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(settingsService.createResource).not.toHaveBeenCalled();
    expect(await screen.findByText(/Название.*IP адрес.*обязательны/)).toBeInTheDocument();
  });

  it("requires confirmation before delete and cancels with zero requests", async () => {
    render(<SettingsPrintersPage />);
    await screen.findByText("Real One");
    const row = screen.getByText("Real One").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: /Удалить/ }));
    expect(settingsService.deleteResource).not.toHaveBeenCalled();
    expect(screen.getByText("Удалить принтер?")).toBeInTheDocument();
    expect(screen.getByText(/будет удалён из настроек/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(settingsService.deleteResource).not.toHaveBeenCalled();
    expect(screen.queryByText("Real One")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /Удалить/ }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить", exact: true }));
    await waitFor(() => expect(settingsService.deleteResource).toHaveBeenCalledWith("printers", "p1"));
    expect(screen.queryByText("Real One")).toBeNull();
  });

  it("shows the truthful illustrated empty state", async () => {
    settingsService.listResource.mockResolvedValueOnce({ data: [] });
    const { container } = render(<SettingsPrintersPage />);
    expect(await screen.findByText("Список принтеров пуст")).toBeInTheDocument();
    expect(container.querySelector(".owner-report-empty-image")).not.toBeNull();
  });

  it("maps rows and payloads to canonical backend fields only", () => {
    expect(apiMapRow({ id: "p", name: "Printer", ip_address: "10.0.0.2", is_active: false })).toMatchObject({
      name: "Printer",
      ip: "10.0.0.2",
      active: false,
    });
    expect(apiMapFormToPayload({ name: "  ", ip: "10.0.0.2" }, { editing: false })).toBeNull();
    expect(apiMapFormToPayload({ name: "P", ip: "  " }, { editing: false })).toBeNull();
    expect(apiMapFormToPayload({ name: "P", ip: "10.0.0.2" }, { editing: false })).toEqual({
      name: "P",
      printer_type: "receipt",
      connection_type: "network",
      ip_address: "10.0.0.2",
      port: 9100,
    });
    expect(apiMapFormToPayload({ name: "P", ip: "10.0.0.2", active: false }, { editing: true })).toEqual({
      name: "P",
      ip_address: "10.0.0.2",
      is_active: false,
      printer_type: "receipt",
    });
    expect(apiMapFormToPayload({ name: "P", ip: "10.0.0.2", type: "kitchen" }, { editing: false })).toEqual({
      name: "P",
      printer_type: "kitchen",
      connection_type: "network",
      ip_address: "10.0.0.2",
      port: 9100,
    });
  });
});
