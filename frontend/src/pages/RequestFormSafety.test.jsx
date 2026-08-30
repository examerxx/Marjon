import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import SupportWidget from "../components/SupportWidget";
import FinanceTransactionsPage from "./FinanceTransactionsPage";
import StaffPage from "./StaffPage";
import ZReportPage from "./ZReportPage";
import {
  apiMapFormToPayload as mapClientPayload,
  apiMapRow as mapClientRow,
} from "./settings/SettingsClientsPage";
// NOTE (TEST-SAFETY-01): SettingsPlacesPage no longer exports a pure
// `apiMapFormToPayload` — the Place feature migrated off the shared mapper to a
// page-local submit path (`hallPayload()`). Its payload-safety coverage (invalid
// percent rejected without POST + canonical-fields-only, never condition-as-money)
// now lives at the real boundary in SettingsPlacesPage.test.jsx, so it is not
// imported here.
import { apiMapFormToPayload as mapPaymentPayload } from "./settings/SettingsPaymentMethodsPage";
import {
  apiMapFormToPayload as mapPrinterPayload,
  apiMapRow as mapPrinterRow,
} from "./settings/SettingsPrintersPage";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  formatMoney: (value) => `${Number(value).toLocaleString("ru-RU")} UZS`,
  formatNumber: (value) => String(value),
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function financeReferenceResponse(path) {
  if (path === "/finance/payment-types") return { data: { items: [] } };
  if (path === "/finance/transaction-categories") return { data: { items: [] } };
  if (path === "/finance/counterparties") return { data: { items: [] } };
  return null;
}

