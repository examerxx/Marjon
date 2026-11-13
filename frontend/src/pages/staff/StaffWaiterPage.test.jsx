import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import StaffRolePage from "../StaffRolePage";
import { shortStaffId } from "./staffConstants";

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

// Сеть → филиал: сотрудник без User.branch_id не может войти в Marjon Staff
// (приложение резолвит филиал только из этой колонки), поэтому форма требует
// филиал. Справочник филиалов приходит с /companies/me/branches.
const branchFixtures = [
  { id: "branch-1", name: "Филиал №1" },
  { id: "branch-2", name: "Филиал №2" },
];

const waiterUser = {
  id: "waiter-uuid",
  name: "Waiter One",
  email: null,
  phone: "998901234567",
  role_slug: "waiter",
  role_slugs: ["waiter"],
  is_active: true,
  branch_id: "branch-1",
};

const cashierUser = {
  id: "cashier-uuid",
  name: "Cashier One",
  email: "cashier1@marjon.test",
  phone: "998901234567",
  role_slug: "cashier",
  role_slugs: ["cashier"],
  is_active: true,
  branch_id: "branch-1",
};

// api.get обслуживает три разных запроса страницы: список сотрудников,
// справочник филиалов и список принтеров. Разводим их по URL, иначе
// селекторы получают в качестве справочника список сотрудников.
function mockGet(staff = [waiterUser, cashierUser], printers = []) {
  api.get.mockImplementation((url) => {
    if (url === "/companies/me/branches") return Promise.resolve({ data: branchFixtures });
    if (url === "/printers") return Promise.resolve({ data: printers });
    return Promise.resolve({ data: staff });
  });
}

// Выбор филиала в продуктовом drawer: кнопка-селект внутри поля «Филиал *»
// раскрывает список, пункт — обычная кнопка с role="option".
// Поле «Филиал» убрано из карточки сотрудника (прод-линия): филиал
// резолвится на странице автоматически (единственный филиал компании либо
// сохранённый User.branch_id). Выбор в диалоге больше не нужен — helper
// оставлен no-op, чтобы не переписывать десятки сценариев.
// eslint-disable-next-line no-unused-vars
function pickBranch(dialog, name = "Филиал №1") {}

const EXPECTED_WAITER_SWITCHES = [
  "Статус",
  "Удаление блюд",
  "Изменить код маркировки",
  "Заказ на вынос за столом",
  "Изменить тип заказа",
  // Новый primary-тумблер: гейт must('can_manage_orders') в десктопе
  // (отмена/перенос блюда, смена стола) без него всегда блокировался.
  "Управление заказами",
];

const CASHIER_ONLY_SWITCHES = [
  "Может закрыть счёт",
  "Открыть денежный ящик после оплаты",
  "Просмотр закрытых заказов",
];

async function waitForExpectPost() {
  await waitFor(() => expect(api.post).toHaveBeenCalled());
}

async function waitForExpectPatch() {
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
}

