import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/finance", () => ({
  financeService: {
    listCounterparties: vi.fn(),
    listTransactionCategories: vi.fn(),
    createTransactionCategory: vi.fn(),
  },
}));

import { financeService } from "../../../api/finance";
import {
  allocateDebtToOrders, ensureRepaymentCategory, loadClientDebts, displayRepaymentComment, orderRepaymentComment, parseOrderRepayment, purchaseRepaymentComment, repaymentPayload,
} from "./clientDebts";

beforeEach(() => vi.clearAllMocks());

describe("сценарий: 340 000 в долг, +200 000, ещё 410 000 в долг, погашения частями", () => {
  const orders = [
    // сервер отдаёт новые сверху
    { order_id: "b", order_number: 2, closed_at: "2026-11-02T15:00:00Z", debt_amount: "410000" },
    { order_id: "a", order_number: 1, closed_at: "2026-11-01T15:00:00Z", debt_amount: "340000" },
  ];
  const left = (balance) => Object.fromEntries(allocateDebtToOrders(orders, balance).map((o) => [o.order_number, o.open_amount]));

  it("после 200 000 долг 550 000: первый счёт закрыт на 200 000, второй целиком", () => {
    expect(left(550000)).toEqual({ 1: 140000, 2: 410000 });
  });

  it("ещё 150 000 → 400 000: первый счёт погашен полностью, второй — частично", () => {
    const result = allocateDebtToOrders(orders, 400000);
    expect(result.find((o) => o.order_number === 1)).toMatchObject({ open_amount: 0, repaid: true });
    expect(result.find((o) => o.order_number === 2)).toMatchObject({ open_amount: 400000, repaid: false });
  });

  it("долг 0 или переплата — все счета погашены; порядок строк не меняется", () => {
    expect(left(0)).toEqual({ 1: 0, 2: 0 });
    expect(left(-50000)).toEqual({ 1: 0, 2: 0 });
    expect(allocateDebtToOrders(orders, 0).map((o) => o.order_number)).toEqual([2, 1]);
  });

  it("сальдо больше суммы счетов (другие долги) — счета остаются с полным долгом", () => {
    expect(left(900000)).toEqual({ 1: 340000, 2: 410000 });
  });
});

describe("погашение", () => {
  it("тело запроса: приход на клиента в категории «Возврат долга» с датой и способом оплаты", () => {
    const date = new Date("2026-11-17T10:00:00Z");
    expect(repaymentPayload({ amount: 200000, clientId: "c1", categoryId: "cat", paymentTypeId: "cash", date, comment: "  " }))
      .toEqual({
        amount: 200000, direction: "income", counterparty_id: "c1", category_id: "cat",
        payment_type_id: "cash", date: "2026-11-17T10:00:00.000Z", comment: "Погашение долга",
      });
  });

  it("берёт существующую категорию «Возврат долга» (без учёта регистра и пробелов)", async () => {
    financeService.listTransactionCategories.mockResolvedValue({ data: { items: [
      { id: "x", name: "Продажи", kind: "income" },
      { id: "r", name: " возврат ДОЛГА ", kind: "income" },
    ] } });
    await expect(ensureRepaymentCategory()).resolves.toMatchObject({ id: "r" });
    expect(financeService.createTransactionCategory).not.toHaveBeenCalled();
  });

  it("если категории нет — создаёт её", async () => {
    financeService.listTransactionCategories.mockResolvedValue({ data: { items: [] } });
    financeService.createTransactionCategory.mockResolvedValue({ data: { id: "new", name: "Возврат долга", kind: "income" } });
    await expect(ensureRepaymentCategory()).resolves.toMatchObject({ id: "new" });
    expect(financeService.createTransactionCategory).toHaveBeenCalledWith({ name: "Возврат долга", kind: "income", status: true });
  });

  it("долги клиентов: только клиенты, баланс уже за вычетом погашений", async () => {
    financeService.listCounterparties.mockResolvedValue({ data: { items: [
      { id: 1, type: "client", balance: "550000.00" },
      { id: 2, type: "supplier", balance: "-100" },
      { id: 3, type: "client", balance: "0" },
    ], total: 3 } });
    const debts = await loadClientDebts();
    expect([...debts]).toEqual([["1", 550000], ["3", 0]]);
  });
});

