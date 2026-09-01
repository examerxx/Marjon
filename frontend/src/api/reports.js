import { api } from "./client";

function rangeParams(dateFrom, dateTo, extra = {}) {
  return { date_from: dateFrom, date_to: dateTo, ...extra };
}

function compactParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== "all"));
}

export const reportsService = {
  // Single day: { date }. Period aggregation: { date_from, date_to }. The caller
  // passes exactly one shape; the backend (ZR-PERIOD-01) validates the mode.
  getZReport(params = {}, config = {}) {
    return api.get("/analytics/z-report", { params, ...config });
  },
  listOrders(dateFrom, dateTo, config = {}) {
    return api.get("/reports/orders", { params: rangeParams(dateFrom, dateTo), ...config });
  },
  listTables(dateFrom, dateTo, { filters = {}, ...config } = {}) {
    const filterParams = compactParams({
      table_number: filters.tableNumber?.trim(),
      waiter_id: filters.waiterId,
      payment_method: filters.paymentMethod,
      cashier_id: filters.cashierId,
      hall_id: filters.hallId,
    });
    return api.get("/reports/tables", { params: rangeParams(dateFrom, dateTo, filterParams), ...config });
  },
  getTablesFilters(config = {}) {
    return api.get("/reports/tables/filters", config);
  },
  listWaiters(dateFrom, dateTo, config = {}) {
    return api.get("/reports/waiters", { params: rangeParams(dateFrom, dateTo), ...config });
  },
  listDishes(dateFrom, dateTo, config = {}) {
    return api.get("/reports/dishes", { params: rangeParams(dateFrom, dateTo), ...config });
  },
  listCancelledDishes(dateFrom, dateTo, config = {}) {
    return api.get("/reports/cancelled", { params: rangeParams(dateFrom, dateTo), ...config });
  },
  listDebtCredit(dateFrom, dateTo, counterpartyId, config = {}) {
    return api.get("/reports/debt-credit", {
      params: rangeParams(dateFrom, dateTo, counterpartyId ? { counterparty_id: counterpartyId } : {}),
      ...config,
    });
  },
};

export const analyticsService = {
  getDashboard(date, config = {}) {
    return api.get("/analytics/dashboard", { params: { date }, ...config });
  },
  listSales(dateFrom, dateTo, config = {}) {
    return api.get("/analytics/sales", { params: rangeParams(dateFrom, dateTo), ...config });
  },
  listTopProducts({ limit = 20, dateFrom, dateTo, signal } = {}) {
    return api.get("/analytics/products/top", {
      params: rangeParams(dateFrom, dateTo, { limit }),
      ...(signal ? { signal } : {}),
    });
  },
};