describe("waiter page visual contract (/users/waiter) — WAITER-01", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet();
    api.post.mockResolvedValue({ data: waiterUser });
    api.patch.mockResolvedValue({ data: waiterUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("renders title Список сотрудников: Официанты with ПОЛЬЗОВАТЕЛИ eyebrow", async () => {
    render(<StaffRolePage role="waiter" />);
    expect(await screen.findByText("Waiter One")).toBeInTheDocument();
    expect(screen.getByText("Список сотрудников: Официанты")).toBeInTheDocument();
    expect(screen.getByText("Пользователи")).toBeInTheDocument();
  });

  it("renders exactly the 8 product columns in order, role Официант", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    const headers = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(headers).toEqual([
      "ID",
      "Фото",
      "ФИО",
      "Логин",
      "Роль",
      "Права доступа",
      "Статус",
      "Действия",
    ]);
    const table = document.querySelector(".staff-table");
    expect(within(table).queryByText("Email")).toBeNull();
    expect(within(table).getByText("Официант")).toBeInTheDocument();
    expect(within(table).queryByText("Кассир")).toBeNull();
    expect(within(table).queryByText("Waiter")).toBeNull();
    expect(within(table).getByText(shortStaffId("waiter-uuid"))).toBeInTheDocument();
    expect(within(table).queryByText("waiter-uuid")).toBeNull();
    // Access column shows ONLY delete-dishes truth, never generic text.
    expect(within(table).queryByText("Базовый доступ")).toBeNull();
    expect(within(table).getByText("Удаление блюд")).toBeInTheDocument();
  });

  it("renders waiter access as red OFF delete-dishes indicator (no persisted grant)", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    const table = document.querySelector(".staff-table");
    const access = within(table).getByText("Удаление блюд").closest(".staff-permission");
    expect(access).not.toBeNull();
    const dot = access.querySelector(".staff-permission-dot.is-off");
    expect(dot).not.toBeNull();
  });

  it("uses product header: slider tabs + Add, no legacy filters", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    expect(document.querySelector(".staff-filters")).toBeNull();
    expect(screen.getByRole("button", { name: "Активные" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Архивированные" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить/ })).toBeInTheDocument();
    const header = document.querySelector("header.staff-header--cashier");
    expect(header).not.toBeNull();
    expect(header.querySelector(".staff-header__actions")).not.toBeNull();
    expect(header.querySelector(".staff-tabs--slider")).not.toBeNull();
  });

  it("renders canonical Активен status without old pill", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    const table = document.querySelector(".staff-table");
    const status = within(table).getByText("Активен");
    expect(status.classList.contains("staff-status-badge")).toBe(true);
    expect(status.querySelector(".staff-status-badge__dot")).not.toBeNull();
    expect(within(table).queryByText("#активно")).toBeNull();
  });

  it("add drawer shows photo + 4 fields, no Email or role selector", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".staff-form--cashier")).not.toBeNull();
    expect(dialog.classList.contains("staff-modal--cashier-full")).toBe(true);
    expect(within(dialog).getByText("Добавить официанта")).toBeInTheDocument();
    expect(within(dialog).getByText("Загрузить фото")).toBeInTheDocument();
    expect(within(dialog).getByText("Имя")).toBeInTheDocument();
    expect(within(dialog).getByText("Логин")).toBeInTheDocument();
    expect(within(dialog).getByText("Пароль")).toBeInTheDocument();
    expect(within(dialog).getByText("Принтер")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Имя официанта")).toBeInTheDocument();
    expect(within(dialog).queryByText("Email")).toBeNull();
    expect(dialog.querySelector("select")).toBeNull();
    expect(localStorage.getItem("marjon_staff")).toBeNull();
  });

  it("edit drawer uses Новый пароль + waiter titles, no Email", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Изменить официанта")).toBeInTheDocument();
    expect(within(dialog).getByText("Новый пароль")).toBeInTheDocument();
    expect(within(dialog).queryByText("Email")).toBeNull();
    expect(dialog.querySelector("select")).toBeNull();
  });

  it("shows exactly the 6 primary waiter switches plus the detailed matrix", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const primary = dialog.querySelectorAll(
      ".cashier-permission-switches .staff-permission-switch",
    );
    expect(primary).toHaveLength(6);
    // Основные тумблеры ищем в их блоке: матрица ниже — 50 модулей, и
    // role-запрос по всему drawer’у в jsdom считается секундами.
    const primaryBlock = dialog.querySelector(".cashier-permission-switches");
    for (const label of EXPECTED_WAITER_SWITCHES) {
      if (label === "Статус") {
        expect(within(primaryBlock).getByText("Статус")).toBeInTheDocument();
      } else {
        expect(within(primaryBlock).getByRole("button", { name: label })).toBeInTheDocument();
      }
    }
    expect([...primary].filter((b) => b.disabled)).toHaveLength(0);
    // Additional detailed permissions below remain available (not counted).
    expect(within(dialog).getByRole("button", { name: "Главная" })).toBeInTheDocument();
    expect(dialog.querySelector(".staff-permission-matrix")).not.toBeNull();
  });

  it("has no cashier-only extra switches", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const primaryBlock = dialog.querySelector(".cashier-permission-switches");
    for (const label of CASHIER_ONLY_SWITCHES) {
      expect(within(primaryBlock).queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("toggles waiter switches incl. marking code and keeps form state", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const primaryBlock = dialog.querySelector(".cashier-permission-switches");
    for (const label of ["Удаление блюд", "Изменить код маркировки", "Заказ на вынос за столом", "Изменить тип заказа"]) {
      const button = within(primaryBlock).getByRole("button", { name: label });
      expect(button.classList.contains("is-on")).toBe(false);
      fireEvent.click(button);
      expect(button.classList.contains("is-on")).toBe(true);
      fireEvent.click(button);
      expect(button.classList.contains("is-on")).toBe(false);
    }
  });

  it("creates a waiter without Email through the real endpoint", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const created = {
      id: "new-waiter-uuid",
      name: "Waiter Two",
      email: null,
      phone: "998901112233",
      role_slug: "waiter",
      role_slugs: ["waiter"],
      is_active: true,
    };
    api.post.mockResolvedValue({ data: created });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), {
      target: { value: "Waiter Two" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Waiter123" },
    });
    // PIN обязателен при создании (ba0c267 «PIN всем»): без него saveStaff
    // валидирует форму и POST не уходит.
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText("Waiter Two");
    expect(api.post).toHaveBeenCalledWith("/auth/users", {
      password: "Waiter123",
      phone: "998901112233",
      role_slug: "waiter",
      role_name: "Waiter Two",
      // create всегда шлёт permissions (тумблеры + матрица); пустой — {}
      permissions: {},
      printer_id: null,
      branch_id: null,
    });
    const sent = api.post.mock.calls[0][1];
    expect(sent).not.toHaveProperty("email");
    expect(sent.role_slug).toBe("waiter");
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
    expect(localStorage.getItem("marjon_staff")).toBeNull();
  });

  it("persists toggled waiter switches as permissions dict in create payload", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockResolvedValue({
      data: {
        id: "new-waiter-uuid",
        name: "Waiter Two",
        email: null,
        phone: "998901112233",
        role_slug: "waiter",
        role_slugs: ["waiter"],
        is_active: true,
      },
    });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: "Waiter Two" } });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), { target: { value: "+998901112233" } });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Waiter123" } });
    // Тумблеры владельца обязаны уйти словарём permissions: без них
    // десктопный must('can_manage_orders') никогда не пропускал отмену.
    const primaryBlock = dialog.querySelector(".cashier-permission-switches");
    fireEvent.click(within(primaryBlock).getByRole("button", { name: "Удаление блюд" }));
    fireEvent.click(within(primaryBlock).getByRole("button", { name: "Управление заказами" }));
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText("Waiter Two");
    expect(api.post).toHaveBeenCalledWith("/auth/users", {
      password: "Waiter123",
      phone: "998901112233",
      role_slug: "waiter",
      role_name: "Waiter Two",
      // Ключи snake_case: create и PATCH собирает один сборщик
      // (staffPermissionsPayload), и именно их читают гейты десктопа.
      permissions: { can_delete_dishes: true, can_manage_orders: true },
      printer_id: null,
      branch_id: null,
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("edit sends permissions dict with toggled state and preserves untouched keys", async () => {
    api.patch.mockResolvedValue({ data: { ...waiterUser, name: "Waiter One" } });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Управление заказами" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitForExpectPatch();
    const [, payload] = api.patch.mock.calls[0];
    expect(payload.permissions).toBeTruthy();
    expect(payload.permissions.can_manage_orders).toBe(true);
    // Нетронутые тумблеры не высылаются как false: словарь false в
    // десктопе = явный запрет (can()), а мы ничего не отзывали.
    expect(payload.permissions).not.toHaveProperty("can_delete_dishes", false);
  });

  it("edit persists truthfully without email/printer/photo payload", async () => {
    api.patch.mockResolvedValue({ data: { ...waiterUser, name: "Waiter Two" } });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), {
      target: { value: "Waiter Two" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitForExpectPatch();
    const [, payload] = api.patch.mock.calls[0];
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("printerIp");
    expect(payload).toHaveProperty("printer_id", null);
    expect(payload).not.toHaveProperty("photo");
    expect(payload).toHaveProperty("role_slug", "waiter");
    expect(payload.name).toBe("Waiter Two");
  });

  it("keeps phone prefix stable and formats (XX) XXX-XX-XX", async () => {
    const { unmount } = render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const prefix = dialog.querySelector(".staff-phone-country--pill");
    const input = dialog.querySelector(".staff-phone-field--split input");
    expect(prefix.textContent).toContain("+998");
    fireEvent.change(input, { target: { value: "90123" } });
    expect(input.value).toBe("(90) 123");
    fireEvent.change(input, { target: { value: "+998901234567" } });
    expect(input.value).toBe("(90) 123-45-67");
    expect(input.value.includes("+998")).toBe(false);
    unmount();
  });

  it("preserves archive/restore through backend mutations", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByTitle("Archive"));
    await screen.findByText("Waiter One");
    expect(api.delete).toHaveBeenCalledWith("/auth/users/waiter-uuid");
    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Waiter One")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Restore"));
    await screen.findByText("Waiter One");
    expect(api.patch).toHaveBeenCalledWith("/auth/users/waiter-uuid", { is_active: true });
  });

  it("shows inline validation without alert and keeps drawer open", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Waiter123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    // Empty name binds to the name field (near the fold) + error toast.
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Укажите имя и номер телефона официанта.");
    expect(document.querySelector(".marjon-toast--error")).toHaveTextContent(
      "Укажите имя и номер телефона официанта.",
    );
    const fieldError = dialog.querySelector(".staff-field-error");
    expect(fieldError).not.toBeNull();
    expect(fieldError.closest("label").textContent).toContain("Имя");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("surfaces backend failure inline, resets loading and allows retry", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockRejectedValueOnce({
      response: { data: { detail: "Phone already registered" } },
    });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: "Waiter Two" } });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Waiter123" } });
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    // FIX-02: duplicate-phone binds to the phone field (near the fold) AND
    // surfaces as the shared error toast — both carry the Russian text.
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Этот номер уже зарегистрирован");
    expect(alerts[0]).toHaveTextContent("Phone already registered");
    const toast = document.querySelector(".marjon-toast--error");
    expect(toast).toHaveTextContent("Этот номер уже зарегистрирован");
    expect(toast).toHaveTextContent("Phone already registered");
    const fieldError = dialog.querySelector(".staff-phone-error");
    expect(fieldError).not.toBeNull();
    expect(fieldError.textContent).toContain("Этот номер уже зарегистрирован");
    // Field error sits inside the phone label, right under the input.
    expect(fieldError.closest("label").querySelector(".staff-phone-field input")).not.toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // Submit button left loading state; entered values preserved.
    expect(within(dialog).getByRole("button", { name: "Добавить" })).toBeEnabled();
    expect(screen.getByPlaceholderText("Имя официанта").value).toBe("Waiter Two");
    // Retry works after failure (loading reset).
    api.post.mockResolvedValue({
      data: { ...waiterUser, id: "retry-uuid", name: "Waiter Two" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText("Waiter Two");
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("renders list validation errors as text, never [object Object]", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockRejectedValue({
      response: {
        data: {
          detail: [{ loc: ["body", "phone"], msg: "Field required", type: "missing" }],
          code: "VALIDATION_ERROR",
          message: "Ошибка валидации данных",
        },
      },
    });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: "Waiter Two" } });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Waiter123" } });
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    // Списочный detail FastAPI не привязан к полю — показываем тостом.
    const toast = await waitFor(() => {
      const node = document.querySelector(".marjon-toast--error");
      expect(node).not.toBeNull();
      return node;
    });
    expect(toast).toHaveTextContent("Field required");
    expect(toast.textContent).not.toContain("[object Object]");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("animates drawer close before unmounting", async () => {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    await screen.findByRole("dialog");
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
      expect(screen.getByRole("dialog").classList.contains("is-closing")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("staff role isolation (cashier vs waiter)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet([cashierUser, waiterUser]);
    api.post.mockResolvedValue({ data: waiterUser });
    api.patch.mockResolvedValue({ data: waiterUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("cashier page shows only cashiers", async () => {
    render(<StaffRolePage role="cashier" />);
    expect(await screen.findByText("Cashier One")).toBeInTheDocument();
    expect(screen.queryByText("Waiter One")).not.toBeInTheDocument();
  });

  it("waiter page shows only waiters", async () => {
    render(<StaffRolePage role="waiter" />);
    expect(await screen.findByText("Waiter One")).toBeInTheDocument();
    expect(screen.queryByText("Cashier One")).not.toBeInTheDocument();
  });

  it("locks primary switch sets: cashier 10, waiter 6 (matrix extra)", async () => {
    const { unmount } = render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    let dialog = await screen.findByRole("dialog");
    // Статус + 9 прав: DESK-PERM-01 добавил «Просмотр финансов» и «Посещаемость»,
    // EXPO-01 — «Раздача».
    expect(
      dialog.querySelectorAll(".cashier-permission-switches .staff-permission-switch"),
    ).toHaveLength(10);
    unmount();

    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    dialog = await screen.findByRole("dialog");
    expect(
      dialog.querySelectorAll(".cashier-permission-switches .staff-permission-switch"),
    ).toHaveLength(6);
  });
});

describe("waiter field validation matrix (name/phone/password/printer IP)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet();
    api.post.mockResolvedValue({ data: waiterUser });
    api.patch.mockResolvedValue({ data: waiterUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  async function openAddAndFill({ name = "Field Test", phone = "+998901112233", password = "Waiter123" }) {
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    if (name !== null) {
      fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: name } });
    }
    if (phone !== null) {
      fireEvent.change(dialog.querySelector(".staff-phone-field input"), { target: { value: phone } });
    }
    if (password !== null) {
      fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: password } });
    }
    // PIN обязателен при создании (ba0c267): required-инпут блокирует submit
    // до заполнения 4 цифр.
    // Филиал обязателен: без User.branch_id вход в Marjon Staff не работает.
    pickBranch(dialog);
    return dialog;
  }

  it.each([
    ["single Cyrillic char", "А"],
    ["digits-only name", "12345"],
    ["latin name with space", "John Doe"],
  ])("name accepted: %s → POST sent", async (_label, name) => {
    const dialog = await openAddAndFill({ name });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].role_name).toBe(name);
  });

  it("name is trimmed: surrounding spaces stripped in payload", async () => {
    const dialog = await openAddAndFill({ name: "  Алишер  " });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].role_name).toBe("Алишер");
  });

  it("spaces-only name blocked with name field error, no POST", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dialog = await openAddAndFill({ name: "   " });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(document.querySelector(".marjon-toast--error")).toHaveTextContent(
      "Укажите имя и номер телефона официанта.",
    );
    expect(dialog.querySelector(".staff-field-error")).not.toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("short phone passes frontend gate (no length floor); canonical digits sent", async () => {
    const dialog = await openAddAndFill({ phone: "123" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    // normalizePhone UZ: dial 998 + local digits.
    expect(api.post.mock.calls[0][1].phone).toBe("998123");
  });

  it.each([
    ["empty", ""],
    ["too short", "Ab1"],
    ["too short digits", "123"],
  ])("password rejected: %s → blocked before POST with password field error", { timeout: 20000 }, async (_label, password) => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const dialog = await openAddAndFill({ password });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    const alerts = await within(dialog).findAllByRole("alert");
    // Ошибка валидации рисуется ровно один раз — инлайном под полем пароля.
    // Второго «алерта» (тоста) нет: до POST дело не доходит.
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Пароль должен содержать минимум 4 символа.");
    const fieldError = dialog.querySelector(".staff-field-error");
    expect(fieldError).not.toBeNull();
    expect(fieldError.closest("label").textContent).toContain("Пароль");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it.each([
    ["four digits", "6611"],
    ["four alphanumerics", "QW12"],
    ["four letters", "abcd"],
    ["letters only", "Password"],
    ["digits only", "12345678"],
    ["cyrillic letters + digit", "Пароль12"],
    ["exactly 8 letters+digits", "a1b2c3d4"],
    ["specials and spaces", "P@ss w0rd"],
  ])("password accepted: %s → POST sent", async (_label, password) => {
    const dialog = await openAddAndFill({ password });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });

  function mockPrinters() {
    mockGet([waiterUser, cashierUser], [
      { id: "printer-1", name: "Kitchen", ip_address: "192.168.1.10" },
    ]);
  }

  it("default printer binding inherits the branch (printer_id null)", async () => {
    mockPrinters();
    const dialog = await openAddAndFill({});
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = api.post.mock.calls[0][1];
    expect(payload).not.toHaveProperty("printerIp");
    expect(payload).not.toHaveProperty("printer_ip");
    expect(payload).toHaveProperty("printer_id", null);
  });

  it("chosen printer is sent as printer_id", async () => {
    mockPrinters();
    const dialog = await openAddAndFill({});
    // Поле принтера переиспользует DishSingleSelect (как в форме блюда):
    // триггер — combobox с aria-label, а не кнопка внутри <label>.
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Принтер" }));
    fireEvent.click(within(dialog).getByRole("option", { name: /Kitchen/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1]).toHaveProperty("printer_id", "printer-1");
  });
});

describe("waiter live-create fix (duplicate phone 409)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGet();
    api.post.mockResolvedValue({ data: waiterUser });
    api.patch.mockResolvedValue({ data: waiterUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("shows a clear Russian message on 409 duplicate phone, keeps drawer open for retry", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockRejectedValueOnce({
      response: { data: { detail: "Phone already registered", code: "CONFLICT" } },
    });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), {
      target: { value: "Waiter Two" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Waiter123" },
    });
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Этот номер уже зарегистрирован");
    expect(alerts[0]).toHaveTextContent("Phone already registered");
    const toast = document.querySelector(".marjon-toast--error");
    expect(toast).toHaveTextContent("Этот номер уже зарегистрирован");
    // Field-level error is bound to the phone label, right under the input.
    const fieldError = dialog.querySelector(".staff-phone-error");
    expect(fieldError).not.toBeNull();
    expect(fieldError.closest("label").textContent).toContain("Логин");
    expect(alertSpy).not.toHaveBeenCalled();
    // Drawer stays open with values preserved; retry with a free number works.
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.getByPlaceholderText("Имя официанта").value).toBe("Waiter Two");
    api.post.mockResolvedValue({
      data: { ...waiterUser, id: "retry-uuid", name: "Waiter Two" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText("Waiter Two");
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("creates an archived waiter via POST then deactivate, visible under Archived", async () => {
    const created = {
      id: "archived-waiter-uuid",
      name: "Archived Waiter",
      email: null,
      phone: "998901112244",
      role_slug: "waiter",
      role_slugs: ["waiter"],
      is_active: true,
    };
    const deactivated = { ...created, is_active: false };
    api.post.mockResolvedValue({ data: created });
    api.patch.mockResolvedValue({ data: deactivated });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), {
      target: { value: "Archived Waiter" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112244" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Waiter123" },
    });
    // Switch status to archived before submit.
    fireEvent.click(within(dialog).getByText("Статус").closest("button"));
    expect(within(dialog).getByText("Архив")).toBeInTheDocument();
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/auth/users/archived-waiter-uuid", { is_active: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
    // Active tab hides it; Archived tab shows canonical truth.
    expect(screen.queryByText("Archived Waiter")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Archived Waiter")).toBeInTheDocument();
    expect(screen.getByText("Неактивен")).toBeInTheDocument();
  });

  it("waiter survives reload: remount refetches canonical list via GET", async () => {
    const created = {
      id: "reload-waiter-uuid",
      name: "Reload Waiter",
      email: null,
      phone: "998901112255",
      role_slug: "waiter",
      role_slugs: ["waiter"],
      is_active: true,
    };
    api.post.mockResolvedValue({ data: created });
    const { unmount } = render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), {
      target: { value: "Reload Waiter" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112255" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Waiter123" },
    });
    pickBranch(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText("Reload Waiter");
    unmount();
    // Reload: fresh mount fetches canonical GET including the new waiter.
    mockGet([waiterUser, created]);
    render(<StaffRolePage role="waiter" />);
    expect(await screen.findByText("Reload Waiter")).toBeInTheDocument();
    expect(screen.getByText("Waiter One")).toBeInTheDocument();
  });

  it("empty phone blocks before POST with phone field error", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(screen.getByPlaceholderText("Имя официанта"), { target: { value: "No Phone" } });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "Waiter123" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(document.querySelector(".marjon-toast--error")).toHaveTextContent(
      "Укажите имя и номер телефона официанта.",
    );
    const fieldError = dialog.querySelector(".staff-phone-error");
    expect(fieldError).not.toBeNull();
    expect(fieldError.closest("label").textContent).toContain("Логин");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("maps edit-time duplicate phone to Russian without [object Object]", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.patch.mockRejectedValueOnce({
      response: { data: { detail: "Phone already in use", code: "CONFLICT" } },
    });
    render(<StaffRolePage role="waiter" />);
    await screen.findByText("Waiter One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    // Полевая ошибка — инлайн у телефона; общая — красный тост (портал в body).
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Этот номер уже используется");
    expect(alerts[0].textContent).not.toContain("[object Object]");
    const toast = document.querySelector(".marjon-toast--error");
    expect(toast).not.toBeNull();
    expect(toast).toHaveTextContent("Этот номер уже используется");
    expect(toast.textContent).not.toContain("[object Object]");
    expect(dialog.querySelector(".staff-phone-error")).not.toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
