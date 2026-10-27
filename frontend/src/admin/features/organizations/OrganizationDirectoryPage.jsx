import { useEffect, useMemo, useRef, useState } from "react";

import { ApiContractError, normalizePaginatedList } from "../../../api/normalizers";
import Icon from "../../../components/Icon";
import { AdminPageSizeDropdown, getPageList, keepWheelInsideScroller } from "../../AdminShared";
import { organizationErrorMessage } from "./organizationErrors";
import { organizationsApi } from "./organizationsApi";
import { webFormat } from "../../../utils/webTime";
import { t } from "../../../i18n/t";

export const organizationRows = [];

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const COLUMN_KEYS = [
  "number", "message", "name", "clientId", "type", "owner", "admin", "branches",
  "tariff", "workingDays", "installed", "accessStatus", "lifecycle", "onlineMenu",
  "warehouse", "cashBalance", "actions",
];
const DEFAULT_VISIBLE_COLUMNS = [...COLUMN_KEYS];
const COLUMN_STORAGE_KEY = "marjon.admin.organizations.truthful-columns.v1";

const EMPTY_ORGANIZATION_FORM = Object.freeze({
  name: "",
  tariffPrice: "",
  workingDays: "",
  isMain: false,
  virtualCashRegisterNumber: "",
  virtualCashRegisterIpAddress: "",
  countryId: "",
  regionId: "",
  districtId: "",
  tin: "",
  installationDate: "",
  organizationStatusId: "",
  lifecycleStatus: "active",
  onlineMenu: false,
  storageIntegration: false,
  isSolvent: true,
  billingAutoblock: false,
  taplink: "",
  faceDetectionRequired: false,
});

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || "null");
    if (!Array.isArray(saved)) return DEFAULT_VISIBLE_COLUMNS;
    const normalized = COLUMN_KEYS.filter((key) => saved.includes(key));
    return normalized.length ? normalized : DEFAULT_VISIBLE_COLUMNS;
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
}

function saveVisibleColumns(visibleColumns) {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns));
  } catch {
    // Storage is optional; the current page state remains authoritative.
  }
}

