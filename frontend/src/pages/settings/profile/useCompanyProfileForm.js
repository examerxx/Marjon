import { useEffect, useMemo, useState } from "react";
import { settingsService } from "../../../api/settings";
import { readStoredProfile, updateStoredProfile } from "../../../utils/profileCache";
import { isAbortError, useLatestRequest, useMutationLocks } from "../../../hooks/useAsyncSafety";
import { emptyForm } from "./profileSections";

// Контроллер загрузки/сохранения профиля компании.
// Инкапсулирует состояние формы и жизненный цикл запроса (FE-06):
// свежесть запроса (useLatestRequest), блокировки повторной отправки
// (useMutationLocks), правдивые success/error и безопасность при размонтировании.
// Логика и зависимости эффекта перенесены из SettingsProfilePage без изменений.
export function useCompanyProfileForm(user) {
  const storedProfile = useMemo(() => readStoredProfile(user?.id), [user?.id]);
  const [form, setForm] = useState({ ...emptyForm, profileLogo: storedProfile.photo || "" });
  const [savedForm, setSavedForm] = useState({ ...emptyForm, profileLogo: storedProfile.photo || "" });
  const [activeSection, setActiveSection] = useState("basic");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const beginRequest = useLatestRequest();
  const { acquire, release } = useMutationLocks();

  // Доля обслуги официанту и час старта операционного дня — самодостаточные
  // блоки страницы профиля: у каждого своя кнопка «Сохранить», в общий payload
  // handleSave они не входят. Оба поля бэкенд принимает в PATCH /companies/me
  // (CompanyUpdate.waiter_service_percent / day_start_hour) и отдаёт в профиле.
  const [waiterPct, setWaiterPct] = useState("");
  const [waiterPctSaving, setWaiterPctSaving] = useState(false);
  const [dayStartHour, setDayStartHour] = useState("0");
  const [dayStartHourSaving, setDayStartHourSaving] = useState(false);

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
          profileLogo: storedProfile.photo || "",
        };
        setForm(next);
        setSavedForm(next);
        // Доля обслуги и час сброса нумерации приходят в том же профиле компании.
        setWaiterPct(data?.waiter_service_percent != null ? String(data.waiter_service_percent) : "");
        setDayStartHour(data?.day_start_hour != null ? String(data.day_start_hour) : "0");
      })
      .catch((err) => {
        if (request.isCurrent() && !isAbortError(err)) setError(err.response?.data?.detail || "Не удалось загрузить профиль.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, storedProfile.companyLogo, storedProfile.name, storedProfile.photo, user?.id]);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setSuccess("");
  };

  function handleImageChange(key, event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Выберите файл изображения.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => set(key, String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  function resetForm() {
    setForm(savedForm);
    setError("");
    setSuccess("Изменения отменены.");
  }

  function clearLogo(key) {
    set(key, "");
  }

  async function saveWaiterPct() {
    setWaiterPctSaving(true);
    try {
      await settingsService.updateCompanyProfile({
        waiter_service_percent: Math.max(0, Math.min(100, Number(waiterPct) || 0)),
      });
      setError("");
      setSuccess("Доля обслуги официанту сохранена.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить долю обслуги");
    } finally {
      setWaiterPctSaving(false);
    }
  }

  async function saveDayStartHour() {
    setDayStartHourSaving(true);
    try {
      await settingsService.updateCompanyProfile({
        day_start_hour: Math.max(0, Math.min(23, Math.trunc(Number(dayStartHour) || 0))),
      });
      setError("");
      setSuccess("Время сброса нумерации сохранено.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить время сброса");
    } finally {
      setDayStartHourSaving(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!acquire("company-profile-save")) return;
    if (!form.name.trim()) {
      setError("Укажите название компании.");
      release("company-profile-save");
      return;
    }
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
      const { data } = await settingsService.updateCompanyProfile(payload);
      if (!data || typeof data !== "object") throw new Error("Backend не вернул сохранённый профиль.");
      const confirmed = {
        ...form,
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        inn: data.inn || "",
        currency: data.currency || "UZS",
      };
      const nextStored = {
        ...readStoredProfile(user?.id),
        name: confirmed.name,
        photo: form.profileLogo,
        companyLogo: form.companyLogo,
      };
      updateStoredProfile(user?.id, nextStored);
      setForm(confirmed);
      setSavedForm(confirmed);
      setSuccess("Профиль сохранён.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось сохранить профиль.");
    } finally {
      setSaving(false);
      release("company-profile-save");
    }
  }

  return {
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
  };
}
