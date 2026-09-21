import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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

const cashierUser = {
  id: "cashier-uuid",
  name: "Cashier One",
  email: "cashier1@marjon.test",
  phone: "998901234567",
  role_slug: "cashier",
  role_slugs: ["cashier"],
  is_active: true,
};

const waiterUser = {
  id: "waiter-uuid",
  name: "Waiter One",
  email: "waiter1@marjon.test",
  phone: "998907654321",
  role_slug: "waiter",
  role_slugs: ["waiter"],
  is_active: true,
};

describe("cashier page visual contract (/users/cashier)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [cashierUser, waiterUser] });
    api.post.mockResolvedValue({ data: cashierUser });
    api.patch.mockResolvedValue({ data: cashierUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("removes the filter panel but keeps tabs, add action and route filtering", async () => {
    render(<StaffRolePage role="cashier" />);

    expect(await screen.findByText("Cashier One")).toBeInTheDocument();
    // Route-level role filtering still ensures only cashiers are displayed.
    expect(screen.queryByText("Waiter One")).not.toBeInTheDocument();

    // Entire unwanted filter block is gone — no wrapper, no spacing container.
    expect(document.querySelector(".staff-filters")).toBeNull();
    expect(screen.queryByPlaceholderText("ФИО или телефон")).toBeNull();
    expect(screen.queryByText("Фильтровать")).toBeNull();
    expect(screen.queryByText("Очистить")).toBeNull();

    expect(screen.getByRole("button", { name: "Активные" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Архивированные" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить/ })).toBeInTheDocument();

    // FE-03: title LEFT, [tabs][Add] action group RIGHT in the header —
    // tabs immediately LEFT of Add (Reports-like composition).
    const header = document.querySelector("header.staff-header--cashier");
    expect(header).not.toBeNull();
    const actions = header.querySelector(".staff-header__actions");
    expect(actions).not.toBeNull();
    const tabs = actions.querySelector(".staff-tabs");
    const add = actions.querySelector(".staff-add-button--cashier");
    expect(tabs).not.toBeNull();
    expect(add).not.toBeNull();
    expect(tabs.compareDocumentPosition(add)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(document.querySelector(".staff-cashier-toolbar")).toBeNull();
  });

  it("slides one measured pill between Active and Archived", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    const slider = document.querySelector(".staff-tabs--slider");
    expect(slider).not.toBeNull();
    expect(slider.getAttribute("data-active")).toBe("active");
    const pill = slider.querySelector(".staff-tabs__indicator");
    expect(pill).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(slider.getAttribute("data-active")).toBe("archived");
    expect(
      slider.querySelector('[data-tab="archived"]').classList.contains("is-active"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Активные" }));
    expect(slider.getAttribute("data-active")).toBe("active");
    expect(
      slider.querySelector('[data-tab="active"]').classList.contains("is-active"),
    ).toBe(true);
  });

  it("renders exactly the 8 product columns in order, without Email or RBAC header", async () => {
    render(<StaffRolePage role="cashier" />);

    await screen.findByText("Cashier One");

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "ID",
      "Фото",
      "ФИО",
      "Номер телефона",
      "Роль",
      "Права доступа",
      "Статус",
      "Действия",
    ]);

    expect(screen.queryByText("Доступ RBAC")).not.toBeInTheDocument();
    const table = document.querySelector(".staff-table");
    expect(within(table).queryByText("Email")).toBeNull();
    // Honest generic rights display — no fabricated backend permissions.
    expect(within(table).getByText("Базовый доступ")).toBeInTheDocument();
    // ID renders the full canonical value (no truncation, no invented shorts).
    expect(within(table).getByText("cashier-uuid")).toBeInTheDocument();
  });

  it("uses a 47x49 rounded-square avatar like the MARJON logo mark", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const block = css.match(
      /\.staff-card--cashier \.staff-table \.staff-avatar \{[^}]*\}/,
    );
    expect(block).not.toBeNull();
    expect(block[0]).toContain("width: 47px");
    expect(block[0]).toContain("height: 49px");
    expect(block[0]).toContain("border: 1px solid #fff");
    expect(block[0]).toContain("border-radius: 14px");
    expect(block[0]).not.toContain("50%");
  });

  it("renders the canonical Активен status without the old pill", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    const table = document.querySelector(".staff-table");
    const status = within(table).getByText("Активен");
    expect(status.classList.contains("staff-status-badge")).toBe(true);
    expect(status.classList.contains("is-archived")).toBe(false);
    expect(
      status.querySelector(".staff-status-badge__dot"),
    ).not.toBeNull();
    expect(within(table).queryByText("#активно")).toBeNull();
  });

  it("renders archived cashiers as canonical Неактивен", async () => {
    api.get.mockResolvedValue({
      data: [{ ...cashierUser, id: "archived-uuid", name: "Old Cashier", is_active: false }],
    });
    render(<StaffRolePage role="cashier" />);
    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    await screen.findByText("Old Cashier");

    const table = document.querySelector(".staff-table");
    const status = within(table).getByText("Неактивен");
    expect(status.classList.contains("staff-status-badge")).toBe(true);
    expect(status.classList.contains("is-archived")).toBe(true);
    expect(
      status.querySelector(".staff-status-badge__dot"),
    ).not.toBeNull();
    expect(within(table).queryByText("#архив")).toBeNull();
  });

  it("locks the canonical status visuals to the Place language", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const ok = (re) => expect(css).toMatch(re);
    ok(/\.staff-card--cashier \.staff-table \.staff-status-badge:not\(\.is-archived\) \{[^}]*background: transparent[^}]*\}/);
    ok(/\.staff-card--cashier \.staff-table \.staff-status-badge:not\(\.is-archived\) \{[^}]*color: #00dc3b[^}]*\}/);
    ok(/\.staff-card--cashier \.staff-table \.staff-status-badge\.is-archived \{[^}]*color: var\(--color-danger, #ef4444\)[^}]*\}/);
    ok(/\.staff-card--cashier \.staff-status-badge__dot \{[^}]*width: 8px[^}]*background: currentColor[^}]*\}/);
  });

  it("unifies the header with the Reports 22px pill language", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const tabs = css.match(
      /\.staff-header--cashier \.staff-tabs \{[^}]*\}/,
    );
    expect(tabs).not.toBeNull();
    expect(tabs[0]).toContain("border-radius: 22px");
    const tabButtons = css.match(
      /\.staff-header--cashier \.staff-tabs button \{[^}]*\}/,
    );
    expect(tabButtons).not.toBeNull();
    expect(tabButtons[0]).toContain("border-radius: 22px");
    expect(tabButtons[0]).toMatch(/transition:[^;]*240ms/);
    const add = css.match(
      /\.staff-add-button--cashier \{[^}]*border-radius: 22px[^}]*\}/,
    );
    expect(add).not.toBeNull();
    expect(add[0]).toContain("border-radius: 22px");
    expect(add[0]).toContain("background: #1FC9C9");
    expect(add[0]).toContain("min-height: 43px");
    const accent = css.match(
      /\.staff-card--cashier \.staff-header__accent \{[^}]*\}/,
    );
    expect(accent).not.toBeNull();
    expect(accent[0]).toContain("width: 8px");
    expect(accent[0]).toContain("height: 44px");
    expect(accent[0]).toContain("border-radius: 999px");
    expect(accent[0]).toContain("background: #16c6c8");
  });

  it("sizes the cashier panel by content, not viewport", () => {    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const card = css.match(
      /\.dashboard-content--staff \.staff-card--cashier \{[^}]*\}/,
    );
    expect(card).not.toBeNull();
    expect(card[0]).toContain("flex: none");
    expect(card[0]).toContain("align-self: flex-start");
    expect(card[0]).toContain("min-height: 0");
    expect(card[0]).not.toContain("100vh");
    expect(card[0]).toContain("padding: 22px");
  });

  it("centers the Фото heading and avatar without touching other columns", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const th = css.match(
      /\.staff-card--cashier \.staff-table th:nth-child\(2\) \{[^}]*\}/,
    );
    expect(th).not.toBeNull();
    expect(th[0]).toContain("text-align: center");
    const avatar = css.match(
      /\.staff-card--cashier \.staff-table td:nth-child\(2\) \.staff-avatar \{[^}]*\}/,
    );
    expect(avatar).not.toBeNull();
    expect(avatar[0]).toContain("margin-inline: auto");
    // Textual ID/ФИО/phone columns keep the shared left geometry.
    expect(css).not.toMatch(/\.staff-card--cashier \.staff-table (th|td):nth-child\((1|3|4)\)/);
  });

  it("centers badge/group columns as whole units under centered headers", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    expect(css).toMatch(
      /\.staff-card--cashier \.staff-table th:nth-child\(5\),[\s\S]*?th:nth-child\(8\) \{[^}]*text-align: center[^}]*\}/,
    );
    expect(css).toMatch(
      /\.staff-card--cashier \.staff-table td:nth-child\(8\) \.staff-actions \{[^}]*justify-content: center[^}]*\}/,
    );
  });

  it("add form shows photo plus four fields, without Email or role selector", { timeout: 20000 }, async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    // FE-03: FE-01 drawer shell restored — no FE-02 centered dialog.
    expect(dialog.classList.contains("staff-modal--cashier")).toBe(false);
    expect(dialog.querySelector(".staff-form__body")).toBeNull();
    expect(dialog.querySelector(".staff-form--cashier")).not.toBeNull();

    // Overlay mounts at document.body so it covers sidebar + topbar.
    expect(dialog.classList.contains("staff-modal--cashier-full")).toBe(true);
    expect(dialog.parentElement).toBe(document.body);

    expect(within(dialog).getByText("Загрузить фото")).toBeInTheDocument();
    expect(dialog.querySelector('input[type="file"]')).not.toBeNull();
    expect(within(dialog).getByText("Имя")).toBeInTheDocument();
    expect(within(dialog).getByText("Номер телефона")).toBeInTheDocument();
    expect(within(dialog).getByText("Пароль")).toBeInTheDocument();
    expect(within(dialog).getByText("IP адрес принтера")).toBeInTheDocument();

    expect(within(dialog).queryByText("Email")).toBeNull();
    expect(dialog.querySelector("select")).toBeNull();

    // Permission switches: 1 functional status + 6 interactive permissions.
    const switches = dialog.querySelectorAll(
      ".cashier-permission-switches .staff-permission-switch",
    );
    expect(switches).toHaveLength(7);
    expect(
      [...switches].filter((button) => button.disabled),
    ).toHaveLength(0);

    // Legacy access matrix restored: module toggle expands its 4 actions
    // locally (like before); inner actions stay disabled until expanded.
    const homeToggle = within(dialog).getByRole("button", { name: "Главная" });
    expect(homeToggle.disabled).toBe(false);
    fireEvent.click(homeToggle);
    const homeRow = homeToggle.closest(".staff-access-row");
    expect(homeRow.classList.contains("is-open")).toBe(true);
    for (const label of ["Создать", "Читать", "Обновлять", "Удалить"]) {
      const action = within(homeRow).getByRole("button", { name: label });
      expect(action.disabled).toBe(false);
    }

    // No fake employee persistence introduced.
    expect(localStorage.getItem("marjon_staff")).toBeNull();
    expect(localStorage.getItem("marjon_employees")).toBeNull();
  });

  it("edit form uses the same five product elements", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.classList.contains("staff-modal--cashier")).toBe(false);
    expect(dialog.querySelector(".staff-form__body")).toBeNull();
    expect(dialog.querySelector(".staff-form--cashier")).not.toBeNull();
    expect(dialog.classList.contains("staff-modal--cashier-full")).toBe(true);
    expect(dialog.parentElement).toBe(document.body);

    expect(within(dialog).getByText("Загрузить фото")).toBeInTheDocument();
    expect(within(dialog).getByText("Имя")).toBeInTheDocument();
    expect(within(dialog).getByText("Номер телефона")).toBeInTheDocument();
    expect(within(dialog).getByText("Новый пароль")).toBeInTheDocument();
    expect(within(dialog).getByText("IP адрес принтера")).toBeInTheDocument();
    expect(within(dialog).queryByText("Email")).toBeNull();
    expect(dialog.querySelector("select")).toBeNull();
  });

  it("creates a cashier without Email through the real endpoint", { timeout: 20000 }, async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const created = {
      id: "new-cashier-uuid",
      name: "Cashier Two",
      email: null,
      phone: "998901112233",
      role_slug: "cashier",
      role_slugs: ["cashier"],
      is_active: true,
    };
    api.post.mockResolvedValue({ data: created });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("Имя кассира"), {
      target: { value: "Cashier Two" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Cashier123" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    await screen.findByText("Cashier Two");
    expect(api.post).toHaveBeenCalledWith("/auth/users", {
      password: "Cashier123",
      phone: "998901112233",
      role_slug: "cashier",
      role_name: "Cashier Two",
    });
    const sentPayload = api.post.mock.calls[0][1];
    expect(sentPayload).not.toHaveProperty("email");
    expect(alertSpy).not.toHaveBeenCalled();
    // Modal exits through the existing animated close path.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 2000,
    });
    expect(localStorage.getItem("marjon_staff")).toBeNull();
  });

  it("edit persists truthfully without email, printer ip or photo payload", async () => {
    api.patch.mockResolvedValue({
      data: { ...cashierUser, name: "Cashier Two" },
    });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("Имя кассира"), {
      target: { value: "Cashier Two" },
    });
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), {
      target: { value: "192.168.1.10" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));

    await waitForExpectPatch();
    const [, payload] = api.patch.mock.calls[0];
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("printerIp");
    expect(payload).not.toHaveProperty("photo");
    // Route context still defines the truthful role internally.
    expect(payload).toHaveProperty("role_slug", "cashier");
  });

  it("preserves archive/restore semantics through confirmed backend mutations", async () => {    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");

    fireEvent.click(screen.getByTitle("Archive"));
    await screen.findByText("Cashier One");
    expect(api.delete).toHaveBeenCalledWith("/auth/users/cashier-uuid");

    fireEvent.click(screen.getByRole("button", { name: "Архивированные" }));
    expect(await screen.findByText("Cashier One")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Restore"));
    await screen.findByText("Cashier One");
    expect(api.patch).toHaveBeenCalledWith("/auth/users/cashier-uuid", {
      is_active: true,
    });
  });

  it("renders a real avatar_url with priority over the default asset", async () => {
    api.get.mockResolvedValue({
      data: [
        {
          ...cashierUser,
          id: "real-photo-uuid",
          name: "Photo Cashier",
          avatar_url: "https://cdn.example.com/photos/cashier.jpg",
        },
      ],
    });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Photo Cashier");

    const table = document.querySelector(".staff-table");
    const img = within(table).getByAltText("Photo Cashier");
    expect(img.getAttribute("src")).toContain("cashier.jpg");
    expect(img.getAttribute("src")).not.toContain("staff-default-avatar");
  });

  it("renders the approved default avatar when avatar_url is null or empty", async () => {
    api.get.mockResolvedValue({
      data: [
        { ...cashierUser, id: "null-uuid", name: "Null Cashier", avatar_url: null },
        { ...cashierUser, id: "empty-uuid", name: "Empty Cashier", avatar_url: "" },
      ],
    });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Null Cashier");

    const table = document.querySelector(".staff-table");
    for (const name of ["Null Cashier", "Empty Cashier"]) {
      const img = within(table).getByAltText(name);
      expect(img.getAttribute("src")).toContain("staff-default-avatar.png");
    }
    // Cashier initials fallback is gone: no «ХУ»-style spans in the table.
    expect(within(table).queryByText("NU")).toBeNull();
    expect(within(table).queryByText("EM")).toBeNull();
  });
});

