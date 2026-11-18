import { analyticsService, reportsService } from "./reports";
import { catalogService } from "./catalog";
import { financeService } from "./finance";
import { webDayKey, webTime } from "../utils/webTime";
import { settingsService } from "./settings";
import { staffService } from "./staff";

export const dashboardService = Object.freeze({
  loadOwnerOverview({ dateFrom, dateTo, timeFrom, timeTo, signal }) {
    const config = signal ? { signal } : undefined;
    const financials = analyticsService.getOwnerFinancials(dateFrom, dateTo, config,
      { ...(timeFrom ? { time_from: timeFrom } : {}), ...(timeTo ? { time_to: timeTo } : {}) }).catch((error) => {
      if (signal?.aborted || error?.code === "ERR_CANCELED" || error?.name === "AbortError") throw error;
      return { data: { metric_basis: "completed_income_minus_snapshot_cogs", financial_unavailable: true,
        today_revenue: null, income_total: null, cogs_total: null, sales: [],
        profit_unavailable_reason: "Не удалось загрузить оплаты и историческую себестоимость." } };
    });
    return Promise.all([
      // Same response drives the KPI formula and graph for the entire period.
      financials,
      financials.then((res) => ({ data: res.data.sales || [] })),
      // A new report may be unavailable on an older backend. Isolate that
      // card without replacing confirmed sales with the old unpaid ranking.
      analyticsService.listTopProducts({ limit: 5, dateFrom, dateTo, timeFrom, timeTo, signal, confirmedOnly: true })
        .catch((error) => {
          if (signal?.aborted || error?.code === "ERR_CANCELED" || error?.name === "AbortError") throw error;
          return { data: [], unavailable: true, unavailableReason: error?.response?.status === 404
            ? "Для рейтинга оплаченных продаж требуется обновление backend."
            : "Не удалось загрузить подтверждённые продажи." };
        }),
      catalogService.listProducts(config),
      staffService.listEmployees(config),
      reportsService.listOrders(dateFrom, dateTo, {
        ...config,
        filters: { orderStatus: ["new", "accepted", "cooking", "ready", "completed", "cancelled"] },
      }).then(({ data }) => {
        const rows = Array.isArray(data) ? data : data.items;
        const start = `${dateFrom}T${timeFrom || "00:00"}`;
        const end = `${dateTo}T${timeTo || "23:59"}`;
        return { data: rows.filter((order) => {
          const timestamp = `${webDayKey(order.created_at)}T${webTime(order.created_at)}`;
          return timestamp >= start && timestamp <= end;
        }).slice(0, 5) };
      }).catch((error) => {
        if (signal?.aborted || error?.code === "ERR_CANCELED" || error?.name === "AbortError") throw error;
        return { data: [], unavailable: true };
      }),
      settingsService.listDashboardPlaces(config),
      Promise.all([
        financeService.listTransactions({ dateFrom, dateTo, signal }),
        financeService.listOrderDebtOperations({ dateFrom, dateTo, signal }),
        financeService.listTransactionCategories(undefined, { signal }),
      ]).then(([transactions, debts, categories]) => {
        const rows = Array.isArray(transactions.data) ? transactions.data : transactions.data.items || [];
        const debtRows = (Array.isArray(debts.data) ? debts.data : debts.data?.items || []).filter(row => {
          const timestamp = `${webDayKey(row.date)}T${webTime(row.date)}`;
          return timestamp >= `${dateFrom}T${timeFrom || "00:00"}` && timestamp <= `${dateTo}T${timeTo || "23:59"}`;
        }).map(row => ({ ...row, id: `order-debt-${row.id}`, direction: "expense",
          category_name: "Продажа в долг", isOrderDebt: true, non_cash: true }));
        const categoryRows = Array.isArray(categories.data) ? categories.data : categories.data.items || [];
        const names = new Map(categoryRows.map(row => [String(row.id), row.name]));
        return { data: [...rows.map(row => ({ ...row, category_name: row.category_name || names.get(String(row.category_id)) })), ...debtRows] };
      }),
      Promise.resolve().then(() => reportsService.listDebtCredit(dateFrom, dateTo, undefined, config))
        .catch((error) => {
          if (signal?.aborted || error?.code === "ERR_CANCELED" || error?.name === "AbortError") throw error;
          return { data: null };
        }),
    ]);
  },
});
