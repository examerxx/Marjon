import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { adminFinanceApi, resolveHqTransactionSubmission } from "./financeApi";

import { organizationsApi } from "./features/organizations/organizationsApi";

import { normalizePaginatedList } from "../api/normalizers";

import Icon from '../components/Icon';

import ReportDateRangePicker from "../components/ReportDateRangePicker";

import { createPortal } from "react-dom";
import { parseWebInstant, webFormat, webTime, webCalendarToday } from "../utils/webTime";

import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";

import { ADMIN_DASHBOARD_DATE_PRESET_LABELS, adminDateToInputValue, adminInputDateToReportDate, adminReportDateToInputDate, adminTodayInputValue, buildAdminDashboardDateRange, formatAdminDashboardDateRangeButton, formatCurrency, formatSignedFinanceAmount, getAdminFinanceLoadMessage, isUuidLike, normalizeAdminReportRange } from "./AdminShared";

const ADMIN_FINANCE_COUNTERPARTY_TYPES = [
  { value: "provider", label: "Поставщики" },
  { value: "client", label: "Клиенты" },
  { value: "employee", label: "Сотрудники" },
  { value: "other", label: "Другие" },
];

const ADMIN_FINANCE_CALENDAR_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

const ADMIN_FINANCE_CALENDAR_WEEK_DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

const ADMIN_FINANCE_CALENDAR_YEARS = Array.from({ length: 15 }, (_, index) => 2020 + index);

const ADMIN_FINANCE_MODAL_ANIMATION_MS = 180;

const ADMIN_FINANCE_COMMENT_LIMIT = 500;

const ADMIN_FINANCE_REQUIRED_FIELDS = ["amount", "paymentTypeId", "organizationId", "date", "categoryId"];

export function extractAdminFinanceItems(data) {
  return normalizePaginatedList(data).items;
}

function normalizeAdminFinanceOption(item, index, labelFields = ["name"]) {
  const rawId = item?.id || item?.uuid || item?.value || "";
  const label = labelFields.map((field) => item?.[field]).find(Boolean) || item?.label || rawId || `option-${index + 1}`;
  return {
    id: String(rawId || `${label}-${index}`),
    apiId: isUuidLike(rawId) ? String(rawId) : null,
    label: String(label),
    raw: item,
  };
}

function normalizeAdminFinanceTransaction(row, index = 0) {
  const operationType = row.direction || row.operation_type || (Number(row.amount || 0) < 0 ? "expense" : "income");
  const amount = Math.abs(Number(row.amount || 0));
  const dateValue = row.date || row.created_at || "";
  const parsedDate = parseWebInstant(dateValue);
  const hasValidDate = parsedDate && !Number.isNaN(parsedDate.getTime());
  return {
    id: row.id || row.uuid || row.document_number || `finance-operation-${index}`,
    date: hasValidDate ? webFormat(parsedDate, { day: "2-digit", month: "2-digit", year: "numeric" }) : (row.date || "—"),
    time: hasValidDate ? webTime(parsedDate) : (row.time || ""),
    number: row.document_number || row.id || "",
    organization: row.organization_name || row.organization || "—",
    type: operationType === "expense" ? "Расход" : "Приход",
    operationType,
    amount: operationType === "expense" ? -amount : amount,
    paymentType: row.payment_type_name || row.payment_type || "—",
    counterparty: row.counterparty_name || row.counterparty || "—",
    category: row.category_name || row.category || "—",
    status: "—",
    comment: row.comment || "—",
  };
}

function createAdminFinanceTransactionDraft(operationType = "income", defaults = {}) {
  return {
    operationType,
    amount: "",
    paymentTypeId: defaults.paymentTypeId || "",
    organizationId: defaults.organizationId || "",
    counterpartyType: "provider",
    counterpartyId: "",
    date: adminTodayInputValue(),
    categoryId: defaults.categoryId || "",
    comment: "",
  };
}

function formatAdminFinanceAmountDraft(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function parseAdminFinanceAmount(value) {
  return Number(String(value || "").replace(/\s/g, "")) || 0;
}

function adminFinanceDateForApi(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? `${value}T00:00:00` : null;
}

function adminFinanceInputToDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return webCalendarToday();
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function adminFinanceCalendarDays(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function getAdminFinanceBackendMessage(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join("; ");
  }
  if (detail && typeof detail === "object") {
    return detail.message || JSON.stringify(detail);
  }
  return detail || "Не удалось добавить операцию. Проверьте данные и попробуйте ещё раз.";
}

export function useDefaultAdminFinanceOrganizationId(onNotify) {
  const [organizationId, setOrganizationId] = useState("");
  const [loadState, setLoadState] = useState("loading");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    organizationsApi.listOrganizations({ size: 1, status: "active" }, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const first = extractAdminFinanceItems(data)[0];
        setOrganizationId(isUuidLike(first?.id) ? String(first.id) : "");
        setLoadState(first ? "success" : "empty");
      })
      .catch((error) => {
        if (!request.isCurrent() || isAbortError(error)) return;
        setOrganizationId("");
        setLoadState("error");
        onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, onNotify]);

  return { organizationId, loadState };
}

