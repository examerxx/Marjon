import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import StaffRolePage from "../StaffRolePage";

vi.mock("../../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  formatMoney: (value) => `${value}`,
  formatNumber: (value) => `${value}`,
}));

// PIN для входа на кассе: поле вернули в карточку сотрудника, потому что
// «PIN = пароль» работает только для 4–8-значных паролей и только на бэкенде
// из репозитория — у сотрудников со старым паролем PIN оставался пустым,
// и задать его было негде (касса отвечала «Неверный PIN» на любой код).

const branches = [{ id: "branch-1", name: "Филиал №1" }];

const waiterUser = {
  id: "waiter-uuid",
  name: "Алишер",
  email: null,
  phone: "998901234567",
  role_slug: "waiter",
  role_slugs: ["waiter"],
  is_active: true,
  branch_id: "branch-1",
};

function mockGet(staff = [waiterUser]) {
  api.get.mockImplementation((url) => {
    if (url === "/companies/me/branches") return Promise.resolve({ data: branches });
    if (url === "/printers") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: staff });
  });
}

async function openCreateDrawer() {
  render(<StaffRolePage role="waiter" />);
  await screen.findByText("Алишер");
  fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
  return screen.findByRole("dialog");
}

async function openEditDrawer() {
  render(<StaffRolePage role="waiter" />);
  await screen.findByText("Алишер");
  fireEvent.click(screen.getByTitle("Edit"));
  return screen.findByRole("dialog");
}

function typePin(dialog, value) {
  fireEvent.change(within(dialog).getByPlaceholderText("4–8 цифр"), { target: { value } });
}

describe("PIN сотрудника в карточке", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet();
    api.post.mockResolvedValue({ data: waiterUser });
    api.patch.mockResolvedValue({ data: waiterUser });
  });

  it("новому официанту PIN уходит в создании", async () => {
    const dialog = await openCreateDrawer();
    expect(within(dialog).getByText("PIN для кассы")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: "Алишер" } });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901234567" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "secret1" } });
    typePin(dialog, "4321");
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/auth/users", expect.objectContaining({ pin: "4321" })));
  });

  it("в правке PIN ставится отдельным запросом после сохранения карточки", async () => {
    const dialog = await openEditDrawer();
    // Поле пустое: прежний код не показываем и не затираем.
    expect(within(dialog).getByPlaceholderText("4–8 цифр").value).toBe("");
    typePin(dialog, "9876");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/auth/users/waiter-uuid/pin", { pin: "9876" }));
    // Карточка сохраняется раньше PIN: иначе «PIN = пароль» перетёр бы код.
    const calls = api.patch.mock.calls.map(([url]) => url);
    expect(calls.indexOf("/auth/users/waiter-uuid")).toBeLessThan(calls.indexOf("/auth/users/waiter-uuid/pin"));
  });

  it("короткий PIN не отправляется и подсвечивает поле", async () => {
    const dialog = await openEditDrawer();
    typePin(dialog, "12");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    expect(await within(dialog).findByText("PIN — от 4 до 8 цифр.")).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("моноблоку PIN не предлагаем: он входит по телефону и паролю", async () => {
    api.get.mockImplementation((url) => {
      if (url === "/companies/me/branches") return Promise.resolve({ data: branches });
      if (url === "/printers") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [{ ...waiterUser, role_slug: "monoblock", role_slugs: ["monoblock"] }] });
    });
    render(<StaffRolePage role="monoblock" />);
    await screen.findByText("Алишер");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("PIN для кассы")).toBeNull();
    expect(within(dialog).queryByPlaceholderText("4–8 цифр")).toBeNull();
  });
});
