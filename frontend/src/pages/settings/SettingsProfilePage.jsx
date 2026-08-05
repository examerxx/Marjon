import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import logo from "../../assets/marjon-logo.svg";
import Icon from "../../components/Icon";
import { useOrg } from "../../context/OrgContext";

const PROFILE_STORAGE_KEY = "marjon_profile_settings";

const profileSections = [
  { key: "basic", label: "Основные данные", icon: "bi-file-earmark-text" },
  { key: "main", label: "Основные настройки", icon: "bi-sliders" },
  { key: "receipt", label: "Настройки для чека", icon: "bi-receipt" },
  { key: "cashier", label: "Настройки кассира", icon: "bi-person" },
  { key: "online", label: "Настройки для онлайн меню", icon: "bi-list" },
  { key: "other", label: "Другие настройки", icon: "bi-three-dots" },
  { key: "discounts", label: "Скидки", icon: "bi-percent" },
  { key: "profile", label: "Настройка профиля", icon: "bi-person-gear" },
  { key: "constructor", label: "Чек конструктор", icon: "bi-ticket-perforated" },
  { key: "import", label: "Импорт", icon: "bi-box-arrow-in-down" },
  { key: "telegram", label: "Telegram бот настройки", icon: "bi-chat-left" },
  { key: "legacy", label: "Старая версия", icon: "bi-arrow-counterclockwise" },
];

function readStoredProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function updateStoredProfile(nextProfile) {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
  window.dispatchEvent(new CustomEvent("marjon-profile-updated", { detail: nextProfile }));
}

const emptyForm = {
  name: "",
  phone: "",
  address: "",
  inn: "",
  currency: "UZS",
  companyLogo: "",
  profileLogo: "",
};

