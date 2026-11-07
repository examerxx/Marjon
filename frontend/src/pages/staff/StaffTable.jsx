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
  // KITCHEN-01: повар — та же продуктовая презентация (аватар-заглушка,
  // статус «Активен/Неактивен», колонка прав). Раньше кухня рисовала легаси-
  // таблицу с инициалами и «#активно/#архив».
  isKitchen = false,
  // Принтеры компании — чтобы в строке показать закреплённый принтер
  // (в строке лежит только printer_id).
  printers = [],
}) {
  const isProduct = isCashier || isWaiter || isMonoblock || isManager || isWarehouse || isKitchen;
  const showAccess = !(isManager || isWarehouse);
  // STAFF-PRINTER-SCOPE-02: привязка принтера — свойство самой записи, а не
  // грант «Показать кассиров»: раньше имя рисовалось только в ветке моноблока
  // (то есть под чужим тумблером), а у кассира/официанта с привязкой подписи
  // не было вовсе. Теперь имя живёт в ячейке роли — для любой роли.
  // Если привязка есть, а имени в справочнике нет (принтер удалён или
  // неактивен и отфильтрован), подпись не рисуем: слово-заглушка «Принтер»
  // именем не является и только врёт о содержимом привязки.
  const resolvePrinterName = (printerId) => {
    if (!printerId) return "";
    const match = printers.find((printer) => String(printer.id) === String(printerId));
    return match?.name || "";
  };
  return (
    <>
      {/* Ошибка загрузки рендерится ровно один раз — под таблицей (см. ниже).
          Раньше тот же текст дублировался ещё и над таблицей (.login-error),
          из-за чего role="alert" срабатывал дважды и скринридер читал
          сообщение повторно. */}
      <div className="staff-table-wrapper staff-table-wrapper--roles">
        <div className="staff-role-table-scroll" role="region" aria-label="Таблица сотрудников с прокруткой" tabIndex={0}>
        <table className={`staff-table${showAccess ? "" : " staff-table--no-access"}`}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Фото</th>
              <th>ФИО</th>
              <th>Логин</th>
              <th>Роль</th>
              {showAccess ? <th>Права доступа</th> : null}
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleStaff.map((employee) => {
              const printerName = resolvePrinterName(employee.printerId);
              return (
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
                    <span className="staff-role-cell">
                      <span className="staff-role-badge">
                        {roleMap[employee.roleKey]?.label || employee.roleKey}
                      </span>
                      {printerName ? (
                        <small className="staff-printer-name" title={`Принтер: ${printerName}`}>
                          {printerName}
                        </small>
                      ) : null}
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
                      // Backend persists no cashier-list grant yet, so the
                      // indicator is red OFF unless a truthful grant arrives
                      // via employee.canSeeCashiers. Привязанный принтер здесь
                      // больше не рисуется — он не часть этого гранта, см.
                      // ячейку роли (STAFF-PRINTER-SCOPE-02).
                      <span className="staff-permission staff-permission--column">
                        <span className="staff-permission-main">
                          <span
                            className={`staff-permission-dot${employee.canSeeCashiers ? "" : " is-off"}`}
                            aria-hidden="true"
                          />
                          Показать кассиров
                        </span>
                      </span>
                    ) : isKitchen ? (
                      // KITCHEN-01: у повара предметный грант один — печать на
                      // принтер повара (can_cook_printer). Остальные права
                      // кухни живут в словаре permissions и в колонке не
                      // размазываются, иначе ячейка превращается в список.
                      <span className="staff-permission staff-permission--column">
                        <span className="staff-permission-main">
                          <span
                            className={`staff-permission-dot${employee.canCookPrinter ? "" : " is-off"}`}
                            aria-hidden="true"
                          />
                          Принтер повара
                        </span>
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
              );
            })}
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
      {/* Ошибка загрузки — иначе при сбое /auth/users экран оставался
          полностью пустым (ни таблицы, ни пустого состояния, ни текста):
          «висит Загрузка → ничего». Теперь показываем причину и даём
          пользователю понять, что это сбой, а не пустой список. */}
      {!staffLoading && staffError ? (
        <div className="staff-empty-cell" role="alert">{staffError}</div>
      ) : null}
    </>
  );
}
