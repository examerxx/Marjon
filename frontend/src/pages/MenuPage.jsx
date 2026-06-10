import { useEffect, useState } from "react";
import { api, formatMoney } from "../api/client";

export default function MenuPage() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/inventory/products").then(({ data }) => setProducts(data)).catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить меню."));
  }, []);

  return (
    <section className="card card-pad">
      <div className="section-header"><div><span className="eyebrow">Menu</span><h2>Меню</h2></div></div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive"><table className="data-table"><thead><tr><th>Блюдо</th><th>Цена</th><th>Ед.</th><th>Доступность</th></tr></thead><tbody>
        {products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><br /><small>{product.description || product.sku || ""}</small></td><td>{formatMoney(product.price)}</td><td>{product.unit}</td><td><span className={`badge ${product.is_available ? "badge-success" : "badge-info"}`}>{product.is_available ? "доступно" : "скрыто"}</span></td></tr>)}
        {!products.length ? <tr><td colSpan="4">Блюд пока нет.</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
