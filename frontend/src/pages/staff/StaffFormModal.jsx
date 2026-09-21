import { useRef } from "react";
import Icon from "../../components/Icon";
import { createPortal } from "react-dom";
import staffDefaultAvatar from "../../assets/staff/staff-default-avatar.png";
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
  closing = false,
  // Cashier drawer inline submit error (no browser-native popups on this path).
  saveError = "",
}) {
  const phoneInputRef = useRef(null);
  if (isCashier) {
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
          key={editingId ? `cashier-edit-${editingId}` : "cashier-add-empty"}
          className="staff-form staff-form--cashier"
          onSubmit={saveStaff}
          autoComplete="off"
        >
          <div className="staff-form__header">
            <div>
              <p>{editingId ? "Редактирование" : "Новый сотрудник"}</p>
              <h2>{editingId ? "Изменить кассира" : "Добавить кассира"}</h2>
            </div>
            <button type="button" disabled={saving} onClick={closeModal} aria-label="Закрыть">
              <Icon name="bi-x-lg" size={20} />
            </button>
          </div>
          <div className="cashier-photo">
            <div className="staff-avatar staff-avatar--large">
              {form.photo ? (
                <img src={form.photo} alt="Фото кассира" />
              ) : (
                <img src={staffDefaultAvatar} alt="Фото кассира" />
              )}
            </div>
            <div className="cashier-photo__body">
              <span>Фото</span>
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
                placeholder="Имя кассира"
              />
            </label>
            <label>
              <span>Номер телефона</span>
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
                />
              </div>
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
              {editingId ? (
                <small className="muted">Оставьте пустым, чтобы не менять пароль.</small>
              ) : null}
            </label>
            <label>
              <span>IP адрес принтера</span>
              <input
                autoComplete="off"
                inputMode="decimal"
                value={form.printerIp || ""}
                onChange={(event) => updateForm("printerIp", event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="192.168.1.10"
              />
            </label>
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
            </div>
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
            <div className="login-error" role="alert">{saveError}</div>
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
            <span>Номер телефона</span>
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
          <label>
            <span>PIN-код 4 цифры</span>
            <input
              value={form.pin}
              maxLength={4}
              inputMode="numeric"
              pattern="[0-9]{4}"
              onChange={(event) => updateForm("pin", event.target.value.replace(/\D/g, ""))}
              placeholder="0000"
            />
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
            <span>Номер телефона</span>
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
              {roleOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>PIN-код 4 цифры</span>
            <input
              value={form.pin}
              maxLength={4}
              inputMode="numeric"
              pattern="[0-9]{4}"
              onChange={(event) => updateForm("pin", event.target.value.replace(/\D/g, ""))}
              placeholder="0000"
            />
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






