import Icon from "../../components/Icon";
import staffDefaultAvatar from "../../assets/staff/staff-default-avatar.png";
import { getPermissionSummary, roleMap } from "./staffConstants";
import { formatPhone, inferPhoneCountry } from "./staffPhone";

// Индикаторы загрузки/ошибки и таблица сотрудников OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Разметка, классы и текст сохранены 1:1;
// данные и обработчики действий принадлежат оркестратору и приходят пропсами.
// Cashier получает presentation-фолбэк staff-default-avatar.png вместо инициалов;
// остальные роли сохраняют инициалы.
export default function StaffTable({
  staffLoading,
  staffError,
  visibleStaff,
  pendingActionId,
  openEditModal,
  archiveStaff,
  restoreStaff,
  isCashier = false,
}) {
  return (
    <>
      {staffLoading ? <div className="staff-empty-cell" role="status">Загрузка сотрудников...</div> : null}
      {staffError ? <div className="login-error" role="alert">{staffError}</div> : null}
      <div className="staff-table-wrapper">
        <table className="staff-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Фото</th>
              <th>ФИО</th>
              <th>Номер телефона</th>
              <th>Роль</th>
              <th>Права доступа</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.map((employee) => (
              <tr key={employee.id}>
                <td>{employee.id}</td>
                <td>
                  <div className="staff-avatar">
                    {employee.photo ? (
                      <img src={employee.photo} alt={employee.fullName} />
                    ) : isCashier ? (
                      <img src={staffDefaultAvatar} alt={employee.fullName} />
                    ) : (
                      <span>{employee.fullName.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                </td>
                <td className="staff-name-cell">{employee.fullName}</td>
                <td>{formatPhone(employee.phone, employee.phoneCountry || inferPhoneCountry(employee.phone))}</td>
                <td>
                  <span className="staff-role-badge">
                    {roleMap[employee.roleKey]?.label || employee.roleKey}
                  </span>
                </td>
                <td>
                  <span className="staff-permission">
                    <span className="staff-permission-dot" aria-hidden="true" />
                    {getPermissionSummary(employee)}
                  </span>
                </td>
                <td>
                  {isCashier ? (
                    <span
                      className={`staff-status-badge ${
                        employee.status === "archived" ? "is-archived" : ""
                      }`}
                    >
                      <span className="staff-status-badge__dot" aria-hidden="true" />
                      {employee.status === "archived" ? "Неактивен" : "Активен"}
                    </span>
                  ) : (
                    <span
                      className={`staff-status-badge ${
                        employee.status === "archived" ? "is-archived" : ""
                      }`}
                    >
                      {employee.status === "archived" ? "#архив" : "#активно"}
                    </span>
                  )}
                </td>
                <td>
                  <div className="staff-actions">
                    <button
                      type="button"
                      className="edit-action-button"
                      onClick={() => openEditModal(employee)}
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Icon name="bi-pencil" size={15} />
                    </button>
                    {employee.status === "archived" ? (
                      <button
                        type="button"
                        disabled={pendingActionId === String(employee.id)}
                        className="staff-restore-action"
                        onClick={() => restoreStaff(employee.id)}
                        aria-label="Restore"
                        title="Restore"
                      >
                        <Icon name="bi-recycle" size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingActionId === String(employee.id)}
                        className="staff-delete-action"
                        onClick={() => archiveStaff(employee.id)}
                        aria-label="Archive"
                        title="Archive"
                      >
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!staffLoading && !staffError && visibleStaff.length === 0 && (
              <tr>
                <td colSpan={8} className="staff-empty-cell">
                  Сотрудники не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}