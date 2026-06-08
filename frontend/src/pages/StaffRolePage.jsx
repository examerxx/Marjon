import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

const roleConfigs = {
  cashier: {
    title: "Кассир",
    subtitle: "Кассовые смены, доступы и операции кассира.",
    roleLabel: "Кассир",
    roleKey: "cashier",
    accent: "bi-cash-coin",
  },
  waiter: {
    title: "Официант",
    subtitle: "Официанты зала, зоны обслуживания и заказы.",
    roleLabel: "Официант",
    roleKey: "waiter",
    accent: "bi-person",
  },
  monoblock: {
    title: "Моноблок",
    subtitle: "Рабочие места, терминалы и устройства обслуживания.",
    roleLabel: "Моноблок",
    roleKey: "monoblock",
    accent: "bi-pc-display",
  },
  kitchen: {
    title: "Кухня",
    subtitle: "Кухонная команда, KDS и станции приготовления.",
    roleLabel: "Кухня",
    roleKey: "kitchen",
    accent: "bi-display",
  },
  manager: {
    title: "Менеджер",
    subtitle: "Менеджеры, управленческий доступ и контроль смены.",
    roleLabel: "Менеджер",
    roleKey: "manager",
    accent: "bi-shield-lock",
  },
  all: {
    title: "Все сотрудники",
    subtitle: "Единый список сотрудников ресторана.",
    roleLabel: "Сотрудник",
    roleKey: "all",
    accent: "bi-people",
  },
};

const demoEmployees = [
  { id: 5439, full_name: "SARDORKASSA", phone: "998770702103", role: "Кассир", access: "Удаление блюд", status: "active", photo: "" },
  { id: 5440, full_name: "КАССА 2", phone: "998770702102", role: "Кассир", access: "Возвраты и оплата", status: "active", photo: "" },
  { id: 15349, full_name: "Khusniddin Khusanboyev", phone: "998882229904", role: "Кассир", access: "Удаление блюд", status: "active", photo: "" },
  { id: 8711, full_name: "Azizbek", phone: "998901112233", role: "Официант", access: "Заказы зала", status: "active", photo: "" },
  { id: 9012, full_name: "Kitchen station", phone: "998901234567", role: "Кухня", access: "KDS", status: "active", photo: "" },
  { id: 7112, full_name: "Manager", phone: "998909998877", role: "Менеджер", access: "Управление сменой", status: "active", photo: "" },
];

const emptyForm = {
  full_name: "",
  phone: "",
  access: "",
  role: "",
  photo: "",
};

const STAFF_STORAGE_KEY = "marjon_staff_employees";

