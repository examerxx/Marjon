import { useEffect, useMemo, useRef, useState } from "react";
import { settingsService } from "../../../api/settings";
import { authService } from "../../../api/auth";
import { readStoredProfile, updateStoredProfile } from "../../../utils/profileCache";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../../hooks/useAsyncSafety";
import { emptyForm } from "./profileSections";
import { useProfilePhoto } from "../../../hooks/useProfilePhoto";

// Контроллер страницы «Настройка профиля» (V1: 4 секции).
// Канонические поля компании грузятся/сохраняются через PATCH /companies/me.
// Поля без backend-поддержки (пароли блюд, цена доставки, тип заказа,
// смена пароля, очистка отчетов) хранятся только локально, никогда не
// отправляются и никогда не показывают ложный успех — см. флаги ниже.
export const PROFILE_PASSWORD_BACKEND_SUPPORTED = true;
export const CLEAR_REPORTS_BACKEND_SUPPORTED = false;
export const ORDER_TYPES_BACKEND_SUPPORTED = true;
// Display identity is persisted through the narrow authenticated self-profile API.
export const PROFILE_NAME_BACKEND_SUPPORTED = true;

// Матрица поддержки backend для секции «Основные настройки»:
// FIELD | BACKEND FIELD | GET | PATCH | PERSISTED
// Начало дня | day_start_hour | YES | YES | YES
// НДС с сервису (%) | vat_rate | YES | YES | YES
// Пароль для удаления блюд | — | NO | NO (extra=forbid→422) | NO
// Пароль для удаления блюд после пречека | — | NO | NO | NO
// Пароль при смене официанта | — | NO | NO | NO
// Пароль для восстановления заказа | — | NO | NO | NO
// Цена доставки | — (только зональные delivery_fee) | NO | NO | NO
export const MAIN_SETTINGS_SUPPORT = Object.freeze({
  dayStartHour: { backendField: "day_start_hour", get: true, patch: true, persisted: true },
  vatRate: { backendField: "vat_rate", get: true, patch: true, persisted: true },
  showSupportButton: { backendField: "show_support_button", get: true, patch: true, persisted: true },
  dishDeletePassword: { backendField: null, get: false, patch: false, persisted: false },
  dishDeleteAfterPrecheckPassword: { backendField: null, get: false, patch: false, persisted: false },
  waiterChangePassword: { backendField: null, get: false, patch: false, persisted: false },
  orderRestorePassword: { backendField: null, get: false, patch: false, persisted: false },
  deliveryPrice: { backendField: null, get: false, patch: false, persisted: false },
});

const EMPTY_ORDER_TYPES = Object.freeze({ dineIn: true, takeaway: true, delivery: true });