describe("погашение конкретного счёта (кнопка в строке заказа)", () => {
  // данные Алишера: два разных заказа с номером 2
  const orders = [
    { order_id: "n2", public_id: 10000149, order_number: 2, closed_at: "2026-11-16T16:58:00Z", debt_amount: "30800" },
    { order_id: "n5", public_id: 10000145, order_number: 5, closed_at: "2026-11-16T10:10:00Z", debt_amount: "227868" },
    { order_id: "n1", public_id: 10000141, order_number: 1, closed_at: "2026-11-15T19:20:00Z", debt_amount: "1242468" },
    { order_id: "o2", public_id: 10000142, order_number: 2, closed_at: "2026-11-15T18:58:00Z", debt_amount: "398388" },
    { order_id: "n9", public_id: 10000129, order_number: 9, closed_at: "2026-11-11T17:08:00Z", debt_amount: "241188" },
  ];
  const repayments = [
    { date: "2026-11-15T20:09:00Z", amount: "1000000", direction: "income", comment: null },
    { date: "2026-11-17T14:41:00Z", amount: "12323", direction: "income", comment: null },
    { date: "2026-11-17T14:59:00Z", amount: "20000", direction: "income", comment: "Погашение по заказу № 2" },
  ];
  const open = (list) => Object.fromEntries(list.map((o) => [o.order_id, o.open_amount]));

  it("было 30 800, погасили 20 000 по заказу № 2 — на нём осталось 10 800, остальное от старых к новым", () => {
    const result = open(allocateDebtToOrders(orders, 1108389, repayments));
    expect(result).toEqual({ n2: 10800, n5: 227868, n1: 869721, o2: 0, n9: 0 });
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(1108389);
  });

  it("по номеру и дате попадает точно в свой счёт, даже если номер повторяется", () => {
    const withId = [{ date: "2026-11-17T15:00:00Z", amount: "100000", direction: "income", comment: orderRepaymentComment(orders[3]) }];
    // долг уменьшился на 100 000 — и именно у старого заказа № 2
    const result = open(allocateDebtToOrders(orders, 2140712 - 100000, withId));
    expect(result).toMatchObject({ o2: 298388, n2: 30800 });
  });

  it("комментарий без ID: номер заказа и дата его закрытия (по Ташкенту); разбор обратно", () => {
    expect(orderRepaymentComment(orders[0])).toBe("Погашение по заказу № 2 от 16.11.2026");
    expect(orderRepaymentComment(orders[3])).toBe("Погашение по заказу № 2 от 15.11.2026");
    expect(parseOrderRepayment("Погашение по заказу № 2 от 16.11.2026")).toEqual({ orderNumber: "2", publicId: null, day: "16.11.2026" });
    // ранние записи с ID тоже понимаем, но показываем без ID
    expect(parseOrderRepayment("Погашение по заказу № 2 (ID 10000149)")).toEqual({ orderNumber: "2", publicId: "10000149", day: null });
    expect(displayRepaymentComment("Погашение по заказу № 2 (ID 10000149)")).toBe("Погашение по заказу № 2");
    expect(parseOrderRepayment("Погашение по заказу № 2")).toEqual({ orderNumber: "2", publicId: null, day: null });
    expect(parseOrderRepayment("просто приход")).toBeNull();
  });
});

describe("оплаты поставщику по приходам «на потом»", () => {
  const purchases = [
    { order_id: "p15", order_number: 15, closed_at: "2026-11-18T16:16:00Z", debt_amount: "333000" },
    { order_id: "p14", order_number: 14, closed_at: "2026-11-18T16:11:00Z", debt_amount: "300000" },
  ];
  const pay = (amount, comment, date = "2026-11-18T17:00:00Z") => ({ id: `t${amount}`, date, amount, direction: "expense", comment });

  it("комментарий и разбор: «Оплата по приходу № N от дата»", () => {
    expect(purchaseRepaymentComment(purchases[1])).toBe("Оплата по приходу № 14 от 18.11.2026");
    expect(parseOrderRepayment("Оплата по приходу № 14 от 18.11.2026")).toEqual({ orderNumber: "14", publicId: null, day: "18.11.2026" });
  });

  it("оплата «по приходу» гасит именно его; расходом считается направление expense, а не income", () => {
    const payments = [pay(100000, "Оплата по приходу № 14 от 18.11.2026"), { id: "inc", date: "2026-11-18T18:00:00Z", amount: "999", direction: "income", comment: null }];
    const result = Object.fromEntries(allocateDebtToOrders(purchases, 533000, payments, { direction: "expense" }).map((o) => [o.order_id, o.open_amount]));
    expect(result).toEqual({ p15: 333000, p14: 200000 });
  });

  it("общая оплата закрывает приходы от старых к новым", () => {
    const result = Object.fromEntries(allocateDebtToOrders(purchases, 233000, [pay(400000, "Оплата долга поставщику")], { direction: "expense" }).map((o) => [o.order_id, o.open_amount]));
    expect(result).toEqual({ p15: 233000, p14: 0 });
  });
});