function nullableText(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("ru-RU") : String(value);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : webFormat(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function lifecycleLabel(status) {
  if (status === "active") return "Активна";
  if (status === "blocked") return "Заблокирована";
  return nullableText(status);
}

function booleanLabel(value) {
  if (value === true) return "Активно";
  if (value === false) return "Неактивно";
  return "—";
}

function requireCanonicalString(raw, field, contractName) {
  const value = raw?.[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiContractError(`Invalid ${contractName} response: ${field} is required.`, {
      code: `INVALID_${contractName.toUpperCase()}_RESPONSE`,
      field,
    });
  }
  return value;
}

export function normalizeOrganizationStatus(raw) {
  const id = requireCanonicalString(raw, "id", "organization_status");
  const name = requireCanonicalString(raw, "name", "organization_status");
  if (!Number.isInteger(raw?.sort) || typeof raw?.status !== "boolean") {
    throw new ApiContractError("Invalid organization_status response.", {
      code: "INVALID_ORGANIZATION_STATUS_RESPONSE",
    });
  }
  return {
    id,
    name,
    sort: raw.sort,
    active: raw.status,
  };
}

export function normalizeOrganization(raw, statusNames = new Map()) {
  const id = requireCanonicalString(raw, "id", "organization");
  const name = requireCanonicalString(raw, "name", "organization");
  const organizationStatusId = raw?.organization_status_id ? String(raw.organization_status_id) : "";
  const linkedStatus = organizationStatusId
    ? statusNames.get(organizationStatusId) || `ID: ${organizationStatusId}`
    : "—";

  return {
    id,
    name,
    clientId: id,
    type: raw?.is_main === true ? "Главный" : raw?.is_main === false ? "Обычный" : nullableText(raw?.type),
    owner: nullableText(raw?.owner_name),
    admin: nullableText(raw?.admin_name),
    branches: raw?.branches_count === null || raw?.branches_count === undefined
      ? "—"
      : String(raw.branches_count),
    tariff: formatNumber(raw?.tariff_price),
    workingDays: formatNumber(raw?.working_days),
    installed: formatDate(raw?.installation_date),
    accessStatus: linkedStatus,
    organizationStatusId,
    lifecycle: lifecycleLabel(raw?.status),
    lifecycleValue: raw?.status || "",
    onlineMenu: booleanLabel(raw?.online_menu),
    warehouse: booleanLabel(raw?.enabled_storage_integration),
    cashBalance: formatNumber(raw?.cash_balance),
    raw,
  };
}

function organizationToForm(raw = {}) {
  return {
    name: raw.name ?? "",
    tariffPrice: raw.tariff_price ?? "",
    workingDays: raw.working_days ?? "",
    isMain: raw.is_main === true,
    virtualCashRegisterNumber: raw.virtual_cash_register_number ?? "",
    virtualCashRegisterIpAddress: raw.virtual_cash_register_ip_address ?? "",
    countryId: raw.country_id ?? "",
    regionId: raw.region_id ?? "",
    districtId: raw.district_id ?? "",
    tin: raw.tin ?? "",
    installationDate: raw.installation_date ?? "",
    organizationStatusId: raw.organization_status_id ?? "",
    lifecycleStatus: raw.status ?? "",
    onlineMenu: raw.online_menu === true,
    storageIntegration: raw.enabled_storage_integration === true,
    isSolvent: raw.is_solvent === true,
    billingAutoblock: raw.is_billing_autoblock === true,
    taplink: raw.taplink ?? "",
    faceDetectionRequired: raw.is_face_detection_required === true,
  };
}

function organizationPayload(form) {
  const name = form.name.trim();
  if (!name) throw new Error("Укажите название организации.");

  const tariffPrice = form.tariffPrice === "" ? 0 : Number(form.tariffPrice);
  const workingDays = form.workingDays === "" ? 0 : Number(form.workingDays);
  if (!Number.isFinite(tariffPrice) || tariffPrice < 0) throw new Error("Цена тарифа должна быть неотрицательным числом.");
  if (!Number.isInteger(workingDays) || workingDays < 0) throw new Error("Рабочие дни должны быть целым неотрицательным числом.");

  return {
    name,
    tariff_price: tariffPrice,
    working_days: workingDays,
    is_main: form.isMain,
    virtual_cash_register_number: form.virtualCashRegisterNumber.trim() || null,
    virtual_cash_register_ip_address: form.virtualCashRegisterIpAddress.trim() || null,
    country_id: form.countryId || null,
    region_id: form.regionId || null,
    district_id: form.districtId || null,
    tin: form.tin.trim() || null,
    installation_date: form.installationDate || null,
    organization_status_id: form.organizationStatusId || null,
    status: form.lifecycleStatus,
    online_menu: form.onlineMenu,
    enabled_storage_integration: form.storageIntegration,
    is_solvent: form.isSolvent,
    is_billing_autoblock: form.billingAutoblock,
    taplink: form.taplink.trim() || null,
    is_face_detection_required: form.faceDetectionRequired,
  };
}

function normalizeDirectoryOption(raw, label) {
  return {
    id: requireCanonicalString(raw, "id", label),
    name: requireCanonicalString(raw, "name", label),
  };
}

function ModalShell({ title, description, onClose, busy, children, actions, tone = "default" }) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const first = panelRef.current?.querySelector("input, select, button:not([disabled])");
    first?.focus();
    return () => returnFocusRef.current?.focus?.();
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...panelRef.current.querySelectorAll("input, select, button:not([disabled])")]
      .filter((element) => !element.hasAttribute("hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="admin-modal org-directory-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        ref={panelRef}
        className={`admin-modal__panel org-directory-modal__panel ${tone === "danger" ? "is-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-directory-modal-title"
        aria-describedby="org-directory-modal-description"
        onKeyDown={handleKeyDown}
      >
        <div className="admin-modal__head">
          <div>
            <h3 id="org-directory-modal-title">{title}</h3>
            <p id="org-directory-modal-description">{description}</p>
          </div>
          <button className="admin-modal__close" type="button" onClick={onClose} disabled={busy} aria-label={t("admin.features.organizations.organizationdirectorypage.zakryt")}>
            <Icon name="bi-x-lg" size={16} />
          </button>
        </div>
        {children}
        <div className="admin-modal__actions">{actions}</div>
      </section>
    </div>
  );
}

function OrganizationFormModal({ mode, row, statuses, directories, busy, error, onClose, onSubmit }) {
  const [form, setForm] = useState(() => mode === "edit" ? organizationToForm(row.raw) : { ...EMPTY_ORGANIZATION_FORM });
  const [validationError, setValidationError] = useState("");

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError("");
  }

  function submit(event) {
    event.preventDefault();
    try {
      onSubmit(organizationPayload(form));
    } catch (submitError) {
      setValidationError(submitError.message);
    }
  }

  const title = mode === "create" ? "Добавить организацию" : `Редактировать ${row.name}`;
  return (
    <ModalShell
      title={title}
      description={t("admin.features.organizations.organizationdirectorypage.polya_sootvetstvuyut_kanonicheskomu_hq_kontraktu")}
      onClose={onClose}
      busy={busy}
      actions={<>
        <button type="button" className="admin-modal__btn is-ghost" onClick={onClose} disabled={busy}>{t("admin.features.organizations.organizationdirectorypage.otmena")}</button>
        <button type="submit" form="organization-form" className="admin-modal__btn is-primary" disabled={busy}>
          {busy ? "Сохранение..." : "Сохранить"}
        </button>
      </>}
    >
      <form id="organization-form" className="org-directory-modal__form" onSubmit={submit}>
        <label className="is-wide"><span>{t("admin.features.organizations.organizationdirectorypage.nazvanie")}</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} required /></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.tip_filiala")}</span><select value={form.isMain ? "main" : "regular"} onChange={(event) => setField("isMain", event.target.value === "main")}><option value="regular">{t("admin.features.organizations.organizationdirectorypage.obychnyy")}</option><option value="main">{t("admin.features.organizations.organizationdirectorypage.glavnyy")}</option></select></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.inn")}</span><input value={form.tin} onChange={(event) => setField("tin", event.target.value)} /></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.tsena_tarifa")}</span><input type="number" min="0" step="0.01" value={form.tariffPrice} onChange={(event) => setField("tariffPrice", event.target.value)} /></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.rabochie_dni")}</span><input type="number" min="0" step="1" value={form.workingDays} onChange={(event) => setField("workingDays", event.target.value)} /></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.data_ustanovki")}</span><input type="date" value={form.installationDate} onChange={(event) => setField("installationDate", event.target.value)} /></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.strana")}</span><select value={form.countryId} onChange={(event) => setField("countryId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazana")}</option>{directories.countries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.region")}</span><select value={form.regionId} onChange={(event) => setField("regionId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.regions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>{t("admin.features.organizations.organizationdirectorypage.rayon")}</span><select value={form.districtId} onChange={(event) => setField("districtId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.districts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>
          <span>{t("admin.features.organizations.organizationdirectorypage.status_organizatsii")}</span>
          <select value={form.organizationStatusId} onChange={(event) => setField("organizationStatusId", event.target.value)}>
            <option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>
            {statuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
          </select>
        </label>
        <label>
          <span>{t("admin.features.organizations.organizationdirectorypage.sostoyanie")}</span>
          <select value={form.lifecycleStatus} onChange={(event) => setField("lifecycleStatus", event.target.value)} required>
            <option value="active">{t("admin.features.organizations.organizationdirectorypage.aktivna")}</option>
            <option value="blocked">{t("admin.features.organizations.organizationdirectorypage.zablokirovana")}</option>
          </select>
        </label>
        <div className="org-directory-modal__checks is-wide">
          <label><input type="checkbox" checked={form.onlineMenu} onChange={(event) => setField("onlineMenu", event.target.checked)} /> {t("admin.features.organizations.organizationdirectorypage.onlayn_menyu")}</label>
          <label><input type="checkbox" checked={form.storageIntegration} onChange={(event) => setField("storageIntegration", event.target.checked)} /> {t("admin.features.organizations.organizationdirectorypage.integratsiya_sklada")}</label>
          <label><input type="checkbox" checked={form.isSolvent} onChange={(event) => setField("isSolvent", event.target.checked)} /> {t("admin.features.organizations.organizationdirectorypage.platezhesposobna")}</label>
          <label><input type="checkbox" checked={form.billingAutoblock} onChange={(event) => setField("billingAutoblock", event.target.checked)} /> {t("admin.features.organizations.organizationdirectorypage.avtoblokirovka_billinga")}</label>
          <label><input type="checkbox" checked={form.faceDetectionRequired} onChange={(event) => setField("faceDetectionRequired", event.target.checked)} /> {t("admin.features.organizations.organizationdirectorypage.podtverzhdenie_myid")}</label>
        </div>
        {validationError || error ? <div className="org-directory-modal__error is-wide" role="alert">{validationError || error}</div> : null}
      </form>
    </ModalShell>
  );
}

function OrganizationEditScreen({ row, statuses, directories, busy, error, onBack, onSubmit }) {
  const [form, setForm] = useState(() => organizationToForm(row.raw));
  const [validationError, setValidationError] = useState("");

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError("");
  }

  function submit(event) {
    event.preventDefault();
    try {
      onSubmit(organizationPayload(form));
    } catch (submitError) {
      setValidationError(submitError.message);
    }
  }

  const settingRows = [
    ["storageIntegration", "Управление складом"],
    ["onlineMenu", "Онлайн-меню"],
    ["isSolvent", "Платёжеспособна"],
    ["billingAutoblock", "Автоблокировка"],
    ["faceDetectionRequired", "Подтверждение MYID"],
  ];

  return (
    <section className="org-edit-page">
      <header className="org-edit-header">
        <button type="button" className="org-edit-back" onClick={onBack} disabled={busy} aria-label={t("admin.features.organizations.organizationdirectorypage.nazad_k_organizatsiyam")}>
          <Icon name="bi-chevron-left" size={18} />
        </button>
        <h2>{t("admin.features.organizations.organizationdirectorypage.izmenit_organizatsiyu")}</h2>
      </header>

      <form className="org-edit-form" onSubmit={submit}>
        <h3>{t("admin.features.organizations.organizationdirectorypage.osnovnye_dannye")}</h3>
        <div className="org-edit-grid">
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.nazvanie")}<b>*</b></span><input value={form.name} onChange={(event) => setField("name", event.target.value)} required /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.tsena_tarifa")}</span><input type="number" min="0" step="0.01" value={form.tariffPrice} onChange={(event) => setField("tariffPrice", event.target.value)} /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.rabochie_dni")}</span><input type="number" min="0" step="1" value={form.workingDays} onChange={(event) => setField("workingDays", event.target.value)} /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.tip_filiala")}</span><select value={form.isMain ? "main" : "regular"} onChange={(event) => setField("isMain", event.target.value === "main")}><option value="regular">{t("admin.features.organizations.organizationdirectorypage.obychnyy")}</option><option value="main">{t("admin.features.organizations.organizationdirectorypage.glavnyy")}</option></select></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.virtualnaya_kassa_nomer")}</span><input value={form.virtualCashRegisterNumber} onChange={(event) => setField("virtualCashRegisterNumber", event.target.value)} placeholder={t("admin.features.organizations.organizationdirectorypage.vvedite_nomer")} /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.ip_adres_virtualnoy_kassy")}</span><input value={form.virtualCashRegisterIpAddress} onChange={(event) => setField("virtualCashRegisterIpAddress", event.target.value)} placeholder={t("admin.features.organizations.organizationdirectorypage.vvedite_ip_adres")} /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.strana")}</span><select value={form.countryId} onChange={(event) => setField("countryId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazana")}</option>{directories.countries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.region")}</span><select value={form.regionId} onChange={(event) => setField("regionId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.regions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.rayon")}</span><select value={form.districtId} onChange={(event) => setField("districtId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.districts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.data_ustanovki")}</span><input type="date" value={form.installationDate} onChange={(event) => setField("installationDate", event.target.value)} /></label>
          <label className="org-edit-field"><span>{t("admin.features.organizations.organizationdirectorypage.inn_organizatsii")}</span><input value={form.tin} onChange={(event) => setField("tin", event.target.value)} /></label>
          <label className="org-edit-field"><span>Taplink</span><input type="url" value={form.taplink} onChange={(event) => setField("taplink", event.target.value)} placeholder="https://" /></label>
          <label className="org-edit-field">
            <span>{t("admin.features.organizations.organizationdirectorypage.status_organizatsii")}</span>
            <select value={form.organizationStatusId} onChange={(event) => setField("organizationStatusId", event.target.value)}>
              <option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>
              {statuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
            </select>
          </label>
          <label className="org-edit-field">
            <span>{t("admin.features.organizations.organizationdirectorypage.sostoyanie")}</span>
            <select value={form.lifecycleStatus} onChange={(event) => setField("lifecycleStatus", event.target.value)} required>
              <option value="active">{t("admin.features.organizations.organizationdirectorypage.aktivna")}</option>
              <option value="blocked">{t("admin.features.organizations.organizationdirectorypage.zablokirovana")}</option>
            </select>
          </label>
        </div>

        <div className="org-edit-settings">
          <h3>{t("admin.features.organizations.organizationdirectorypage.nastroyki")}</h3>
          <div className="org-edit-toggle-grid">
            {settingRows.map(([key, label]) => (
              <div className="org-edit-setting" key={key}>
                <span>{label}</span>
                <button
                  type="button"
                  className={`org-edit-toggle ${form[key] ? "is-on" : ""}`}
                  onClick={() => setField(key, !form[key])}
                  aria-pressed={form[key]}
                  aria-label={label}
                >
                  <span />
                </button>
              </div>
            ))}
          </div>
        </div>

        {validationError || error ? <div className="org-directory-modal__error org-edit-error" role="alert">{validationError || error}</div> : null}
        <div className="org-edit-actions">
          <button type="submit" className="org-edit-save" disabled={busy}>{busy ? "Сохранение..." : "Сохранить"}</button>
        </div>
      </form>
    </section>
  );
}

function OrganizationMessageScreen({ row, statuses, directories, busy, error, onBack, onSubmit }) {
  const [form, setForm] = useState(() => organizationToForm(row.raw));
  const [validationError, setValidationError] = useState("");

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationError("");
  }

  function submit(event) {
    event.preventDefault();
    try {
      onSubmit(organizationPayload(form));
    } catch (submitError) {
      setValidationError(submitError.message);
    }
  }

  const settings = [
    ["storageIntegration", "Управление складом"],
    ["onlineMenu", "Онлайн-меню"],
    ["isSolvent", "Платёжеспособна"],
    ["billingAutoblock", "Автоблокировка"],
    ["faceDetectionRequired", "Подтверждение MYID"],
  ];

  return (
    <section className="org-message-page">
      <header className="org-message-header">
        <button type="button" className="org-message-back" onClick={onBack} disabled={busy} aria-label={t("admin.features.organizations.organizationdirectorypage.nazad_k_organizatsiyam")}>
          <Icon name="bi-arrow-left" size={16} />
        </button>
        <div>
          <h2>{t("admin.features.organizations.organizationdirectorypage.soobschenie")} {row.name}</h2>
          <p>{row.name} · ID {row.clientId}</p>
        </div>
        <button type="submit" form="organization-message-form" className="org-message-save-top" disabled={busy}>{busy ? "Сохранение..." : "Сохранить"}</button>
      </header>

      <div className="org-message-layout">
        <form id="organization-message-form" className="org-message-form" onSubmit={submit}>
          <div className="org-message-form__status">
            <span>{t("admin.features.organizations.organizationdirectorypage.sostoyanie_2")} {form.lifecycleStatus === "blocked" ? "Заблокирована" : "Активна"}</span>
            <button
              type="button"
              className={`org-message-toggle ${form.lifecycleStatus === "active" ? "is-on" : ""}`}
              onClick={() => setField("lifecycleStatus", form.lifecycleStatus === "active" ? "blocked" : "active")}
              aria-label={t("admin.features.organizations.organizationdirectorypage.sostoyanie_organizatsii")}
              aria-pressed={form.lifecycleStatus === "active"}
            >
              <span />
            </button>
          </div>

          <div className="org-message-field-grid">
            <label><span>{t("admin.features.organizations.organizationdirectorypage.nazvanie_2")}</span><input value={form.name} onChange={(event) => setField("name", event.target.value)} required /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.tip_filiala")}</span><select value={form.isMain ? "main" : "regular"} onChange={(event) => setField("isMain", event.target.value === "main")}><option value="regular">{t("admin.features.organizations.organizationdirectorypage.obychnyy")}</option><option value="main">{t("admin.features.organizations.organizationdirectorypage.glavnyy")}</option></select></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.tsena_tarifa")}</span><input type="number" min="0" step="0.01" value={form.tariffPrice} onChange={(event) => setField("tariffPrice", event.target.value)} /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.rabochie_dni")}</span><input type="number" min="0" step="1" value={form.workingDays} onChange={(event) => setField("workingDays", event.target.value)} /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.virtualnaya_kassa")}</span><input value={form.virtualCashRegisterNumber} onChange={(event) => setField("virtualCashRegisterNumber", event.target.value)} /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.ip_virtualnoy_kassy")}</span><input value={form.virtualCashRegisterIpAddress} onChange={(event) => setField("virtualCashRegisterIpAddress", event.target.value)} /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.strana")}</span><select value={form.countryId} onChange={(event) => setField("countryId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazana")}</option>{directories.countries.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.region")}</span><select value={form.regionId} onChange={(event) => setField("regionId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.regions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.rayon")}</span><select value={form.districtId} onChange={(event) => setField("districtId", event.target.value)}><option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>{directories.districts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.inn_organizatsii")}</span><input value={form.tin} onChange={(event) => setField("tin", event.target.value)} /></label>
            <label><span>{t("admin.features.organizations.organizationdirectorypage.data_ustanovki")}</span><input type="date" value={form.installationDate} onChange={(event) => setField("installationDate", event.target.value)} /></label>
            <label><span>Taplink</span><input type="url" value={form.taplink} onChange={(event) => setField("taplink", event.target.value)} /></label>
            <label className="is-wide">
              <span>{t("admin.features.organizations.organizationdirectorypage.status_organizatsii")}</span>
              <select value={form.organizationStatusId} onChange={(event) => setField("organizationStatusId", event.target.value)}>
                <option value="">{t("admin.features.organizations.organizationdirectorypage.ne_ukazan")}</option>
                {statuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
              </select>
            </label>
          </div>

          <div className="org-message-settings">
            <h3>{t("admin.features.organizations.organizationdirectorypage.nastroyki")}</h3>
            <div>
              {settings.map(([key, label]) => (
                <button type="button" className={`org-message-setting ${form[key] ? "is-on" : ""}`} key={key} onClick={() => setField(key, !form[key])} aria-pressed={form[key]}>
                  <span>{label}</span><i />
                </button>
              ))}
            </div>
          </div>

          {validationError || error ? <div className="org-directory-modal__error" role="alert">{validationError || error}</div> : null}
          <button className="org-message-save" type="submit" disabled={busy}>{busy ? "Сохранение..." : "Сохранить"}</button>
        </form>

        <section className="org-message-chat" aria-label={`Сообщения ${row.name}`}>
          <div className="org-message-chat__head">
            <div className="org-message-chat__avatar"><Icon name="bi-building" size={18} /></div>
            <div><strong>{t("admin.features.organizations.organizationdirectorypage.kompaniya")} {row.name}</strong><span>ID: {row.clientId}</span></div>
            <button type="button" onClick={onBack}>{t("admin.features.organizations.organizationdirectorypage.zakryt")}</button>
          </div>
          <div className="org-message-chat__body">
            <div className="org-message-bubble is-system">
              <small>{t("admin.features.organizations.organizationdirectorypage.sistema")}</small>
              <p>{t("admin.features.organizations.organizationdirectorypage.istoriya_soobscheniy_nedostupna_kanonicheskiy_hq")}</p>
            </div>
          </div>
          <div className="org-message-chat__composer">
            <input placeholder={t("admin.features.organizations.organizationdirectorypage.napisat_soobschenie")} disabled aria-label={t("admin.features.organizations.organizationdirectorypage.soobschenie_nedostupno")} />
            <button type="button" disabled title={t("admin.features.organizations.organizationdirectorypage.hq_kontrakt_soobscheniy_otsutstvuet")}><Icon name="bi-send" size={16} /> Send</button>
          </div>
        </section>
      </div>
    </section>
  );
}

function DirectoryFlag({ value }) {
  const normalized = String(value).toLowerCase();
  const tone = normalized.includes("неактив") || normalized.includes("заблок") ? "danger"
    : value === "—" || normalized.startsWith("id:") ? "warning"
      : "success";
  return <span className={`admin-data-flag admin-data-flag--${tone}`}>{value}</span>;
}

export function OrganizationDirectoryPage({ search = "", onNotify, onInnerBackChange }) {
  const [rows, setRows] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const statusNamesRef = useRef(new Map());
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);
  const [directories, setDirectories] = useState({ countries: [], regions: [], districts: [] });
  const [directoriesLoadFailed, setDirectoriesLoadFailed] = useState(false);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [pageMeta, setPageMeta] = useState({ total: 0, page: 1, size: 20, pages: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [appliedLifecycle, setAppliedLifecycle] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [visibleColumns, setVisibleColumns] = useState(loadVisibleColumns);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editor, setEditor] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!onInnerBackChange) return undefined;
    if (editor?.mode === "edit" || editor?.mode === "message") {
      onInnerBackChange(() => {
        if (!mutationBusy) setEditor(null);
      });
    } else {
      onInnerBackChange(null);
    }
    return () => onInnerBackChange(null);
  }, [editor?.mode, mutationBusy, onInnerBackChange]);

  useEffect(() => {
    const controller = new AbortController();
    organizationsApi.listOrganizationStatuses({ page: 1, size: 200, sort: "sort" }, { signal: controller.signal })
      .then(({ data }) => {
        const normalizedStatuses = normalizePaginatedList(data).items.map(normalizeOrganizationStatus);
        statusNamesRef.current = new Map(normalizedStatuses.map((status) => [status.id, status.name]));
        setStatuses(normalizedStatuses);
        setRows((current) => current.map((row) => normalizeOrganization(row.raw, statusNamesRef.current)));
        setStatusLoadFailed(false);
      })
      .catch((error) => {
        if (error?.isAborted || error?.code === "ABORTED") return;
        setStatuses([]);
        setStatusLoadFailed(true);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      organizationsApi.listCountries({ page: 1, size: 200 }, { signal: controller.signal }),
      organizationsApi.listRegions({ page: 1, size: 200 }, { signal: controller.signal }),
      organizationsApi.listDistricts({ page: 1, size: 200 }, { signal: controller.signal }),
    ])
      .then(([countriesResponse, regionsResponse, districtsResponse]) => {
        setDirectories({
          countries: normalizePaginatedList(countriesResponse.data).items.map((item) => normalizeDirectoryOption(item, "country")),
          regions: normalizePaginatedList(regionsResponse.data).items.map((item) => normalizeDirectoryOption(item, "region")),
          districts: normalizePaginatedList(districtsResponse.data).items.map((item) => normalizeDirectoryOption(item, "district")),
        });
        setDirectoriesLoadFailed(false);
      })
      .catch((error) => {
        if (error?.isAborted || error?.code === "ABORTED") return;
        setDirectories({ countries: [], regions: [], districts: [] });
        setDirectoriesLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = { page, size: pageSize };
    const canonicalSearch = appliedSearch || search.trim();
    if (canonicalSearch) params.search = canonicalSearch;
    if (appliedLifecycle) params.status = appliedLifecycle;
    if (appliedStatus) params.organization_status_id = appliedStatus;

    setLoadState("loading");
    setLoadError("");
    organizationsApi.listOrganizations(params, { signal: controller.signal })
      .then(({ data }) => {
        const normalizedPage = normalizePaginatedList(data);
        setRows(normalizedPage.items.map((item) => normalizeOrganization(item, statusNamesRef.current)));
        setPageMeta({
          total: normalizedPage.total,
          page: normalizedPage.page,
          size: normalizedPage.size,
          pages: normalizedPage.pages,
        });
        setLoadState(normalizedPage.items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (error?.isAborted || error?.code === "ABORTED") return;
        setRows([]);
        setLoadState("error");
        setLoadError(organizationErrorMessage(error, "Не удалось загрузить организации."));
      });
    return () => controller.abort();
  }, [appliedLifecycle, appliedSearch, appliedStatus, page, pageSize, reloadKey, search]);

  useEffect(() => {
    saveVisibleColumns(visibleColumns);
  }, [visibleColumns]);

  const pageList = getPageList(pageMeta.page, pageMeta.pages);
  const startIndex = (pageMeta.page - 1) * pageMeta.size;
  const endIndex = Math.min(startIndex + rows.length, pageMeta.total);
  const activeOnPage = rows.filter((row) => row.lifecycleValue === "active").length;
  const onlineOnPage = rows.filter((row) => row.raw?.online_menu === true).length;
  const hasFilters = Boolean(appliedSearch || search.trim() || appliedLifecycle || appliedStatus);

  function applyFilters(event) {
    event?.preventDefault();
    setPage(1);
    setAppliedSearch(searchDraft.trim());
    setAppliedLifecycle(lifecycleFilter);
    setAppliedStatus(statusFilter);
  }

  function resetFilters() {
    setSearchDraft("");
    setLifecycleFilter("");
    setStatusFilter("");
    setAppliedSearch("");
    setAppliedLifecycle("");
    setAppliedStatus("");
    setPage(1);
  }

  async function saveOrganization(payload) {
    if (mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      if (editor.mode === "create") await organizationsApi.createOrganization(payload);
      else await organizationsApi.updateOrganization(editor.row.id, payload);
      onNotify?.(editor.mode === "create" ? "Организация создана." : "Организация обновлена.");
      setEditor(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setMutationError(organizationErrorMessage(error, "Не удалось сохранить организацию."));
    } finally {
      setMutationBusy(false);
    }
  }

  async function runConfirmedMutation() {
    if (!confirmation || mutationBusy) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      if (confirmation.kind === "archive") {
        await organizationsApi.archiveOrganization(confirmation.row.id);
        onNotify?.("Организация архивирована.");
        if (rows.length === 1 && page > 1) setPage((value) => value - 1);
        else setReloadKey((value) => value + 1);
      } else {
        await organizationsApi.updateOrganization(confirmation.row.id, { status: confirmation.nextStatus });
        onNotify?.(confirmation.nextStatus === "blocked" ? "Организация заблокирована." : "Организация активирована.");
        setReloadKey((value) => value + 1);
      }
      setConfirmation(null);
    } catch (error) {
      setMutationError(organizationErrorMessage(error, "Не удалось изменить организацию."));
    } finally {
      setMutationBusy(false);
    }
  }

  const allColumns = useMemo(() => [
    { key: "number", label: "№", width: 58, render: (_, index) => startIndex + index + 1 },
    { key: "message", label: "Msg", width: 62, render: (row) => <button type="button" className="org-directory-icon" onClick={() => { setMutationError(""); setEditor({ mode: "message", row }); }} title={t("admin.features.organizations.organizationdirectorypage.otkryt_rabochuyu_oblast_organizatsii")} aria-label={`Открыть сообщения ${row.name}`}><Icon name="bi-chat-square" size={15} /></button> },
    { key: "name", label: t("admin.features.organizations.organizationdirectorypage.nazvanie"), width: 200, render: (row) => <strong className="admin-data-name">{row.name}</strong> },
    { key: "clientId", label: "ID", width: 210, render: (row) => <span>{row.clientId}</span> },
    { key: "type", label: t("admin.features.organizations.organizationdirectorypage.tip"), width: 120, render: (row) => row.type },
    { key: "owner", label: t("admin.features.organizations.organizationdirectorypage.vladelets"), width: 150, render: (row) => row.owner },
    { key: "admin", label: t("admin.features.organizations.organizationdirectorypage.administrator"), width: 150, render: (row) => row.admin },
    { key: "branches", label: t("admin.features.organizations.organizationdirectorypage.filialy"), width: 86, render: (row) => row.branches },
    { key: "tariff", label: t("admin.features.organizations.organizationdirectorypage.tsena_tarifa"), width: 120, render: (row) => row.tariff },
    { key: "workingDays", label: t("admin.features.organizations.organizationdirectorypage.rabochie_dni"), width: 110, render: (row) => row.workingDays },
    { key: "installed", label: t("admin.features.organizations.organizationdirectorypage.ustanovlena"), width: 118, render: (row) => row.installed },
    { key: "accessStatus", label: t("admin.features.organizations.organizationdirectorypage.status_organizatsii"), width: 170, render: (row) => <DirectoryFlag value={row.accessStatus} /> },
    { key: "lifecycle", label: t("admin.features.organizations.organizationdirectorypage.sostoyanie"), width: 130, render: (row) => <DirectoryFlag value={row.lifecycle} /> },
    { key: "onlineMenu", label: t("admin.features.organizations.organizationdirectorypage.onlayn_menyu"), width: 126, render: (row) => <DirectoryFlag value={row.onlineMenu} /> },
    { key: "warehouse", label: t("admin.features.organizations.organizationdirectorypage.sklad"), width: 112, render: (row) => <DirectoryFlag value={row.warehouse} /> },
    { key: "cashBalance", label: t("admin.features.organizations.organizationdirectorypage.balans"), width: 118, render: (row) => row.cashBalance },
    { key: "actions", label: "", width: 132, render: (row) => <div className="org-directory-row-actions">
      <button type="button" className="org-directory-edit" onClick={() => { setMutationError(""); setEditor({ mode: "edit", row }); }} aria-label={`Редактировать ${row.name}`}><Icon name="bi-pencil" size={15} /></button>
      <button type="button" className="org-directory-edit" onClick={() => { setMutationError(""); setConfirmation({ kind: "status", row, nextStatus: row.lifecycleValue === "blocked" ? "active" : "blocked" }); }} aria-label={`${row.lifecycleValue === "blocked" ? "Активировать" : "Заблокировать"} ${row.name}`}><Icon name={row.lifecycleValue === "blocked" ? "bi-unlock" : "bi-lock"} size={15} /></button>
      <button type="button" className="org-directory-edit is-danger" onClick={() => { setMutationError(""); setConfirmation({ kind: "archive", row }); }} aria-label={`Архивировать ${row.name}`}><Icon name="bi-archive" size={15} /></button>
    </div> },
  ], [startIndex]);

  const columns = allColumns.filter((column) => visibleColumns.includes(column.key));

  if (editor?.mode === "edit") {
    return <OrganizationEditScreen row={editor.row} statuses={statuses.filter((status) => status.active || status.id === editor.row.organizationStatusId)} directories={directories} busy={mutationBusy} error={mutationError || (directoriesLoadFailed ? "Справочники географии недоступны; текущие связи сохранятся, если их не изменять." : "")} onBack={() => { if (!mutationBusy) setEditor(null); }} onSubmit={saveOrganization} />;
  }

  if (editor?.mode === "message") {
    return <OrganizationMessageScreen row={editor.row} statuses={statuses.filter((status) => status.active || status.id === editor.row.organizationStatusId)} directories={directories} busy={mutationBusy} error={mutationError || (directoriesLoadFailed ? "Справочники географии недоступны; текущие связи сохранятся, если их не изменять." : "")} onBack={() => { if (!mutationBusy) setEditor(null); }} onSubmit={saveOrganization} />;
  }

  return (
    <section className="org-directory-page">
      <div className="org-directory-topbar">
        <div><h2>{t("admin.features.organizations.organizationdirectorypage.organizatsii")}</h2><p>{t("admin.features.organizations.organizationdirectorypage.kanonicheskiy_reestr_klientov_hq_s_servernoy")}</p></div>
        <button className="org-directory-add" type="button" onClick={() => { setMutationError(""); setEditor({ mode: "create", row: null }); }}>{t("admin.features.organizations.organizationdirectorypage.dobavit")} <Icon name="bi-plus-lg" size={16} /></button>
      </div>

      <div className="org-directory-metrics">
        <span><b>{pageMeta.total}</b> {t("admin.features.organizations.organizationdirectorypage.vsego")}</span>
        <span><b>{rows.length}</b> {t("admin.features.organizations.organizationdirectorypage.na_stranitse")}</span>
        <span><b>{activeOnPage}</b> {t("admin.features.organizations.organizationdirectorypage.aktivnyh_na_stranitse")}</span>
        <span><b>{onlineOnPage}</b> {t("admin.features.organizations.organizationdirectorypage.onlayn_menyu_na_stranitse")}</span>
      </div>

      <form className="org-directory-toolbar" onSubmit={applyFilters}>
        <label className="admin-data-search"><Icon name="bi-search" size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("admin.features.organizations.organizationdirectorypage.poisk_po_nazvaniyu_ili_inn")} /></label>
        <select value={lifecycleFilter} onChange={(event) => setLifecycleFilter(event.target.value)} aria-label={t("admin.features.organizations.organizationdirectorypage.sostoyanie_organizatsii")}>
          <option value="">{t("admin.features.organizations.organizationdirectorypage.vse_sostoyaniya")}</option><option value="active">{t("admin.features.organizations.organizationdirectorypage.aktivnye")}</option><option value="blocked">{t("admin.features.organizations.organizationdirectorypage.zablokirovannye")}</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={t("admin.features.organizations.organizationdirectorypage.status_organizatsii")} disabled={statusLoadFailed}>
          <option value="">{t("admin.features.organizations.organizationdirectorypage.vse_statusy")}</option>
          {statuses.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
        </select>
        <button type="submit" className="org-directory-soft">{t("admin.features.organizations.organizationdirectorypage.primenit")}</button>
        <button type="button" className="org-directory-soft" onClick={resetFilters}>{t("admin.features.organizations.organizationdirectorypage.sbrosit")}</button>
        <button type="button" className={`org-directory-settings ${settingsOpen ? "is-open" : ""}`} onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><Icon name="bi-sliders" size={15} /> {t("admin.features.organizations.organizationdirectorypage.stolbtsy")}</button>
      </form>

      {statusLoadFailed ? <div className="org-directory-notice" role="status">{t("admin.features.organizations.organizationdirectorypage.spravochnik_statusov_nedostupen_svyazannye")}</div> : null}
      {loadState === "loading" ? <div className="admin-data-state" role="status">{t("admin.features.organizations.organizationdirectorypage.zagruzka_organizatsiy")}</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">{loadError}</div> : null}

      {settingsOpen ? <div className="admin-data-column-panel">
        {allColumns.map((column) => <label key={column.key}><input type="checkbox" checked={visibleColumns.includes(column.key)} disabled={visibleColumns.includes(column.key) && visibleColumns.length === 1} onChange={() => setVisibleColumns((current) => current.includes(column.key) ? current.filter((key) => key !== column.key) : COLUMN_KEYS.filter((key) => [...current, column.key].includes(key)))} /> {column.label || "Действия"}</label>)}
        <button type="button" className="org-directory-soft" onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}>{t("admin.features.organizations.organizationdirectorypage.sbrosit_stolbtsy")}</button>
      </div> : null}

      {loadState !== "error" ? <div className="admin-data-table-shell" onWheelCapture={keepWheelInsideScroller}>
        <table className="admin-data-table admin-data-table--configurable is-actions-sticky">
          <colgroup>{columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
          <thead><tr>{columns.map((column) => <th className={`org-directory-cell org-directory-cell--${column.key}`} key={column.key}>{column.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, rowIndex) => <tr key={row.id}>{columns.map((column) => <td className={`org-directory-cell org-directory-cell--${column.key}`} key={column.key}>{column.render(row, rowIndex)}</td>)}</tr>)}</tbody>
        </table>
        {loadState === "empty" ? <div className="admin-data-state">{hasFilters ? "По заданным условиям организации не найдены." : "Организации не найдены."}</div> : null}
      </div> : null}

      <div className="admin-data-footer">
        <span className="admin-data-footer__summary">{pageMeta.total ? `${startIndex + 1}-${endIndex} из ${pageMeta.total}` : "0 из 0"}<small>{t("admin.features.organizations.organizationdirectorypage.stranitsa")} {pageMeta.page} {t("admin.features.organizations.organizationdirectorypage.iz")} {pageMeta.pages}</small></span>
        <div className="admin-data-pager">
          <AdminPageSizeDropdown value={pageSize} options={PAGE_SIZE_OPTIONS} onChange={(value) => { setPageSize(value); setPage(1); }} />
          <button type="button" disabled={pageMeta.page === 1 || loadState === "loading"} onClick={() => setPage(1)} aria-label={t("admin.features.organizations.organizationdirectorypage.pervaya_stranitsa")}><Icon name="bi-chevron-double-left" size={14} /></button>
          <button type="button" disabled={pageMeta.page === 1 || loadState === "loading"} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label={t("admin.features.organizations.organizationdirectorypage.predyduschaya_stranitsa")}><Icon name="bi-chevron-left" size={15} /></button>
          {pageList.map((item, index) => item === "…" ? <span className="admin-data-ellipsis" key={`gap-${index}`}>…</span> : <button type="button" className={`admin-data-page-btn ${item === pageMeta.page ? "is-active" : ""}`} key={item} onClick={() => setPage(item)} aria-current={item === pageMeta.page ? "page" : undefined}>{item}</button>)}
          <button type="button" disabled={pageMeta.page === pageMeta.pages || loadState === "loading"} onClick={() => setPage((value) => Math.min(pageMeta.pages, value + 1))} aria-label={t("admin.features.organizations.organizationdirectorypage.sleduyuschaya_stranitsa")}><Icon name="bi-chevron-right" size={15} /></button>
          <button type="button" disabled={pageMeta.page === pageMeta.pages || loadState === "loading"} onClick={() => setPage(pageMeta.pages)} aria-label={t("admin.features.organizations.organizationdirectorypage.poslednyaya_stranitsa")}><Icon name="bi-chevron-double-right" size={14} /></button>
        </div>
      </div>

      {editor?.mode === "create" ? <OrganizationFormModal mode={editor.mode} row={editor.row} statuses={statuses.filter((status) => status.active)} directories={directories} busy={mutationBusy} error={mutationError || (directoriesLoadFailed ? "Справочники географии сейчас недоступны." : "")} onClose={() => { if (!mutationBusy) setEditor(null); }} onSubmit={saveOrganization} /> : null}
      {confirmation ? <ModalShell
        title={confirmation.kind === "archive" ? "Архивировать организацию" : confirmation.nextStatus === "blocked" ? "Заблокировать организацию" : "Активировать организацию"}
        description={confirmation.kind === "archive" ? "Backend выполнит мягкое удаление: запись исчезнет из активного реестра, исторические данные сохранятся." : "Состояние будет изменено каноническим PATCH-запросом."}
        onClose={() => { if (!mutationBusy) setConfirmation(null); }} busy={mutationBusy} tone={confirmation.kind === "archive" ? "danger" : "default"}
        actions={<><button type="button" className="admin-modal__btn is-ghost" onClick={() => setConfirmation(null)} disabled={mutationBusy}>{t("admin.features.organizations.organizationdirectorypage.otmena")}</button><button type="button" className="admin-modal__btn is-primary" onClick={runConfirmedMutation} disabled={mutationBusy}>{mutationBusy ? "Выполнение..." : "Подтвердить"}</button></>}
      >
        <p className="org-directory-modal__confirmation">{confirmation.row.name}</p>
        {mutationError ? <div className="org-directory-modal__error" role="alert">{mutationError}</div> : null}
      </ModalShell> : null}
    </section>
  );
}