export function useCompanyProfileForm(user, onProfileSaved) {
  const serverPhoto = useProfilePhoto(user);
  const [profileFile, setProfileFile] = useState(null);
  const savedProfileName = useRef(user?.name || user?.full_name || "");
  const photoReadVersion = useRef(0);
  const storedProfile = useMemo(() => readStoredProfile(user?.id), [user?.id]);
  const [form, setForm] = useState({ ...emptyForm, profileLogo: "" });
  const [savedForm, setSavedForm] = useState({ ...emptyForm, profileLogo: "" });
  const [activeSection, setActiveSectionState] = useState("basic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [successClosing, setSuccessClosing] = useState(false);
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  // V3: success-баннер живёт 5 секунд (4500 fully visible + ~500 animate
  // out) и только после РЕАЛЬНОГО успеха. Таймеры сбрасываются при новом
  // сейве, смене секции, Cancel и размонтировании.
  const toastTimers = useRef([]);
  function clearToastTimers() {
    toastTimers.current.forEach((timer) => clearTimeout(timer));
    toastTimers.current = [];
  }
  useEffect(() => () => clearToastTimers(), []);
  function flashSuccess(message) {
    clearToastTimers();
    setSuccessClosing(false);
    setSuccess(message);
    toastTimers.current.push(setTimeout(() => setSuccessClosing(true), 4500));
    toastTimers.current.push(setTimeout(() => {
      setSuccess("");
      setSuccessClosing(false);
    }, 5000));
  }
  function clearSuccess() {
    clearToastTimers();
    setSuccessClosing(false);
    setSuccess("");
  }
  function clearError() {
    setError("");
  }

  // «Основные настройки»: поддерживается backend (своя кнопка «Сохранить»).
  const [dayStartHour, setDayStartHour] = useState("0");
  const [vatRate, setVatRate] = useState("");
  const [savedMain, setSavedMain] = useState({ dayStartHour: "0", vatRate: "" });
  const [mainSaving, setMainSaving] = useState(false);
  // Видимость глобальной кнопки поддержки: canonical company-поле
  // show_support_button (default TRUE — сохраняет текущее поведение).
  const [showSupportButton, setShowSupportButton] = useState(true);
  const [savedShowSupportButton, setSavedShowSupportButton] = useState(true);
  const [supportSaving, setSupportSaving] = useState(false);

  // «Основные настройки»: без backend-поддержки — локально, не отправляется.
  const [dishDeletePassword, setDishDeletePassword] = useState("");
  const [dishDeleteAfterPrecheckPassword, setDishDeleteAfterPrecheckPassword] = useState("");
  const [waiterChangePassword, setWaiterChangePassword] = useState("");
  const [orderRestorePassword, setOrderRestorePassword] = useState("");
  const [deliveryPrice, setDeliveryPrice] = useState("");

  // «Другие настройки»: тип заказа — с backend (Company.order_types).
  // NULL/отсутствие = все включены (как раньше).
  const [orderTypes, setOrderTypes] = useState({ ...EMPTY_ORDER_TYPES });
  const [savedOrderTypes, setSavedOrderTypes] = useState({ ...EMPTY_ORDER_TYPES });
  const [orderTypesSaving, setOrderTypesSaving] = useState(false);

  // Secrets live only in component memory; never in profile/local storage.
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passSaving, setPassSaving] = useState(false);

  // Персональная подпись интерфейса: локальный профиль, затем GET /auth/me.
  const derivedProfileName = user?.name || user?.full_name || "";
  const [profileName, setProfileNameState] = useState("");
  const [profileNamePristine, setProfileNamePristine] = useState(true);
  useEffect(() => {
    savedProfileName.current = derivedProfileName;
    if (profileNamePristine) setProfileNameState(derivedProfileName);
  }, [derivedProfileName, profileNamePristine, user?.id]);

  useEffect(() => {
    if (!profileFile) {
      setForm((current) => ({ ...current, profileLogo: serverPhoto }));
      setSavedForm((current) => ({ ...current, profileLogo: serverPhoto }));
    }
  }, [serverPhoto, profileFile]);

  useEffect(() => {
    const request = beginRequest();
    settingsService.getCompanyProfile({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const next = {
          name: data.name || "",
          phone: data.phone || "",
          address: data.address || "",
          inn: data.inn || "",
          currency: data.currency || "UZS",
          companyLogo: storedProfile.companyLogo || "",
          profileLogo: serverPhoto,
        };
        setForm((current) => ({ ...next, profileLogo: current.profileLogo }));
        setSavedForm((current) => ({ ...next, profileLogo: current.profileLogo }));
        const nextMain = {
          dayStartHour: data?.day_start_hour != null ? String(data.day_start_hour) : "0",
          vatRate: data?.vat_rate != null ? String(data.vat_rate) : "",
        };
        setDayStartHour(nextMain.dayStartHour);
        setVatRate(nextMain.vatRate);
        setSavedMain(nextMain);
        // Backend default TRUE: отсутствующее поле = видимая кнопка.
        const nextShowSupport = data?.show_support_button !== false;
        setShowSupportButton(nextShowSupport);
        setSavedShowSupportButton(nextShowSupport);
        const nextOrderTypes = {
          dineIn: data?.order_types?.dine_in ?? true,
          takeaway: data?.order_types?.takeaway ?? true,
          delivery: data?.order_types?.delivery ?? true,
        };
        setOrderTypes(nextOrderTypes);
        setSavedOrderTypes(nextOrderTypes);
      })
      .catch((err) => {
        if (request.isCurrent() && !isAbortError(err)) setError(err.response?.data?.detail || "Не удалось загрузить профиль.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, storedProfile.companyLogo, user?.id]);

  function setActiveSection(key) {
    if (key !== "profile") resetPassword();
    setActiveSectionState(key);
    setError("");
    clearSuccess();
  }

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    clearSuccess();
  };

  const setProfileName = (value) => {
    setProfileNameState(value);
    setProfileNamePristine(false);
    setError("");
    clearSuccess();
  };

  function handleImageChange(key, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Выберите JPG, PNG или WebP размером до 5 МБ.");
      return;
    }
    if (key === "profileLogo") setProfileFile(file);
    const version = ++photoReadVersion.current;
    const reader = new FileReader();
    reader.onload = () => { if (version === photoReadVersion.current) set(key, String(reader.result || "")); };
    reader.readAsDataURL(file);
  }

  function resetForm() {
    photoReadVersion.current++;
    setProfileFile(null);
    setForm(savedForm);
    setProfileNameState(savedProfileName.current);
    setError("");
    clearSuccess();
  }

  function clearLogo(key) {
    set(key, "");
  }

  // «Основные данные»: сохраняются только канонические поля.
  // phone/currency в V1 не редактируются — отправляем сохранённые значения,
  // чтобы не затереть их пустыми строками.
  async function handleSave(event) {
    event.preventDefault();
    if (!acquire("company-profile-save")) return;
    if (!profileName.trim() || profileName.trim().length > 255) {
      setError("Укажите имя профиля от 1 до 255 символов.");
      clearSuccess();
      release("company-profile-save");
      return;
    }
    if (!form.name.trim() || form.name.trim().length > 255) {
      setError("Укажите название заведения от 1 до 255 символов.");
      clearSuccess();
      release("company-profile-save");
      return;
    }
    setSaving(true);
    setError("");
    clearSuccess();

    try {
      // Company metadata and personal identity use separate scoped endpoints.
      const payload = {
        name: form.name.trim(),
        phone: savedForm.phone,
        address: form.address,
        inn: form.inn,
        currency: savedForm.currency,
      };
      const companyChanged = ["name", "address", "inn"].some((key) => form[key] !== savedForm[key]);
      const { data } = companyChanged ? await settingsService.updateCompanyProfile(payload) : { data: savedForm };
      if (!data || typeof data !== "object") throw new Error("Backend не вернул сохранённый профиль.");
      const confirmed = {
        ...form,
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        inn: data.inn || "",
        currency: data.currency || "UZS",
      };
      const { data: profile } = await authService.updateProfile({ name: profileName.trim(), file: profileFile });
      if (profile?.id !== user?.id || typeof profile?.name !== "string") throw new Error("Backend не подтвердил сохранение профиля.");
      const nextStored = {
        ...readStoredProfile(user?.id),
        name: confirmed.name,
        companyLogo: form.companyLogo,
      };
      delete nextStored.photo;
      delete nextStored.profileName;
      try { updateStoredProfile(user?.id, nextStored); } catch { /* Server is authoritative even when browser storage is unavailable. */ }
      setForm(confirmed);
      setSavedForm(confirmed);
      savedProfileName.current = profile.name;
      setProfileNameState(profile.name);
      setProfileFile(null);
      onProfileSaved?.(profile);
      // Success only follows the server-confirmed personal profile response.
      flashSuccess("Профиль сохранён.");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Не удалось сохранить профиль. Проверьте имя и фото и повторите попытку.");
    } finally {
      setSaving(false);
      release("company-profile-save");
    }
  }

  function resetMain() {
    setDayStartHour(savedMain.dayStartHour);
    setVatRate(savedMain.vatRate);
    setDishDeletePassword("");
    setDishDeleteAfterPrecheckPassword("");
    setWaiterChangePassword("");
    setOrderRestorePassword("");
    setDeliveryPrice("");
    setError("");
    clearSuccess();
  }

  // This one setting saves independently; pending clicks cannot overlap.
  async function saveSupportVisibility(nextVisible) {
    if (!acquire("company-support-visibility-save")) return;
    const previous = savedShowSupportButton;
    const notify = (value) => window.dispatchEvent(new CustomEvent("marjon:company-profile-updated", {
      detail: { show_support_button: value },
    }));
    setSupportSaving(true);
    setError("");
    clearSuccess();
    setShowSupportButton(nextVisible);
    notify(nextVisible);
    try {
      const { data } = await settingsService.updateCompanyProfile({ show_support_button: nextVisible });
      if (typeof data?.show_support_button !== "boolean") {
        throw new Error("Backend не вернул сохранённую настройку поддержки.");
      }
      setShowSupportButton(data.show_support_button);
      setSavedShowSupportButton(data.show_support_button);
      if (data.show_support_button !== nextVisible) notify(data.show_support_button);
    } catch (err) {
      setShowSupportButton(previous);
      notify(previous);
      setError(err.response?.data?.detail || err.message || "Не удалось сохранить настройку поддержки.");
    } finally {
      setSupportSaving(false);
      release("company-support-visibility-save");
    }
  }

  // «Основные настройки»: отправляются ТОЛЬКО day_start_hour и vat_rate.
  // Пароли/цена доставки не поддерживаются backend и в payload не входят.
  async function saveMain(event) {
    event?.preventDefault?.();
    if (!acquire("company-main-settings-save")) return;
    setMainSaving(true);
    setError("");
    clearSuccess();

    try {
      const payload = {
        day_start_hour: Math.max(0, Math.min(23, Math.trunc(Number(dayStartHour) || 0))),
      };
      if (String(vatRate).trim() !== "") {
        const parsed = Number(String(vatRate).replace(",", "."));
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          throw new Error("НДС должен быть числом от 0 до 100.");
        }
        payload.vat_rate = parsed;
      }
      const { data } = await settingsService.updateCompanyProfile(payload);
      if (!data || typeof data !== "object") throw new Error("Backend не вернул сохранённые настройки.");
      const nextMain = {
        dayStartHour: data?.day_start_hour != null ? String(data.day_start_hour) : savedMain.dayStartHour,
        vatRate: data?.vat_rate != null ? String(data.vat_rate) : savedMain.vatRate,
      };
      setDayStartHour(nextMain.dayStartHour);
      setVatRate(nextMain.vatRate);
      setSavedMain(nextMain);
      flashSuccess("Основные настройки сохранены.");
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Не удалось сохранить основные настройки.");
    } finally {
      setMainSaving(false);
      release("company-main-settings-save");
    }
  }

  function toggleOrderType(key) {
    setOrderTypes((current) => ({ ...current, [key]: !current[key] }));
    setError("");
    clearSuccess();
  }

  function resetOrderTypes() {
    setOrderTypes({ ...savedOrderTypes });
    setError("");
    clearSuccess();
  }

  // «Другие настройки»: отправка типов заказа (dineIn→dine_in).
  async function saveOrderTypes(event) {
    event?.preventDefault?.();
    if (!acquire("company-order-types-save")) return;
    setOrderTypesSaving(true);
    setError("");
    clearSuccess();
    try {
      const payload = {
        order_types: {
          dine_in: Boolean(orderTypes.dineIn),
          takeaway: Boolean(orderTypes.takeaway),
          delivery: Boolean(orderTypes.delivery),
        },
      };
      const { data } = await settingsService.updateCompanyProfile(payload);
      if (!data || typeof data !== "object") throw new Error("Backend не вернул сохранённые настройки.");
      const next = {
        dineIn: data?.order_types?.dine_in ?? orderTypes.dineIn,
        takeaway: data?.order_types?.takeaway ?? orderTypes.takeaway,
        delivery: data?.order_types?.delivery ?? orderTypes.delivery,
      };
      setOrderTypes(next);
      setSavedOrderTypes(next);
      flashSuccess("Типы заказа сохранены.");
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Не удалось сохранить типы заказа.");
    } finally {
      setOrderTypesSaving(false);
      release("company-order-types-save");
    }
  }

  // «Настройка профиля»: смена пароля.
  // Реального эндпоинта смены пароля нет — мутаций не выполняем.
  async function savePassword(event) {
    event?.preventDefault?.();
    if (passSaving) return;
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Заполните все поля пароля.");
      clearSuccess();
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают.");
      clearSuccess();
      return;
    }
    // Канонические правила пароля backend (auth/schemas: мин. 4 символа,
    // состав не ограничен — «6611» и «QW12» валидны).
    if (newPassword.length < 4) {
      setError("Пароль должен быть не менее 4 символов.");
      clearSuccess();
      return;
    }
    if (new TextEncoder().encode(currentPassword).length > 72 || new TextEncoder().encode(newPassword).length > 72) {
      setError("Пароль должен быть не более 72 байт.");
      clearSuccess();
      return;
    }
    if (currentPassword === newPassword) {
      setError("Новый пароль должен отличаться от текущего.");
      clearSuccess();
      return;
    }
    if (!acquire("profile-password-save")) return;
    setPassSaving(true);
    try {
      setError("");
      clearSuccess();
      await authService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      resetPassword();
      flashSuccess("Пароль изменён. Другие сеансы потребуют повторного входа.");
    } catch (err) {
      const data = err.response?.data;
      setError(typeof data?.detail === "string" ? data.detail : data?.message || "Не удалось изменить пароль. Проверьте соединение и повторите попытку.");
    } finally {
      setPassSaving(false);
      release("profile-password-save");
    }
  }

  function resetPassword() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setError("");
    clearSuccess();
  }

  return {
    form,
    activeSection,
    setActiveSection,
    loading,
    saving,
    error,
    clearError,
    success,
    successClosing,
    setSuccess,
    clearSuccess,
    set,
    profileName,
    setProfileName,
    handleImageChange,
    resetForm,
    clearLogo,
    handleSave,
    dayStartHour,
    setDayStartHour,
    vatRate,
    setVatRate,
    showSupportButton,
    supportSaving,
    saveSupportVisibility,
    mainSaving,
    saveMain,
    resetMain,
    dishDeletePassword,
    setDishDeletePassword,
    dishDeleteAfterPrecheckPassword,
    setDishDeleteAfterPrecheckPassword,
    waiterChangePassword,
    setWaiterChangePassword,
    orderRestorePassword,
    setOrderRestorePassword,
    deliveryPrice,
    setDeliveryPrice,
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
    resetPassword,
  };
}