function validateAdminFinanceDraft(draft) {
  const errors = {};
  const amount = parseAdminFinanceAmount(draft.amount);
  if (!String(draft.amount || "").trim()) {
    errors.amount = "Введите сумму";
  } else if (amount <= 0) {
    errors.amount = "Сумма должна быть больше нуля";
  }
  if (!draft.paymentTypeId) errors.paymentTypeId = "Выберите способ оплаты";
  if (!draft.organizationId) errors.organizationId = "Выберите филиал";
  if (!draft.date || !adminFinanceDateForApi(draft.date)) errors.date = "Выберите дату";
  if (!draft.categoryId) errors.categoryId = "Выберите категорию";
  return errors;
}

function AdminFinanceSearchableSelect({
  label,
  required = false,
  value,
  options,
  onChange,
  placeholder = "Выберите",
  searchPlaceholder = "Поиск",
  emptyText = "Ничего не найдено",
  error,
  disabled = false,
  loading = false,
  controlRef,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const selected = options.find((option) => option.id === value);
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function chooseOption(option) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={`admin-income-field admin-transaction-field admin-finance-select-field ${error ? "is-invalid" : ""}`} ref={rootRef}>
      <span>{label} {required ? <b>*</b> : null}</span>
      <button
        type="button"
        className="admin-finance-select-button"
        ref={controlRef}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onClick={() => setOpen((current) => !current)}
      >
        <strong className={selected ? "" : "is-placeholder"}>{loading ? "Загрузка..." : selected?.label || placeholder}</strong>
        <Icon name="bi-chevron-down" size={14} />
      </button>
      {open ? (
        <div className="admin-finance-select-menu" onClick={(event) => event.stopPropagation()}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            autoFocus
          />
          <div className="admin-finance-select-options">
            {filteredOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={option.id === value ? "is-selected" : ""}
                onClick={() => chooseOption(option)}
              >
                {option.label}
              </button>
            ))}
            {!filteredOptions.length ? <em>{emptyText}</em> : null}
          </div>
        </div>
      ) : null}
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </div>
  );
}

function AdminFinanceCurrencyInput({ value, onChange, error, controlRef, disabled }) {
  return (
    <label className={`admin-income-field admin-transaction-field ${error ? "is-invalid" : ""}`}>
      <span>Сумма <b>*</b></span>
      <div className="admin-transaction-amount-input admin-finance-operation-amount">
        <input
          ref={controlRef}
          value={value}
          inputMode="numeric"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(formatAdminFinanceAmountDraft(event.target.value))}
          placeholder="0"
          autoFocus
        />
        <strong>UZS</strong>
      </div>
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </label>
  );
}

