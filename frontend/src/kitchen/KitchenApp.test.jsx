import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n/index.js";
import * as api from "./api";
import KitchenApp from "./KitchenApp.jsx";

// No real device, cook session, API requests, or WebSocket connections.
vi.mock("./api", () => ({
  forgetKdsDevice: vi.fn(),
  getKdsBranch: vi.fn(),
  getKdsCookName: vi.fn(),
  hasKdsDevice: vi.fn(),
  isKdsAuthenticated: vi.fn(),
  kdsConnectDevice: vi.fn(),
  kdsCookLogout: vi.fn(),
  kdsGetCooks: vi.fn(),
  kdsGetOrders: vi.fn(),
  kdsPinLogin: vi.fn(),
  kdsSetItemStatus: vi.fn(),
  kdsSetOrderReady: vi.fn(),
  kdsWsUrl: vi.fn(),
}));

const BRANCH = { id: "fixture-branch-1", name: "Тестовая кухня" };
const COOK = { id: "fixture-cook-1", name: "Тестовый повар" };
const ITEM_ID = "fixture-item-1";
const ORDER_ID = "fixture-order-1";
const DISH_NAME = "Тестовый плов";
let serverOrders;
let sockets;
let previousLanguage;

function makeItem(overrides = {}) {
  return { id: ITEM_ID, name: DISH_NAME, quantity: 1, status: "pending", ...overrides };
}

function makeOrder(overrides = {}) {
  return {
    id: ORDER_ID,
    order_number: "TEST-101",
    branch_id: BRANCH.id,
    table_number: "7",
    order_type: "dine_in",
    status: "cooking",
    created_at: new Date().toISOString(),
    items: [makeItem()],
    ...overrides,
  };
}

