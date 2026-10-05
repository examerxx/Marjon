import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import staffDefaultAvatar from "../../assets/staff/staff-default-avatar.png";
import { getPermissionSummary, roleMap, shortStaffId } from "./staffConstants";
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
  // WAITER-01: waiter reuses exact cashier presentation (avatar/status/alignment).
  isWaiter = false,
  // MONOBLOCK-01: monoblock reuses the same product presentation; its
  // access cell stays the generic summary (no persisted grants on record).
  isMonoblock = false,
  // MANAGER-STOREKEEPER-01: manager/warehouse reuse the product presentation
  // but drop the access column entirely (7 columns, no invisible placeholder).
  isManager = false,
  isWarehouse = false,
}) {
  const isProduct = isCashier || isWaiter || isMonoblock || isManager || isWarehouse;
  const showAccess = !(isManager || isWarehouse);
  return (
    <>
      {staffError ? <div className="login-error" role="alert">{staffError}</div> : null}
      <div className="staff-table-wrapper staff-table-wrapper--roles">
        <div className="staff-role-table-scroll">
        <table className={`staff-table${showAccess ? "" : " staff-table--no-access"}`}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Фото</th>
              <th>ФИО</th>
              <th>Номер телефона</th>
              <th>Роль</th>
              {showAccess ? <th>Права доступа</th> : null}
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.map((employee) => (
              <tr key={employee.id}>
                <td>{shortStaffId(employee.id)}</td>
                <td>
                  <div className="staff-avatar">
                    {employee.photo ? (
                      <img src={employee.photo} alt={employee.fullName} />
                    ) : isProduct ? (
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
                {showAccess ? (
                <td>
                  {isWaiter ? (
                    // WAITER access column shows ONLY delete-dishes truth.
                    // Backend stores no per-waiter permission flags
                    // (FRONTEND_ONLY, handoff required), so no grant is ever
                    // on record: red OFF indicator + fixed label, never
                    // fabricated "Базовый доступ", never green.
                    <span className="staff-permission">
                      <span className="staff-permission-dot is-off" aria-hidden="true" />
                      Удаление блюд
                    </span>
                  ) : isCashier ? (
                    // CASHIER access column: delete-dishes truth via the
                    // shared adapter (employee.canDeleteDishes). Backend
                    // persists no grant yet, so red OFF unless a truthful
                    // grant arrives; never fabricated "Базовый доступ".
                    <span className="staff-permission">
                      <span
                        className={`staff-permission-dot${employee.canDeleteDishes ? "" : " is-off"}`}
                        aria-hidden="true"
                      />
                      Удаление блюд
                    </span>
                  ) : isMonoblock ? (
                    // MONOBLOCK access cell ("Показать кассиров" concept).
                    // Backend persists no cashier-list/printer truth yet, so
                    // the indicator is red OFF unless a truthful grant arrives
                    // via employee.canSeeCashiers; printer IP renders only
                    // from truthful row data, never fabricated.
                    <span className="staff-permission staff-permission--column">
                      <span className="staff-permission-main">
                        <span
                          className={`staff-permission-dot${employee.canSeeCashiers ? "" : " is-off"}`}
                          aria-hidden="true"
                        />
                        Показать кассиров
                      </span>
                      {employee.printerIp ? (
                        <small className="staff-permission-sub">{employee.printerIp}</small>
                      ) : null}
                    </span>
                  ) : (
                    <span className="staff-permission">
                      <span className="staff-permission-dot" aria-hidden="true" />
                      {getPermissionSummary(employee)}
                    </span>
                  )}
                </td>
                ) : null}
                <td>
                  {isProduct ? (
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
              <tr className="staff-empty-row">
                <td colSpan={showAccess ? 8 : 7} className="staff-empty-cell">
                  {/* Reports parity: same PNG illustration + centered message. */}
                  <ReportEmptyState title="Сотрудники не найдены" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      {/* Индикатор загрузки — ПОД таблицей (а не над ней), как и статусы/пустое
          состояние, чтобы шапка таблицы была видна сразу, а «Загрузка…» не
          выталкивала её вниз. */}
      {staffLoading ? <div className="staff-empty-cell" role="status">Загрузка сотрудников...</div> : null}
    </>
  );
}
