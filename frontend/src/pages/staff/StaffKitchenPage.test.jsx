import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import StaffRolePage from "../StaffRolePage";

vi.mock("../../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatMoney: (value) => `${value}`,
  formatNumber: (value) => `${value}`,
}));

// KITCHEN-01: страница повара должна быть 1:1 с остальными страницами
// сотрудников — продуктовый drawer, вкладки статуса в шапке и никакого
// блока фильтров (.staff-filters). Тесты фиксируют именно это, плюс то, что
// тумблеры карточки уходят в permissions и возвращаются из бэкенда.

// Один филиал: страница сама подставляет его в branch_id (повар без филиала
// «сетевой» — его PIN видел бы кухонный экран любого филиала).
const branchFixtures = [{ id: "branch-1", name: "Филиал №1" }];

const cookActive = {
  id: "cook-active-uuid",
  name: "Cook One",
  email: null,
  phone: "998901234567",
  role_slug: "kitchen",
  role_slugs: ["kitchen"],
  is_active: true,
  branch_id: "branch-1",
};

const cookArchived = {
  id: "cook-archived-uuid",
  name: "Old Cook",
  email: null,
  phone: "998907654321",
  role_slug: "kitchen",
  role_slugs: ["kitchen"],
  is_active: false,
  branch_id: "branch-1",
};

const waiterUser = {
  id: "waiter-uuid",
  name: "Waiter One",
  email: null,
  phone: "998900000000",
  role_slug: "waiter",
  role_slugs: ["waiter"],
  is_active: true,
  branch_id: "branch-1",
};

function mockGet(staff = [cookActive, waiterUser]) {
  api.get.mockImplementation((url) => {
    if (url === "/companies/me/branches") return Promise.resolve({ data: branchFixtures });
    if (url === "/printers") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: staff });
  });
}

describe("kitchen page (/users/kitchen) matches the staff template", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet();
    api.post.mockResolvedValue({ data: cookActive });
    api.patch.mockResolvedValue({ data: cookActive });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("renders the product header without the legacy filter panel", async () => {
    render(<StaffRolePage role="kitchen" />);

    expect(await screen.findByText("Cook One")).toBeInTheDocument();
    // Роль маршрута по-прежнему фильтрует список.
    expect(screen.queryByText("Waiter One")).not.toBeInTheDocument();

    // Блок фильтров убран целиком — ни обёртки, ни полей, ни кнопок.
    expect(document.querySelector(".staff-filters")).toBeNull();
    expect(screen.queryByPlaceholderText("ФИО или телефон")).toBeNull();
    expect(screen.queryByText("Фильтровать")).toBeNull();
    expect(screen.queryByText("Очистить")).toBeNull();

    // Шапка продуктовая: заголовок слева, [вкладки][Добавить] справа.
    const header = document.querySelector("header.staff-header--cashier");
    expect(header).not.toBeNull();
    const actions = header.querySelector(".staff-header__actions");
    const tabs = actions.querySelector(".staff-tabs--slider");
    const add = actions.querySelector(".staff-add-button--cashier");
    expect(tabs).not.toBeNull();
    expect(add).not.toBeNull();
    expect(tabs.compareDocumentPosition(add)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Продуктовая таблица: статус «Активен», а не легаси «#активно».
    const table = document.querySelector(".staff-table");
    expect(within(table).getByText("Активен")).toBeInTheDocument();
    expect(within(table).queryByText("#активно")).toBeNull();
  });

  it("switches between active and archived cooks", async () => {
    mockGet([cookActive, cookArchived]);
    render(<StaffRolePage role="kitchen" />);
    await screen.findByText("Cook One");
    expect(screen.queryByText("Old Cook")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Old Cook")).toBeInTheDocument();
    expect(screen.queryByText("Cook One")).not.toBeInTheDocument();
    expect(document.querySelector(".staff-tabs--slider").getAttribute("data-active")).toBe("archived");
    expect(within(document.querySelector(".staff-table")).getByText("Неактивен")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Активные" }));
    expect(await screen.findByText("Cook One")).toBeInTheDocument();
    expect(screen.queryByText("Old Cook")).not.toBeInTheDocument();
  });

  it("opens the cook drawer with cook-only switches and the kitchen PIN field", async () => {
    render(<StaffRolePage role="kitchen" />);
    await screen.findByText("Cook One");

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Добавить повара")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Имя повара")).toBeInTheDocument();
    expect(within(dialog).getByText("PIN для кухни")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("4–8 цифр")).toBeInTheDocument();

    // Статус + два кухонных права.
    expect(within(dialog).getByRole("button", { name: /Статус/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Печать на принтер повара" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Печать отмены заказа" })).toBeInTheDocument();

    // Права кассира повару не показываем.
    expect(within(dialog).queryByRole("button", { name: "Может закрыть счёт" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Открыть денежный ящик после оплаты" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Удаление блюд" })).toBeNull();
  });

  it("creates a cook with role kitchen, branch and the toggled permissions", async () => {
    api.post.mockResolvedValue({
      data: {
        id: "new-cook-uuid",
        name: "Cook Two",
        email: null,
        phone: "998901112233",
        role_slug: "kitchen",
        role_slugs: ["kitchen"],
        is_active: true,
        branch_id: "branch-1",
      },
    });
    render(<StaffRolePage role="kitchen" />);
    await screen.findByText("Cook One");

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя повара"), { target: { value: "Cook Two" } });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), { target: { value: "+998901112233" } });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Cook1234" } });
    fireEvent.change(screen.getByPlaceholderText("4–8 цифр"), { target: { value: "4321" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Печать на принтер повара" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Печать отмены заказа" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe("/auth/users");
    expect(payload).toMatchObject({
      role_slug: "kitchen",
      role_name: "Cook Two",
      phone: "998901112233",
      password: "Cook1234",
      pin: "4321",
      branch_id: "branch-1",
      printer_id: null,
      // Ключи snake_case — тот же словарь, что читают гейты десктопа/KDS.
      permissions: { can_cook_printer: true, can_print_cancel: true },
    });
    // Ничего лишнего из прав кассира в payload не уехало.
    expect(Object.keys(payload.permissions).sort()).toEqual(["can_cook_printer", "can_print_cancel"]);
  });

  it("opens an existing cook with the saved permissions and keeps them on save", async () => {
    mockGet([
      {
        ...cookActive,
        permissions: { can_cook_printer: true, can_print_cancel: false },
      },
    ]);
    api.patch.mockResolvedValue({
      data: { ...cookActive, permissions: { can_cook_printer: true, can_print_cancel: false } },
    });
    render(<StaffRolePage role="kitchen" />);
    await screen.findByText("Cook One");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Изменить повара")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Печать на принтер повара" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(dialog).getByRole("button", { name: "Печать отмены заказа" }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(within(dialog).getByRole("button", { name: "Печать отмены заказа" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [url, payload] = api.patch.mock.calls[0];
    expect(url).toBe("/auth/users/cook-active-uuid");
    expect(payload).toMatchObject({
      role_slug: "kitchen",
      is_active: true,
      branch_id: "branch-1",
      permissions: { can_cook_printer: true, can_print_cancel: true },
    });
  });

  it("archives a cook through the row action and moves it to the archived tab", async () => {
    render(<StaffRolePage role="kitchen" />);
    await screen.findByText("Cook One");

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/auth/users/cook-active-uuid"));

    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Cook One")).toBeInTheDocument();
    expect(within(document.querySelector(".staff-table")).getByText("Неактивен")).toBeInTheDocument();
  });
});
