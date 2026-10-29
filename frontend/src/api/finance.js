import { api } from "./client";

function definedParams(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function createTransactionIdempotencyKey() {
  const randomPart = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `owner-finance-${randomPart}`;
}

export function resolveTransactionSubmission(previous, payload, keyFactory = createTransactionIdempotencyKey) {
  const fingerprint = JSON.stringify(payload);
  if (previous?.fingerprint === fingerprint && previous.idempotencyKey) return previous;
  return { fingerprint, idempotencyKey: keyFactory() };
}

export const financeService = {
  getIncomeSummary({ dateFrom, dateTo, signal } = {}) {
    return api.get("/finance/transactions/summary", {
      params: definedParams({ date_from: dateFrom, date_to: dateTo, web_timezone: dateFrom || dateTo ? "Asia/Tashkent" : undefined }),
      ...(signal ? { signal } : {}),
    });
  },
  listTransactions({ dateFrom, dateTo, direction, signal } = {}) {
    return api.get("/finance/transactions", {
      params: definedParams({ date_from: dateFrom, date_to: dateTo, direction, web_timezone: dateFrom || dateTo ? "Asia/Tashkent" : undefined }),
      ...(signal ? { signal } : {}),
    });
  },

  createTransaction(payload, idempotencyKey) {
    return idempotencyKey
      ? api.post("/finance/transactions", payload, { headers: { "Idempotency-Key": idempotencyKey } })
      : api.post("/finance/transactions", payload);
  },

  updateTransaction(transactionId, payload) {
    return api.patch(`/finance/transactions/${transactionId}`, payload);
  },

  listPaymentTypes({ page = 1, size = 200, signal, ...params } = {}) {
    return api.get("/finance/payment-types", { params: { page, size, ...params }, ...(signal ? { signal } : {}) });
  },

  listTransactionCategories(kind, { signal } = {}) {
    if (kind) {
      return api.get("/finance/transaction-categories", { params: { kind }, ...(signal ? { signal } : {}) });
    }
    return signal
      ? api.get("/finance/transaction-categories", { signal })
      : api.get("/finance/transaction-categories");
  },

  createTransactionCategory(payload) {
    return api.post("/finance/transaction-categories", payload);
  },

  updateTransactionCategory(categoryId, payload) {
    return api.patch(`/finance/transaction-categories/${categoryId}`, payload);
  },

  deleteTransactionCategory(categoryId) {
    return api.delete(`/finance/transaction-categories/${categoryId}`);
  },

  listCounterparties({ page = 1, size = 200, signal, ...params } = {}) {
    return api.get("/finance/counterparties", { params: { page, size, ...params }, ...(signal ? { signal } : {}) });
  },

  listFinanceHistory({ page = 1, size = 20, ...params } = {}) {
    return api.get("/finance/finance-history", { params: { page, size, ...params } });
  },

  listCounterpartyTransactions(counterpartyId, { page = 1, size = 20, ...params } = {}) {
    return api.get(`/finance/counterparties/${counterpartyId}/transactions`, {
      params: { page, size, ...params, ...(params.date_from || params.date_to ? { web_timezone: "Asia/Tashkent" } : {}) },
    });
  },

  // DEBT-ORDERS-01: заказы клиента (закрытые «в долг»). Долг не создаёт
  // финансовую транзакцию, поэтому в «Истории транзакций» у должника было
  // пусто — показываем его заказы, как в отчёте по заказам.
  listCounterpartyOrders(counterpartyId, { dateFrom, dateTo, signal } = {}) {
    return api.get(`/finance/counterparties/${counterpartyId}/orders`, {
      params: definedParams({ date_from: dateFrom, date_to: dateTo }),
      ...(signal ? { signal } : {}),
    });
  },
};