function readStoredEmployees() {
  try {
    const stored = localStorage.getItem(STAFF_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function storeEmployees(employees) {
  localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(employees));
}

function normalizeEmployee(employee, index) {
  return {
    id: employee.id || 9000 + index,
    full_name: employee.full_name || employee.name || employee.position || "Сотрудник",
    phone: employee.phone || employee.phone_number || "998901234567",
    role: employee.role || employee.position || "Сотрудник",
    access: employee.access || employee.permissions || "Базовый доступ",
    status: employee.status || "active",
    photo: employee.photo || employee.avatar || "",
  };
}

function matchesRole(employee, config) {
  if (config.roleKey === "all") return true;
  return String(employee.role || "").toLowerCase().includes(config.roleLabel.toLowerCase());
}

export default function StaffRolePage({ role = "all" }) {
  const config = roleConfigs[role] || roleConfigs.all;
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState("active");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...emptyForm, role: config.roleKey === "all" ? "Кассир" : config.roleLabel });

  useEffect(() => {
    let mounted = true;
    const stored = readStoredEmployees();
    if (stored.length) {
      setEmployees(stored);
      return () => { mounted = false; };
    }

    api.get("/hr/employees")
      .then(({ data }) => {
        if (!mounted) return;
        const normalized = Array.isArray(data) ? data.map(normalizeEmployee) : [];
        setEmployees(normalized.length ? normalized : demoEmployees);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.detail || "Backend сотрудников пока недоступен. Данные и действия работают локально в демо-режиме.");
        setEmployees(demoEmployees);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (employees.length) storeEmployees(employees);
  }, [employees]);

  useEffect(() => {
    if (!editingId) {
      setForm((current) => ({ ...current, role: config.roleKey === "all" ? current.role || "Кассир" : config.roleLabel }));
    }
  }, [config.roleKey, config.roleLabel, editingId]);

  const roleEmployees = useMemo(() => employees.filter((employee) => matchesRole(employee, config)), [employees, config]);
  const visibleEmployees = useMemo(() => roleEmployees.filter((employee) => employee.status === activeTab), [roleEmployees, activeTab]);
  const activeCount = roleEmployees.filter((employee) => employee.status === "active").length;
  const archiveCount = roleEmployees.filter((employee) => employee.status === "archived").length;

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm, role: config.roleKey === "all" ? "Кассир" : config.roleLabel });
  }

  function toggleForm() {
    if (showForm) resetForm();
    setShowForm((value) => !value);
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handlePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, photo: String(reader.result || "") }));
    reader.readAsDataURL(file);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const name = form.full_name.trim();
    if (!name) return;

    if (editingId) {
      setEmployees((current) => current.map((employee) => (
        employee.id === editingId
          ? { ...employee, ...form, full_name: name, phone: form.phone.trim() || employee.phone, access: form.access.trim() || employee.access }
          : employee
      )));
    } else {
      setEmployees((current) => [
        {
          id: Date.now(),
          full_name: name,
          phone: form.phone.trim() || "998000000000",
          role: form.role || config.roleLabel,
          access: form.access.trim() || "Базовый доступ",
          status: "active",
          photo: form.photo,
        },
        ...current,
      ]);
    }

    resetForm();
    setShowForm(false);
    setActiveTab("active");
  }

  function editEmployee(employee) {
    setEditingId(employee.id);
    setForm({
      full_name: employee.full_name,
      phone: employee.phone,
      access: employee.access,
      role: employee.role,
      photo: employee.photo || "",
    });
    setShowForm(true);
  }

  function toggleArchive(employee) {
    setEmployees((current) => current.map((item) => (
      item.id === employee.id ? { ...item, status: item.status === "active" ? "archived" : "active" } : item
    )));
  }

  function deleteEmployee(employeeId) {
    setEmployees((current) => current.filter((employee) => employee.id !== employeeId));
  }

  return (
    <section className="staff-manager staff-manager--next card card-pad">
      <div className="staff-manager__hero staff-manager__hero--next">
        <div className="staff-manager__title">
          <span className="eyebrow">Сотрудники</span>
          <h2>{config.title}</h2>
          <p>{config.subtitle}</p>
        </div>
        <button className="staff-manager__add" type="button" onClick={toggleForm}>
          <span>{showForm ? "Закрыть" : "Добавить"}</span>
          <i className={`bi ${showForm ? "bi-x-lg" : "bi-plus-lg"}`} />
        </button>
      </div>

      {error ? <div className="message message-info">{error}</div> : null}

      <div className="staff-manager__stats staff-manager__stats--next">
        <div><i className={`bi ${config.accent}`} /><span>Всего</span><strong>{roleEmployees.length}</strong></div>
        <div><i className="bi bi-check2-circle" /><span>Активные</span><strong>{activeCount}</strong></div>
        <div><i className="bi bi-archive" /><span>Архив</span><strong>{archiveCount}</strong></div>
      </div>

      {showForm ? (
        <form className="staff-manager__form staff-manager__form--next" onSubmit={handleSubmit}>
          <label className="staff-manager__photo-upload">
            <input type="file" accept="image/*" onChange={handlePhoto} />
            <span>{form.photo ? <img src={form.photo} alt="Фото сотрудника" /> : <i className="bi bi-camera" />}</span>
            <em>Фото</em>
          </label>
          <label>
            <span>ФИО</span>
            <input name="full_name" value={form.full_name} onChange={handleChange} placeholder="Например: Sardor Kassa" />
          </label>
          <label>
            <span>Номер телефона</span>
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="998901234567" />
          </label>
          {config.roleKey === "all" ? (
            <label>
              <span>Роль</span>
              <select name="role" value={form.role} onChange={handleChange}>
                {Object.values(roleConfigs).filter((item) => item.roleKey !== "all").map((item) => <option key={item.roleKey}>{item.roleLabel}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>Доступ</span>
            <input name="access" value={form.access} onChange={handleChange} placeholder="Например: Удаление блюд" />
          </label>
          <button type="submit">{editingId ? "Сохранить изменения" : "Добавить сотрудника"}</button>
        </form>
      ) : null}

      <div className="staff-manager__toolbar">
        <div className="staff-manager__tabs">
          <button className={activeTab === "active" ? "is-active" : ""} type="button" onClick={() => setActiveTab("active")}><i className="bi bi-check2" /> Активные</button>
          <button className={activeTab === "archived" ? "is-active" : ""} type="button" onClick={() => setActiveTab("archived")}><i className="bi bi-archive" /> Архивированные</button>
        </div>
        <span className="staff-manager__hint">Все действия пока сохраняются локально до подключения backend POST.</span>
      </div>

      <div className="staff-manager__table-wrap staff-manager__table-wrap--next">
        <table className="staff-manager__table staff-manager__table--next">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Телефон</th>
              <th>Роль</th>
              <th>Доступ</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmployees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <div className="staff-manager__person">
                    <span className="staff-manager__avatar">{employee.photo ? <img src={employee.photo} alt={employee.full_name} /> : <i className="bi bi-person" />}</span>
                    <div><strong>{employee.full_name}</strong><small>ID {employee.id}</small></div>
                  </div>
                </td>
                <td>{employee.phone}</td>
                <td><span className="staff-manager__role">{employee.role}</span></td>
                <td><span className="staff-manager__access-dot" /> {employee.access}</td>
                <td><span className={`staff-manager__status ${employee.status === "archived" ? "is-archived" : ""}`}>{employee.status === "active" ? "#активно" : "#архив"}</span></td>
                <td>
                  <div className="staff-manager__actions">
                    <button type="button" onClick={() => editEmployee(employee)} aria-label="Редактировать"><i className="bi bi-pencil" /></button>
                    <button type="button" onClick={() => toggleArchive(employee)} aria-label="Архив"><i className={`bi ${employee.status === "active" ? "bi-archive" : "bi-arrow-counterclockwise"}`} /></button>
                    <button type="button" onClick={() => deleteEmployee(employee.id)} aria-label="Удалить"><i className="bi bi-trash3" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!visibleEmployees.length ? (
              <tr><td colSpan="6">В этом списке пока нет сотрудников.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
