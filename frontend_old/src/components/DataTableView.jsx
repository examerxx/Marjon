import { TableLoader } from "./Loader";

export default function DataTableView({
  columns = [],
  rows = [],
  loading = false,
  error = "",
  emptyText = "Нет данных для отображения.",
}) {
  const colCount = columns.length || 1;

  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {error ? (
            <tr><td colSpan={colCount}>{error}</td></tr>
          ) : loading ? (
            <TableLoader colSpan={colCount} />
          ) : rows.length ? (
            rows.map((row, index) => (
              <tr key={row.id ?? index}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render ? col.render(row, index) : row[col.key]}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr><td colSpan={colCount}>{emptyText}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
