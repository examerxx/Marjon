// Экран входа сотрудников: сетка аватаров.
// Маршрут: /login/staff. ТЗ §3.2.
// Клик по аватару → /login/pin/:employeeId

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchStaffUsers } from "../../api/client";
import Icon from '../../components/Icon';

export default function StaffLoginPage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetchStaffUsers()
      .then((data) => {
        if (!active) return;
        setEmployees(Array.isArray(data) ? data : data?.items || []);
      })
      .catch((e) => {
        if (!active) return;
        setError(e?.response?.data?.detail || "Не удалось загрузить список сотрудников");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  return (
    <main className="staff-login">
      <header className="staff-login__head">
        <Link to="/login" className="staff-login__back">
          <Icon name="bi-arrow-left" size={18} /> Вход по email
        </Link>
        <h1>Выберите сотрудника</h1>
        <p>Нажмите на свой аватар, затем введите PIN-код.</p>
      </header>

      {loading ? (
        <div className="staff-login__state">Загрузка…</div>
      ) : error ? (
        <div className="staff-login__state staff-login__state--error">{error}</div>
      ) : employees.length === 0 ? (
        <div className="staff-login__state">Нет доступных сотрудников</div>
      ) : (
        <div className="staff-login__grid">
          {employees.map((emp) => (
            <button
              key={emp.id}
              type="button"
              className="staff-login__card"
              onClick={() => navigate(`/login/pin/${emp.id}`, { state: { employee: emp } })}
            >
              <div className="staff-login__avatar">
                {emp.photo_url ? (
                  <img src={emp.photo_url} alt={emp.full_name} />
                ) : (
                  <span>{(emp.full_name || "?").trim().charAt(0)}</span>
                )}
              </div>
              <div className="staff-login__name">{emp.full_name}</div>
              <div className="staff-login__role">{emp.role_label || emp.role}</div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
