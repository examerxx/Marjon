import { api } from "./client";

function rangeParams(dateFrom, dateTo, extra = {}) {
  return { date_from: dateFrom, date_to: dateTo, ...extra };
}

function compactParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => (
    value !== undefined && value !== null && value !== "" && value !== "all"
    && !(Array.isArray(value) && value.length === 0)
  )));
}

// FastAPI reads list params (`ids: list[UUID] = Query(...)`, and REPORT-04's
// `waiter_id: list[UUID] | None`) from REPEATED query params (`ids=A&ids=B`).
// Axios' default array serializer emits `ids[]=A&ids[]=B`, which the canonical
// backend rejects with 422 "Field required" — so the repeated-list form is part
// of these endpoints' contract, not a caller option.
const REPEATED_IDS_SERIALIZER = Object.freeze({ indexes: null });

export const reportsService = {
  // Single day: { date }. Period aggregation: { date_from, date_to }. The caller
  // passes exactly one shape; the backend (ZR-PERIOD-01) validates the mode.
  getZReport(params = {}, config = {}) {
    return api.get("/analytics/z-report", { params, ...config });
  },
  // Per-entity Z-report sections (ZR-PRINT-01B). Exactly one dimension per
  // request — "cashier" | "waiter" | "hall" — plus the SAME two date modes as
  // getZReport. Menu is deliberately not a dimension. No percentage is ever
  // sent: the waiter % is a print-time presentation applied to net_sales.
  getZReportDetail(params = {}, config = {}) {
    return api.get("/analytics/z-report/detail", {
      params,
      ...config,
      paramsSerializer: REPEATED_IDS_SERIALIZER,
    });
  },
  listOrders(dateFrom, dateTo, { filters = {}, ...config } = {}) {
    const filterParams = compactParams({
      order_number: filters.orderNumber?.trim(),
      waiter_id: filters.waiterId,
      cashier_id: filters.cashierId,
      product_id: filters.productId,
      order_type: filters.orderType,
      order_status: filters.orderStatus,
      payment_method: filters.paymentMethod,
    });
    return api.get("/reports/orders", {
      params: rangeParams(dateFrom, dateTo, filterParams),
      ...config,
      paramsSerializer: REPEATED_IDS_SERIALIZER,
    });
  },
  getOrdersFilters(config = {}) {
    return api.get("/reports/orders/filters", config);
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
  listDishes(dateFrom, dateTo, { filters = {}, ...config } = {}) {
    const filterParams = compactParams({
      query: filters.query?.trim(),
      author_id: filters.authorId,
      product_id: filters.productId,
      order_type: filters.orderType,
      order_status: filters.orderStatus,
      category_id: filters.categoryId,
      payment_method: filters.paymentMethod,
    });
    return api.get("/reports/dishes", { params: rangeParams(dateFrom, dateTo, filterParams), ...config });
  },
  getDishesFilters(config = {}) {
    return api.get("/reports/dishes/filters", config);
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
