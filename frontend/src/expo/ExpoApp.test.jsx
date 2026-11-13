import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n/index.js";
import * as api from "./api";
import ExpoApp from "./ExpoApp.jsx";

vi.mock("./api", () => ({
  clearExpoSession: vi.fn(),
  confirmExpoOrder: vi.fn(),
  expoLogin: vi.fn(),
  expoLogout: vi.fn(),
  fetchExpoOrders: vi.fn(),
  getExpoUser: vi.fn(),
  isExpoAuthenticated: vi.fn(),
}));

const ORDER = {
  id: "fixture-expo-order",
  order_number: "TEST-201",
  table_number: "5",
  order_type: "dine_in",
  updated_at: new Date().toISOString(),
  items: [{ id: "fixture-item", name: "Тестовый плов", quantity: 1, status: "ready" }],
};

function signIn() {
  fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "901112233" } });
  fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "Passw0rd!" } });
  fireEvent.click(screen.getByRole("button", { name: "Войти" }));
}

describe("ExpoApp — вход и доска раздачи", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await i18n.changeLanguage("ru");
    api.getExpoUser.mockReturnValue(null);
    api.isExpoAuthenticated.mockReturnValue(false);
    api.fetchExpoOrders.mockResolvedValue([]);
    api.expoLogout.mockResolvedValue(undefined);
  });

  it("shows the branded sign-in card and masks the phone", () => {
    render(<ExpoApp />);
    expect(screen.getByText("MARJON")).toBeInTheDocument();
    expect(screen.getByText("Вход для раздачи")).toBeInTheDocument();
    expect(screen.getByText("+998")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "901112233" } });
    expect(screen.getByLabelText("Телефон")).toHaveValue("90 111-22-33");
  });

  it("does not send an incomplete phone", () => {
    render(<ExpoApp />);
    fireEvent.change(screen.getByLabelText("Телефон"), { target: { value: "90111" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "Passw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Номер вводится полностью");
    expect(api.expoLogin).not.toHaveBeenCalled();
  });

  it("signs in with the full number and shows the expo board", async () => {
    api.expoLogin.mockResolvedValue({ name: "Раздача" });
    api.fetchExpoOrders.mockResolvedValue([ORDER]);

    render(<ExpoApp />);
    signIn();

    await waitFor(() =>
      expect(api.expoLogin).toHaveBeenCalledWith("+998901112233", "Passw0rd!"),
    );
    expect(await screen.findByText("TEST-201")).toBeInTheDocument();
    expect(screen.getByText("Тестовый плов")).toBeInTheDocument();
    expect(screen.getByText("1 к выдаче")).toBeInTheDocument();
  });

  it("confirms an order and removes it from the board", async () => {
    api.getExpoUser.mockReturnValue({ name: "Раздача" });
    api.isExpoAuthenticated.mockReturnValue(true);
    api.fetchExpoOrders.mockResolvedValue([ORDER]);
    api.confirmExpoOrder.mockResolvedValue({ order_number: "TEST-201" });

    render(<ExpoApp />);
    const confirm = await screen.findByRole("button", {
      name: "Подтвердить — повар всё сделал",
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.confirmExpoOrder).toHaveBeenCalledWith(ORDER.id));
    await waitFor(() => expect(screen.queryByText("TEST-201")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Заказ TEST-201 передан на экран гостей",
    );
  });

  it("explains a network-wide session instead of pretending the network is down", async () => {
    api.getExpoUser.mockReturnValue({ name: "Владелец" });
    api.isExpoAuthenticated.mockReturnValue(true);
    api.fetchExpoOrders.mockRejectedValue({ response: { status: 422 } });

    render(<ExpoApp />);

    expect(await screen.findByText("Экран не привязан к филиалу")).toBeInTheDocument();
    expect(screen.getByText(/войдите сотрудником филиала/i)).toBeInTheDocument();
    expect(screen.queryByText("Нет связи — последние данные")).toBeNull();
  });

  it("shows the empty state when nothing is waiting", async () => {
    api.getExpoUser.mockReturnValue({ name: "Раздача" });
    api.isExpoAuthenticated.mockReturnValue(true);

    render(<ExpoApp />);
    expect(await screen.findByText("Пока нечего выдавать")).toBeInTheDocument();
  });
});
