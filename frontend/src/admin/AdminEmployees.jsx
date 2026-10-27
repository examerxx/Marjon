import { t } from "../i18n/t";
export function AdminEmployeesPage() {
  return (
    <section className="admin-employee-page">
      <div className="admin-data-state" role="status">
       {t("admin.adminemployees.spisok_sotrudnikov_nedostupen_backend_contract_ne")}
      </div>
    </section>
  );
}