function AdminFinanceCounterpartyTypeSelector({ value, onChange }) {
  return (
    <div className="admin-income-field admin-transaction-field admin-finance-counterparty-field">
      <span>Тип контрагента</span>
      <div className="admin-finance-counterparty-types" role="radiogroup" aria-label="Тип контрагента">
        {ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => (
          <button
            type="button"
            key={item.value}
            className={item.value === value ? "is-active" : ""}
            role="radio"
            aria-checked={item.value === value}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminFinanceDateInput({ value, onChange, error, controlRef, disabled }) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(value || adminTodayInputValue());
  const [viewDate, setViewDate] = useState(() => {
    const selected = adminFinanceInputToDate(value || adminTodayInputValue());
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [calendarPosition, setCalendarPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const todayValue = adminTodayInputValue();
  const selectedValue = draftDate || value || todayValue;

  useEffect(() => {
    if (!open) return undefined;

    const selected = adminFinanceInputToDate(value || todayValue);
    setDraftDate(value || todayValue);
    setViewDate(new Date(selected.getFullYear(), selected.getMonth(), 1));

    function updateCalendarPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const gap = 7;
      const safeGap = 12;
      const width = Math.min(314, Math.max(260, viewportWidth - safeGap * 2));
      const estimatedHeight = 292;
      const left = Math.min(Math.max(safeGap, rect.left), Math.max(safeGap, viewportWidth - width - safeGap));
      const top = rect.bottom + gap + estimatedHeight <= viewportHeight - safeGap
        ? rect.bottom + gap
        : Math.max(safeGap, rect.top - gap - estimatedHeight);
      setCalendarPosition((current) => {
        const next = { left, top, width };
        return current && current.left === next.left && current.top === next.top && current.width === next.width
          ? current
          : next;
      });
    }

    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }

    updateCalendarPosition();
    window.addEventListener("resize", updateCalendarPosition);
    window.addEventListener("scroll", updateCalendarPosition, true);
    window.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", updateCalendarPosition);
      window.removeEventListener("scroll", updateCalendarPosition, true);
      window.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, todayValue, value]);

  function setDateButtonRef(node) {
    buttonRef.current = node;
    controlRef?.(node);
  }

  function shiftMonth(delta) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function selectToday() {
    const today = webCalendarToday();
    setDraftDate(todayValue);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function applyDate() {
    onChange(selectedValue);
    setOpen(false);
  }

  const calendar = open && calendarPosition && typeof document !== "undefined"
    ? createPortal(
      <div
        className="admin-finance-calendar"
        role="dialog"
        aria-label="Выбор даты"
        style={{
          left: `${calendarPosition.left}px`,
          top: `${calendarPosition.top}px`,
          width: `${calendarPosition.width}px`,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="admin-finance-calendar__toolbar">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
            <Icon name="bi-chevron-left" size={16} />
          </button>
          <select value={viewDate.getFullYear()} onChange={(event) => setViewDate(new Date(Number(event.target.value), viewDate.getMonth(), 1))} aria-label="Год">
            {ADMIN_FINANCE_CALENDAR_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select value={viewDate.getMonth()} onChange={(event) => setViewDate(new Date(viewDate.getFullYear(), Number(event.target.value), 1))} aria-label="Месяц">
            {ADMIN_FINANCE_CALENDAR_MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
            <Icon name="bi-chevron-right" size={16} />
          </button>
        </div>
        <div className="admin-finance-calendar__week">
          {ADMIN_FINANCE_CALENDAR_WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="admin-finance-calendar__grid">
          {adminFinanceCalendarDays(viewDate).map((day) => {
            const inputValue = adminDateToInputValue(day);
            const muted = day.getMonth() !== viewDate.getMonth();
            return (
              <button
                type="button"
                key={inputValue}
                className={`${muted ? "is-muted" : ""} ${inputValue === selectedValue ? "is-selected" : ""} ${inputValue === todayValue ? "is-today" : ""}`.trim()}
                onClick={() => setDraftDate(inputValue)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
        <div className="admin-finance-calendar__footer">
          <button type="button" className="admin-finance-calendar__today" onClick={selectToday}>
            <Icon name="bi-calendar3" size={15} />
            <span>Сегодня</span>
          </button>
          <button type="button" className="admin-finance-calendar__ok" onClick={applyDate}>OK</button>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={`admin-income-field admin-transaction-field admin-finance-date-field ${error ? "is-invalid" : ""}`} ref={rootRef}>
      <span>Дата <b>*</b></span>
      <button
        type="button"
        className="admin-finance-operation-date"
        ref={setDateButtonRef}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        onClick={() => {
          if (!open) setCalendarPosition(null);
          setOpen((current) => !current);
        }}
      >
        <strong>{adminInputDateToReportDate(value)}</strong>
        <Icon name="bi-calendar3" size={15} />
      </button>
      {calendar}
      {error ? <em className="admin-finance-field-error">{error}</em> : null}
    </div>
  );
}

function AdminFinanceTransactionModal({
  open,
  closing = false,
  operationType,
  draft,
  errors,
  submitError,
  submitting,
  referencesLoading,
  paymentTypes,
  organizations,
  categories,
  counterparties,
  onChange,
  onCloseRequest,
  onSubmit,
  fieldRef,
}) {
  if (!open || typeof document === "undefined") return null;

  const isIncome = operationType === "income";
  const title = isIncome ? "Добавить приход" : "Добавить расход";
  const actionText = isIncome ? "Добавить" : "Добавить";
  const loadingText = isIncome ? "Добавление…" : "Добавление…";
  const counterpartyOptions = counterparties[draft.counterpartyType] || [];

  return createPortal(
    <div
      className={`admin-income-modal admin-transaction-modal admin-finance-operation-modal ${isIncome ? "is-income" : "is-expense"} ${closing ? "is-closing" : "is-opening"}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={closing ? "true" : undefined}
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRequest();
      }}
    >
      <form className="admin-income-dialog admin-transaction-dialog admin-finance-operation-dialog" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="admin-income-dialog__head admin-transaction-dialog__head admin-finance-operation-dialog__head">
          <div className="admin-finance-operation-title">
            <span aria-hidden="true">
              <Icon name={isIncome ? "bi-plus-lg" : "bi-dash-lg"} size={18} />
            </span>
            <div>
              <h3>{title}</h3>
            </div>
          </div>
          <button type="button" className="admin-income-dialog__close" onClick={onCloseRequest} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={16} />
          </button>
        </div>

        <div className="admin-transaction-dialog__grid admin-finance-operation-dialog__grid">
          <AdminFinanceCurrencyInput
            value={draft.amount}
            disabled={submitting}
            error={errors.amount}
            controlRef={fieldRef("amount")}
            onChange={(value) => onChange("amount", value)}
          />
          <AdminFinanceSearchableSelect
            label="Способ оплаты"
            required
            value={draft.paymentTypeId}
            options={paymentTypes}
            loading={referencesLoading && !paymentTypes.length}
            disabled={submitting}
            error={errors.paymentTypeId}
            controlRef={fieldRef("paymentTypeId")}
            placeholder="Выберите способ оплаты"
            onChange={(value) => onChange("paymentTypeId", value)}
          />
          <AdminFinanceSearchableSelect
            label="Организация или филиал"
            required
            value={draft.organizationId}
            options={organizations}
            loading={referencesLoading && !organizations.length}
            disabled={submitting}
            error={errors.organizationId}
            controlRef={fieldRef("organizationId")}
            placeholder="Выберите филиал"
            searchPlaceholder="Поиск филиала"
            onChange={(value) => onChange("organizationId", value)}
          />
          <AdminFinanceCounterpartyTypeSelector
            value={draft.counterpartyType}
            onChange={(value) => onChange("counterpartyType", value)}
          />
          <AdminFinanceSearchableSelect
            label="Контрагент"
            value={draft.counterpartyId}
            options={counterpartyOptions}
            disabled={submitting}
            error={errors.counterpartyId}
            controlRef={fieldRef("counterpartyId")}
            placeholder="Не выбран"
            searchPlaceholder="Поиск контрагента"
            emptyText="Контрагенты не найдены"
            onChange={(value) => onChange("counterpartyId", value)}
          />
          <AdminFinanceDateInput
            value={draft.date}
            disabled={submitting}
            error={errors.date}
            controlRef={fieldRef("date")}
            onChange={(value) => onChange("date", value)}
          />
          <AdminFinanceSearchableSelect
            label="Категория"
            required
            value={draft.categoryId}
            options={categories}
            loading={referencesLoading && !categories.length}
            disabled={submitting}
            error={errors.categoryId}
            controlRef={fieldRef("categoryId")}
            placeholder="Выберите категорию"
            searchPlaceholder="Поиск категории"
            onChange={(value) => onChange("categoryId", value)}
          />
          <label className="admin-income-field admin-transaction-field admin-transaction-field--wide admin-finance-comment-field">
            <span>Комментарий</span>
            <textarea
              value={draft.comment}
              disabled={submitting}
              maxLength={ADMIN_FINANCE_COMMENT_LIMIT}
              onChange={(event) => onChange("comment", event.target.value)}
              placeholder="Комментарий к операции"
              rows={3}
            />
            <small>{draft.comment.length}/{ADMIN_FINANCE_COMMENT_LIMIT}</small>
          </label>
        </div>

        {submitError ? <div className="admin-finance-submit-error">{submitError}</div> : null}

        <div className="admin-income-dialog__actions admin-transaction-dialog__actions admin-finance-operation-dialog__actions is-single">
          <button type="submit" className="is-primary" disabled={submitting}>
            {submitting ? loadingText : actionText}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function AdminFinanceFilterDrawer({
  open,
  draft,
  counterpartyOptions,
  categoryOptions,
  onDraftChange,
  onApply,
  onClear,
  onClose,
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="admin-finance-filter-drawer" role="dialog" aria-modal="true" aria-label="Фильтр" onMouseDown={onClose}>
      <form className="admin-finance-filter-panel" onSubmit={onApply} onMouseDown={(event) => event.stopPropagation()}>
        <h3>Фильтр</h3>
        <label className="admin-finance-filter-field">
          <span>Тип операции</span>
          <select value={draft.type} aria-label="Тип операции" onChange={(event) => onDraftChange("type", event.target.value)}>
            <option value="all">Выберите тип</option>
            <option value="income">Приход</option>
            <option value="expense">Расход</option>
          </select>
        </label>
        <label className="admin-finance-filter-field">
          <span>Контрагент</span>
          <select value={draft.counterparty} aria-label="Контрагент" onChange={(event) => onDraftChange("counterparty", event.target.value)}>
            <option value="all">Фильтр по контрагентам</option>
            {counterpartyOptions.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <label className="admin-finance-filter-field">
          <span>Категория</span>
          <select value={draft.category} aria-label="Категория" onChange={(event) => onDraftChange("category", event.target.value)}>
            <option value="all">Фильтр по категории</option>
            {categoryOptions.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
        <div className="admin-finance-filter-actions">
          <button type="submit" className="is-apply">Фильтровать</button>
          <button type="button" className="is-clear" onClick={onClear}>Очистить</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function AdminFinanceOperationsPage({ search, onNotify }) {
  const [range, setRange] = useState(() => buildAdminDashboardDateRange("Этот месяц"));
  const [operations, setOperations] = useState([]);
  const [operationsLoadState, setOperationsLoadState] = useState("loading");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [counterpartyFilter, setCounterpartyFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [filterDraft, setFilterDraft] = useState({ type: "all", counterparty: "all", category: "all" });
  const [financeModalOpen, setFinanceModalOpen] = useState(false);
  const [financeModalClosing, setFinanceModalClosing] = useState(false);
  const [financeModalType, setFinanceModalType] = useState("income");
  const [financeDraft, setFinanceDraft] = useState(() => createAdminFinanceTransactionDraft("income"));
  const [financeInitialDraft, setFinanceInitialDraft] = useState(() => createAdminFinanceTransactionDraft("income"));
  const [financeErrors, setFinanceErrors] = useState({});
  const [financeSubmitError, setFinanceSubmitError] = useState("");
  const [financeSubmitting, setFinanceSubmitting] = useState(false);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [categoriesByKind, setCategoriesByKind] = useState({ income: [], expense: [] });
  const [counterpartiesByType, setCounterpartiesByType] = useState(() => (
    Object.fromEntries(ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => [item.value, []]))
  ));
  const financeFieldRefs = useRef({});
  const financeCloseTimerRef = useRef(null);
  const financeSubmissionRef = useRef(null);
  const beginOperationsRequest = useLatestRequest();
  const beginOrganizationsRequest = useLatestRequest();
  const beginReferencesRequest = useLatestRequest();
  const { acquire: acquireFinanceLock, release: releaseFinanceLock } = useMutationLocks();
  const query = (search || "").trim().toLowerCase();
  const datePresets = useMemo(() => (
    ADMIN_DASHBOARD_DATE_PRESET_LABELS.map((label) => ({
      label,
      getRange: () => buildAdminDashboardDateRange(label),
    }))
  ), []);
  const transactionCategories = categoriesByKind[financeModalType] || [];
  const referenceOrganization = organizations.find((item) => item.id === financeDraft.organizationId)
    || organizations[0];
  const referenceOrganizationId = referenceOrganization?.apiId || "";

  useEffect(() => () => {
    if (financeCloseTimerRef.current) {
      window.clearTimeout(financeCloseTimerRef.current);
    }
  }, []);

  const loadFinanceOperations = useCallback(async () => {
    const request = beginOperationsRequest();
    const normalizedRange = normalizeAdminReportRange(range);
    const params = {
      date_from: adminReportDateToInputDate(normalizedRange.start),
      date_to: adminReportDateToInputDate(normalizedRange.end),
    };
    setOperationsLoadState("loading");
    setOperations([]);
    try {
      const { data } = await adminFinanceApi.listTransactions(params, { signal: request.signal });
      if (!request.isCurrent()) return null;
      const items = extractAdminFinanceItems(data);
      setOperations(items.map(normalizeAdminFinanceTransaction));
      setOperationsLoadState(items.length ? "success" : "empty");
      return items;
    } catch (error) {
      if (!request.isCurrent() || isAbortError(error)) return null;
      setOperations([]);
      setOperationsLoadState("error");
      onNotify?.(getAdminFinanceLoadMessage(error));
      return null;
    }
  }, [beginOperationsRequest, onNotify, range]);

  useEffect(() => {
    loadFinanceOperations();
  }, [loadFinanceOperations]);

  useEffect(() => {
    const request = beginOrganizationsRequest();

    async function loadOrganizations() {
      setReferencesLoading(true);
      try {
        const { data } = await organizationsApi.listOrganizations({ size: 100, status: "active" }, { signal: request.signal });
        if (!request.isCurrent()) return;
        const nextOrganizations = extractAdminFinanceItems(data)
          .filter((item) => item.status !== "blocked")
          .map((item, index) => normalizeAdminFinanceOption(item, index, ["name", "company_name"]));
        setOrganizations(nextOrganizations);
      } catch (error) {
        if (!request.isCurrent() || isAbortError(error)) return;
        setOrganizations([]);
        onNotify?.(getAdminFinanceLoadMessage(error));
      } finally {
        if (request.isCurrent()) setReferencesLoading(false);
      }
    }

    loadOrganizations();
  }, [beginOrganizationsRequest, onNotify]);

  useEffect(() => {
    const request = beginReferencesRequest();
    if (!referenceOrganizationId) {
      setPaymentTypes([]);
      setCategoriesByKind({ income: [], expense: [] });
      setCounterpartiesByType(Object.fromEntries(
        ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => [item.value, []]),
      ));
      return undefined;
    }

    async function loadReferences() {
      setReferencesLoading(true);
      setPaymentTypes([]);
      setCategoriesByKind({ income: [], expense: [] });
      setCounterpartiesByType(Object.fromEntries(
        ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => [item.value, []]),
      ));
      try {
        const [
          paymentResponse,
          incomeCategoryResponse,
          expenseCategoryResponse,
          ...counterpartyResponses
        ] = await Promise.all([
          adminFinanceApi.listPaymentTypes(referenceOrganizationId, { status: true }, { signal: request.signal }),
          adminFinanceApi.listCategories(referenceOrganizationId, "income", { status: true }, { signal: request.signal }),
          adminFinanceApi.listCategories(referenceOrganizationId, "expense", { status: true }, { signal: request.signal }),
          ...ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item) => (
            adminFinanceApi.listCounterparties(referenceOrganizationId, item.value, {}, { signal: request.signal })
          )),
        ]);
        if (!request.isCurrent()) return;

        const nextPaymentTypes = extractAdminFinanceItems(paymentResponse.data)
          .filter((item) => item.status !== false)
          .map((item, index) => normalizeAdminFinanceOption(item, index, ["name", "type"]));
        const nextIncomeCategories = extractAdminFinanceItems(incomeCategoryResponse.data)
          .filter((item) => item.kind === "income" && item.status !== false)
          .map((item, index) => ({ ...normalizeAdminFinanceOption(item, index, ["name"]), kind: "income" }));
        const nextExpenseCategories = extractAdminFinanceItems(expenseCategoryResponse.data)
          .filter((item) => item.kind === "expense" && item.status !== false)
          .map((item, index) => ({ ...normalizeAdminFinanceOption(item, index, ["name"]), kind: "expense" }));
        const nextCounterparties = Object.fromEntries(
          ADMIN_FINANCE_COUNTERPARTY_TYPES.map((item, index) => [
            item.value,
            extractAdminFinanceItems(counterpartyResponses[index].data)
              .map((row, rowIndex) => normalizeAdminFinanceOption(row, rowIndex, ["full_name", "name", "phone"])),
          ]),
        );

        setPaymentTypes(nextPaymentTypes);
        setCategoriesByKind({ income: nextIncomeCategories, expense: nextExpenseCategories });
        setCounterpartiesByType(nextCounterparties);
        setFinanceDraft((current) => {
          if (current.organizationId !== referenceOrganization?.id) return current;
          return {
            ...current,
            paymentTypeId: nextPaymentTypes[0]?.id || "",
            categoryId: (current.operationType === "income" ? nextIncomeCategories : nextExpenseCategories)[0]?.id || "",
            counterpartyId: "",
          };
        });
      } catch (error) {
        if (request.isCurrent() && !isAbortError(error)) onNotify?.(getAdminFinanceLoadMessage(error));
      } finally {
        if (request.isCurrent()) setReferencesLoading(false);
      }
    }

    loadReferences();
  }, [beginReferencesRequest, onNotify, referenceOrganization?.id, referenceOrganizationId]);

  useEffect(() => {
    if (!financeModalOpen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;

    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseFinanceModal();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [financeModalOpen, financeDraft, financeInitialDraft, financeSubmitting, financeModalClosing]);

  const filterCounterpartyOptions = useMemo(
    () => Array.from(new Set(operations.map((row) => row.counterparty).filter((value) => value && value !== "—")))
      .sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" })),
    [operations],
  );
  const filterCategoryOptions = useMemo(
    () => Array.from(new Set(operations.map((row) => row.category).filter((value) => value && value !== "—")))
      .sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" })),
    [operations],
  );
  const financeFiltersActive = typeFilter !== "all" || counterpartyFilter !== "all" || categoryFilter !== "all";
  const financeTotals = useMemo(() => operations.reduce((acc, row) => {
    if (row.amount < 0) {
      acc.expense += Math.abs(Number(row.amount || 0));
    } else {
      acc.income += Number(row.amount || 0);
    }
    return acc;
  }, { income: 0, expense: 0 }), [operations]);
  const filteredOperations = operations.filter((row) => {
    const typeMatches = typeFilter === "all" || (typeFilter === "income" ? row.amount > 0 : row.amount < 0);
    const counterpartyMatches = counterpartyFilter === "all" || row.counterparty === counterpartyFilter;
    const categoryMatches = categoryFilter === "all" || row.category === categoryFilter;
    const queryMatches = !query || [
      row.date,
      row.time,
      row.paymentType,
      row.counterparty,
      row.category,
      row.organization,
      row.comment,
      String(row.amount),
    ].some((value) => String(value).toLowerCase().includes(query));
    return typeMatches && counterpartyMatches && categoryMatches && queryMatches;
  });
  function deleteOperation(row) {
    void row;
    onNotify?.("Удаление операции недоступно: backend mutation contract не подключён.");
  }

  function fieldRef(name) {
    return (node) => {
      if (node) financeFieldRefs.current[name] = node;
    };
  }

  function focusFirstInvalidField(errors) {
    const firstField = ADMIN_FINANCE_REQUIRED_FIELDS.find((field) => errors[field]);
    if (!firstField) return;
    window.requestAnimationFrame(() => {
      financeFieldRefs.current[firstField]?.focus?.();
    });
  }

  function buildFinanceDraft(operationType = "income") {
    return createAdminFinanceTransactionDraft(operationType, {
      paymentTypeId: paymentTypes[0]?.id || "",
      organizationId: organizations[0]?.id || "",
      categoryId: (categoriesByKind[operationType] || [])[0]?.id || "",
    });
  }

  function openFinanceModal(operationType = "income") {
    financeSubmissionRef.current = null;
    if (financeCloseTimerRef.current) {
      window.clearTimeout(financeCloseTimerRef.current);
      financeCloseTimerRef.current = null;
    }
    const nextDraft = buildFinanceDraft(operationType);
    financeFieldRefs.current = {};
    setFinanceModalType(operationType);
    setFinanceDraft(nextDraft);
    setFinanceInitialDraft(nextDraft);
    setFinanceErrors({});
    setFinanceSubmitError("");
    setFinanceModalClosing(false);
    setFinanceModalOpen(true);
  }

  function closeFinanceModal(afterClose) {
    if (financeCloseTimerRef.current) return;
    setFinanceModalClosing(true);
    financeCloseTimerRef.current = window.setTimeout(() => {
      financeCloseTimerRef.current = null;
      setFinanceModalOpen(false);
      setFinanceModalClosing(false);
      setFinanceErrors({});
      setFinanceSubmitError("");
      setFinanceSubmitting(false);
      afterClose?.();
    }, ADMIN_FINANCE_MODAL_ANIMATION_MS);
  }

  function requestCloseFinanceModal() {
    if (financeSubmitting || financeModalClosing) return;
    closeFinanceModal();
  }

  function openFinanceFilters() {
    setFilterDraft({ type: typeFilter, counterparty: counterpartyFilter, category: categoryFilter });
    setFiltersOpen(true);
  }

  function toggleFinanceFilters() {
    if (filtersOpen) {
      setFiltersOpen(false);
    } else {
      openFinanceFilters();
    }
  }

  function updateFilterDraft(field, value) {
    setFilterDraft((current) => ({ ...current, [field]: value }));
  }

  function applyFinanceFilters(event) {
    event.preventDefault();
    setTypeFilter(filterDraft.type);
    setCounterpartyFilter(filterDraft.counterparty);
    setCategoryFilter(filterDraft.category);
    setFiltersOpen(false);
  }

  function clearFinanceFilters() {
    const emptyFilters = { type: "all", counterparty: "all", category: "all" };
    setFilterDraft(emptyFilters);
    setTypeFilter("all");
    setCounterpartyFilter("all");
    setCategoryFilter("all");
  }

  function updateFinanceDraft(field, value) {
    setFinanceDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "counterpartyType") {
        next.counterpartyId = "";
      }
      if (field === "organizationId") {
        next.paymentTypeId = "";
        next.categoryId = "";
        next.counterpartyId = "";
      }
      return next;
    });
    setFinanceErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === "counterpartyType") delete next.counterpartyId;
      return next;
    });
    setFinanceSubmitError("");
  }

  async function saveFinanceOperation(event) {
    event.preventDefault();
    if (financeSubmitting) return;
    if (!acquireFinanceLock("hq-finance-create")) return;

    const errors = validateAdminFinanceDraft(financeDraft);
    if (Object.keys(errors).length) {
      setFinanceErrors(errors);
      focusFirstInvalidField(errors);
      releaseFinanceLock("hq-finance-create");
      return;
    }

    const selectedPaymentType = paymentTypes.find((item) => item.id === financeDraft.paymentTypeId);
    const selectedOrganization = organizations.find((item) => item.id === financeDraft.organizationId);
    const selectedCounterparty = (counterpartiesByType[financeDraft.counterpartyType] || [])
      .find((item) => item.id === financeDraft.counterpartyId);
    const selectedCategory = transactionCategories.find((item) => item.id === financeDraft.categoryId);
    const payload = {
      direction: financeDraft.operationType,
      amount: parseAdminFinanceAmount(financeDraft.amount),
      date: adminFinanceDateForApi(financeDraft.date),
      comment: financeDraft.comment.trim() || null,
    };

    if (selectedPaymentType?.apiId) payload.payment_type_id = selectedPaymentType.apiId;
    if (selectedOrganization?.apiId) payload.organization_id = selectedOrganization.apiId;
    if (selectedCounterparty?.apiId) payload.counterparty_id = selectedCounterparty.apiId;
    if (selectedCategory?.apiId) payload.category_id = selectedCategory.apiId;

    setFinanceSubmitting(true);
    setFinanceSubmitError("");

    try {
      const submission = resolveHqTransactionSubmission(financeSubmissionRef.current, payload);
      financeSubmissionRef.current = submission;
      const { data } = await adminFinanceApi.createTransaction(payload, submission.idempotencyKey);
      financeSubmissionRef.current = null;
      const refreshedItems = await loadFinanceOperations();
      if ((!refreshedItems || !refreshedItems.length) && data?.id) {
        setOperations((current) => [
          normalizeAdminFinanceTransaction({
            ...data,
            payment_type_name: selectedPaymentType?.label,
            organization_name: selectedOrganization?.label,
            counterparty_name: selectedCounterparty?.label,
            category_name: selectedCategory?.label,
          }),
          ...current.filter((row) => row.id !== data.id),
        ]);
      }
      const nextDraft = buildFinanceDraft(financeDraft.operationType);
      closeFinanceModal(() => {
        setFinanceDraft(nextDraft);
        setFinanceInitialDraft(nextDraft);
      });
      onNotify?.(financeDraft.operationType === "income" ? "Приход успешно добавлен" : "Расход успешно добавлен");
    } catch (error) {
      const message = getAdminFinanceBackendMessage(error);
      setFinanceSubmitError(message);
      onNotify?.(message);
    } finally {
      setFinanceSubmitting(false);
      releaseFinanceLock("hq-finance-create");
    }
  }

  return (
    <section className="admin-finance-page">
      <h2 className="sr-only">Денежные операции</h2>

      <div className="admin-finance-toolbar">
        <div className="admin-finance-date">
          <ReportDateRangePicker
            value={range}
            onChange={(nextRange) => setRange(normalizeAdminReportRange(nextRange))}
            buttonClassName="admin-finance-date-button"
            showTime={false}
            presets={datePresets}
            formatButtonLabel={formatAdminDashboardDateRangeButton}
            blockPageScrollOnWheel
            applyPresetOnSelect
            showMenuOk={false}
            leadingIconName="bi-calendar3"
            leadingIconSize={16}
          />
        </div>
        <div className="admin-finance-summary is-income">
          <span>Приход</span>
          <strong>{operationsLoadState === "loading" ? "Загрузка..." : operationsLoadState === "error" ? "Недоступно" : formatCurrency(financeTotals.income)}</strong>
        </div>
        <div className="admin-finance-summary is-expense">
          <span>Расход</span>
          <strong>{operationsLoadState === "loading" ? "Загрузка..." : operationsLoadState === "error" ? "Недоступно" : formatCurrency(financeTotals.expense)}</strong>
        </div>
        <div className="admin-finance-actions">
          <button type="button" className="admin-finance-action is-income" onClick={() => openFinanceModal("income")}>
            <Icon name="bi-plus-lg" size={16} />
            <span>ПРИХОД</span>
          </button>
          <button type="button" className="admin-finance-action is-expense" onClick={() => openFinanceModal("expense")}>
            <Icon name="bi-dash-lg" size={16} />
            <span>РАСХОД</span>
          </button>
          <button type="button" className="admin-finance-action is-export" onClick={() => onNotify?.("Денежные операции подготовлены для Excel.")}>
            <Icon name="bi-file-earmark-excel" size={16} />
            <span>Скачать на EXCEL</span>
          </button>
          <button type="button" className={`admin-finance-action is-filter ${filtersOpen || financeFiltersActive ? "is-active" : ""}`} onClick={toggleFinanceFilters}>
            <Icon name="bi-sliders" size={16} />
            <span>Фильтровать</span>
          </button>
        </div>
      </div>

      <div className="admin-finance-table-shell">
        <table className="admin-finance-table">
          <colgroup>
            <col className="admin-finance-col-date" />
            <col className="admin-finance-col-amount" />
            <col className="admin-finance-col-type" />
            <col className="admin-finance-col-payment" />
            <col className="admin-finance-col-counterparty" />
            <col className="admin-finance-col-category" />
            <col className="admin-finance-col-organization" />
            <col className="admin-finance-col-comment" />
            <col className="admin-finance-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Тип</th>
              <th>Тип оплаты</th>
              <th>Контрагент</th>
              <th>Категория</th>
              <th>Организация</th>
              <th>Комментарии</th>
              <th aria-label="Действия" />
            </tr>
          </thead>
          <tbody>
            {operationsLoadState !== "loading" ? filteredOperations.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.date}</strong>
                  <span>{row.time}</span>
                </td>
                <td>
                  <span className={`admin-finance-amount ${row.amount < 0 ? "is-expense" : "is-income"}`}>
                    {formatSignedFinanceAmount(row.amount)}
                  </span>
                </td>
                <td><span className={`admin-finance-operation-type ${row.amount < 0 ? "is-expense" : "is-income"}`}>{row.type}</span></td>
                <td>{row.paymentType}</td>
                <td>{row.counterparty}</td>
                <td><span className="admin-finance-tag">{row.category}</span></td>
                <td>{row.organization}</td>
                <td className="admin-finance-comment"><span>{row.comment}</span></td>
                <td>
                  <button type="button" className="admin-finance-delete" onClick={() => deleteOperation(row)} aria-label="Удалить операцию">
                    <Icon name="bi-trash3" size={16} />
                  </button>
                </td>
              </tr>
            )) : null}
            {operationsLoadState === "loading" ? (
              <tr><td colSpan="9" className="admin-finance-empty" role="status">Загрузка денежных операций...</td></tr>
            ) : operationsLoadState === "error" ? (
              <tr><td colSpan="9" className="admin-finance-empty" role="alert">Не удалось загрузить денежные операции.</td></tr>
            ) : !filteredOperations.length ? (
              <tr>
                <td colSpan="9" className="admin-finance-empty">Операции не найдены.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <AdminFinanceFilterDrawer
        open={filtersOpen}
        draft={filterDraft}
        counterpartyOptions={filterCounterpartyOptions}
        categoryOptions={filterCategoryOptions}
        onDraftChange={updateFilterDraft}
        onApply={applyFinanceFilters}
        onClear={clearFinanceFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <AdminFinanceTransactionModal
        open={financeModalOpen}
        closing={financeModalClosing}
        operationType={financeModalType}
        draft={financeDraft}
        errors={financeErrors}
        submitError={financeSubmitError}
        submitting={financeSubmitting}
        referencesLoading={referencesLoading}
        paymentTypes={paymentTypes}
        organizations={organizations}
        categories={transactionCategories}
        counterparties={counterpartiesByType}
        onChange={updateFinanceDraft}
        onCloseRequest={requestCloseFinanceModal}
        onSubmit={saveFinanceOperation}
        fieldRef={fieldRef}
      />
    </section>
  );
}
