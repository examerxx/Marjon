import { useEffect, useMemo, useRef, useState } from "react";
import { staffService } from "../api/staff";
import { isAbortError, useLatestRequest, useMutationLocks } from "../hooks/useAsyncSafety";
import {
  emptyForm,
  mapStaffUser,
  roleMap,
  roleOptions,
} from "./staff/staffConstants";
import { getPhoneLocal, inferPhoneCountry, normalizePhone } from "./staff/staffPhone";
import StaffToolbar from "./staff/StaffToolbar";
import StaffTable from "./staff/StaffTable";
import StaffFormModal from "./staff/StaffFormModal";

// Оркестратор раздела «Сотрудники» OWNER (FE-07B). Владеет сквозным состоянием
// (список, фильтры, форма создания/редактирования) и обработчиками; рендер
// разнесён по презентационным подкомпонентам. Транспорт только через
// staffService (FE-05); безопасность запросов/мутаций сохранена (FE-06).
function StaffRolePage({ role = "all" }) {
  const routeRole = roleMap[role] ? role : "all";
  // CASHIER-FE-01: cashier route is the visual/UX reference; other roles keep legacy UI.
  const isCashierView = routeRole === "cashier";
  const pageTitle =
    routeRole === "all" ? "Список сотрудников" : `Список сотрудников: ${roleMap[routeRole].title}`;

  const [staff, setStaff] = useState([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingActionId, setPendingActionId] = useState("");
  const beginRequest = useLatestRequest();
  const mutationLocks = useMutationLocks();

  useEffect(() => {
    const request = beginRequest();
    setStaffError("");
    staffService.listStaffUsers({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const mapped = (data || []).map(mapStaffUser);
        setStaff(mapped);
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        console.warn("Не удалось загрузить сотрудников:", err.message);
        setStaff([]);
        setStaffError("Не удалось загрузить сотрудников.");
      })
      .finally(() => { if (request.isCurrent()) setStaffLoading(false); });
  }, [beginRequest]);

  const defaultFilters = useMemo(() => ({
    query: "",
    roleKey: routeRole === "all" ? "" : routeRole,
    status: "",
  }), [routeRole]);

  const [activeTab, setActiveTab] = useState("active");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalClosing, setModalClosing] = useState(false);
  // Cashier drawer inline submit error (no browser-native popups).
  const [saveError, setSaveError] = useState("");
  const closeTimer = useRef(null);
  const [editingId, setEditingId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [phoneCountryOpen, setPhoneCountryOpen] = useState(false);
  const [form, setForm] = useState({
    ...emptyForm,
  });

  useEffect(() => {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
  }, [defaultFilters]);

  const visibleStaff = useMemo(() => {
    const normalizedQuery = filters.query.trim().toLowerCase();

    return staff.filter((employee) => {
      const matchesRoute = routeRole === "all" || employee.roleKey === routeRole;
      const matchesTab = employee.status === activeTab;
      const matchesQuery =
        !normalizedQuery ||
        employee.fullName.toLowerCase().includes(normalizedQuery) ||
        employee.phone.includes(normalizedQuery);
      const matchesRole = !filters.roleKey || employee.roleKey === filters.roleKey;
      const matchesStatus = !filters.status || employee.status === filters.status;

      return matchesRoute && matchesTab && matchesQuery && matchesRole && matchesStatus;
    });
  }, [activeTab, filters, routeRole, staff]);

  useEffect(() => () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelPendingClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setModalClosing(false);
  };

  const openAddModal = () => {
    cancelPendingClose();
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({
      ...emptyForm,
      phoneCountry: "UZ",
      printerIp: "",
      roleKey: routeRole === "all" ? "cashier" : routeRole,
    });
    setModalOpen(true);
  };

  const openEditModal = (employee) => {
    cancelPendingClose();
    setEditingId(employee.id);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setForm({ ...emptyForm, ...employee, printerIp: "", phoneCountry: employee.phoneCountry || inferPhoneCountry(employee.phone) });
    setModalOpen(true);
  };

  const closeModal = () => {
    // Cashier drawer plays a right-exit animation before unmounting.
    if (isCashierView && modalOpen && !modalClosing) {
      setModalClosing(true);
      cancelPendingCloseTimerOnly();
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null;
        setModalClosing(false);
        resetModalState();
      }, 260);
      return;
    }
    cancelPendingClose();
    resetModalState();
  };

  const cancelPendingCloseTimerOnly = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const resetModalState = () => {
    setModalOpen(false);
    setEditingId(null);
    setShowPassword(false);
    setPhoneCountryOpen(false);
    setSaveError("");
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const toggleForm = (field) => {
    setForm((current) => ({ ...current, [field]: !current[field] }));
  };

  const selectPhoneCountry = (countryKey) => {
    setForm((current) => ({
      ...current,
      phoneCountry: countryKey,
      phone: current.phone ? normalizePhone(getPhoneLocal(current.phone, current.phoneCountry), countryKey) : "",
    }));
    setPhoneCountryOpen(false);
  };

  const toggleAccess = (moduleKey, actionKey = "enabled") => {
    setForm((current) => {
      const moduleAccess = current.access?.[moduleKey] || {};

      return {
        ...current,
        access: {
          ...(current.access || {}),
          [moduleKey]: {
            ...moduleAccess,
            [actionKey]: !moduleAccess[actionKey],
          },
        },
      };
    });
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => updateForm("photo", reader.result);
    reader.readAsDataURL(file);
  };

  // Cashier submit errors surface as drawer inline text. Backend detail can
  // be a string, a list of validation dicts, or absent — always reduce to a
  // human-readable string so React never renders [object Object].
  const toCashierSaveError = (err) => {
    const data = err.response?.data;
    if (!data || typeof data !== "object") {
      return typeof err.message === "string" && err.message
        ? err.message
        : "Ошибка сохранения";
    }
    if (typeof data.detail === "string" && data.detail) return data.detail;
    if (Array.isArray(data.detail)) {
      const first = data.detail.find((entry) => entry && typeof entry.msg === "string");
      if (first) return first.msg;
    }
    if (typeof data.message === "string" && data.message) {
      const fields = data.field_errors;
      if (fields && typeof fields === "object") {
        const firstField = Object.values(fields).find(
          (value) => typeof value === "string" && value,
        );
        if (firstField) return `${data.message}: ${firstField}`;
      }
      return data.message;
    }
    return "Ошибка сохранения";
  };

  const saveStaff = async (event) => {
    event.preventDefault();
    if (!mutationLocks.acquire("staff-save")) return;
    const phone = normalizePhone(form.phone, form.phoneCountry);
    // CASHIER: cashier form has no Email input by product contract; the
    // canonical POST /auth/users accepts no address (nullable email).
    // Never fake an email. Edit path unchanged.
    if (isCashierView) {
      const cashierName = form.fullName.trim();
      if (!cashierName || !phone) {
        setSaveError("Укажите имя и номер телефона кассира.");
        mutationLocks.release("staff-save");
        return;
      }
      if ((!editingId || form.password) && (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))) {
        setSaveError("Пароль должен содержать минимум 8 символов, букву и цифру.");
        mutationLocks.release("staff-save");
        return;
      }
      setSaveError("");
      setSaving(true);
      try {
        // printerIp and photo are visual-only in this phase: never sent.
        // No email key is sent at all — backend persists email NULL.
        let confirmedUser;
        if (!editingId) {
          const { data: createdUser } = await staffService.createCompanyUser({
            password: form.password,
            phone: phone || null,
            role_slug: "cashier",
            role_name: cashierName,
          });
          confirmedUser = createdUser;
          if (form.status === "archived") {
            const { data } = await staffService.updateCompanyUser(createdUser.id, {
              is_active: false,
            });
            confirmedUser = data;
          }
        } else {
          const { data: updatedUser } = await staffService.updateCompanyUser(editingId, {
            name: cashierName,
            password: form.password || undefined,
            phone: phone || null,
            role_slug: "cashier",
            is_active: form.status !== "archived",
          });
          confirmedUser = updatedUser;
        }
        setStaff((current) => {
          const mapped = mapStaffUser(confirmedUser);
          return editingId
            ? current.map((emp) => emp.id === editingId ? mapped : emp)
            : [mapped, ...current.filter((emp) => emp.id !== mapped.id)];
        });
        closeModal();
      } catch (err) {
        console.error("Ошибка сохранения:", err.response?.data?.detail || err.message);
        setSaveError(toCashierSaveError(err));
      } finally {
        setSaving(false);
        mutationLocks.release("staff-save");
      }
      return;
    }
    const email = form.email.trim();
    const roleKey = form.roleKey || "cashier";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roleOptions.some((option) => option.key === roleKey)) {
      window.alert("Укажите email и допустимую роль сотрудника.");
      mutationLocks.release("staff-save");
      return;
    }
    if ((!editingId || form.password) && (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))) {
      window.alert("Пароль должен содержать минимум 8 символов, букву и цифру.");
      mutationLocks.release("staff-save");
      return;
    }
    if (form.pin && !/^\d{4,8}$/.test(form.pin)) {
      window.alert("PIN должен содержать от 4 до 8 цифр.");
      mutationLocks.release("staff-save");
      return;
    }
    setSaving(true);

    try {
      if (!editingId) {
        const { data: createdUser } = await staffService.createCompanyUser({
          email,
          password: form.password,
          phone: phone || null,
          role_slug: roleKey,
        });
        setEditingId(createdUser.id);
        setStaff((current) => [mapStaffUser(createdUser), ...current.filter((item) => item.id !== createdUser.id)]);
        let newUser = createdUser;
        if (form.fullName.trim() || form.status === "archived") {
          const { data } = await staffService.updateCompanyUser(createdUser.id, {
            name: form.fullName.trim() || undefined,
            is_active: form.status !== "archived",
          });
          newUser = data;
        }
        if (form.pin) {
          await staffService.updateUserPin(createdUser.id, form.pin);
        }
        setStaff((current) => [mapStaffUser(newUser), ...current.filter((item) => item.id !== newUser.id)]);
      } else {
        const { data: updatedUser } = await staffService.updateCompanyUser(editingId, {
          name: form.fullName,
          email,
          password: form.password || undefined,
          phone: phone || null,
          role_slug: roleKey,
          is_active: form.status !== "archived",
        });
        if (form.pin) {
          await staffService.updateUserPin(editingId, form.pin);
        }
        setStaff((current) => current.map((emp) =>
          emp.id === editingId ? mapStaffUser(updatedUser) : emp
        ));
      }
      closeModal();
    } catch (err) {
      console.error("Ошибка сохранения:", err.response?.data?.detail || err.message);
      window.alert(err.response?.data?.detail || "Ошибка сохранения");
    } finally {
      setSaving(false);
      mutationLocks.release("staff-save");
    }
  };

  const archiveStaff = async (id) => {
    const key = `staff-action:${id}`;
    if (!mutationLocks.acquire(key)) return;
    setPendingActionId(String(id));
    try {
      await staffService.deleteCompanyUser(id);
      setStaff((current) => current.map((employee) => (
        employee.id === id ? { ...employee, status: "archived" } : employee
      )));
    } catch (err) {
      window.alert(err.response?.data?.detail || "Не удалось архивировать сотрудника.");
    } finally {
      setPendingActionId("");
      mutationLocks.release(key);
    }
  };

  const restoreStaff = async (id) => {
    const key = `staff-action:${id}`;
    if (!mutationLocks.acquire(key)) return;
    setPendingActionId(String(id));
    try {
      await staffService.updateCompanyUser(id, { is_active: true });
      setStaff((current) => current.map((employee) => (
        employee.id === id ? { ...employee, status: "active" } : employee
      )));
    } catch (err) {
      window.alert(err.response?.data?.detail || "Не удалось восстановить сотрудника.");
    } finally {
      setPendingActionId("");
      mutationLocks.release(key);
    }
  };

  const applyFilters = () => {
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    const resetFilters = {
      query: "",
      roleKey: routeRole === "all" ? "" : routeRole,
      status: "",
    };
    setDraftFilters(resetFilters);
    setFilters(resetFilters);
  };

  return (
    <div className={`staff-page${isCashierView ? " staff-page--cashier" : ""}`}>
      <section className={`staff-card${isCashierView ? " staff-card--cashier" : ""}`}>
        <StaffToolbar
          pageTitle={pageTitle}
          openAddModal={openAddModal}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          draftFilters={draftFilters}
          setDraftFilters={setDraftFilters}
          routeRole={routeRole}
          applyFilters={applyFilters}
          clearFilters={clearFilters}
          hideFilters={isCashierView}
        />

        <StaffTable
          staffLoading={staffLoading}
          staffError={staffError}
          visibleStaff={visibleStaff}
          pendingActionId={pendingActionId}
          openEditModal={openEditModal}
          archiveStaff={archiveStaff}
          restoreStaff={restoreStaff}
          isCashier={isCashierView}
        />
      </section>

      {modalOpen && (
        <StaffFormModal
          editingId={editingId}
          saving={saving}
          closeModal={closeModal}
          saveStaff={saveStaff}
          form={form}
          updateForm={updateForm}
          toggleForm={toggleForm}
          selectPhoneCountry={selectPhoneCountry}
          toggleAccess={toggleAccess}
          handlePhotoChange={handlePhotoChange}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          phoneCountryOpen={phoneCountryOpen}
          setPhoneCountryOpen={setPhoneCountryOpen}
          isCashier={isCashierView}
          closing={modalClosing}
          saveError={saveError}
        />
      )}
    </div>
  );
}

export default StaffRolePage;


