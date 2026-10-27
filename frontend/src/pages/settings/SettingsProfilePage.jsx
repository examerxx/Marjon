// Страница «Настройка профиля» (V1: ровно 4 внутренние секции).
// Каждая секция рендерит собственный контент; общего плейсхолдера нет.
// Поля без backend-поддержки рисуются, но никогда не отправляются
// и не показывают ложный успех (см. useCompanyProfileForm).
// Тип заказа сохраняется через PATCH /companies/me (Company.order_types).
import { useState } from "react";
import { createPortal } from "react-dom";
import logo from "../../assets/marjon-logo.svg";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { useAuth } from "../../context/AuthContext";
import { ordersService } from "../../api/orders";
import { warehouseService } from "../../api/warehouse";
import { profileSections } from "./profile/profileSections";
import { useCompanyProfileForm } from "./profile/useCompanyProfileForm";
import { t } from "../../i18n/t";
import "./settingsProfileViewport.css";

const ORDER_TYPE_ROWS = [
  { key: "dineIn", label: "На стол" },
  { key: "takeaway", label: "На вынос" },
  { key: "delivery", label: "Доставка" },
];

export default function SettingsProfilePage() {
  const { user, applyProfile } = useAuth();
  const {
    form,
    activeSection,
    setActiveSection,
    loading,
    saving,
    error,
    clearError: clearProfileError,
    success,
    successClosing,
    clearSuccess,
    handleImageChange,
    resetForm,
    handleSave,
    profileName,
    setProfileName,
    dayStartHour,
    setDayStartHour,
    showSupportButton,
    supportSaving,
    saveSupportVisibility,
    mainSaving,
    saveMain,
    resetMain,
    dishDeletePassword,
    setDishDeletePassword,
    orderTypes,
    toggleOrderType,
    resetOrderTypes,
    orderTypesSaving,
    saveOrderTypes,
    currentPassword,
    setCurrentPassword,
    showCurrentPassword,
    setShowCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showNewPassword,
    setShowNewPassword,
    showConfirmPassword,
    setShowConfirmPassword,
    passSaving,
    savePassword,
  } = useCompanyProfileForm(user, applyProfile);

  const activeMeta = profileSections.find((section) => section.key === activeSection) || profileSections[0];
  const profilePreview = form.profileLogo || form.companyLogo || logo;
  const showHeaderActions = activeSection !== "profile";
  // Массовая очистка данных: confirmTarget — какое уточняющее окно открыто
  // (null | "reports" | "purchases"), clearing — идёт ли удаление.
  // Результат показываем честно (без ложного успеха).
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [clearing, setClearing] = useState(null);
  const [clearResult, setClearResult] = useState("");
  const [clearError, setClearError] = useState("");

  const openClearConfirm = (target) => {
    if (clearing) return;
    setClearError("");
    setConfirmTarget(target);
  };

  const closeClearConfirm = () => {
    if (clearing) return;
    setConfirmTarget(null);
    setClearError("");
  };

  const runClearReports = async () => {
    setClearing("reports");
    setClearError("");
    try {
      const { data } = await ordersService.purge();
      const orders = Number(data?.orders) || 0;
      const payments = Number(data?.payments) || 0;
      setConfirmTarget(null);
      setClearResult(`Отчёты очищены: удалено заказов: ${orders}, платежей: ${payments}.`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setClearError(typeof detail === "string" ? `Не удалось очистить отчёты: ${detail}` : "Не удалось очистить отчёты.");
    } finally {
      setClearing(null);
    }
  };

  const runClearPurchases = async () => {
    setClearing("purchases");
    setClearError("");
    try {
      const { data } = await warehouseService.list("incoming");
      const docs = Array.isArray(data) ? data : data?.items || [];
      let removed = 0;
      let failed = 0;
      for (const doc of docs) {
        if (!doc?.id) continue;
        try {
          await warehouseService.deletePurchase(doc.id);
          removed += 1;
        } catch {
          failed += 1;
        }
      }
      try {
        localStorage.removeItem("marjon:purchase-last-values:v1");
      } catch {
        // хранилище недоступно — молча, на очистку не влияет
      }
      setConfirmTarget(null);
      setClearResult(failed > 0
        ? `История продуктов: удалено ${removed} из ${docs.length} (ошибок: ${failed}). Остатки не изменились.`
        : `История продуктов очищена: удалено документов: ${removed}. Остатки не изменились.`);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setClearError(typeof detail === "string" ? `Не удалось очистить историю продуктов: ${detail}` : "Не удалось очистить историю продуктов.");
    } finally {
      setClearing(null);
    }
  };

  const confirmClearContent = confirmTarget === "purchases"
    ? {
        title: t("pages.settings.settingsprofilepage.ochistit_istoriyu_produktov"),
        body: t("pages.settings.settingsprofilepage.budet_udalena_vsya_istoriya_dobavleniya_produktov"),
        run: runClearPurchases,
      }
    : {
        title: t("pages.settings.settingsprofilepage.ochistit_vse_otchety"),
        body: t("pages.settings.settingsprofilepage.budut_udaleny_vse_zakazy_platezhi_cheki_i_dostavki"),
        run: runClearReports,
      };

  if (loading) {
    return (
      <section className="company-profile-page">
        <div className="company-profile-shell">
          <p className="company-profile-loading">{t("pages.settings.settingsprofilepage.zagruzka")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="company-profile-page">
      <div className="company-profile-shell">
        <aside className="company-profile-nav" aria-label={t("pages.settings.settingsprofilepage.razdely_nastroek")}>
          {profileSections.map((section) => (
            <button
              key={section.key}
              type="button"
              className={activeSection === section.key ? "is-active" : ""}
              onClick={() => setActiveSection(section.key)}
            >
              <Icon name={section.icon} size={18} />
              <span>{t(section.label)}</span>
            </button>
          ))}
        </aside>

        <div className="company-profile-content">
          <header className="company-profile-header">
            <div className="settings-title-group">
              <span className="settings-accent-bar" />
              <div>
                <p>{t("pages.settings.settingsprofilepage.nastroyki")}</p>
                <h1>{t(activeMeta.label)}</h1>
              </div>
            </div>
            {showHeaderActions ? (
              <div className="company-profile-actions">
                <button
                  type="button"
                  className="company-profile-cancel"
                  onClick={activeSection === "main" ? resetMain : activeSection === "other" ? resetOrderTypes : resetForm}
                >
                 {t("pages.settings.settingsprofilepage.otmenit")}
                </button>
                {activeSection === "other" ? (
                  <button
                    type="button"
                    className="company-profile-save"
                    disabled={orderTypesSaving}
                    onClick={saveOrderTypes}
                  >
                    {orderTypesSaving ? t("staff.saving") : t("common.save")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="company-profile-save"
                    disabled={activeSection === "main" ? mainSaving : saving}
                    onClick={activeSection === "main" ? saveMain : handleSave}
                  >
                    {activeSection === "main" && mainSaving ? t("staff.saving") : activeSection === "basic" && saving ? t("staff.saving") : t("common.save")}
                  </button>
                )}
              </div>
            ) : null}
          </header>

          {error ? <Toast kind="error" message={error} onClose={clearProfileError} /> : null}
          {success ? <Toast kind="success" message={success} leaving={successClosing} onClose={clearSuccess} /> : null}

          {activeSection === "basic" ? (
            <div className="company-profile-main">
              <section className="company-profile-logo-panel company-profile-identity">
                <div className="company-profile-identity-main">
                  <strong className="company-profile-identity-title">{t("pages.settings.settingsprofilepage.logo_profilya")}</strong>
                  <div className="company-profile-identity-row">
                    <div className="company-profile-logo-actions">
                      <label className="company-profile-upload">
                        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => handleImageChange("profileLogo", event)} />
                        <span>
                          <img src={profilePreview} alt={t("pages.settings.settingsprofilepage.logo_profilya")} />
                        </span>
                        <b>{t("pages.settings.settingsprofilepage.zamenit")}</b>
                      </label>
                    </div>
                    <label className="company-profile-identity-name">
                      <b>{t("pages.settings.settingsprofilepage.imya_profilya")}</b>
                      <input
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                        placeholder={t("pages.settings.settingsprofilepage.vvedite_imya_profilya")}
                      />
                    </label>
                  </div>
                </div>
              </section>

              <div className="company-profile-danger-row">
                <button
                  type="button"
                  className="company-profile-danger"
                  disabled={clearing !== null}
                  onClick={() => openClearConfirm("reports")}
                >
                  <Icon name="bi-exclamation-octagon" size={18} />
                  {clearing === "reports" ? t("common.deleting") : t("pages.settings.profile.clear_all_reports")}
                </button>
                <button
                  type="button"
                  className="company-profile-danger"
                  disabled={clearing !== null}
                  onClick={() => openClearConfirm("purchases")}
                >
                  <Icon name="bi-exclamation-octagon" size={18} />
                  {clearing === "purchases" ? t("common.deleting") : t("pages.settings.profile.clear_product_history")}
                </button>
              </div>
              {confirmTarget ? createPortal((
                <div className="settings-owner-view company-clear-layer">
                  <div className="settings-drawer settings-modal-overlay" role="presentation">
                    <div className="settings-drawer__backdrop" onClick={clearing ? undefined : closeClearConfirm} />
                    <div
                      className="settings-form settings-modal settings-confirm company-clear-confirm"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="company-clear-title"
                      aria-describedby="company-clear-body"
                    >
                      <header className="settings-form__header">
                        <span className="settings-accent-bar" />
                        <div>
                          <p>{t("pages.settings.settingsprofilepage.udalenie")}</p>
                          <h2 id="company-clear-title">{confirmClearContent.title}</h2>
                        </div>
                        <button type="button" aria-label={t("pages.settings.settingsprofilepage.zakryt")} disabled={clearing !== null} onClick={closeClearConfirm}>
                          <Icon name="bi-x-lg" size={18} />
                        </button>
                      </header>
                      <div className="settings-form__body">
                        <p id="company-clear-body" className="settings-confirm__text">
                          {confirmClearContent.body}
                        </p>
                        {clearError ? <p className="settings-form__error" role="alert">{clearError}</p> : null}
                      </div>
                      <footer className="settings-form__footer">
                        <button type="button" autoFocus disabled={clearing !== null} onClick={closeClearConfirm}>{t("pages.settings.settingsprofilepage.otmena")}</button>
                        <button
                          type="button"
                          className="settings-confirm__delete"
                          disabled={clearing !== null}
                          onClick={confirmClearContent.run}
                        >
                          {clearing !== null ? "Очистка…" : "Очистить"}
                        </button>
                      </footer>
                    </div>
                  </div>
                </div>
              ), document.body) : null}
              {clearResult ? <p className="company-profile-field-hint" role="status">{clearResult}</p> : null}
            </div>
          ) : null}

          {activeSection === "main" ? (
            <div className="company-profile-main company-profile-main-settings">
              <div className="company-profile-field-list">
                <label>
                  <span>
                    <b>{t("pages.settings.settingsprofilepage.nachalo_dnya")}</b>
                  </span>
                  <select value={dayStartHour} onChange={(event) => setDayStartHour(event.target.value)}>
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={String(hour)}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>
                    <b>{t("pages.settings.settingsprofilepage.parol_dlya_udaleniya_blyud")}</b>
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={dishDeletePassword}
                    onChange={(event) => setDishDeletePassword(event.target.value)}
                    placeholder={t("pages.settings.settingsprofilepage.vvedite_parol")}
                  />
                </label>

                <div className="company-profile-order-row">
                  <span>
                    <b>{t("pages.settings.settingsprofilepage.pokazyvat_knopku_podderzhki")}</b>
                  </span>
                  <label className="company-profile-toggle company-profile-toggle--support" aria-label={t("pages.settings.settingsprofilepage.pokazyvat_knopku_podderzhki")}>
                    <input
                      type="checkbox"
                      checked={showSupportButton}
                      disabled={supportSaving}
                      onChange={(event) => saveSupportVisibility(event.target.checked)}
                    />
                    <span className="company-profile-toggle__track" aria-hidden="true">
                      <span className="company-profile-toggle__thumb" />
                    </span>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {activeSection === "other" ? (
            <div className="company-profile-main">
              <div className="company-profile-field-list">
                {ORDER_TYPE_ROWS.map((row) => (
                  <div className="company-profile-order-row" key={row.key}>
                    <span>
                      <b>{t("pages.settings.settingsprofilepage.tip_zakaza")}</b>
                      <em>{row.label}</em>
                    </span>
                    <label className="company-profile-toggle" aria-label={row.label}>
                      <input
                        type="checkbox"
                        checked={Boolean(orderTypes[row.key])}
                        onChange={() => toggleOrderType(row.key)}
                      />
                      <span className="company-profile-toggle__track" aria-hidden="true">
                        <span className="company-profile-toggle__thumb" />
                      </span>
                    </label>
                  </div>
                ))}
              </div>
              <p className="company-profile-field-hint">{t("pages.settings.settingsprofilepage.vyklyuchennye_tipy_propadayut_iz_kassy_prilozheniya")}</p>
            </div>
          ) : null}

          {activeSection === "profile" ? (
            <form className="company-profile-main company-profile-password-form" onSubmit={savePassword}>
              <input type="text" name="username" autoComplete="username" hidden readOnly
                value={user?.email || user?.phone || ""} />
              <div className="company-profile-field-list">
                <label>
                  <span><b>{t("pages.settings.settingsprofilepage.tekuschiy_parol")}</b></span>
                  <span className="company-profile-password-wrap">
                    <input name="current_password" type={showCurrentPassword ? "text" : "password"} autoComplete="current-password"
                      value={currentPassword} disabled={passSaving}
                      onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t("pages.settings.settingsprofilepage.vvedite_tekuschiy_parol")} />
                    <button type="button" disabled={passSaving} className="company-profile-eye"
                      onClick={() => setShowCurrentPassword((value) => !value)}
                      aria-label={showCurrentPassword ? "Скрыть текущий пароль" : "Показать текущий пароль"} aria-pressed={showCurrentPassword}>
                      <Icon name={showCurrentPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                    </button>
                  </span>
                </label>
                <label>
                  <span>
                    <b>{t("pages.settings.settingsprofilepage.novyy_parol")}</b>
                  </span>
                  <span className="company-profile-password-wrap">
                    <input
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      name="new_password"
                      disabled={passSaving}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder={t("pages.settings.settingsprofilepage.vvedite_novyy_parol")}
                    />
                    <button
                      type="button"
                      className="company-profile-eye"
                      onClick={() => setShowNewPassword((value) => !value)}
                      aria-label={showNewPassword ? "Скрыть пароль" : "Показать пароль"}
                      aria-pressed={showNewPassword}
                    >
                      <Icon name={showNewPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                    </button>
                  </span>
                </label>

                <label>
                  <span>
                    <b>{t("pages.settings.settingsprofilepage.povtorite_novyy_parol")}</b>
                  </span>
                  <span className="company-profile-password-wrap">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={confirmPassword}
                      name="confirm_password"
                      disabled={passSaving}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder={t("pages.settings.settingsprofilepage.povtorite_novyy_parol")}
                    />
                    <button
                      type="button"
                      className="company-profile-eye"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
                      aria-pressed={showConfirmPassword}
                    >
                      <Icon name={showConfirmPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                    </button>
                  </span>
                </label>
              </div>

              <div className="company-profile-password-actions">
                <button type="submit" className="company-profile-save" disabled={passSaving}>
                  {passSaving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
