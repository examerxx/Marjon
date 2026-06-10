import { useEffect, useState } from "react";
import { api, formatMoney } from "../api/client";

export default function StaffPage() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/hr/employees").then(({ data }) => setEmployees(data)).catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить сотрудников."));
  }, []);

  return (
    <section className="card card-pad">
      <div className="section-header"><div><span className="eyebrow">Staff</span><h2>Сотрудники</h2></div></div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive"><table className="data-table"><thead><tr><th>Позиция</th><th>Дата найма</th><th>Тип зарплаты</th><th>Сумма</th></tr></thead><tbody>
        {employees.map((employee) => <tr key={employee.id}><td>{employee.position}</td><td>{employee.hire_date}</td><td>{employee.salary_type}</td><td>{formatMoney(employee.salary_amount)}</td></tr>)}
        {!employees.length ? <tr><td colSpan="4">Сотрудников пока нет.</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