describe("FE-06 request and form safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: {} });
  });

  it("keeps the latest finance response and aborts ownership of an older filter request", async () => {
    const first = deferred();
    const second = deferred();
    const transactionSignals = [];
    let transactionCall = 0;
    api.get.mockImplementation((path, config) => {
      const reference = financeReferenceResponse(path);
      if (reference) return Promise.resolve(reference);
      if (path === "/finance/transactions") {
        transactionSignals.push(config.signal);
        transactionCall += 1;
        return transactionCall === 1 ? first.promise : second.promise;
      }
      return Promise.resolve({ data: [] });
    });

    render(<FinanceTransactionsPage />);
    await waitFor(() => expect(transactionCall).toBe(1));
    fireEvent.change(screen.getByLabelText("Направление"), { target: { value: "income" } });
    await waitFor(() => expect(transactionCall).toBe(2));
    expect(transactionSignals[0].aborted).toBe(true);

    await act(async () => second.resolve({ data: { items: [{ id: "new", date: "2026-08-13", amount: 222, direction: "income" }] } }));
    expect((await screen.findAllByText(/222 UZS/)).length).toBeGreaterThan(0);
    await act(async () => first.resolve({ data: { items: [{ id: "old", date: "2026-08-12", amount: 111, direction: "income" }] } }));
    expect(screen.queryByText(/111 UZS/)).not.toBeInTheDocument();
  });

  it("blocks duplicate finance creates and keeps the drawer open after backend failure", async () => {
    api.get.mockImplementation((path) => Promise.resolve(
      path === "/finance/transactions" ? { data: { items: [] } } : financeReferenceResponse(path) || { data: [] },
    ));
    const create = deferred();
    api.post
      .mockReturnValueOnce(create.promise)
      .mockResolvedValueOnce({ data: { id: "tx-1", date: "2026-08-13", amount: 1250, direction: "income" } });

    render(<FinanceTransactionsPage />);
    await screen.findByText("Транзакций нет.");
    fireEvent.click(screen.getByRole("button", { name: /ПРИХОД/ }));
    fireEvent.change(screen.getByLabelText("Сумма, UZS"), { target: { value: "1e3" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Сумма, UZS"), { target: { value: "1250" } });
    const save = screen.getByRole("button", { name: "Сохранить" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/finance/transactions",
      expect.objectContaining({ amount: 1250, direction: "income" }),
      { headers: { "Idempotency-Key": expect.stringMatching(/^owner-finance-/) } },
    );
    const firstIdempotencyKey = api.post.mock.calls[0][2].headers["Idempotency-Key"];

    await act(async () => create.reject({ response: { data: { detail: "Backend rejected create" } } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend rejected create");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][2].headers["Idempotency-Key"]).toBe(firstIdempotencyKey);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("blocks duplicate employee creation and preserves the selected staff UUID", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/hr/employees") return Promise.resolve({ data: [] });
      if (path === "/auth/users") return Promise.resolve({ data: [{ id: "staff-uuid", email: "staff@example.test", role_slug: "cashier", role_slugs: ["cashier"], is_active: true, is_superadmin: false }] });
      if (path === "/companies/me/branches") return Promise.resolve({ data: [{ id: "branch-uuid", name: "Main" }] });
      return Promise.resolve({ data: [] });
    });
    const create = deferred();
    api.post.mockReturnValue(create.promise);
    render(<StaffPage />);
    await screen.findByText("Сотрудников пока нет.");
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    fireEvent.change(screen.getByLabelText("Учётная запись сотрудника"), { target: { value: "staff-uuid" } });
    fireEvent.change(screen.getByLabelText("Филиал"), { target: { value: "branch-uuid" } });
    fireEvent.change(screen.getByLabelText("Позиция"), { target: { value: "Кассир" } });
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "500" } });
    const form = screen.getByRole("button", { name: "Сохранить" }).closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/hr/employees", expect.objectContaining({
      user_id: "staff-uuid",
      branch_id: "branch-uuid",
      salary_amount: 500,
    }));
    await act(async () => create.resolve({ data: { id: "employee-uuid", user_id: "staff-uuid", branch_id: "branch-uuid", position: "Кассир", hire_date: "2026-08-13", salary_type: "fixed", salary_amount: 500 } }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the newest Z-report date and treats the aborted older request as intentional", async () => {
    const first = deferred();
    const second = deferred();
    const signals = [];
    let calls = 0;
    api.get.mockImplementation((path, config) => {
      if (path !== "/analytics/z-report") return Promise.resolve({ data: [] });
      calls += 1;
      signals.push(config.signal);
      return calls === 1 ? first.promise : second.promise;
    });
    render(<ZReportPage />);
    await waitFor(() => expect(calls).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Период Z-отчёта" }));
    fireEvent.change(screen.getByLabelText("Начало периода"), { target: { value: "12.08.2026" } });
    fireEvent.change(screen.getByLabelText("Конец периода"), { target: { value: "12.08.2026" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ОК" })[0]);
    await waitFor(() => expect(calls).toBe(2));
    expect(signals[0].aborted).toBe(true);
    await act(async () => second.resolve({ data: { date: "2026-08-12", is_closed: false, gross_sales: 222, discounts_total: 0, service_fee_total: 0, tax_total: 0, refunds_total: 0, net_sales: 222, orders_count: 1, avg_check: 222, payment_methods: [{ method: "Newest payment", count: 1, amount: 222 }] } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Печать общего Z-отчёта/ })).toBeEnabled());
    await act(async () => first.resolve({ data: { date: "2026-08-13", is_closed: false, gross_sales: 111, discounts_total: 0, service_fee_total: 0, tax_total: 0, refunds_total: 0, net_sales: 111, orders_count: 1, avg_check: 111, payment_methods: [{ method: "Obsolete payment", count: 1, amount: 111 }] } }));
    expect(screen.queryByText("Obsolete payment")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the Z period first level compact, restores time controls, and applies the full current month", async () => {
    api.get.mockImplementation((path) => Promise.resolve(path === "/analytics/z-report"
      ? { data: { date: "2026-08-24", is_closed: false, payment_methods: [] } }
      : { data: [] }));
    render(<ZReportPage />);

    fireEvent.click(screen.getByRole("button", { name: "Период Z-отчёта" }));
    expect(screen.queryByRole("button", { name: "Предыдущий месяц" })).not.toBeInTheDocument();
    expect(screen.getByText("Время").closest(".report-date-calendar-shell")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByLabelText("Начало периода"));
    expect(screen.getByRole("button", { name: "Предыдущий месяц" })).toBeInTheDocument();
    expect(screen.getByText("Время")).toBeInTheDocument();
    expect(screen.getByText("Часы")).toBeInTheDocument();
    expect(screen.getByText("Минуты")).toBeInTheDocument();
    expect(screen.getByLabelText("Начало периода").closest("label")).toHaveClass("is-active");
    expect(screen.queryByRole("combobox", { name: "Год" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Месяц" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Год" }));
    expect(screen.getByRole("listbox", { name: "Выбор года" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2026" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "2027" }));
    expect(screen.getByRole("button", { name: "Год" })).toHaveTextContent("2027");

    fireEvent.click(screen.getByRole("button", { name: "Месяц" }));
    expect(screen.getByRole("listbox", { name: "Выбор месяца" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Январь" }));
    fireEvent.click(screen.getByRole("button", { name: "Предыдущий месяц" }));
    expect(screen.getByRole("button", { name: "Год" })).toHaveTextContent("2026");
    expect(screen.getByRole("button", { name: "Месяц" })).toHaveTextContent("Декабрь");

    fireEvent.click(screen.getByLabelText("Конец периода"));
    expect(screen.getByLabelText("Начало периода").closest("label")).not.toHaveClass("is-active");
    expect(screen.getByLabelText("Конец периода").closest("label")).toHaveClass("is-active");
    fireEvent.click(screen.getAllByRole("button", { name: "ОК" })[1]);
    expect(screen.queryByRole("button", { name: "Предыдущий месяц" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Этот месяц" }));
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, "0");
    expect(screen.getByLabelText("Начало периода")).toHaveValue(`01.${month}.${year}`);
    expect(screen.getByLabelText("Конец периода")).toHaveValue(`${lastDay}.${month}.${year}`);
    fireEvent.click(screen.getByRole("button", { name: "ОК" }));
    expect(screen.getByRole("button", { name: "Период Z-отчёта" })).toHaveTextContent(`01.${month}.${year} – ${lastDay}.${month}.${year}`);
  });

  it("does not show support success before confirmation and allows a retry after failure", async () => {
    const first = deferred();
    api.post.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data: { id: "ticket-1" } });
    render(<SupportWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть поддержку" }));
    fireEvent.change(screen.getByPlaceholderText("Коротко опишите вопрос..."), { target: { value: "Нужна помощь" } });
    const send = screen.getByRole("button", { name: "Отправить" });
    fireEvent.click(send);
    fireEvent.submit(send.closest("form"));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Закрыть" })).toHaveLength(2);
    screen.getAllByRole("button", { name: "Закрыть" }).forEach((button) => expect(button).toBeDisabled());
    expect(screen.queryByText("Заявка принята")).not.toBeInTheDocument();

    await act(async () => first.reject({ response: { data: { detail: "Support unavailable" } } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Support unavailable");
    expect(screen.queryByText("Заявка принята")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Заявка принята")).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("keeps settings payloads on their exact backend fields and rejects invalid numeric input", () => {
    expect(mapClientPayload({ name: " Client ", phone: " 99890 ", type: "clients" })).toEqual({
      full_name: "Client",
      phone: "99890",
      type: "client",
    });
    expect(mapClientPayload({ name: "   ", phone: "99890", type: "clients" })).toBeNull();
    expect(mapClientRow({ id: "cp", full_name: "Server", type: "supplier" })).toEqual({
      id: "cp",
      type: "suppliers",
      name: "Server",
      phone: "",
      status: "—",
    });
    // Place payload safety (invalid percent rejected, canonical fields only,
    // condition never sent) is asserted at its real boundary in
    // SettingsPlacesPage.test.jsx — see TEST-SAFETY-01.
    expect(mapPaymentPayload({ name: "Cash", sort: "x", typeLabel: "cash", status: "#активно" })).toBeNull();
    expect(mapPaymentPayload({ name: "Cash", sort: "10abc", typeLabel: "cash", status: "#активно" })).toBeNull();
    expect(mapPrinterPayload({ name: "Kitchen", printerType: "kitchen", connectionType: "network", ip: "10.0.0.2", port: "70000", zone: "Kitchen", status: "Активно" }, { editing: false })).toBeNull();
    expect(mapPrinterPayload({ name: "Kitchen", printerType: "kitchen", connectionType: "network", ip: "10.0.0.2", port: "9100abc", zone: "Kitchen", status: "Активно" }, { editing: false })).toBeNull();
    expect(mapPrinterPayload({ name: "Kitchen", printerType: "kitchen", connectionType: "network", ip: "10.0.0.2", port: "9100", zone: "Kitchen", status: "Активно" }, { editing: true })).toEqual({
      name: "Kitchen",
      printer_type: "kitchen",
      connection_type: "network",
      ip_address: "10.0.0.2",
      port: 9100,
      zone: "Kitchen",
      is_active: true,
    });
    expect(mapPrinterRow({ id: "p", name: "Printer", printer_type: null, connection_type: null, ip_address: "10.0.0.2", port: null })).toMatchObject({
      printerType: "",
      connectionType: "",
      port: "",
      endpoint: "",
    });
  });
});
