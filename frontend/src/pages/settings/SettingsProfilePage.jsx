// Оркестратор страницы «Профиль компании»: связывает контроллер данных
// (useCompanyProfileForm) с представлением. Конфигурация секций и логика
// загрузки/сохранения вынесены в ./profile; здесь только вывод разметки.
import logo from "../../assets/marjon-logo.svg";
import Icon from "../../components/Icon";
import { useAuth } from "../../context/AuthContext";
import { profileSections } from "./profile/profileSections";
import { useCompanyProfileForm } from "./profile/useCompanyProfileForm";

export default function SettingsProfilePage() {
  const { user } = useAuth();
  const {
    form,
    activeSection,
    setActiveSection,
    loading,
    saving,
    error,
    success,
    setSuccess,
    set,
    handleImageChange,
    resetForm,
    clearLogo,
    handleSave,
    waiterPct,
    setWaiterPct,
    waiterPctSaving,
    saveWaiterPct,
    dayStartHour,
    setDayStartHour,
    dayStartHourSaving,
    saveDayStartHour,
  } = useCompanyProfileForm(user);

  const activeMeta = profileSections.find((section) => section.key === activeSection) || profileSections[0];
  const profilePreview = form.profileLogo || form.companyLogo || logo;

  if (loading) {
    return (
      <section className="company-profile-page">
        <div className="company-profile-shell">
          <p className="company-profile-loading">Загрузка...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="company-profile-page">
      <form className="company-profile-shell" onSubmit={handleSave}>
        <aside className="company-profile-nav" aria-label="Разделы настроек">
          {profileSections.map((section) => (
            <button
              key={section.key}
              type="button"
              className={activeSection === section.key ? "is-active" : ""}
              onClick={() => setActiveSection(section.key)}
            >
              <Icon name={section.icon} size={18} />
              <span>{section.label}</span>
            </button>
          ))}
        </aside>

        <div className="company-profile-content">
          <header className="company-profile-header">
            <div className="company-profile-title">
              <span className="company-profile-accent" />
              <div>
                <p>{activeSection === "basic" ? "Профиль компании" : "Раздел настроек"}</p>
                <h1>{activeMeta.label}</h1>
              </div>
            </div>
            <div className="company-profile-actions">
              <button type="button" className="company-profile-cancel" onClick={resetForm}>Отменить</button>
              <button type="submit" className="company-profile-save" disabled={saving}>
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </header>

          {error ? <div className="company-profile-alert is-error">{error}</div> : null}
          {success ? <div className="company-profile-alert is-success">{success}</div> : null}

          <div className="company-profile-main">
            <section className="company-profile-logo-panel">
              <div className="company-profile-logo-copy">
                <strong>Лого компании</strong>
                <span>Используется в чеках, ссылках и элементах бренда.</span>
              </div>
              <div className="company-profile-logo-actions">
                <label className="company-profile-upload">
                  <input type="file" accept="image/*" onChange={(event) => handleImageChange("companyLogo", event)} />
                  <span>
                    {form.companyLogo ? <img src={form.companyLogo} alt="Лого компании" /> : <Icon name="bi-image" size={22} />}
                  </span>
                  <b>Загрузить</b>
                </label>
                {form.companyLogo ? (
                  <button type="button" onClick={() => clearLogo("companyLogo")}>Очистить</button>
                ) : null}
              </div>
            </section>

            <section className="company-profile-logo-panel">
              <div className="company-profile-logo-copy">
                <strong>Лого профиля</strong>
                <span>Отображается в боковом меню и карточке пользователя.</span>
              </div>
              <div className="company-profile-logo-actions">
                <label className="company-profile-upload">
                  <input type="file" accept="image/*" onChange={(event) => handleImageChange("profileLogo", event)} />
                  <span>
                    <img src={profilePreview} alt="Лого профиля" />
                  </span>
                  <b>Заменить</b>
                </label>
                {form.profileLogo ? (
                  <button type="button" onClick={() => clearLogo("profileLogo")}>Очистить</button>
                ) : null}
              </div>
            </section>

            <div className="company-profile-field-list">
              <label>
                <span>
                  <b>Название компании</b>
                  <em>Введите полное название компании</em>
                </span>
                <input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Название компании" />
              </label>

              <label>
                <span>
                  <b>Адрес компании</b>
                  <em>Введите текущий юридический адрес</em>
                </span>
                <input value={form.address} onChange={(event) => set("address", event.target.value)} placeholder="Введите адрес" />
              </label>

              <label>
                <span>
                  <b>ИНН</b>
                  <em>Введите ИНН</em>
                </span>
                <input value={form.inn} onChange={(event) => set("inn", event.target.value)} placeholder="123456789" />
              </label>

              <label>
                <span>
                  <b>Телефон</b>
                  <em>Контактный номер ресторана</em>
                </span>
                <input value={form.phone} onChange={(event) => set("phone", event.target.value)} placeholder="+998..." />
              </label>

              <label>
                <span>
                  <b>Валюта</b>
                  <em>Основная валюта системы</em>
                </span>
                <select value={form.currency} onChange={(event) => set("currency", event.target.value)}>
                  <option value="UZS">UZS - Узбекский сум</option>
                  <option value="USD">USD - Доллар</option>
              </select>
              </label>

              <label>
                <span>
                  <b>Доля обслуги официанту, %</b>
                  <em>Процент от суммы обслуги для отчёта по официантам</em>
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={waiterPct}
                    onChange={(event) => setWaiterPct(event.target.value)}
                    placeholder="0"
                  />
                  <button type="button" className="company-profile-danger" style={{ whiteSpace: "nowrap" }} disabled={waiterPctSaving} onClick={saveWaiterPct}>
                    Сохранить
                  </button>
                </div>
              </label>

              <label>
                <span>
                  <b>Сброс нумерации заказов</b>
                  <em>Час, когда начинается новый операционный день. Заказы до этого часа относятся к прошлому дню. 0 — сброс в полночь</em>
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={dayStartHour}
                    onChange={(event) => setDayStartHour(event.target.value)}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={String(hour)}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                  <button type="button" className="company-profile-danger" style={{ whiteSpace: "nowrap" }} disabled={dayStartHourSaving} onClick={saveDayStartHour}>
                    Сохранить
                  </button>
                </div>
              </label>
            </div>

            <button
              type="button"
              className="company-profile-danger"
              onClick={() => setSuccess("Очистка отчетов отключена в демо-режиме.")}
            >
              <Icon name="bi-exclamation-octagon" size={18} />
              Очистить все отчеты
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