export default function SettingsProfilePage() {
  const { reload: reloadOrg } = useOrg();
  const storedProfile = useMemo(() => readStoredProfile(), []);
  const [form, setForm] = useState({ ...emptyForm, profileLogo: storedProfile.photo || "" });
  const [savedForm, setSavedForm] = useState({ ...emptyForm, profileLogo: storedProfile.photo || "" });
  const [activeSection, setActiveSection] = useState("basic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Спец-пароль отмены заказа (самодостаточный блок, отдельно от основного сохранения профиля)
  const [cancelPw, setCancelPw] = useState("");
  const [cancelPwSet, setCancelPwSet] = useState(false);
  const [cancelPwSaving, setCancelPwSaving] = useState(false);
  const [waiterPct, setWaiterPct] = useState("");
  const [waiterPctSaving, setWaiterPctSaving] = useState(false);

  useEffect(() => {
    api.get("/companies/me/cancel-password")
      .then(({ data }) => setCancelPwSet(Boolean(data?.is_set)))
      .catch(() => {});
    api.get("/companies/me")
      .then(({ data }) => setWaiterPct(data?.waiter_service_percent != null ? String(data.waiter_service_percent) : ""))
      .catch(() => {});
  }, []);

  const saveWaiterPct = async () => {
    setWaiterPctSaving(true);
    try {
      await api.patch("/companies/me", { waiter_service_percent: Math.max(0, Math.min(100, Number(waiterPct) || 0)) });
      setSuccess("Доля обслуги официанту сохранена.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить долю обслуги");
    } finally {
      setWaiterPctSaving(false);
    }
  };

  const saveCancelPw = async () => {
    setCancelPwSaving(true);
    try {
      const { data } = await api.post("/companies/me/cancel-password", { password: cancelPw || null });
      setCancelPwSet(Boolean(data?.is_set));
      setCancelPw("");
      setSuccess("Пароль отмены сохранён.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить пароль отмены");
    } finally {
      setCancelPwSaving(false);
    }
  };

  useEffect(() => {
    api.get("/companies/me")
      .then(({ data }) => {
        const next = {
          name: data.name || storedProfile.name || "",
          phone: data.phone || "",
          address: data.address || "",
          inn: data.inn || "",
          currency: data.currency || "UZS",
          // Реальное лого с бэкенда — приоритет над локальным кешем (мог остаться
          // от старой демо-версии, где загрузка лого нигде не сохранялась).
          companyLogo: data.logo || storedProfile.companyLogo || "",
          profileLogo: storedProfile.photo || "",
        };
        setForm(next);
        setSavedForm(next);
      })
      .catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить профиль."))
      .finally(() => setLoading(false));
  }, [storedProfile.companyLogo, storedProfile.name, storedProfile.photo]);

  const activeMeta = profileSections.find((section) => section.key === activeSection) || profileSections[0];
  const profilePreview = form.profileLogo || form.companyLogo || logo;

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setSuccess("");
  };

  function handleImageChange(key, event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // позволяет выбрать тот же файл повторно
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Выберите файл изображения.");
      return;
    }

    if (key === "companyLogo") {
      uploadCompanyLogo(file);
      return;
    }

    // Лого профиля (аватар пользователя) — пока без серверной загрузки,
    // используется только для превью в этой сессии.
    const reader = new FileReader();
    reader.onload = () => set(key, String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  async function uploadCompanyLogo(file) {
    setUploadingLogo(true);
    setError("");
    setSuccess("");
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/companies/me/logo", body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      set("companyLogo", data.logo || "");
      setSavedForm((current) => ({ ...current, companyLogo: data.logo || "" }));
      await reloadOrg(); // чтобы шаблон чека сразу подхватил новое лого
      setSuccess("Лого компании загружено и будет напечатано на чеке.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось загрузить лого. Поддерживаются jpg, png, webp.");
    } finally {
      setUploadingLogo(false);
    }
  }

  function resetForm() {
    setForm(savedForm);
    setError("");
    setSuccess("Изменения отменены.");
  }

  async function clearLogo(key) {
    if (key !== "companyLogo") {
      set(key, "");
      return;
    }
    setUploadingLogo(true);
    setError("");
    try {
      await api.delete("/companies/me/logo");
      set("companyLogo", "");
      setSavedForm((current) => ({ ...current, companyLogo: "" }));
      await reloadOrg();
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось удалить лого.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        address: form.address,
        inn: form.inn,
        currency: form.currency,
      };
      await api.patch("/companies/me", payload);
      const nextStored = {
        ...readStoredProfile(),
        name: form.name.trim() || "MARJON",
        photo: form.profileLogo,
        companyLogo: form.companyLogo,
      };
      updateStoredProfile(nextStored);
      setSavedForm(form);
      setSuccess("Профиль сохранён.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить профиль.");
    } finally {
      setSaving(false);
    }
  }

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
                <span>Печатается на чеке (ESC/POS) и используется в UI/ссылках.</span>
              </div>
              <div className="company-profile-logo-actions">
                <label className="company-profile-upload" aria-disabled={uploadingLogo}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingLogo}
                    onChange={(event) => handleImageChange("companyLogo", event)}
                  />
                  <span>
                    {form.companyLogo ? <img src={form.companyLogo} alt="Лого компании" /> : <Icon name="bi-image" size={22} />}
                  </span>
                  <b>{uploadingLogo ? "Загрузка..." : "Загрузить"}</b>
                </label>
                {form.companyLogo ? (
                  <button type="button" disabled={uploadingLogo} onClick={() => clearLogo("companyLogo")}>Очистить</button>
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
                  <b>Пароль отмены заказа</b>
                  <em>{cancelPwSet ? "Пароль задан — введите новый, чтобы изменить" : "Требуется в кассе для отмены заказа"}</em>
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={cancelPw}
                    onChange={(event) => setCancelPw(event.target.value)}
                    placeholder={cancelPwSet ? "•••• (задан)" : "Например: 1234"}
                    autoComplete="off"
                  />
                  <button type="button" className="company-profile-danger" style={{ whiteSpace: "nowrap" }} disabled={cancelPwSaving} onClick={saveCancelPw}>
                    Сохранить
                  </button>
                </div>
              </label>

              <label>
                <span>
                  <b>Доля обслуги официанту, %</b>
                  <em>Процент от суммы обслуги для отчёта по официантам</em>
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number" min="0" max="100"
                    value={waiterPct}
                    onChange={(event) => setWaiterPct(event.target.value)}
                    placeholder="0"
                  />
                  <button type="button" className="company-profile-danger" style={{ whiteSpace: "nowrap" }} disabled={waiterPctSaving} onClick={saveWaiterPct}>
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
