import { useEffect, useState } from "react";
import { staffService } from "../api/staff";
import ReportEmptyState from "../components/ReportEmptyState";
import staffDefaultAvatar from "../assets/staff/staff-default-avatar.png";
import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

// Ячейка «Сотрудник» в журналах: аватар + имя в одну строку, слева (как в
// реестре). Фото — avatar_url с бэкенда; при отсутствии — дефолтная заглушка.
function JournalNameCell({ name, photo }) {
  return (
    <td className="staff-name-cell">
      <span className="staff-journal-name">
        <img
          className="staff-journal-name__avatar"
          src={photo || staffDefaultAvatar}
          alt=""
          onError={(event) => { event.currentTarget.src = staffDefaultAvatar; }}
        />
        <span className="staff-journal-name__label">{name}</span>
      </span>
    </td>
  );
}

// STAFF-JOURNAL-01: login history (6-col contract) and attendance (8-col
// contract) share the Staff subcategory product shell. Both are read-only
// journals: backend truth only, honest "—" placeholders (BACKEND HANDOFF),
// no fake enrichment, no drawers, no action buttons.
function StaffActivityPage({ type = "login-history" }) {
  const isAttendance = type === "attendance";
  const title = isAttendance ? "Посещаемость" : "История входа";
  const eyebrow = isAttendance ? "Смены сотрудников" : "Безопасность";
  const [loginRows, setLoginRows] = useState([]);
  const [shiftRows, setShiftRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const request = beginRequest();
    setError("");
    setLoading(true);
    staffService.listActivity(type, { signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        if (isAttendance) {
          setShiftRows(items.map((item) => ({
              // BACKEND HANDOFF: open shifts have no end/hours yet — honest "—",
              // never fabricated checkout time or recalculated duration.
              date: item.date || "",
              employee: item.employee_name || item.employee || "",
              photo: item.avatar_url || item.photo || "",
              role: item.role || "",
              start: item.start_time || item.start || "",
              end: item.end_time || item.end || "—",
              hours: item.hours || "—",
              status: item.status || "—",
              // ATT-IP-01: IP устройства, с которого отметили приход/уход.
              // Смены, отмеченные до появления колонки, приходят пустыми —
              // честный «—», адрес не додумываем.
              ip: item.ip || item.ip_address || "—",
            })));
        } else {
          setLoginRows(items.map((item) => {
            // Дата и время входа: truthful composition of backend date +
            // login parts only; nothing manufactured, no timezone conversion.
            const when = [item.date, item.login]
              .map((part) => (part || "").trim())
              .filter(Boolean)
              .join(" ");
            return {
              employee: item.employee || "",
              photo: item.avatar_url || item.photo || "",
              role: item.role || "",
              // Телефон, устройство и IP приходят с бэкенда; где бэкенд ещё не
              // отдаёт поле — честный «—», без выдумывания значений.
              phone: item.phone || "—",
              datetime: when || "—",
              device: item.device || "—",
              ip: item.ip || item.ip_address || "—",
            };
          }));
        }
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        if (isAttendance) setShiftRows([]);
        else setLoginRows([]);
        setError("Не удалось загрузить данные активности сотрудников.");
      })
      .finally(() => { if (request.isCurrent()) setLoading(false); });
  }, [beginRequest, isAttendance, type]);

  const displayLoginRows = loginRows;
  const displayAttendanceRows = shiftRows;

  return (
    // Both journals use the Staff subcategory product shell (same classes as
    // Официант et al): title + table only, no action buttons.
    <div className="staff-page staff-page--cashier">
      <section className="staff-card staff-card--cashier">
        <header className="staff-header staff-header--cashier">
          <div className="staff-header__title">
            <span className="staff-header__accent" aria-hidden="true" />
            <div>
              <p className="staff-header__eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
          </div>
        </header>

        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <div className="staff-table-wrapper">
          {isAttendance ? (
            <table className="staff-table staff-table--attendance">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Дата</th>
                  <th>Время прихода</th>
                  <th>Время ухода</th>
                  <th>Отработано</th>
                  <th>Статус</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {displayAttendanceRows.map((row, index) => (
                  <tr key={`${row.employee}-${row.date}-${row.start}-${index}`}>
                    <JournalNameCell name={row.employee} photo={row.photo} />
                    <td>
                      <span className="staff-role-badge">{row.role}</span>
                    </td>
                    <td>{row.date}</td>
                    <td>{row.start}</td>
                    <td>{row.end}</td>
                    <td>{row.hours}</td>
                    <td>{row.status}</td>
                    <td className="staff-ip-cell">{row.ip}</td>
                  </tr>
                ))}
                {!loading && !error && !displayAttendanceRows.length ? (
                  <tr className="staff-empty-row">
                    <td colSpan={8} className="staff-empty-cell">
                      <ReportEmptyState title="Данных о посещаемости пока нет." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <table className="staff-table staff-table--login-history">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Роль</th>
                  <th>Телефон</th>
                  <th>Дата и время входа</th>
                  <th>Устройство</th>
                  <th>IP устройство</th>
                </tr>
              </thead>
              <tbody>
                {displayLoginRows.map((row, index) => (
                  <tr key={`${row.employee}-${row.datetime}-${index}`}>
                    <JournalNameCell name={row.employee} photo={row.photo} />
                    <td>
                      <span className="staff-role-badge">{row.role}</span>
                    </td>
                    <td>{row.phone}</td>
                    <td>{row.datetime}</td>
                    <td>{row.device}</td>
                    <td>{row.ip}</td>
                  </tr>
                ))}
                {!loading && !error && !displayLoginRows.length ? (
                  <tr className="staff-empty-row">
                    <td colSpan={6} className="staff-empty-cell">
                      <ReportEmptyState title="Истории входов пока нет." />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
        {/* Индикатор загрузки — ПОД таблицей (а не над ней), чтобы шапка
            таблицы была видна сразу, а «Загрузка…» не выталкивала её вниз. */}
        {loading && !error ? (
          <div className="staff-empty-cell" role="status">
            {isAttendance ? "Загрузка посещаемости..." : "Загрузка истории входов..."}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default StaffActivityPage;
