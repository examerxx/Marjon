import { useEffect, useState } from "react";
import { api } from "../api/client";
import Icon from "../components/Icon";
import { exportToExcel } from "../utils/excel";

function StaffActivityPage({ type = "login-history" }) {
  const isAttendance = type === "attendance";
  const title = isAttendance ? "Посещаемость" : "История входа";
  const eyebrow = isAttendance ? "Смены сотрудников" : "Безопасность";
  const [loginRows, setLoginRows] = useState([]);
  const [shiftRows, setShiftRows] = useState([]);

  useEffect(() => {
    const endpoint = isAttendance ? "/hr/attendance" : "/hr/login-history";
    api.get(endpoint)
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        if (isAttendance) {
          setShiftRows(items.map((item) => ({
              date: item.date || "",
              employee: item.employee_name || item.employee || "",
              role: item.role || "",
              start: item.start_time || item.start || "",
              end: item.end_time || item.end || "",
              hours: item.hours || "",
              status: item.status || "Закрыта",
            })));
        } else {
          setLoginRows(items.map((item) => ({
              date: item.date || "",
              employee: item.employee_name || item.employee || "",
              role: item.role || "",
              device: item.device || `${item.ip || ""} / ${item.device_name || ""}`,
              login: item.login_time || item.login || "",
              logout: item.logout_time || item.logout || "",
              status: item.status || "Успешно",
            })));
        }
      })
      .catch(() => {
        if (isAttendance) setShiftRows([]);
        else setLoginRows([]);
      });
  }, [isAttendance]);

  const displayLoginRows = loginRows;
  const displayAttendanceRows = shiftRows;

  return (
    <div className="staff-page">
      <section className="staff-card">
        <header className="staff-header">
          <div className="staff-header__title">
            <span className="staff-header__accent" aria-hidden="true" />
            <div>
              <p className="staff-header__eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
          </div>
          <button
            className="staff-add-button staff-add-button--ghost"
            type="button"
            onClick={() => {
              if (isAttendance) {
                exportToExcel(displayAttendanceRows, [
                  { key: "date", label: "Дата" },
                  { key: "employee", label: "Сотрудник" },
                  { key: "role", label: "Роль" },
                  { key: "start", label: "Начало смены" },
                  { key: "end", label: "Конец смены" },
                  { key: "hours", label: "Часы" },
                  { key: "status", label: "Статус" },
                ], "staff-attendance");
              } else {
                exportToExcel(displayLoginRows, [
                  { key: "date", label: "Дата" },
                  { key: "employee", label: "Сотрудник" },
                  { key: "role", label: "Роль" },
                  { key: "device", label: "Устройство" },
                  { key: "login", label: "Вход" },
                  { key: "logout", label: "Выход" },
                  { key: "status", label: "Статус" },
                ], "staff-login-history");
              }
            }}
          >
            <Icon name="bi-file-earmark-spreadsheet" size={18} />
            Скачать Excel
          </button>
        </header>

        <div className="staff-table-wrapper">
          {isAttendance ? (
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Начало смены</th>
                  <th>Конец смены</th>
                  <th>Отработано часов</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {displayAttendanceRows.map((row) => (
                  <tr key={`${row.date}-${row.employee}`}>
                    <td>{row.date}</td>
                    <td className="staff-name-cell">{row.employee}</td>
                    <td>
                      <span className="staff-role-badge">{row.role}</span>
                    </td>
                    <td>{row.start}</td>
                    <td>{row.end}</td>
                    <td>{row.hours}</td>
                    <td>
                      <span className="staff-status-badge">{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>IP / устройство</th>
                  <th>Время входа</th>
                  <th>Время выхода</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {displayLoginRows.map((row) => (
                  <tr key={`${row.date}-${row.employee}-${row.login}`}>
                    <td>{row.date}</td>
                    <td className="staff-name-cell">{row.employee}</td>
                    <td>
                      <span className="staff-role-badge">{row.role}</span>
                    </td>
                    <td>{row.device}</td>
                    <td>{row.login}</td>
                    <td>{row.logout}</td>
                    <td>
                      <span className="staff-status-badge">{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export default StaffActivityPage;
