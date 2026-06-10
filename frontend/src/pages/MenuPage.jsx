import { useEffect, useMemo, useState } from "react";
import { api, formatMoney } from "../api/client";

export default function MenuPage() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get("/inventory/products").then(({ data }) => setProducts(data)).catch((err) => setError(err.response?.data?.detail || "Не удалось загрузить меню."));
  }, []);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter((p) =>
      p.name?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <section className="card card-pad">
      <div className="section-header">
        <div><span className="eyebrow">Menu</span><h2>Меню</h2></div>
        <div className="menu-search">
          <i className="bi bi-search" />
          <input
            type="search"
            placeholder="Поиск по блюдам..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="menu-search__input"
          />
        </div>
      </div>
      {error ? <div className="login-error">{error}</div> : null}
      <div className="table-responsive"><table className="data-table"><thead><tr><th>Блюдо</th><th>Цена</th><th>Ед.</th><th>Доступность</th></tr></thead><tbody>
        {filteredProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><br /><small>{product.description || product.sku || ""}</small></td><td>{formatMoney(product.price)}</td><td>{product.unit}</td><td><span className={`badge ${product.is_available ? "badge-success" : "badge-info"}`}>{product.is_available ? "доступно" : "скрыто"}</span></td></tr>)}
        {!filteredProducts.length && search ? <tr><td colSpan="4">Ничего не найдено по запросу «{search}»</td></tr> : null}
        {!products.length && !search ? <tr><td colSpan="4">Блюд пока нет.</td></tr> : null}
      </tbody></table></div>
    </section>
  );
}
