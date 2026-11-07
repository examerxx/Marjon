import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { createPortal } from "react-dom";
import staffDefaultAvatar from "../../assets/staff/staff-default-avatar.png";
import DishSingleSelect from "../nomenclature/DishSingleSelect";
import {
  roleOptions,
  staffAccessModules,
  staffAccessActions,
  staffOrderTypeActions,
} from "./staffConstants";
import {
  caretForDigitCount,
  formatLocalUZ,
  formatPhone,
  getPhoneFlag,
  getPhoneLocal,
  normalizePhone,
  phoneCountries,
  phoneCountryMap,
} from "./staffPhone";

// Кастомный дропдаун (принтер/филиал). Заменяет нативный <select>, повторяя
// визуал полей формы и паттерн меню телефонного кода (клик-вне и Escape
// закрывают). options — [{ id, name }]; пустое значение "" = «по умолчанию».
function StaffSelect({ value, options = [], onChange, placeholder = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.id) === String(value));
  const label = selected ? selected.name : placeholder;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (nextId) => {
    onChange(nextId);
    setOpen(false);
  };

  return (
    <div className={`staff-select${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="staff-select__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={`staff-select__value${selected ? "" : " is-placeholder"}`}>
          {label}
        </span>
        <Icon name="bi-chevron-down" size={14} className="staff-select__caret" />
      </button>
      {open ? (
        <ul className="staff-select__menu" role="listbox">
          {options.map((option) => {
            const active = String(option.id) === String(value);
            return (
              <li key={option.id || "__none"}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`staff-select__option${active ? " is-active" : ""}`}
                  onClick={() => choose(option.id)}
                >
                  {option.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// BranchSelect удалён в прод-линии: селектор филиала больше не рендерится
// в модалке (филиал резолвится на странице). StaffSelect остаётся — на нём
// построен селектор принтера в карточке сотрудника.
// Модальное окно создания/редактирования сотрудника OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Разметка, классы, текст и мёртвый
// блок `{false && ...}` сохранены 1:1; форма и обработчики (включая блокировку
// повторной отправки и числовой парсинг) принадлежат оркестратору — приходят пропсами.
export default function StaffFormModal({
  editingId,
  saving,
  closeModal,
  saveStaff,
  form,
  updateForm,
  toggleForm,
  selectPhoneCountry,
  toggleAccess,
  handlePhotoChange,
  showPassword,
  setShowPassword,
  phoneCountryOpen,
  setPhoneCountryOpen,
  // CASHIER-FE-01: cashier route uses its own product form; other roles keep legacy UI.
  isCashier = false,
  // WAITER-01: waiter reuses exact cashier drawer shell/CSS (1:1 oracle).
  isWaiter = false,
  // MONOBLOCK-01: monoblock reuses the same product drawer shell.
  isMonoblock = false,
  // Сеть → филиал: селектор филиала убран из модалки (прод-линия) — филиал
  // резолвится на странице (form.branchId || единственный филиал компании).
  // Принтеры компании (GET /printers) для селектора привязки принтера к
  // сотруднику. Пустой список — селект покажет только «как у филиала».
  printers = [],
  // MANAGER-STOREKEEPER-01: manager/warehouse reuse the product drawer shell
  // (7-col roles, exact Cashier matrix per CASHIER-PARITY-01, no HR, no printer binding).
  isManager = false,
  isWarehouse = false,
  // KITCHEN-01: повар использует тот же боковой drawer, что и остальные роли
  // зала. Отличие только в наборе тумблеров (Статус + два кухонных права) и в
  // подписи PIN — повару код нужен для входа на кухонный экран, не на кассу.
  isKitchen = false,
  closing = false,
  // Cashier drawer inline submit error (no browser-native popups on this path).
  saveError = "",
  // WAITER-01 FIX-02: field key the save error belongs to ("phone" renders
  // the message directly under the phone input, near the fold).
  saveErrorField = "",
  // Closes the generic (non-field) error toast; field errors stay inline.
  onClearSaveError = null,
}) {
  const phoneInputRef = useRef(null);
  // WAITER-01: same drawer shell for cashier + waiter; only role strings + switch list differ.
  // MONOBLOCK-01: monoblock shares the shell with role-aware strings/switches.
  // MANAGER-STOREKEEPER-01: manager/warehouse share the shell; primary
  // switches collapse to Статус only, matrix mirrors Cashier 1:1 (FRONTEND ONLY).
  const isProductDrawer = isCashier || isWaiter || isMonoblock || isManager || isWarehouse || isKitchen;
  if (isProductDrawer) {
    const isWaiterView = isWaiter;
    const isMonoblockView = isMonoblock;
    const isManagerView = isManager;
    const isWarehouseView = isWarehouse;
    const isKitchenView = isKitchen;
    const isCuratedView = isManagerView || isWarehouseView;
    const addTitle = isWaiterView
      ? "Добавить официанта"
      : isMonoblockView
        ? "Добавить моноблок"
        : isManagerView
          ? "Добавить менеджера"
          : isWarehouseView
            ? "Добавить завсклада"
            : isKitchenView
              ? "Добавить повара"
              : "Добавить кассира";
    const editTitle = isWaiterView
      ? "Изменить официанта"
      : isMonoblockView
        ? "Изменить моноблок"
        : isManagerView
          ? "Изменить менеджера"
          : isWarehouseView
            ? "Изменить завсклада"
            : isKitchenView
              ? "Изменить повара"
              : "Изменить кассира";
    const namePlaceholder = isWaiterView
      ? "Имя официанта"
      : isMonoblockView
        ? "Имя моноблока"
        : isManagerView
          ? "Имя менеджера"
          : isWarehouseView
            ? "Имя завсклада"
            : isKitchenView
              ? "Имя повара"
              : "Имя кассира";
    const photoAlt = isWaiterView
      ? "Фото официанта"
      : isMonoblockView
        ? "Фото моноблока"
        : isManagerView
          ? "Фото менеджера"
          : isWarehouseView
            ? "Фото завсклада"
            : isKitchenView
              ? "Фото повара"
              : "Фото кассира";
    const formKeyPrefix = isWaiterView
      ? "waiter"
      : isMonoblockView
        ? "monoblock"
        : isManagerView
          ? "manager"
          : isWarehouseView
            ? "warehouse"
            : isKitchenView
              ? "kitchen"
              : "cashier";
    // CASHIER-PARITY-01 (Phase 1): every product drawer — cashier, waiter,
    // monoblock, manager, warehouse — renders the SAME staffAccessModules
    // matrix (same count/text/order). No HR key exists in config; nothing
    // added. Matrix switches stay FRONTEND PREPARED ONLY (BACKEND_HANDOFF).
    const matrixModules = staffAccessModules;
    const cashierCountry = phoneCountryMap[form.phoneCountry || "UZ"] || phoneCountryMap.UZ;
    // Display-only formatting: state keeps raw normalized digits, the input
    // shows (XX) XXX-XX-XX. Caret is remapped by digit count so Backspace and
    // mid-string edits feel native and the +998 pill is never retyped.
    const handleCashierPhoneChange = (event) => {
      const input = event.target;
      const rawValue = input.value;
      const caret = input.selectionStart ?? rawValue.length;
      const digitsBeforeCaret = rawValue.slice(0, caret).replace(/\D/g, "").length;
      // No slice here: normalizePhone strips a pasted country code first and
      // then enforces the per-country digit cap (9 for UZ).
      const digits = rawValue.replace(/\D/g, "");
      updateForm("phone", normalizePhone(digits, form.phoneCountry));
      if (typeof requestAnimationFrame !== "function") return;
      requestAnimationFrame(() => {
        if (!phoneInputRef.current) return;
        const position = caretForDigitCount(digitsBeforeCaret, digits);
        phoneInputRef.current.setSelectionRange(position, position);
      });
    };
    // CASHIER-FE-03: FE-01 drawer shell restored (FE-02 centered dialog undone).
    // Overlay mounts at document.body so the backdrop covers sidebar + topbar
    // like the reference (the page stacking contexts trap in-tree modals).
    return createPortal(
      <div className={`staff-modal staff-modal--cashier-full${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true">
        <div className="staff-modal__backdrop" onClick={saving ? undefined : closeModal} />
        <form
          key={editingId ? `${formKeyPrefix}-edit-${editingId}` : `${formKeyPrefix}-add-empty`}
          className="staff-form staff-form--cashier"
          onSubmit={saveStaff}
          autoComplete="off"
        >
          <div className="staff-form__header">
            <div>
              <p>{editingId ? "Редактирование" : "Новый сотрудник"}</p>
              <h2>{editingId ? editTitle : addTitle}</h2>
            </div>
            <button type="button" disabled={saving} onClick={closeModal} aria-label="Закрыть">
              <Icon name="bi-x-lg" size={20} />
            </button>
          </div>
          {/* Фото сотрудника: файл грузится в POST /auth/users/{id}/photo
              после сохранения карточки, в ответ приходит avatar_url — он же
              показывается в списке и в карточке (form.photo). */}
          <div className="cashier-photo">
            <div className="staff-avatar staff-avatar--large">
              {form.photo ? (
                <img src={form.photo} alt={photoAlt} />
              ) : (
                <img src={staffDefaultAvatar} alt={photoAlt} />
              )}
            </div>
            <div className="cashier-photo__body">
              <span>Фото</span>
              {/* Загрузка доступна всем ролям: бэкенд теперь принимает фото
                  сотрудника (POST /auth/users/{id}/photo), раньше кнопка была
                  скрыта у менеджера/завсклада как «не поддерживается». */}
              <label className="cashier-photo__upload">
                <Icon name="bi-camera" size={16} />
                Загрузить фото
                <input type="file" accept="image/*" onChange={handlePhotoChange} aria-label="Загрузить фото" />
              </label>
            </div>
          </div>

          <div className="staff-form__grid">
            <label>
              <span>Имя</span>
              {/* No native `required`: empty-field validation surfaces as the
                  drawer inline error (saveError), never a browser bubble. */}
              <input
                autoComplete="off"
                value={form.fullName}
                onChange={(event) => updateForm("fullName", event.target.value)}
                placeholder={namePlaceholder}
                aria-invalid={saveErrorField === "name" && saveError ? true : undefined}
                aria-describedby={saveErrorField === "name" && saveError ? "staff-name-error" : undefined}
              />
              {saveErrorField === "name" && saveError ? (
                <small className="staff-field-error" role="alert" id="staff-name-error">{saveError}</small>
              ) : null}
            </label>
            <label>
              <span>Логин</span>
              {/* Split prefix: the country code renders as a stable visual
                  prefix, the input holds subscriber digits only, so Backspace
                  never destroys/recreates the prefix and caret stays put. */}
              <div className="staff-phone-field staff-phone-field--split">
                <button
                  className="staff-phone-country staff-phone-country--pill"
                  type="button"
                  onClick={() => setPhoneCountryOpen((value) => !value)}
                  aria-label="Выбрать страну"
                  aria-expanded={phoneCountryOpen}
                >
                  <img
                    src={getPhoneFlag(form.phoneCountry || "UZ")}
                    alt={cashierCountry.label || ""}
                  />
                  <span>+{cashierCountry.dialCode}</span>
                  <Icon name="bi-chevron-down" size={12} />
                </button>
                {phoneCountryOpen && (
                  <div className="staff-phone-country-menu">
                    {phoneCountries.map((country) => (
                      <button
                        className={form.phoneCountry === country.key ? "is-active" : ""}
                        type="button"
                        key={country.key}
                        onClick={() => selectPhoneCountry(country.key)}
                      >
                        <img src={getPhoneFlag(country.key)} alt="" />
                        <span>{country.label}</span>
                        <b>+{country.dialCode}</b>
                      </button>
                    ))}
                  </div>
                )}
                <input
                  autoComplete="off"
                  inputMode="tel"
                  ref={phoneInputRef}
                  aria-label="Номер телефона без кода страны"
                  value={formatLocalUZ(getPhoneLocal(form.phone, form.phoneCountry))}
                  onChange={handleCashierPhoneChange}
                  placeholder="Введите номер"
                  aria-invalid={saveErrorField === "phone" && saveError ? true : undefined}
                  aria-describedby={saveErrorField === "phone" && saveError ? "staff-phone-error" : undefined}
                />
              </div>
              {saveErrorField === "phone" && saveError ? (
                <small className="staff-phone-error" role="alert" id="staff-phone-error">{saveError}</small>
              ) : null}
            </label>
            <label>
              <span>{editingId ? "Новый пароль" : "Пароль"}</span>
              <div className="staff-password-field">
                <input
                  autoComplete="new-password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => updateForm("password", event.target.value)}
                  placeholder="Пароль"
                  aria-invalid={saveErrorField === "password" && saveError ? true : undefined}
                  aria-describedby={saveErrorField === "password" && saveError ? "staff-password-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={showPassword}
                >
                  <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                </button>
              </div>
              {saveErrorField === "password" && saveError ? (
                <small className="staff-field-error" role="alert" id="staff-password-error">{saveError}</small>
              ) : null}
              {editingId ? (
                <small className="muted">Оставьте пустым, чтобы не менять пароль.</small>
              ) : null}
            </label>
            {/* PIN для терминала. Поле вернули: «PIN = пароль» работает только
                когда пароль целиком из 4–8 цифр, и только на бэкенде из
                репозитория — у сотрудников со старым паролем PIN оставался
                пустым, а задать его было негде (вход на кассе падал с
                «Неверный PIN» при любом коде). Моноблоку PIN не нужен: он
                входит по телефону и паролю. */}
            {isMonoblock ? null : (
            <label>
              <span>{isKitchenView ? "PIN для кухни" : "PIN для кассы"}</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                maxLength={4}
                value={form.pin}
                onChange={(event) => updateForm("pin", event.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4 цифры"
                aria-invalid={saveErrorField === "pin" && saveError ? true : undefined}
                aria-describedby={
                  editingId || !isKitchenView ? "staff-pin-hint" : undefined
                }
              />
              {/* Повару подсказку не показываем: PIN для кухни обязателен, и это
                  проверяется при сохранении, а не мелким текстом под полем. */}
              {editingId ? (
                <small className="muted" id="staff-pin-hint">
                  Пусто — оставить прежний PIN. Забыли код — введите новый.
                </small>
              ) : isKitchenView ? null : (
                <small className="muted" id="staff-pin-hint">
                  Код для входа на кассе. Можно оставить пустым.
                </small>
              )}
              {saveErrorField === "pin" && saveError ? (
                <small className="staff-field-error" role="alert">{saveError}</small>
              ) : null}
            </label>
            )}            {/* Поле «Филиал» убрано: единственный филиал сети подставляется
                автоматически, у существующих сотрудников значение сохраняется. */}
            {isCuratedView ? null : (
            <label>
              <span>Принтер</span>
              {/* 1:1 с полем «Принтер» в форме блюда (Номенклатура → Блюда):
                  тот же контрол DishSingleSelect, без пункта «Как у филиала» —
                  в списке только реально добавленные принтеры. Повторный клик
                  по выбранному пункту снимает выбор (как в форме блюда). */}
              <DishSingleSelect
                label="Принтер"
                placeholder="Принтер"
                value={form.printerId || ""}
                onChange={(next) => updateForm("printerId", next)}
                options={printers.map((printer) => ({
                  value: printer.id,
                  label: printer.is_active === false ? `${printer.name} (не активен)` : printer.name,
                }))}
                disabled={!printers.length}
                disabledLabel="Принтеры недоступны"
              />
            </label>
            )}
          </div>

          <div className="cashier-permissions">
            <h3>Права доступа</h3>
            <div className="cashier-permission-switches">
            <button
              className={`staff-permission-switch ${form.status === "active" ? "is-on" : ""}`}
              type="button"
              onClick={() =>
                updateForm("status", form.status === "active" ? "archived" : "active")
              }
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Статус</span>
              <i>{form.status === "active" ? "Активный" : "Архив"}</i>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            {isMonoblockView || isCuratedView || isKitchenView ? null : (
            <button
              className={`staff-permission-switch ${form.canDeleteDishes ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canDeleteDishes")}
              aria-pressed={Boolean(form.canDeleteDishes)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Удаление блюд</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            )}
            {isWaiterView ? (
            <button
              className={`staff-permission-switch ${form.canChangeMarkingCode ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canChangeMarkingCode")}
              aria-pressed={Boolean(form.canChangeMarkingCode)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Изменить код маркировки</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            ) : null}
            {isMonoblockView || isCuratedView || isKitchenView ? null : (
            <button
              className={`staff-permission-switch ${form.canTakeawayAtTable ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canTakeawayAtTable")}
              aria-pressed={Boolean(form.canTakeawayAtTable)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Заказ на вынос за столом</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            )}
            {isMonoblockView || isCuratedView || isKitchenView ? null : (
            <button
              className={`staff-permission-switch ${form.canChangeOrderType ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canChangeOrderType")}
              aria-pressed={Boolean(form.canChangeOrderType)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Изменить тип заказа</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            )}
            {isWaiterView ? (
            <button
              className={`staff-permission-switch ${form.canManageOrders ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canManageOrders")}
              aria-pressed={Boolean(form.canManageOrders)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Управление заказами</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            ) : null}
            {isMonoblockView ? (
            <>
            <button
              className={`staff-permission-switch ${form.canMainMonoblock ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canMainMonoblock")}
              aria-pressed={Boolean(form.canMainMonoblock)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Главный моноблок</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canSeeCashiers ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canSeeCashiers")}
              aria-pressed={Boolean(form.canSeeCashiers)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Список кассиров</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canCookPrinter ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canCookPrinter")}
              aria-pressed={Boolean(form.canCookPrinter)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Принтер повара</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canPrintCancel ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canPrintCancel")}
              aria-pressed={Boolean(form.canPrintCancel)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Печать отмены заказа</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            {/* DESK-PERM-01: без этих двух тумблеров панели «Финансы» и
                «Посещаемость» на десктопе было невозможно включить — их гейты
                must(user, 'can_view_finance' / 'can_approve_attendance') не
                находились ни в одном списке прав, и кнопки не показывались. */}
            <button
              className={`staff-permission-switch ${form.canViewFinance ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canViewFinance")}
              aria-pressed={Boolean(form.canViewFinance)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Просмотр финансов</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canApproveAttendance ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canApproveAttendance")}
              aria-pressed={Boolean(form.canApproveAttendance)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Посещаемость (приход/уход)</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            </>
            ) : null}
            {/* KITCHEN-01: тумблеры повара. Оба права реально читаются:
                can_cook_printer — печать заказа на кухонный принтер,
                can_print_cancel — печать отмены. Остальные тумблеры кассира
                повару не показываем: он не закрывает счёт и не открывает
                денежный ящик. */}
            {isKitchenView ? (
            <>
            <button
              className={`staff-permission-switch ${form.canCookPrinter ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canCookPrinter")}
              aria-pressed={Boolean(form.canCookPrinter)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Печать на принтер повара</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canPrintCancel ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canPrintCancel")}
              aria-pressed={Boolean(form.canPrintCancel)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Печать отмены заказа</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            </>
            ) : null}
            {isWaiterView || isMonoblockView || isCuratedView || isKitchenView ? null : (
            <>
            <button
              className={`staff-permission-switch ${form.canCloseBill ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canCloseBill")}
              aria-pressed={Boolean(form.canCloseBill)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Может закрыть счёт</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canOpenCashDrawerAfterPayment ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canOpenCashDrawerAfterPayment")}
              aria-pressed={Boolean(form.canOpenCashDrawerAfterPayment)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Открыть денежный ящик после оплаты</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canViewClosedOrders ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canViewClosedOrders")}
              aria-pressed={Boolean(form.canViewClosedOrders)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Просмотр закрытых заказов</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            {/* DESK-PERM-01: панели десктопа «Финансы» и «Посещаемость». */}
            <button
              className={`staff-permission-switch ${form.canViewFinance ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canViewFinance")}
              aria-pressed={Boolean(form.canViewFinance)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Просмотр финансов</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canApproveAttendance ? "is-on" : ""}`}
              type="button"
              onClick={() => toggleForm("canApproveAttendance")}
              aria-pressed={Boolean(form.canApproveAttendance)}
            >
              <span className="staff-permission-state-dot" aria-hidden="true" />
              <span>Посещаемость (приход/уход)</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            </>
            )}
            </div>
            {/* Secondary rows use the shared Cashier collapse mechanism:
                OFF = collapsed/hidden (zero height), ON = revealed. Same for
                every product role; no role-specific visibility system. */}
            <div className="staff-permission-matrix">
              {matrixModules.map((module) => {
                const moduleAccess = form.access?.[module.key] || {};
                const actions =
                  module.key === "order_types" ? staffOrderTypeActions : staffAccessActions;

                return (
                  <div
                    className={`staff-access-row ${moduleAccess.enabled ? "is-open" : ""}`}
                    key={module.key}
                  >
                    <div className="staff-access-toggle">
                      <button
                        className={`staff-switch-button ${moduleAccess.enabled ? "is-on" : ""}`}
                        type="button"
                        onClick={() => toggleAccess(module.key)}
                        aria-pressed={Boolean(moduleAccess.enabled)}
                        aria-label={module.label}
                      >
                        <b className="staff-mini-switch" aria-hidden="true" />
                      </button>
                      <span>{module.label}</span>
                    </div>
                    <div
                      className="staff-access-actions"
                      aria-hidden={!moduleAccess.enabled}
                    >
                      {actions.map((action) => (
                        <button
                          className={`staff-access-action ${
                            moduleAccess[action.key] ? "is-on" : ""
                          }`}
                          type="button"
                          key={action.key}
                          onClick={() => toggleAccess(module.key, action.key)}
                          disabled={!moduleAccess.enabled}
                          aria-pressed={Boolean(moduleAccess[action.key])}
                        >
                          <b className="staff-mini-switch" aria-hidden="true" />
                          <span>{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {saveError ? (
            <Toast kind="error" message={saveError} onClose={onClearSaveError || undefined} />
          ) : null}

          <div className="staff-form__footer">
            <button type="button" disabled={saving} onClick={closeModal}>
              Отменить
            </button>
            <button type="submit" disabled={saving}>{saving ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}</button>
          </div>
        </form>
      </div>,
      document.body,
    );
  }
  return (
    <div className="staff-modal" role="dialog" aria-modal="true">
      <div className="staff-modal__backdrop" onClick={saving ? undefined : closeModal} />
      <form
        key={editingId ? `staff-edit-${editingId}` : "staff-add-empty"}
        className="staff-form"
        onSubmit={saveStaff}
        autoComplete="off"
      >
        <div className="staff-autofill-trap" aria-hidden="true">
          <input type="text" name="username" tabIndex={-1} autoComplete="username" />
          <input type="password" name="password" tabIndex={-1} autoComplete="new-password" />
        </div>
        <div className="staff-form__header">
          <div>
            <p>{editingId ? "Редактирование" : "Новый сотрудник"}</p>
            <h2>{editingId ? "Изменить сотрудника" : "Добавить сотрудника"}</h2>
          </div>
          <button type="button" disabled={saving} onClick={closeModal} aria-label="Закрыть">
            <Icon name="bi-x-lg" size={20} />
          </button>
        </div>

        <div className="staff-form__grid staff-form__grid--edit">
          <label>
            <span>Email *</span>
            <input
              required
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(event) => updateForm("email", event.target.value)}
              placeholder="employee@example.com"
            />
          </label>
          <label>
            <span>Имя *</span>
            <input
              required
              autoComplete="off"
              value={form.fullName}
              onChange={(event) => updateForm("fullName", event.target.value)}
              placeholder="Имя сотрудника"
            />
          </label>
          <label>
            <span>Логин</span>
            <div className="staff-phone-field">
              <button
                className="staff-phone-country"
                type="button"
                onClick={() => setPhoneCountryOpen((value) => !value)}
                aria-label="Выбрать страну"
                aria-expanded={phoneCountryOpen}
              >
                <img
                  src={getPhoneFlag(form.phoneCountry || "UZ")}
                  alt={phoneCountryMap[form.phoneCountry || "UZ"]?.label || ""}
                />
                <Icon name="bi-chevron-down" size={12} />
              </button>
              {phoneCountryOpen && (
                <div className="staff-phone-country-menu">
                  {phoneCountries.map((country) => (
                    <button
                      className={form.phoneCountry === country.key ? "is-active" : ""}
                      type="button"
                      key={country.key}
                      onClick={() => selectPhoneCountry(country.key)}
                    >
                      <img src={getPhoneFlag(country.key)} alt="" />
                      <span>{country.label}</span>
                      <b>+{country.dialCode}</b>
                    </button>
                  ))}
                </div>
              )}
              <input
                required
                autoComplete="off"
                inputMode="tel"
                value={
                  form.phone
                    ? formatPhone(form.phone, form.phoneCountry)
                    : `+${phoneCountryMap[form.phoneCountry || "UZ"]?.dialCode || "998"}`
                }
                onChange={(event) =>
                  updateForm("phone", normalizePhone(event.target.value, form.phoneCountry))
                }
                placeholder=""
              />
            </div>
          </label>
          <label>
            <span>{editingId ? "Новый пароль" : "Пароль *"}</span>
            <div className="staff-password-field">
              <input
                required={!editingId}
                autoComplete="new-password"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) => updateForm("password", event.target.value)}
                placeholder="Пароль"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={showPassword}
              >
                <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
              </button>
            </div>
          </label>
          <div className="staff-permission-switches">
            <button
              className={`staff-permission-switch ${form.status === "active" ? "is-on" : ""}`}
              type="button"
              onClick={() =>
                updateForm("status", form.status === "active" ? "archived" : "active")
              }
            >
              <span>Статус</span>
              <i>{form.status === "active" ? "Активный" : "Архив"}</i>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canDeleteDishes ? "is-on" : ""}`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canDeleteDishes")}
            >
              <span>Удаление блюд</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canTakeawayAtTable ? "is-on" : ""}`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canTakeawayAtTable")}
            >
              <span>Заказ на вынос за столом</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canChangeOrderType ? "is-on" : ""}`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canChangeOrderType")}
            >
              <span>Изменить тип заказа</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canCloseBill ? "is-on" : ""}`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canCloseBill")}
            >
              <span>Может закрыть счет</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${
                form.canOpenCashDrawerAfterPayment ? "is-on" : ""
              }`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canOpenCashDrawerAfterPayment")}
            >
              <span>Открыть денежный ящик после оплаты</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
            <button
              className={`staff-permission-switch ${form.canViewClosedOrders ? "is-on" : ""}`}
              type="button"
              disabled
              title="Недоступно до BI-06"
              onClick={() => toggleForm("canViewClosedOrders")}
            >
              <span>Просмотр закрытых заказов</span>
              <b className="staff-switch" aria-hidden="true" />
            </button>
          </div>
          <p id="staff-rbac-unavailable" className="muted" role="status">
            Детальные права доступа недоступны до BI-06. Изменения здесь не сохраняются.
          </p>
          <div className="staff-permission-matrix">
            {staffAccessModules.map((module) => {
              const moduleAccess = form.access?.[module.key] || {};
              const actions =
                module.key === "order_types" ? staffOrderTypeActions : staffAccessActions;

              return (
                <div
                  className={`staff-access-row ${moduleAccess.enabled ? "is-open" : ""}`}
                  key={module.key}
                >
                  <div className="staff-access-toggle">
                    <button
                      className={`staff-switch-button ${moduleAccess.enabled ? "is-on" : ""}`}
                      type="button"
                      disabled
                      title="Недоступно до BI-06"
                      onClick={() => toggleAccess(module.key)}
                      aria-pressed={Boolean(moduleAccess.enabled)}
                      aria-label={`${module.label}: ${moduleAccess.enabled ? "выключить" : "включить"}`}
                    >
                      <b className="staff-mini-switch" aria-hidden="true" />
                    </button>
                    <span>{module.label}</span>
                  </div>
                  <div
                    className="staff-access-actions"
                    aria-hidden={!moduleAccess.enabled}
                  >
                    {actions.map((action) => (
                      <button
                        className={`staff-access-action ${
                          moduleAccess[action.key] ? "is-on" : ""
                        }`}
                        type="button"
                        key={action.key}
                        onClick={() => toggleAccess(module.key, action.key)}
                        disabled={!moduleAccess.enabled}
                        aria-pressed={Boolean(moduleAccess[action.key])}
                      >
                        <b className="staff-mini-switch" aria-hidden="true" />
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <label className="staff-form__comment">
            <span>Комментарий (недоступно)</span>
            <textarea
              value=""
              disabled
              title="Backend contract отсутствует"
              placeholder="Заметка по сотруднику"
            />
          </label>
        </div>

        {false && (
          <>
        <label className="staff-photo-upload">
          <span>Фото / avatar upload</span>
          <div>
            <div className="staff-avatar staff-avatar--large">
              {form.photo ? (
                <img src={form.photo} alt="Avatar preview" />
              ) : (
                <Icon name="bi-person" size={24} />
              )}
            </div>
            <input type="file" accept="image/*" onChange={handlePhotoChange} />
          </div>
        </label>

        <div className="staff-form__grid">
          <label>
            <span>ФИО</span>
            <input
              required
              value={form.fullName}
              onChange={(event) => updateForm("fullName", event.target.value)}
              placeholder="Имя сотрудника"
            />
          </label>
          <label>
            <span>Логин</span>
            <input
              required
              value={form.phone}
              onChange={(event) => updateForm("phone", event.target.value)}
              placeholder="998..."
            />
          </label>
          <label>
            <span>Роль</span>
            <select
              value={form.roleKey}
              onChange={(event) => updateForm("roleKey", event.target.value)}
            >
              {/* Моноблок исключён: он заводится только на своей странице
                  (вход в десктоп по телефону+паролю, без PIN). Общая форма
                  работает по email и обязательному PIN — для моноблока это
                  неверный контракт. */}
              {roleOptions.filter((item) => item.key !== "monoblock").map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Пароль</span>
            <div className="staff-password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) => updateForm("password", event.target.value)}
                placeholder="Пароль"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={showPassword}
              >
                <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
              </button>
            </div>
          </label>
          <label>
            <span>Доступы / permissions</span>
            <input
              value={form.permission}
              onChange={(event) => updateForm("permission", event.target.value)}
              placeholder="Например: Удаления блюд"
            />
          </label>
          <label className="staff-form__status">
            <span>Статус active</span>
            <select
              value={form.status}
              onChange={(event) => updateForm("status", event.target.value)}
            >
              <option value="active">Активный</option>
              <option value="archived">Архив</option>
            </select>
          </label>
          <label className="staff-form__comment">
            <span>Комментарий</span>
            <textarea
              value={form.comment}
              onChange={(event) => updateForm("comment", event.target.value)}
              placeholder="Заметка по сотруднику"
            />
          </label>
        </div>

          </>
        )}

        <div className="staff-form__footer">
          <button type="button" disabled={saving} onClick={closeModal}>
            Отмена
          </button>
          <button type="submit" disabled={saving}>{saving ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}</button>
        </div>
      </form>
    </div>
  );
}