function secondOrder() {
  return makeOrder({
    id: "fixture-order-2",
    order_number: "TEST-102",
    table_number: "8",
    items: [makeItem({ id: "fixture-item-2", name: "Тестовый суп" })],
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FixtureWebSocket {
  constructor(url) {
    this.url = url;
    sockets.push(this);
  }

  open() {
    this.onopen?.({});
  }

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  close() {
    this.onclose?.({});
  }
}

function card(number = "TEST-101") {
  return screen.getByRole("article", { name: `Заказ ${number}` });
}

function dishActions(name = DISH_NAME) {
  return within(screen.getByRole("group", { name }));
}

function expectDishReady(ready, name = DISH_NAME) {
  const actions = dishActions(name);
  expect(actions.getByRole("button", { name: "Сделал", exact: true }))
    .toHaveAttribute("aria-pressed", String(ready));
  expect(actions.getByRole("button", { name: "Не сделал", exact: true }))
    .toHaveAttribute("aria-pressed", String(!ready));
}

async function renderBoard() {
  const view = render(<KitchenApp />);
  await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false"));
  return view;
}

beforeEach(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage("ru");
  Object.values(api).forEach((mock) => mock.mockReset());
  sockets = [];
  serverOrders = [makeOrder()];
  vi.stubGlobal("WebSocket", FixtureWebSocket);
  api.hasKdsDevice.mockReturnValue(true);
  api.isKdsAuthenticated.mockReturnValue(true);
  api.getKdsBranch.mockReturnValue(BRANCH);
  api.getKdsCookName.mockReturnValue(COOK.name);
  api.kdsWsUrl.mockReturnValue("ws://fixture.invalid/kitchen");
  // Return snapshots: changing the fixture server must not mutate React state.
  api.kdsGetOrders.mockImplementation(async () => ({ items: structuredClone(serverOrders) }));
  api.kdsSetItemStatus.mockImplementation(async (itemId, status) => {
    serverOrders = serverOrders.map((order) => {
      if (!order.items.some((item) => item.id === itemId)) return order;
      const items = order.items.map((item) => item.id === itemId ? { ...item, status } : item);
      const active = items.filter((item) => item.status !== "cancelled");
      return {
        ...order,
        items,
        status: active.every((item) => ["ready", "served"].includes(item.status)) ? "ready" : "cooking",
      };
    });
    return { status };
  });
  api.kdsSetOrderReady.mockImplementation(async (orderId) => {
    serverOrders = serverOrders.map((order) => order.id !== orderId ? order : {
      ...order,
      status: "ready",
      items: order.items.map((item) => ["cancelled", "served"].includes(item.status)
        ? item
        : { ...item, status: "ready" }),
    });
    return { status: "ready" };
  });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage(previousLanguage);
});

describe("KitchenApp — dish and whole-order readiness", () => {
  it("sends pending → ready with Сделал and reloads the confirmed state", async () => {
    await renderBoard();
    expectDishReady(false);
    fireEvent.click(dishActions().getByRole("button", { name: "Не сделал", exact: true }));
    expect(api.kdsSetItemStatus).not.toHaveBeenCalled();

    fireEvent.click(dishActions().getByRole("button", { name: "Сделал", exact: true }));
    expect(api.kdsSetItemStatus).toHaveBeenCalledExactlyOnceWith(ITEM_ID, "ready");
    await waitFor(() => expectDishReady(true));
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
    expect(card()).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Стол готов", exact: true })).toBeDisabled();
    expect(api.kdsSetOrderReady).not.toHaveBeenCalled();
  });

  it("sends ready → cooking with Не сделал and returns the order to work", async () => {
    serverOrders = [makeOrder({ status: "ready", items: [makeItem({ status: "ready" })] })];
    await renderBoard();
    expectDishReady(true);
    fireEvent.click(dishActions().getByRole("button", { name: "Сделал", exact: true }));
    expect(api.kdsSetItemStatus).not.toHaveBeenCalled();

    fireEvent.click(dishActions().getByRole("button", { name: "Не сделал", exact: true }));
    expect(api.kdsSetItemStatus).toHaveBeenCalledExactlyOnceWith(ITEM_ID, "cooking");
    await waitFor(() => expectDishReady(false));
    expect(within(card()).getByText("Готовится")).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Весь стол готов" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^В работе/ }));
    expect(card()).toBeVisible();
  });

  it("keeps a newly ready card on the board and in the Готовые tab", async () => {
    serverOrders.push(secondOrder());
    await renderBoard();
    fireEvent.click(dishActions().getByRole("button", { name: "Сделал", exact: true }));
    await waitFor(() => expectDishReady(true));
    expect(screen.getAllByRole("article")).toHaveLength(2);

    const readyTab = screen.getByRole("button", { name: /^Готовые\s*1$/ });
    fireEvent.click(readyTab);
    expect(readyTab).toHaveAttribute("aria-pressed", "true");
    expect(card()).toBeVisible();
    expect(screen.queryByRole("article", { name: "Заказ TEST-102" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^В работе/ }));
    expect(screen.queryByRole("article", { name: "Заказ TEST-101" })).not.toBeInTheDocument();
    expect(card("TEST-102")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Все\s*2$/ }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("marks the whole order ready in one API call without changing cancelled dishes", async () => {
    serverOrders = [makeOrder({ items: [
      makeItem(),
      makeItem({ id: "fixture-item-2", name: "Тестовый суп", status: "cooking" }),
      makeItem({ id: "fixture-item-cancelled", name: "Отменённое тестовое блюдо", status: "cancelled" }),
    ] })];
    await renderBoard();
    fireEvent.click(within(card()).getByRole("button", { name: "Весь стол готов" }));
    expect(api.kdsSetOrderReady).toHaveBeenCalledExactlyOnceWith(ORDER_ID);
    await waitFor(() => expect(within(card()).getByRole("button", { name: "Стол готов", exact: true })).toBeDisabled());
    expectDishReady(true);
    expectDishReady(true, "Тестовый суп");
    expect(within(card()).getByText("Отменено")).toBeVisible();
    expect(within(card()).getByText("Все блюда готовы")).toBeVisible();
    expect(api.kdsSetItemStatus).not.toHaveBeenCalled();
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
  });

  it.each(["cancelled", "served"])("does not offer dish actions for a %s item", async (status) => {
    serverOrders = [makeOrder({ items: [makeItem({ status })] })];
    await renderBoard();
    expect(within(card()).queryByRole("button", { name: "Сделал", exact: true })).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "Не сделал", exact: true })).not.toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /[Сс]тол готов/ })).toBeDisabled();
    expect(api.kdsSetItemStatus).not.toHaveBeenCalled();
    expect(api.kdsSetOrderReady).not.toHaveBeenCalled();
  });

  it.each([
    { label: "Сделал", initiallyReady: false, whole: false },
    { label: "Не сделал", initiallyReady: true, whole: false },
    { label: "Весь стол готов", initiallyReady: false, whole: true },
  ])("shows a save error without optimistic success for $label", async ({ label, initiallyReady, whole }) => {
    serverOrders = [makeOrder({
      status: initiallyReady ? "ready" : "cooking",
      items: [makeItem({ status: initiallyReady ? "ready" : "pending" })],
    })];
    const request = deferred();
    const mutation = whole ? api.kdsSetOrderReady : api.kdsSetItemStatus;
    mutation.mockReturnValueOnce(request.promise);
    await renderBoard();
    fireEvent.click(within(card()).getByRole("button", { name: label, exact: true }));
    expect(mutation).toHaveBeenCalledTimes(1);
    expectDishReady(initiallyReady);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(1);

    await act(async () => request.reject(new Error("Fixture save rejected")));
    expect(await screen.findByRole("status")).toHaveTextContent(/Не удалось сохранить/);
    expectDishReady(initiallyReady);
    expect(card()).toBeVisible();
    expect(within(card()).getByRole("button", { name: label, exact: true })).toBeEnabled();
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
  });

  it.each(["dish", "whole order"])("blocks duplicate and competing taps during a pending %s save", async (kind) => {
    serverOrders.push(secondOrder());
    const request = deferred();
    const mutation = kind === "dish" ? api.kdsSetItemStatus : api.kdsSetOrderReady;
    const save = mutation.getMockImplementation();
    mutation.mockImplementationOnce((...args) => request.promise.then(() => save(...args)));
    await renderBoard();
    const primary = within(card()).getByRole("button", {
      name: kind === "dish" ? "Сделал" : "Весь стол готов",
      exact: true,
    });
    const otherDish = dishActions("Тестовый суп").getByRole("button", { name: "Сделал", exact: true });
    const otherOrder = within(card("TEST-102")).getByRole("button", { name: "Весь стол готов" });

    // One React batch exercises the synchronous guard, before disabled state renders.
    act(() => {
      fireEvent.click(primary);
      fireEvent.click(primary);
      fireEvent.click(otherDish);
      fireEvent.click(otherOrder);
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(kind === "dish" ? api.kdsSetOrderReady : api.kdsSetItemStatus).not.toHaveBeenCalled();
    within(screen.getByRole("main")).getAllByRole("button").forEach((button) => expect(button).toBeDisabled());
    expectDishReady(false);
    expectDishReady(false, "Тестовый суп");

    await act(async () => request.resolve());
    await waitFor(() => expectDishReady(true));
    expect(otherDish).toBeEnabled();
    expect(otherOrder).toBeEnabled();
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it("renders no sidebar and a guest TV link with only the fixture branch", async () => {
    const { container } = await renderBoard();
    expect(screen.getByText(`${BRANCH.name} · ${COOK.name}`)).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(container.querySelector("aside, .sidebar")).toBeNull();
    const link = screen.getByRole("link", { name: "ТВ для гостей" });
    const url = new URL(link.getAttribute("href"), window.location.origin);
    expect(url.pathname).toBe("/tv.html");
    expect([...url.searchParams.entries()]).toEqual([["branch", BRANCH.id]]);
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.hash).toBe("");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(api.kdsWsUrl).toHaveBeenCalledWith(BRANCH.id);
  });
});

describe("KitchenApp — monoblock setup, cook picker and PIN", () => {
  const COOK_ONE = { id: "cook-1", name: "Алишер Каримов", has_pin: true };
  const COOK_NO_PIN = { id: "cook-2", name: "Без ПИНа", has_pin: false };

  async function renderFreshScreen() {
    const view = render(<KitchenApp />);
    await screen.findByRole("heading", { name: "Экран кухни" });
    return view;
  }

  function fillSetup() {
    fireEvent.change(screen.getByPlaceholderText("90 111-22-33"), {
      target: { value: "901112233" },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), {
      target: { value: "fixture-pass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить экран" }));
  }

  beforeEach(() => {
    api.hasKdsDevice.mockReturnValue(false);
    api.isKdsAuthenticated.mockReturnValue(false);
    api.kdsConnectDevice.mockResolvedValue({ access_token: "device", branch: BRANCH });
    api.kdsGetCooks.mockResolvedValue([COOK_ONE, COOK_NO_PIN]);
    api.kdsPinLogin.mockResolvedValue({ user_name: COOK_ONE.name, branch: BRANCH });
  });

  it("connects the screen with the monoblock phone and lists the cooks", async () => {
    await renderFreshScreen();
    expect(screen.getByRole("tab", { name: "Моноблок" })).toHaveAttribute("aria-selected", "true");
    expect(api.kdsGetCooks).not.toHaveBeenCalled();

    fillSetup();
    await waitFor(() =>
      expect(api.kdsConnectDevice).toHaveBeenCalledExactlyOnceWith("+998901112233", "fixture-pass", {
        mode: "monoblock",
        branchId: undefined,
      }),
    );
    expect(await screen.findByRole("heading", { name: "Кто на смене?" })).toBeVisible();
    const noPin = screen.getByRole("button", { name: /Без ПИНа/ });
    expect(noPin).toBeDisabled();
    expect(noPin).toHaveTextContent("PIN не задан");
    expect(screen.getByRole("button", { name: /Алишер Каримов/ })).toBeEnabled();
    expect(api.kdsGetCooks).toHaveBeenCalledTimes(1);
  });

  it("asks for a branch when the company has more than one", async () => {
    api.kdsConnectDevice.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          detail: {
            message: "Выберите филиал",
            branches: [
              { id: "branch-a", name: "Филиал на Амира Темура" },
              { id: "branch-b", name: "Филиал в Чиланзаре" },
            ],
          },
        },
      },
    });
    await renderFreshScreen();
    fillSetup();
    const choice = await screen.findByRole("button", { name: "Филиал в Чиланзаре" });
    expect(screen.queryByRole("button", { name: "Подключить экран" })).not.toBeInTheDocument();

    fireEvent.click(choice);
    await waitFor(() =>
      expect(api.kdsConnectDevice).toHaveBeenLastCalledWith("+998901112233", "fixture-pass", {
        mode: "monoblock",
        branchId: "branch-b",
      }),
    );
    expect(await screen.findByRole("heading", { name: "Кто на смене?" })).toBeVisible();
  });

  it("explains a switched-off kitchen permission instead of a generic error", async () => {
    api.kdsConnectDevice.mockRejectedValueOnce({
      response: { status: 403, data: { detail: "Кухня выключена в карточке моноблока" } },
    });
    await renderFreshScreen();
    fillSetup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Кухня выключена в карточке моноблока");
    expect(screen.queryByRole("heading", { name: "Кто на смене?" })).not.toBeInTheDocument();
  });

  it("signs the chosen cook in with their own PIN", async () => {
    await renderFreshScreen();
    fillSetup();
    fireEvent.click(await screen.findByRole("button", { name: /Алишер Каримов/ }));

    expect(screen.getByText(COOK_ONE.name)).toBeVisible();
    expect(screen.getByRole("button", { name: "Выбрать другого" })).toBeVisible();
    ["1", "2", "3", "4"].forEach((digit) =>
      fireEvent.click(screen.getByRole("button", { name: digit, exact: true })),
    );

    expect(api.kdsPinLogin).toHaveBeenCalledExactlyOnceWith("1234", COOK_ONE.id);
    await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false"));
    expect(within(screen.getByRole("main")).getAllByRole("article")).toHaveLength(1);
  });

  it("returns from the PIN pad to the cook list", async () => {
    await renderFreshScreen();
    fillSetup();
    fireEvent.click(await screen.findByRole("button", { name: /Алишер Каримов/ }));
    fireEvent.click(screen.getByRole("button", { name: "Выбрать другого" }));
    expect(await screen.findByRole("heading", { name: "Кто на смене?" })).toBeVisible();
    expect(api.kdsPinLogin).not.toHaveBeenCalled();
  });
});