describe("cashier drawer ux: footer, animation, phone, permissions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [cashierUser, waiterUser] });
    api.post.mockResolvedValue({ data: cashierUser });
    api.patch.mockResolvedValue({ data: cashierUser });
    api.delete.mockResolvedValue({ data: {} });
  });

  it("styles drawer footer as 22px teal Add + white/red Cancel", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const submit = css.match(
      /\.staff-modal--cashier-full \.staff-form--cashier \.staff-form__footer button\[type="submit"\] \{[^}]*\}/,
    );
    expect(submit).not.toBeNull();
    expect(submit[0]).toContain("border-radius: 22px");
    expect(submit[0]).toContain("background: #1FC9C9");
    expect(submit[0]).toContain("min-height: 43px");
    const cancel = css.match(
      /\.staff-modal--cashier-full \.staff-form--cashier \.staff-form__footer button\[type="button"\] \{[^}]*\}/,
    );
    expect(cancel).not.toBeNull();
    expect(cancel[0]).toContain("border-radius: 22px");
    expect(cancel[0]).toContain("color: #EF4444");
    expect(cancel[0]).toContain("background: #fff");
  });

  it("renders Отменить before Добавить and keeps both behaviors", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const footer = dialog.querySelector(".staff-form__footer");
    const buttons = [...footer.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Отменить", "Добавить"]);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(api.post).not.toHaveBeenCalled());
  });

  it("animates drawer close before unmounting and reopens cleanly", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    await screen.findByRole("dialog");

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
      const closing = screen.getByRole("dialog");
      expect(closing.classList.contains("is-closing")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const reopened = await screen.findByRole("dialog");
    expect(reopened.classList.contains("is-closing")).toBe(false);
  });

  it("keeps the country prefix stable while typing and deleting", async () => {
    const { unmount } = render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    const prefix = dialog.querySelector(".staff-phone-country--pill");
    const input = dialog.querySelector(".staff-phone-field--split input");
    expect(prefix.textContent).toContain("+998");
    expect(input.getAttribute("placeholder")).toBe("Введите номер");

    fireEvent.change(input, { target: { value: "90123" } });
    expect(input.value).toBe("(90) 123");
    expect(prefix.textContent).toContain("+998");

    fireEvent.change(input, { target: { value: "(90) 12" } });
    expect(input.value).toBe("(90) 12");
    expect(prefix.textContent).toContain("+998");

    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(prefix.textContent).toContain("+998");
    expect(input.value.includes("+")).toBe(false);
    unmount();
  });

  it("shows subscriber digits without prefix in edit mode", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector(".staff-phone-field--split input");
    expect(input.value).toBe("(90) 123-45-67");
    expect(input.value.includes("+")).toBe(false);
  });

  it("formats local digits as (XX) XXX-XX-XX display-only", async () => {
    const { formatLocalUZ } = await import("./staffPhone");
    expect(formatLocalUZ("212312313")).toBe("(21) 231-23-13");
    expect(formatLocalUZ("901234567")).toBe("(90) 123-45-67");
    expect(formatLocalUZ("2")).toBe("(2");
    expect(formatLocalUZ("21")).toBe("(21)");
    expect(formatLocalUZ("212")).toBe("(21) 2");
    expect(formatLocalUZ("212312")).toBe("(21) 231-2");
    expect(formatLocalUZ("")).toBe("");
    expect(formatLocalUZ("90123456799")).toBe("(90) 123-45-6799");
  });

  it("caps local digits at 9 and never duplicates +998 on paste", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector(".staff-phone-field--split input");

    fireEvent.change(input, { target: { value: "+998212312313" } });
    expect(input.value).toBe("(21) 231-23-13");
    expect(input.value.includes("+998")).toBe(false);

    fireEvent.change(input, { target: { value: "9012345679999" } });
    expect(input.value).toBe("(90) 123-45-67");
  });

  it("updates formatted display on Backspace digit removal", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");
    const input = dialog.querySelector(".staff-phone-field--split input");

    fireEvent.change(input, { target: { value: "212312313" } });
    expect(input.value).toBe("(21) 231-23-13");
    fireEvent.change(input, { target: { value: "(21) 231-23-1" } });
    expect(input.value).toBe("(21) 231-23-1");
    fireEvent.change(input, { target: { value: "(21) 231-23" } });
    expect(input.value).toBe("(21) 231-23");
  });

  it("toggles every permission switch and keeps state in form", { timeout: 20000 }, async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    for (const label of [
      "Удаление блюд",
      "Заказ на вынос за столом",
      "Изменить тип заказа",
      "Может закрыть счёт",
      "Открыть денежный ящик после оплаты",
      "Просмотр закрытых заказов",
    ]) {
      const button = within(dialog).getByRole("button", { name: label });
      expect(button.classList.contains("is-on")).toBe(false);
      fireEvent.click(button);
      expect(button.classList.contains("is-on")).toBe(true);
      fireEvent.click(button);
      expect(button.classList.contains("is-on")).toBe(false);
    }
  });

  it("keeps the status switch functional with existing semantics", async () => {
    api.patch.mockResolvedValue({
      data: { ...cashierUser, is_active: false },
    });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(
      within(dialog).getByText("Статус").closest("button"),
    );
    expect(
      within(dialog).getByText("Архив"),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitForExpectPatch();
    const [, payload] = api.patch.mock.calls[0];
    expect(payload.is_active).toBe(false);
  });

  it("locks permission rows to dark labels with live state dots", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    // Labels neutral dark, never green/red.
    expect(css).toMatch(
      /\.staff-form--cashier \.staff-permission-switch span,[^}]*color: var\(--neutral-800, #1e293b\)[^}]*\}/,
    );
    // Dots carry the state instead: red off, green on.
    expect(css).toMatch(
      /\.staff-form--cashier \.staff-permission-state-dot \{[^}]*background: #EF4444[^}]*\}/,
    );
    expect(css).toMatch(
      /\.staff-form--cashier \.staff-permission-switch\.is-on \.staff-permission-state-dot \{[^}]*background: #00DC3B[^}]*\}/,
    );
    // No hover/focus/active recolor of the text.
    expect(
      css.match(
        /\.staff-form--cashier[^{]*:hover[^{]*span[^{]*\{[^}]*color\s*:/,
      ),
    ).toBeNull();
    expect(
      css.match(
        /\.staff-form--cashier[^{]*:(focus|focus-visible|active)[^{]*span[^{]*\{[^}]*color\s*:/,
      ),
    ).toBeNull();
  });

  it("renders one left dot per permission row, ahead of its label", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    const dots = dialog.querySelectorAll(".staff-permission-state-dot");
    expect(dots).toHaveLength(7);
    dots.forEach((dot) => {
      const button = dot.closest(".staff-permission-switch");
      expect(button).not.toBeNull();
      const label = button.querySelector("span:not(.staff-permission-state-dot)");
      expect(label).not.toBeNull();
      expect(
        dot.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    // Dot state follows the switch: toggle Удаление блюд on and off.
    const dishButton = within(dialog).getByRole("button", { name: "Удаление блюд" });
    const dishDot = dishButton.querySelector(".staff-permission-state-dot");
    expect(dishButton.classList.contains("is-on")).toBe(false);
    fireEvent.click(dishButton);
    expect(dishButton.classList.contains("is-on")).toBe(true);
    expect(dishDot.parentElement.classList.contains("is-on")).toBe(true);
    fireEvent.click(dishButton);
    expect(dishButton.classList.contains("is-on")).toBe(false);
  });

  it("shows no required stars on cashier labels", async () => {
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByText("Имя *")).toBeNull();
    expect(within(dialog).queryByText("Номер телефона *")).toBeNull();
    expect(within(dialog).queryByText("Пароль *")).toBeNull();
    expect(within(dialog).getByText("Имя")).toBeInTheDocument();
    expect(within(dialog).getByText("Номер телефона")).toBeInTheDocument();
    expect(within(dialog).getByText("Пароль")).toBeInTheDocument();
  });

  it("renders the phone field as one bordered control", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const box = css.match(
      /\.staff-form--cashier \.staff-phone-field--split \{[^}]*\}/,
    );
    expect(box).not.toBeNull();
    expect(box[0]).toContain("display: flex");
    expect(box[0]).toContain("border: 1px solid var(--blue-100)");
    const input = css.match(
      /\.staff-form--cashier \.staff-phone-field--split input \{[^}]*\}/,
    );
    expect(input).not.toBeNull();
    expect(input[0]).toContain("border: 0");
  });

  it("renders the country prefix as a static pill inside the phone box", () => {
    const css = readFileSync(
      `${process.cwd()}/src/styles/owner/staff-users.css`,
      "utf8",
    );
    const pill = css.match(
      /\.staff-form--cashier \.staff-phone-country--pill \{[^}]*\}/,
    );
    expect(pill).not.toBeNull();
    expect(pill[0]).toContain("position: static");
    expect(pill[0]).toContain("border-radius: 10px");
    expect(pill[0]).toContain("background: #f1f5f9");
  });

  it("shows inline validation error without window.alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Cashier123" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("Укажите имя и номер телефона кассира.");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    // Drawer stays open with entered values preserved.
    expect(screen.getByPlaceholderText("Пароль").value).toBe("Cashier123");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("surfaces backend failure inline without window.alert", async () => {    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    api.post.mockRejectedValue({
      response: { data: { detail: "Phone already registered" } },
    });
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("Имя кассира"), {
      target: { value: "Cashier Two" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Cashier123" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("Phone already registered");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.getByPlaceholderText("Имя кассира").value).toBe("Cashier Two");
  });

  it("renders list-style validation errors as text, never [object Object]", async () => {
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
    render(<StaffRolePage role="cashier" />);
    await screen.findByText("Cashier One");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(screen.getByPlaceholderText("Имя кассира"), {
      target: { value: "Cashier Two" },
    });
    fireEvent.change(dialog.querySelector(".staff-phone-field input"), {
      target: { value: "+998901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), {
      target: { value: "Cashier123" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Field required");
    expect(alert.textContent).not.toContain("[object Object]");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

async function waitForExpectPatch() {
  const { waitFor } = await import("@testing-library/react");
  await waitFor(() => expect(api.patch).toHaveBeenCalled());
}
describe("waiter route smoke (no cashier leakage, no redesign)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [cashierUser, waiterUser] });
  });

  it("renders waiter rows with legacy filters and without cashier layout", async () => {
    render(<StaffRolePage role="waiter" />);

    expect(await screen.findByText("Waiter One")).toBeInTheDocument();
    expect(screen.queryByText("Cashier One")).not.toBeInTheDocument();

    // Legacy filter panel untouched.
    expect(document.querySelector(".staff-filters")).not.toBeNull();
    expect(
      screen.getByPlaceholderText("ФИО или телефон"),
    ).toBeInTheDocument();

    // No cashier-only layout leaks.
    expect(document.querySelector(".staff-cashier-toolbar")).toBeNull();
    expect(document.querySelector(".staff-header__actions")).toBeNull();
    expect(document.querySelector(".staff-card--cashier")).toBeNull();
    const legacyAdd = document.querySelector(
      ".staff-header .staff-add-button",
    );
    expect(legacyAdd).not.toBeNull();
    expect(
      legacyAdd.classList.contains("staff-add-button--cashier"),
    ).toBe(false);
  });

  it("keeps the initials fallback for other roles", async () => {
    render(<StaffRolePage role="waiter" />);

    expect(await screen.findByText("Waiter One")).toBeInTheDocument();

    const table = document.querySelector(".staff-table");
    // Waiter without avatar keeps initials; no default asset leaks in.
    expect(within(table).getByText("WA")).toBeInTheDocument();
    expect(
      table.querySelector('img[src*="staff-default-avatar"]'),
    ).toBeNull();
  });
});
