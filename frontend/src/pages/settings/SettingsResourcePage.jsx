import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { settingsService } from "../../api/settings";
import Icon from "../../components/Icon";
import MarjonSelect from "./MarjonSelect";
import {
  caretForDigitCount,
  formatLocalUZ,
  getPhoneFlag,
  getPhoneLocal,
  inferPhoneCountry,
  normalizePhone,
  phoneCountries,
  phoneCountryMap,
} from "../staff/staffPhone";
import ReportEmptyState from "../../components/ReportEmptyState";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../hooks/useAsyncSafety";
import { t } from "../../i18n/t";

const STATUS_ACTIVE = "#активно";
const STATUS_INACTIVE = "#не активно";
const STATUS_PENDING = "#не подтверждено";
const STATUS_ARCHIVE = "#архив";

// Visual-only counterparty status vocabulary for the Add/Edit select.
// The Counterparty backend has NO canonical status field, so these values
// are form-local display state only: never mapped to the payload, never
// persisted on the server. Shown in the table as a local badge.
export const CLIENT_STATUS_OPTIONS = Object.freeze([
  { value: "active", label: "Активный" },
  { value: "inactive", label: "Не активный" },
]);
export const CLIENT_STATUS_DEFAULT = "active";

function SettingsResourcePage({
  title,
  addLabel = "Добавить +",
  tabs,
  columns,
  initialRows,
  formFields,
  searchable = true,
  searchPlaceholder = "Поиск",
  filterOptions,
  transactionHistory = false,
  pageClassName = "",
  compactHeader = false,
  actionsLabel = "Действия",
  statementHistory = false,
  resourceKey,
  apiMapRow,
  apiMapFormToPayload,
  readOnly = false,
  renderStatementView = null,
  renderHistoryContent = null,
  requireDeleteConfirm = false,
  deleteConfirmText = "Удалить контрагента?",
  emptyText = "Нет данных",
  formatPhoneDisplay = null,
  parsePhoneInput = null,
  staffVariant = false,
  eyebrow = "Настройки",
  addTitle = null,
  editTitle = null,
  // Mount drawers at document.body (same pattern as StaffFormModal) so the
  // backdrop covers sidebar + topbar instead of being trapped under the
  // dashboard stacking context. Opt-in: other consumers keep exact behavior.
  usePortal = false,
  // Clients V10: CENTERED Payment-Methods modal instead of the right drawer.
  // Opt-in: every other consumer keeps its accepted drawer untouched.
  centeredModal = false,
  // Clients V10: hide the redundant Type dropdown — the active top tab owns
  // the entity type. The value stays in form state (set from the active tab
  // on Add, preserved from the record on Edit) so payload semantics never
  // change; only the visible control is removed.
  hideTypeField = false,
}) {
  const [rows, setRows] = useState([]);
  const [apiLoading, setApiLoading] = useState(!!resourceKey);
  const [apiError, setApiError] = useState(resourceKey ? "" : "Данные недоступны: backend contract для этого справочника не подключён.");
  // Clients V10: the active directory tab lives in the URL (?tab=) so the
  // global/topbar Back button (navigate(-1)) returns from History to the
  // SOURCE tab instead of resetting it. Tab switches replace the entry;
  // opening History pushes one — Back then pops exactly to the source tab.
  // Search text stays in local state (the component never unmounts across
  // tab/history navigation), so it is preserved where practical.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabKeys = useMemo(() => (tabs || []).map((tab) => tab.key), [tabs]);
  const urlTab = searchParams.get("tab");
  const [activeTabState, setActiveTabState] = useState(
    urlTab && tabKeys.includes(urlTab) ? urlTab : (tabs?.[0]?.key || ""),
  );
  const activeTab = tabKeys.includes(activeTabState) ? activeTabState : (tabs?.[0]?.key || "");
  const setActiveTab = (key) => {
    setActiveTabState(key);
    if (!tabKeys.includes(key)) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("tab", key);
      return next;
    }, { replace: true });
  };
  useEffect(() => {
    if (urlTab && tabKeys.includes(urlTab) && urlTab !== activeTabState) {
      setActiveTabState(urlTab);
    }
  }, [urlTab, tabKeys, activeTabState]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [modalMode, setModalMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  // Clients V10: the open History record is a pushed ?history=<id> entry, not
  // local state, so browser/topbar Back restores the source tab naturally.
  const historyId = statementHistory ? searchParams.get("history") : null;
  const historyRow = useMemo(
    () => (historyId ? rows.find((row) => String(row.id) === String(historyId)) || null : null),
    [historyId, rows],
  );
  // Boolean view flag for effect deps (stable across row-object identity).
  const historyOpen = historyRow !== null;
  const openHistory = (row) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("history", String(row.id));
      return next;
    });
  };
  const closeHistory = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("history");
      return next;
    }, { replace: true });
  };
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();
  const canMutate = Boolean(resourceKey) && !readOnly;
  // Portal mount point, defined early: renderFormFields() executes while the
  // edit modal/drawer consts initialize below, and the phone country popover
  // reads this during that pass (TDZ-safe: pure derivation, no hooks).
  const portalTarget = usePortal && typeof document !== "undefined" ? document.body : null;

  // Staff-variant sliding pill: measures the active tab segment (same MARJON
  // pattern as StaffToolbar). Variant-only; default rendering untouched.
  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    if (!staffVariant) return undefined;
    const container = tabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector(`[data-tab="${activeTab}"]`);
      if (!active) return;
      // Never poison the pill with a detached/zero-size measurement: a queued
      // ResizeObserver callback can fire after the directory subtree unmounts
      // (History view), where offsetLeft/offsetWidth read 0/0. Skipping keeps
      // the last valid geometry, so Topbar Back restores the visual pill.
      if (!active.isConnected || active.offsetWidth === 0) return;
      setPill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container.querySelectorAll("[data-tab]").forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
    // historyOpen re-triggers measurement: returning from History remounts
    // the tabs DOM while activeTab is unchanged, so without this the effect
    // (and its ResizeObserver) would stay dead and the pill would never
    // re-measure on the fresh container.
  }, [staffVariant, activeTab, historyOpen]);

  useEffect(() => {
    if (!resourceKey) return;
    const request = beginRequest();
    setApiLoading(true);
    setApiError("");
    settingsService.listResource(resourceKey, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setRows(apiMapRow ? items.map(apiMapRow) : []);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setRows([]);
        setApiError(err.response?.data?.detail || "Не удалось загрузить данные справочника.");
      })
      .finally(() => { if (request.isCurrent()) setApiLoading(false); });
  }, [beginRequest, resourceKey]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesTab = !tabs || row.type === activeTab;
      const matchesArchive = row.status !== STATUS_ARCHIVE;
      const matchesSearch = !query || `${row.name || ""} ${row.phone || ""}`.toLowerCase().includes(query);
      const matchesFilter = !filter || row.kind === filter || row.status === filter || row.typeLabel === filter;
      return matchesTab && matchesArchive && matchesSearch && matchesFilter;
    });
  }, [activeTab, filter, rows, search, tabs]);

  const openAdd = () => {
    if (!canMutate) {
      setApiError("Создание недоступно: backend contract для этого справочника не подключён.");
      return;
    }
    const defaults = formFields.reduce((acc, field) => ({ ...acc, [field.key]: field.defaultValue || "" }), {});
    setEditingId(null);
    // No status key: the Counterparty backend has no canonical status field
    // (STATUS_UI_BLOCKED_BY_BACKEND) — nothing status-like may be stored,
    // displayed as state, or sent.
    setForm({ ...defaults, type: activeTab || tabs?.[0]?.key || "", phoneCountry: "UZ" });
    setPhoneCountryOpen(false);
    setModalMode("edit");
  };

  const openEdit = (row) => {
    if (!canMutate) {
      setApiError("Редактирование недоступно: backend contract для этого справочника не подключён.");
      return;
    }
    setEditingId(row.id);
    // The record type is preserved verbatim — with the visible Type dropdown
    // removed (hideTypeField), editing can never silently retype an entity.
    // phoneCountry is inferred for DISPLAY only; form.phone keeps the stored
    // canonical string, so international values are never corrupted.
    // Local-only `status` fields keep their own vocabulary: a row value that
    // is not a valid option (e.g. the table's neutral "—" dash) resets to the
    // visual default instead of leaking table display into the form.
    const seeded = { ...row };
    for (const field of formFields) {
      if (field.type === "status" && !CLIENT_STATUS_OPTIONS.some((option) => option.value === seeded[field.key])) {
        seeded[field.key] = field.defaultValue || CLIENT_STATUS_DEFAULT;
      }
    }
    setForm({ ...seeded, phoneCountry: inferPhoneCountry(row.phone) });
    setPhoneCountryOpen(false);
    setModalMode("edit");
  };

  const closeModal = () => {
    if (saving) return;
    setPhoneCountryOpen(false);
    setModalMode(null);
  };

  // Phone country-menu state lives ABOVE the History early-return: hooks must
  // never be called conditionally after it. form.phoneCountry is display
  // selection only and never reaches the payload.
  const [phoneCountryOpen, setPhoneCountryOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const phoneInputRef = useRef(null);
  const phoneFieldRef = useRef(null);
  const pillRef = useRef(null);
  const menuRef = useRef(null);
  const phoneCountry = form.phoneCountry || inferPhoneCountry(form.phone);
  const phoneCountryMeta = phoneCountryMap[phoneCountry] || phoneCountryMap.UZ;

  // Escape: the open country menu takes priority over the modal itself
  // (same contract family as the Settings → Payment Methods modal).
  useEffect(() => {
    if (!centeredModal || modalMode !== "edit") return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || saving) return;
      if (phoneCountryOpen) {
        event.stopPropagation();
        setPhoneCountryOpen(false);
        return;
      }
      setModalMode(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [centeredModal, modalMode, saving, phoneCountryOpen]);

  // The country list is a fixed overlay popover (portaled to document.body),
  // NOT part of the form flow: the compact modal clips absolutely-positioned
  // descendants (overflow-y:auto), so in-flow rendering cuts the 8-country
  // list. The menu keeps the exact Staff classes/visuals and its own scroll;
  // only the mount point + fixed position change.
  //
  // V18 NO-FLASH RULE: for portaled consumers the menu mounts ONLY once final
  // coordinates exist (menuPos). The previous fallback rendered an in-flow
  // menu for one frame before positioning ran — a visible flash + jump inside
  // the modal on every open. Never render a visible menu at default coords.
  const updateMenuPos = () => {
    const anchor = pillRef.current;
    if (!anchor || typeof window === "undefined") return;
    const width = Math.min(260, window.innerWidth - 16);
    const rect = anchor.getBoundingClientRect();
    // Zero rect (hidden anchor, or layout-less environments like jsdom):
    // fall back to a visible origin instead of hiding the menu entirely.
    // A real visible pill always has size, so browsers never take this path.
    if (!rect.width && !rect.height) {
      setMenuPos({ width, left: 8, top: 8 });
      return;
    }
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const maxH = 250;
    const below = window.innerHeight - rect.bottom - 12;
    const flip = below < Math.min(maxH, 200) && rect.top > below;
    setMenuPos({
      width,
      left,
      top: flip ? Math.max(8, rect.top - maxH - 7) : rect.bottom + 7,
    });
  };

  // Positioning runs in useLayoutEffect (BEFORE paint): coordinates are ready
  // on the very first painted frame, so the menu appears directly at its
  // final placement — no 0,0 flash, no in-modal flash, no relocate jump.
  useLayoutEffect(() => {
    if (!phoneCountryOpen) {
      setMenuPos(null);
      return undefined;
    }
    updateMenuPos();
    window.addEventListener("resize", updateMenuPos);
    // Page/modal scroll re-anchors the popover; the menu's OWN scroll must
    // not close it, so events from inside the menu are ignored.
    const onScroll = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      updateMenuPos();
    };
    const onDown = (event) => {
      if (phoneFieldRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setPhoneCountryOpen(false);
    };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", updateMenuPos);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [phoneCountryOpen]);

  const save = async (event) => {
    event.preventDefault();
    if (!canMutate || !mutationLocks.acquire("resource-save")) return;
    const payload = apiMapFormToPayload ? apiMapFormToPayload(form, { editing: Boolean(editingId) }) : null;

    if (!payload) {
      setApiError("Проверьте обязательные поля формы.");
      mutationLocks.release("resource-save");
      return;
    }
    setSaving(true);
    try {
      const { data } = editingId
        ? await settingsService.updateResource(resourceKey, editingId, payload)
        : await settingsService.createResource(resourceKey, payload);
      if (!data?.id) throw new Error("Backend не вернул сохранённую запись.");
      const mapped = apiMapRow ? apiMapRow(data) : data;
      // Local-only status display: the backend has no status field, so the
      // chosen option is merged into the visible row only (payload untouched).
      if (mapped && typeof mapped === "object" && form.status) {
        const found = CLIENT_STATUS_OPTIONS.find((o) => o.value === form.status);
        if (found) mapped.status = found.label;
      }
      setRows((current) => editingId
        ? current.map((row) => row.id === editingId ? mapped : row)
        : [mapped, ...current]);
      setPhoneCountryOpen(false);
      setModalMode(null);
    } catch (error) {
      setApiError(error.response?.data?.detail || "Не удалось сохранить. Попробуйте позже.");
    } finally {
      setSaving(false);
      mutationLocks.release("resource-save");
    }
  };

  const archive = async (row) => {
    if (!canMutate || !mutationLocks.acquire(`resource-delete:${row.id}`)) return;
    if (requireDeleteConfirm && pendingDeleteId !== String(row.id)) {
      setPendingDeleteId(String(row.id));
      mutationLocks.release(`resource-delete:${row.id}`);
      return;
    }
    setPendingDeleteId(String(row.id));
    try {
      await settingsService.deleteResource(resourceKey, row.id);
      setRows((current) => current.filter((item) => item.id !== row.id));
      if (historyRow && String(historyRow.id) === String(row.id)) closeHistory();
    } catch (error) {
      setApiError(error.response?.data?.detail || "Не удалось удалить. Попробуйте позже.");
    } finally {
      setPendingDeleteId("");
      mutationLocks.release(`resource-delete:${row.id}`);
    }
  };

  const renderSearch = () => {
    if (!searchable) return null;
    if (staffVariant) {
      return (
        <div className="sidebar-search__field clients-toolbar-search">
          <Icon name="bi-search" size={16} className="sidebar-search__icon" aria-hidden="true" />
          <input
            type="search"
            className="sidebar-search__input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(searchPlaceholder)}
            aria-label={t(searchPlaceholder)}
          />
        </div>
      );
    }
    return <input className="settings-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t(searchPlaceholder)} aria-label={t(searchPlaceholder)} />;
  };

  const renderAddButton = () => (
    <button type="button" className={staffVariant ? "staff-add-button staff-add-button--cashier" : "settings-add-button"} onClick={openAdd} disabled={!canMutate}>
      {staffVariant ? <Icon name="bi-plus" size={18} /> : null}
      {t(addLabel)}
    </button>
  );

  const renderActions = () => (
    <div className={staffVariant ? "staff-header__actions" : "settings-actions"}>
      {renderSearch()}
      {filterOptions ? (
        <select className="settings-search" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">{t("pages.settings.settingsresourcepage.vse")}</option>
          {filterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {renderAddButton()}
    </div>
  );

  const renderTabs = () => (
    tabs ? (
      staffVariant ? (
        <div className="staff-tabs staff-tabs--slider" role="tablist" aria-label={title} data-active={activeTab} ref={tabsRef}>
          <span
            className="staff-tabs__indicator"
            aria-hidden="true"
            style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
          />
          {tabs.map((tab) => (
            <button key={tab.key} type="button" data-tab={tab.key} className={activeTab === tab.key ? "is-active" : ""} onClick={() => setActiveTab(tab.key)}>{t(tab.label)}</button>
          ))}
        </div>
      ) : (
        <div className="settings-tabs">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" className={activeTab === tab.key ? "is-active" : ""} onClick={() => setActiveTab(tab.key)}>{t(tab.label)}</button>
          ))}
        </div>
      )
    ) : null
  );

  if (historyRow && statementHistory) {
    if (renderStatementView) return renderStatementView(historyRow, closeHistory);
    return (
      <div className={`settings-page ${pageClassName} client-statement-page`.trim()}>
        <section className="client-statement-card">
          <header className="client-statement-toolbar">
            <div className="client-statement-left">
              <button type="button" className="client-statement-back" onClick={closeHistory} aria-label={t("pages.settings.settingsresourcepage.nazad")}>
                <Icon name="bi-chevron-left" size={18} />
              </button>
            </div>
          </header>

          <div className="client-statement-panel">
            <div className="client-statement-heading">
              <span>{t("pages.settings.settingsresourcepage.istoriya_tranzaktsiy")}</span>
              <h1>{t("pages.settings.settingsresourcepage.akt_sverki")}</h1>
              <strong>{historyRow.name}</strong>
            </div>
            <div className="settings-empty-state" role="status">
             {t("pages.settings.settingsresourcepage.finansovaya_istoriya_nedostupna_backend_contract")}
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Clients V11: phone uses the EXACT Staff split pattern — a separate
  // country-code control [flag +998 v] plus a separate subscriber-digits
  // input — with the real Staff classes, flag assets and helpers
  // (../staff/staffPhone, read-only import). form.phone keeps the canonical
  // stored string ("+998…" / "+…" / digits); form.phoneCountry is display
  // selection only and never reaches the payload (the mapper picks
  // full_name/phone/type). Persisted semantics are unchanged. (Hooks for
  // this block live above the History early-return; only plain consts stay
  // below it so hook order is identical on every render path.)
  const handleClientsPhoneChange = (fieldKey) => (event) => {
    const input = event.target;
    const rawValue = input.value;
    const caret = input.selectionStart ?? rawValue.length;
    const digitsBeforeCaret = rawValue.slice(0, caret).replace(/\D/g, "").length;
    // normalizePhone strips a pasted country code first, then caps digits
    // (9 for UZ) — same as the Staff form, so +998 is never retyped.
    const digits = rawValue.replace(/\D/g, "");
    const normalized = normalizePhone(digits, phoneCountry);
    setForm((current) => ({ ...current, [fieldKey]: normalized ? `+${normalized}` : "" }));
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      if (!phoneInputRef.current) return;
      const position = caretForDigitCount(digitsBeforeCaret, digits);
      phoneInputRef.current.setSelectionRange(position, position);
    });
  };

  const selectClientsPhoneCountry = (fieldKey, nextCountry) => {
    const previous = phoneCountry;
    const local = getPhoneLocal(form[fieldKey], previous).slice(0, nextCountry === "UZ" ? 9 : 10);
    setForm((current) => ({
      ...current,
      phoneCountry: nextCountry,
      // Rebase the KEEPT local digits under the new code; an empty input
      // stays empty so no code is forced onto a blank value.
      [fieldKey]: local ? `+${phoneCountryMap[nextCountry].dialCode}${local}` : current[fieldKey],
    }));
    setPhoneCountryOpen(false);
  };

  const renderPhoneField = (field) => (
    <div
      className="staff-phone-field staff-phone-field--split"
      ref={phoneFieldRef}
      onKeyDown={(event) => {
        // Escape first closes the country menu (never the modal beneath).
        if (event.key === "Escape" && phoneCountryOpen) {
          event.preventDefault();
          event.stopPropagation();
          setPhoneCountryOpen(false);
        }
      }}
    >
      <button
        className="staff-phone-country staff-phone-country--pill"
        type="button"
        ref={pillRef}
        onClick={() => setPhoneCountryOpen((value) => !value)}
        aria-label={t("pages.settings.settingsresourcepage.vybrat_stranu")}
        aria-expanded={phoneCountryOpen}
        aria-haspopup="listbox"
      >
        <img src={getPhoneFlag(phoneCountry)} alt={phoneCountryMeta.label || ""} width={22} height={15} loading="eager" decoding="async" />
        <span>+{phoneCountryMeta.dialCode}</span>
        <Icon name="bi-chevron-down" size={12} />
      </button>
      {phoneCountryOpen ? (
        portalTarget
          // Portaled consumers (Clients modal): mount ONLY at final coords.
          // While menuPos is null (first frame) render NOTHING — never the
          // in-flow fallback below, which flashed visibly for one frame.
          ? (menuPos ? createPortal(
          <div
            className="staff-phone-country-menu"
            ref={menuRef}
            role="listbox"
            aria-label={t("pages.settings.settingsresourcepage.vybrat_stranu")}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              zIndex: 10001,
            }}
          >
            {phoneCountries.map((country) => (
              <button
                className={phoneCountry === country.key ? "is-active" : ""}
                type="button"
                role="option"
                aria-selected={phoneCountry === country.key}
                key={country.key}
                onClick={() => selectClientsPhoneCountry(field.key, country.key)}
              >
              <img src={getPhoneFlag(country.key)} alt="" width={28} height={19} loading="eager" decoding="async" />
              <span>{t(country.label)}</span>
              <b>+{country.dialCode}</b>
            </button>
          ))}
        </div>,
        portalTarget,
      ) : null) : (
        // Non-portaled fallback (consumers without usePortal): in-flow menu,
        // same Staff classes. The Clients modal always portals (see above).
        <div className="staff-phone-country-menu" ref={menuRef} role="listbox" aria-label={t("pages.settings.settingsresourcepage.vybrat_stranu")}>
          {phoneCountries.map((country) => (
            <button
              className={phoneCountry === country.key ? "is-active" : ""}
              type="button"
              role="option"
              aria-selected={phoneCountry === country.key}
              key={country.key}
              onClick={() => selectClientsPhoneCountry(field.key, country.key)}
            >
              <img src={getPhoneFlag(country.key)} alt="" width={28} height={19} loading="eager" decoding="async" />
                <span>{t(country.label)}</span>
                <b>+{country.dialCode}</b>
              </button>
            ))}
          </div>
        )
      ) : null}
      <input
        autoComplete="off"
        inputMode="tel"
        ref={phoneInputRef}
        aria-label={t("pages.settings.settingsresourcepage.nomer_telefona_bez_koda_strany")}
        value={formatLocalUZ(getPhoneLocal(form.phone, phoneCountry))}
        onChange={handleClientsPhoneChange(field.key)}
        placeholder={t("pages.settings.settingsresourcepage.vvedite_nomer")}
      />
    </div>
  );

  const visibleFormFields = hideTypeField ? formFields.filter((field) => field.key !== "type") : formFields;

  const renderFormFields = () => (
    <div className="settings-form__grid">
      {visibleFormFields.map((field) => field.type === "status" ? (
        // Marjon custom select (shared MarjonSelect primitive, floating
        // portal menu): sibling label + control, exactly like the Payment
        // Methods type field. form.status is LOCAL-ONLY display state while
        // the Counterparty backend has no canonical status field
        // (STATUS_BACKEND_SUPPORTED = NO): never mapped into the payload,
        // never persisted, reset on every open.
        <div className="settings-field" key={field.key}>
          <label className="settings-field__label" htmlFor={`clients-${field.key}`}>{t(field.label)}</label>
          <MarjonSelect
            id={`clients-${field.key}`}
            label={field.label}
            placeholder={t("pages.settings.settingsresourcepage.vyberite_status")}
            value={form[field.key] || CLIENT_STATUS_DEFAULT}
            options={CLIENT_STATUS_OPTIONS}
            onChange={(next) => setForm((current) => ({ ...current, [field.key]: next }))}
            floating
          />
        </div>
      ) : (
        <label key={field.key} className={field.type === "textarea" ? "settings-form__wide" : ""}>
          <span>{field.label}</span>
          {field.type === "select" ? (
            <select value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>
              {(field.options || []).map((option) => {
                const value = typeof option === "object" ? option.value : option;
                const label = typeof option === "object" ? option.label : option;
                return <option key={value} value={value}>{label}</option>;
              })}
            </select>
          ) : field.type === "textarea" ? (
            <textarea value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
          ) : field.type === "phone" ? (
            renderPhoneField(field)
          ) : (
            <input value={form[field.key] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />
          )}
        </label>
      ))}
    </div>
  );

  const formTitle = editingId
    ? (typeof editTitle === "function" ? editTitle(form) : (editTitle || title))
    : (typeof addTitle === "function" ? addTitle(form) : (addTitle || title));

  // Clients V10: CENTERED modal reusing the exact Settings → Payment Methods
  // modal primitives (settings-drawer settings-modal-overlay shell,
  // settings-drawer__backdrop, settings-form settings-modal card, header with
  // accent bar + eyebrow + title + X, settings-form__body, footer with
  // Отмена/Сохранить). No right drawer, no viewport-fixed footer.
  // Other consumers (centeredModal=false) keep the accepted right drawer.
  const editDrawer = !centeredModal && modalMode === "edit" ? (
    <div className="settings-drawer" role="dialog" aria-modal="true">
      <div className="settings-drawer__backdrop" onClick={saving ? undefined : closeModal} />
      <form className="settings-form" onSubmit={save}>
        <header className="settings-form__header">
          <span className="settings-accent-bar" />
          <div>
            <p>{editingId ? "Редактирование" : "Новая запись"}</p>
            <h2>{formTitle}</h2>
          </div>
          <button type="button" disabled={saving} onClick={closeModal} aria-label={t("pages.settings.settingsresourcepage.zakryt")}><Icon name="bi-x-lg" size={20} /></button>
        </header>
        {renderFormFields()}
        <footer className="settings-form__footer">
          <button type="button" disabled={saving} onClick={closeModal}>{t("pages.settings.settingsresourcepage.otmena")}</button>
          <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
        </footer>
      </form>
    </div>
  ) : null;

  const editModal = centeredModal && modalMode === "edit" ? (
    <div className="settings-drawer settings-modal-overlay" role="presentation">
      <div className="settings-drawer__backdrop" onClick={saving ? undefined : closeModal} />
      <form className="settings-form settings-modal clients-modal" role="dialog" aria-modal="true" aria-labelledby="clients-modal-title" onSubmit={save}>
        <header className="settings-form__header">
          <span className="settings-accent-bar" />
          <div>
            <p>{editingId ? "Редактирование" : "Новая запись"}</p>
            <h2 id="clients-modal-title">{formTitle}</h2>
          </div>
          <button type="button" aria-label={t("pages.settings.settingsresourcepage.zakryt")} disabled={saving} onClick={closeModal}><Icon name="bi-x-lg" size={20} /></button>
        </header>
        <div className="settings-form__body">
          {renderFormFields()}
        </div>
        <footer className="settings-form__footer">
          <button type="button" disabled={saving} onClick={closeModal}>{t("pages.settings.settingsresourcepage.otmena")}</button>
          <button type="submit" disabled={saving}>{saving ? "Сохранение..." : "Сохранить"}</button>
        </footer>
      </form>
    </div>
  ) : null;

  const historyDrawer = historyRow && !renderHistoryContent ? (
    <div className="settings-drawer" role="dialog" aria-modal="true">
      <div className="settings-drawer__backdrop" onClick={closeHistory} />
      <aside className="settings-form">
        <header className="settings-form__header">
          <span className="settings-accent-bar" />
          <div>
            <p>{t("pages.settings.settingsresourcepage.istoriya")}</p>
            <h2>{historyRow.name}</h2>
          </div>
          <button type="button" onClick={closeHistory}><Icon name="bi-x-lg" size={20} /></button>
        </header>
        <div className="settings-empty-state" role="status">
         {t("pages.settings.settingsresourcepage.istoriya_nedostupna_backend_contract_dlya")}
        </div>
      </aside>
    </div>
  ) : null;

  // The portaled modal escapes the page's .settings-owner-view ancestor, so
  // the centered-modal rules (scoped under .settings-owner-view, same as the
  // Payment Methods .payment-methods-modal-layer wrapper) need the marker on
  // the portal layer itself. (portalTarget itself is defined near the top,
  // TDZ-safe for the phone popover read during modal const initialization.)
  const modalLayer = (node) => {
    if (!node) return null;
    if (!portalTarget) return node;
    if (!centeredModal) return createPortal(node, portalTarget);
    return createPortal(<div className="settings-owner-view clients-modal-layer">{node}</div>, portalTarget);
  };

  return (
    <div className={`settings-page ${staffVariant ? "settings-owner-view" : ""} ${pageClassName}`.trim().replace(/\s+/g, " ")}>
      <section className="settings-card">
        {compactHeader ? (
          <header className="settings-directory-toolbar">
            {renderTabs()}
            {renderActions()}
          </header>
        ) : staffVariant ? (
          <>
            <header className="settings-header">
              <div className="settings-title-group">
                <span className="settings-accent-bar" />
                <div>
                  <p>{t(eyebrow)}</p>
                  <h1>{title}</h1>
                </div>
              </div>
              <div className="staff-header--cashier clients-toolbar">
                <div className="staff-header__actions">
                  {renderTabs()}
                  {renderSearch()}
                  {renderAddButton()}
                </div>
              </div>
            </header>
          </>
        ) : (
          <>
            <header className="settings-header">
              <div className="settings-title-group">
                <span className="settings-accent-bar" />
                <div>
                  <p>{t("pages.settings.settingsresourcepage.nastroyki")}</p>
                  <h1>{title}</h1>
                </div>
              </div>
              {renderActions()}
            </header>

            {renderTabs()}
          </>
        )}

        <div className={staffVariant ? "staff-table-wrapper" : "settings-table-wrapper"}>
          <table className={staffVariant ? "staff-table" : "settings-table"}>
            <thead>
              <tr>
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                <th>{t(actionsLabel)}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.key === "status" && row.status && row.status !== "—" ? (
                        <StatusBadge status={row.status} />
                      ) : column.key === "history" && transactionHistory ? (
                        <button className="settings-history-button" type="button" onClick={() => openHistory(row)}>
                         {t("pages.settings.settingsresourcepage.istoriya_tranzaktsiy")} <Icon name="bi-arrow-right" size={15} />
                        </button>
                      ) : renderCell(column, row, setForm)}
                    </td>
                  ))}
                  <td>
                    <div className={staffVariant ? "staff-actions" : "settings-row-actions"}>
                      {row.testPrint ? <button type="button" onClick={() => window.alert("Тест печати будет доступен в следующей версии")}>{t("pages.settings.settingsresourcepage.test_pechati")}</button> : null}
                      <button type="button" disabled={!canMutate || saving} className={staffVariant ? "edit-action-button" : "settings-action-edit"} onClick={() => openEdit(row)} aria-label={t("pages.settings.settingsresourcepage.redaktirovat")} title={t("pages.settings.settingsresourcepage.redaktirovat")}><Icon name="bi-pencil" size={15} /></button>
                      {requireDeleteConfirm && pendingDeleteId === String(row.id) ? (
                        <>
                          <span className="settings-delete-confirm" role="alert">{deleteConfirmText}</span>
                          <button type="button" className={staffVariant ? "staff-delete-action is-confirm" : "settings-action-delete is-confirm"} onClick={() => archive(row)}>{t("pages.settings.settingsresourcepage.da")}</button>
                          <button type="button" className="settings-action-cancel" onClick={() => setPendingDeleteId("")}>{t("pages.settings.settingsresourcepage.net")}</button>
                        </>
                      ) : (
                        <button type="button" disabled={!canMutate || pendingDeleteId === String(row.id)} className={staffVariant ? "staff-delete-action" : "settings-action-delete"} onClick={() => archive(row)} aria-label={t("pages.settings.settingsresourcepage.udalit")} title={t("pages.settings.settingsresourcepage.udalit")}><Icon name="bi-trash3" size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {apiLoading ? <tr className={staffVariant ? "staff-empty-row" : ""}><td colSpan={columns.length + 1} className={staffVariant ? "staff-empty-cell" : ""}><div className="settings-empty-state">{t("pages.settings.settingsresourcepage.zagruzka")}</div></td></tr> : null}
              {!apiLoading && apiError ? <tr className={staffVariant ? "staff-empty-row" : ""}><td colSpan={columns.length + 1} className={staffVariant ? "staff-empty-cell" : ""}><div className="settings-empty-state" role="alert">{apiError}</div></td></tr> : null}
              {!apiLoading && !apiError && !visibleRows.length ? (
                <tr className={staffVariant ? "staff-empty-row" : ""}>
                  <td colSpan={columns.length + 1} className={staffVariant ? "staff-empty-cell" : ""}>
                    {staffVariant ? <ReportEmptyState title={t(emptyText)} /> : <div className="settings-empty-state">{t(emptyText)}</div>}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modalLayer(editModal ? editModal : editDrawer)}

      {historyRow ? (
        renderHistoryContent ? renderHistoryContent(historyRow, closeHistory) : (
          portalTarget ? (historyDrawer ? createPortal(historyDrawer, portalTarget) : null) : historyDrawer
        )
      ) : null}
    </div>
  );
}

function renderCell(column, row, setForm) {
  if (column.inlineSort) {
    return <input className="settings-inline-input" value={row[column.key]} onChange={(event) => setForm((current) => ({ ...current, [column.key]: event.target.value }))} readOnly />;
  }
  if (column.link) return <span className="settings-link-cell">{row[column.key]}</span>;
  // Display-only formatting (e.g. Clients UZ phone mask): the raw row value
  // stays canonical for search/edit/payloads; only the rendered cell changes.
  if (typeof column.format === "function") return column.format(row[column.key], row) || "-";
  return row[column.key] || "-";
}

function StatusBadge({ status }) {
  const label = String(status || "").trim();
  const tone = label === "Активный" || label === "Активно" || label === "active" || status === STATUS_ACTIVE
    ? "is-active"
    : "is-inactive";
  const text = label === "active" ? "Активный" : label === "inactive" ? "Не активный" : label;
  return (
    <span className={`settings-status-badge ${tone}`}>
      <span className="settings-status-badge__dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export { STATUS_ACTIVE, STATUS_INACTIVE, STATUS_PENDING };
export default SettingsResourcePage;