describe("KitchenApp — live queue recovery", () => {
  it("recovers an initial load failure when a WS new_order event arrives", async () => {
    api.kdsGetOrders.mockRejectedValueOnce(new Error("Fixture offline"));
    await renderBoard();
    expect(screen.getByRole("heading", { name: "Сервер не отвечает" })).toBeVisible();
    await act(async () => sockets[0].message({ event: "new_order" }));
    expect(await screen.findByRole("article", { name: "Заказ TEST-101" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Сервер не отвечает" })).not.toBeInTheDocument();
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
  });

  it("announces the first new order after an initially empty queue", async () => {
    serverOrders = [];
    await renderBoard();
    expect(screen.getByRole("heading", { name: "Кухня свободна" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    serverOrders = [makeOrder()];
    await act(async () => sockets[0].message({ type: "new_order" }));
    expect(card()).toBeVisible();
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/[Нн]ов.*заказ/);
    expect(toast).toHaveTextContent("1");
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
  });

  it("reloads the queue on order_completed and removes the completed card", async () => {
    await renderBoard();
    expect(card()).toBeVisible();
    serverOrders = [];
    await act(async () => sockets[0].message({ event: "order_completed", order_id: ORDER_ID }));
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("article", { name: "Заказ TEST-101" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Кухня свободна" })).toBeVisible();
  });

  it("ignores an older response that arrives after a newer queue snapshot", async () => {
    await renderBoard();
    const older = deferred();
    const newer = deferred();
    api.kdsGetOrders.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await act(async () => {
      sockets[0].message({ event: "order_updated" });
      sockets[0].message({ event: "item_status_changed" });
    });
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(3);
    await act(async () => newer.resolve({ items: [makeOrder({
      status: "ready", items: [makeItem({ status: "ready" })],
    })] }));
    expectDishReady(true);
    await act(async () => older.resolve({ items: [makeOrder()] }));
    expectDishReady(true);
    expect(within(card()).getByRole("button", { name: "Стол готов", exact: true })).toBeDisabled();
  });

  it("continues polling even with an open WebSocket", async () => {
    vi.useFakeTimers();
    await act(async () => { render(<KitchenApp />); });
    await act(async () => sockets[0].open());
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
    serverOrders = [makeOrder({ status: "ready", items: [makeItem({ status: "ready" })] })];
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(3);
    expectDishReady(true);
    expect(sockets).toHaveLength(1);
  });

  it("reconnects a closed WebSocket, reloads on open, and cancels timers on unmount", async () => {
    vi.useFakeTimers();
    let view;
    await act(async () => { view = render(<KitchenApp />); });
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(1);
    act(() => sockets[0].close());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toBe("ws://fixture.invalid/kitchen");
    serverOrders = [];
    await act(async () => sockets[1].open());
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Кухня свободна" })).toBeVisible();
    act(() => sockets[1].close());
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(sockets).toHaveLength(2);
    expect(api.kdsGetOrders).toHaveBeenCalledTimes(2);
  });
});
