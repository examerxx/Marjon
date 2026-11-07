// Экран входа сотрудников: сетка аватаров.
// Маршрут: /login/staff. ТЗ §3.2.
// Клик по аватару → /login/pin/:employeeId

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchStaffUsers } from "../../api/client";
import Icon from '../../components/Icon';
import { t } from "../../i18n/t";

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
          <Icon name="bi-arrow-left" size={18} /> {t("pages.auth.staffloginpage.vhod_po_email")}
        </Link>
        <h1>{t("pages.auth.staffloginpage.vyberite_sotrudnika")}</h1>
        <p>{t("pages.auth.staffloginpage.nazhmite_na_svoy_avatar_zatem_vvedite_pin_kod")}</p>
      </header>

      {loading ? (
        <div className="staff-login__state">{t("pages.auth.staffloginpage.zagruzka")}</div>
      ) : error ? (
        <div className="staff-login__state staff-login__state--error">{error}</div>
      ) : employees.length === 0 ? (
        <div className="staff-login__state">{t("pages.auth.staffloginpage.net_dostupnyh_sotrudnikov")}</div>
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
