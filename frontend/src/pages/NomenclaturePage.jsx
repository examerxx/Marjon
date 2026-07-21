import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import Icon from "../components/Icon";

const ACTIVE = "Активно";
const ARCHIVED = "Архив";

const dishColumnOptions = [
  { key: "photo", label: "Фото", width: 74 },
  { key: "name", label: "Название", width: 184 },
  { key: "type", label: "Тип", width: 118 },
  { key: "unit", label: "Ед. изм", width: 82 },
  { key: "cost", label: "Себестоимость", width: 132 },
  { key: "price", label: "Цена", width: 112 },
  { key: "menu", label: "Меню", width: 146 },
  { key: "printer", label: "Принтер", width: 162 },
  { key: "recipe", label: "Рецепты", width: 134 },
  { key: "stock", label: "Остаток", width: 116 },
  { key: "auto", label: "Авто", width: 70 },
  { key: "set", label: "Сет", width: 70 },
  { key: "sort", label: "Сорт", width: 78 },
  { key: "actions", label: "Действия", width: 104 },
];

const defaultDishColumnVisibility = Object.fromEntries(dishColumnOptions.map((column) => [column.key, true]));

const photoLibrary = {
  cola: [
    "https://images.unsplash.com/photo-1629203851122-3726ecdf080e?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1581636625402-29b2a704ef13?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=260&q=80",
  ],
  plov: [
    "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1617692855027-33b14f061079?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=260&q=80",
  ],
  mastava: [
    "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1604152135912-04a022e23696?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1594756202469-9ff9799b2e4e?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1603105037880-880cd4edfb0d?auto=format&fit=crop&w=260&q=80",
  ],
  lagman: [
    "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1626804475297-41608ea09aeb?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1516684669134-de6f7c473a2a?auto=format&fit=crop&w=260&q=80",
  ],
  drinks: [
    "https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1570598912132-0ba1dc952b7d?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=260&q=80",
  ],
  dishes: [
    "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=260&q=80",
    "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=260&q=80",
  ],
};

const fallbackConfigs = {
  raw: {
    title: "Сырьё",
    action: "Добавить +",
    columns: ["Название", "Категория", "Подкатегория", "Ед. изм", "Остаток", "Мин. остаток", "Цена закупки", "Поставщик", "Статус", "Действия"],
    rows: [],
  },
  semi: {
    title: "Полуфабрикаты",
    action: "Добавить +",
    columns: ["Название", "Категория", "Ед. изм", "Себестоимость", "Состав", "Статус", "Действия"],
    rows: [],
  },
};

function NomenclaturePage({ type = "dishes" }) {
  if (type === "dishes") return <DishesCatalogPage />;
  return <SimpleNomenclaturePage key={type} config={fallbackConfigs[type] || fallbackConfigs.raw} />;
}

function matchesDishStatFilter(row, filterKey) {
  switch (filterKey) {
    case "blue:0":
      return row.auto === null;
    case "blue:1":
      return row.auto !== null;
    case "green:0":
      return !String(row.recipe || "").includes("(0");
    case "green:1":
      return String(row.recipe || "").includes("(0");
    case "cyan:0":
      return false;
    case "cyan:1":
      return true;
    case "orange:0":
      return row.cost !== "0 UZS";
    case "orange:1":
      return row.cost === "0 UZS";
    case "violet:0":
      return Boolean(row.printer);
    case "violet:1":
      return !row.printer;
    default:
      return true;
  }
}

function DishesCatalogPage() {
  const [rows, setRows] = useState([]);
  const [apiLoading, setApiLoading] = useState(true);
  const [draftFilters, setDraftFilters] = useState({ search: "", chef: "", category: "" });
  const [filters, setFilters] = useState(draftFilters);
  const [statFilter, setStatFilter] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [photoPicker, setPhotoPicker] = useState(null);
  const [photoSearch, setPhotoSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", sort: "1", type: "Блюда", unit: "шт", cost: "0 UZS", price: "", menu: "", printer: "", recipe: "Рецепт (0 шт)", stock: "-", auto: false, set: false, category: "", chef: "" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultDishColumnVisibility);

  const visibleColumnKeys = useMemo(
    () => dishColumnOptions.filter((column) => visibleColumns[column.key] !== false).map((column) => column.key),
    [visibleColumns],
  );
  const tableMinWidth = useMemo(() => {
    const width = dishColumnOptions.reduce((sum, column) => (
      visibleColumns[column.key] !== false ? sum + column.width : sum
    ), 0);
    return Math.max(760, width);
  }, [visibleColumns]);
  const visibleColumnCount = visibleColumnKeys.length;
  const isColumnVisible = (key) => visibleColumns[key] !== false;
  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const checked = current[key] !== false;
      if (checked && visibleColumnCount <= 1) return current;
      return { ...current, [key]: !checked };
    });
  };

  useEffect(() => {
    setApiLoading(true);
    api.get("/inventory/products")
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        setRows(items.map((item) => ({
            id: item.id,
            name: item.name || "",
            sort: String(item.sort_order ?? "1"),
            type: item.product_type === "sale" ? "Реализация" : "Блюда",
            unit: item.unit || "шт",
            cost: item.cost_price ? `${Number(item.cost_price).toLocaleString("ru-RU")} UZS` : "0 UZS",
            price: String(item.price || "0"),
            menu: item.category_name || item.menu || "",
            printer: item.printer_name || "",
            recipe: `Рецепт (${item.ingredients_count ?? 0} шт)`,
            stock: item.stock !== undefined ? String(item.stock) : "-",
            auto: item.auto_write_off ?? false,
            set: item.is_set ?? false,
            category: item.category_name || "",
            chef: item.station || "",
            photo: item.image_url || "",
          })));
      })
      .catch(() => setRows([]))
      .finally(() => setApiLoading(false));
  }, []);

  const computedStats = useMemo(() => {
    const total = rows.length;
    const dishes = rows.filter((r) => r.type === "Блюда").length;
    const realization = total - dishes;
    const withRecipe = rows.filter((r) => r.recipe && !r.recipe.includes("(0")).length;
    const withCost = rows.filter((r) => r.cost && r.cost !== "0 UZS").length;
    const withPrinter = rows.filter((r) => r.printer).length;
    return [
      { label: "Кол-во товаров", value: String(total), rows: [["Реализация", String(realization)], ["Блюда", String(dishes)]], icon: "bi-basket", tone: "blue" },
      { label: "Рецепт", value: String(total), rows: [["С рецептом", String(withRecipe)], ["Без рецепта", String(total - withRecipe)]], icon: "bi-journal-bookmark", tone: "green" },
      { label: "ИКПУ", value: String(total), rows: [["Заполнен", "0"], ["Не заполнен", String(total)]], icon: "bi-card-heading", tone: "cyan" },
      { label: "Себестоимость", value: String(total), rows: [["Заполнен", String(withCost)], ["Не заполнен", String(total - withCost)]], icon: "bi-cash-coin", tone: "orange" },
      { label: "Принтер", value: String(total), rows: [["Подключен", String(withPrinter)], ["Не подключен", String(total - withPrinter)]], icon: "bi-printer", tone: "violet" },
    ];
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const searchMatch = !filters.search || row.name.toLowerCase().includes(filters.search.toLowerCase());
      const chefMatch = !filters.chef || row.chef === filters.chef;
      const categoryMatch = !filters.category || row.category === filters.category;
      const statMatch = !statFilter || matchesDishStatFilter(row, statFilter);
      return searchMatch && chefMatch && categoryMatch && statMatch;
    });
  }, [rows, filters, statFilter]);

  const updateRow = (id, key, value) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  };

  const openDrawer = (row = null) => {
    setEditing(row);
    setForm(row || { name: "", sort: "1", type: "Блюда", unit: "шт", cost: "0 UZS", price: "", menu: "", printer: "", recipe: "Рецепт (0 шт)", stock: "-", auto: false, set: false, category: "", chef: "" });
    setDrawerOpen(true);
  };

  const saveDish = async () => {
    const payload = {
      name: form.name,
      sort_order: parseInt(form.sort, 10) || 1,
      product_type: form.type === "Реализация" ? "sale" : "dish",
      unit: form.unit,
      price: parseInt(form.price, 10) || 0,
      category_name: form.menu || form.category,
      station: form.chef,
      auto_write_off: form.auto,
      is_set: form.set,
    };
    try {
      if (editing) {
        await api.patch(`/inventory/products/${editing.id}`, payload);
      } else {
        const { data } = await api.post("/inventory/products", payload);
        if (data?.id) form.id = data.id;
      }
    } catch (err) {
      window.alert(err.response?.data?.detail || "Ошибка сохранения");
      return;
    }
    if (editing) {
      setRows((prev) => prev.map((row) => (row.id === editing.id ? { ...row, ...form } : row)));
    } else {
      setRows((prev) => [{ ...form, id: form.id || Date.now(), photo: "" }, ...prev]);
    }
    setDrawerOpen(false);
  };

  const archiveDish = async (id) => {
    try {
      await api.delete(`/inventory/products/${id}`);
    } catch (err) {
      window.alert(err.response?.data?.detail || "Ошибка удаления");
      return;
    }
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const openPhotoPicker = (row) => {
    setPhotoPicker(row);
    setPhotoSearch(row.name);
  };

  const selectPhoto = (photo) => {
    if (!photoPicker) return;
    updateRow(photoPicker.id, "photo", photo);
    setPhotoPicker(null);
    setPhotoSearch("");
  };

  return (
    <section className="nomenclature-page dish-catalog-page">
      <div className="dish-catalog-card">
        <div className="dish-catalog-header">
          <div className="report-title-group">
            <span className="report-accent-bar" />
            <div>
              <h1>Блюда</h1>
              <p>Каталог блюд и товаров с быстрым редактированием цен, сортировки и настроек.</p>
            </div>
          </div>
          <div className="dish-header-actions">
            <button type="button" className="btn-soft">
              <Icon name="bi-box-arrow-in-down" /> Импорт Excel
            </button>
            <button type="button" className="btn-primary" onClick={() => openDrawer()}>
              <Icon name="bi-plus" /> Добавить
            </button>
          </div>
        </div>

        <div className="dish-stat-grid">
          {computedStats.map((stat) => (
            <article className={`dish-stat-card dish-stat-${stat.tone}`} key={stat.label}>
              <div className="dish-stat-top">
                <span>{stat.label}</span>
                <Icon name={stat.icon} size={20} />
              </div>
              <strong>{stat.value}</strong>
              <div className="dish-stat-lines">
                {stat.rows.map(([label, value], lineIndex) => {
                  const filterKey = `${stat.tone}:${lineIndex}`;
                  const active = statFilter === filterKey;
                  return (
                  <button
                    type="button"
                    className={active ? "is-active" : ""}
                    key={label}
                    onClick={() => setStatFilter((current) => (current === filterKey ? null : filterKey))}
                    aria-pressed={active}
                  >
                    <em>{label}</em>
                    <b>{value}</b>
                  </button>
                )})}
              </div>
            </article>
          ))}
        </div>

        <div className="dish-toolbar">
          <label className="dish-search">
            <Icon name="bi-search" />
            <input
              value={draftFilters.search}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))}
              placeholder="Поиск"
            />
          </label>
          <select value={draftFilters.chef} onChange={(event) => setDraftFilters((prev) => ({ ...prev, chef: event.target.value }))}>
            <option value="">Выберите повара</option>
            <option value="Повар 1">Повар 1</option>
            <option value="Повар 2">Повар 2</option>
            <option value="Бар">Бар</option>
          </select>
          <select value={draftFilters.category} onChange={(event) => setDraftFilters((prev) => ({ ...prev, category: event.target.value }))}>
            <option value="">Категория</option>
            <option value="Горячие блюда">Горячие блюда</option>
            <option value="Напитки">Напитки</option>
            <option value="Салаты">Салаты</option>
            <option value="Игры">Игры</option>
          </select>
          <button type="button" className="btn-outline-primary" onClick={() => setFilters(draftFilters)}>
            <Icon name="bi-funnel" /> Фильтровать
          </button>
          <div className="dish-table-settings">
            <button
              type="button"
              className="dish-table-settings-btn"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              <Icon name="bi-sliders" /> Настроить таблицу
            </button>
            {settingsOpen ? (
              <div className="dish-table-settings-popover">
                <div className="dish-table-settings-head">
                  <strong>Столбцы</strong>
                  <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
                    <Icon name="bi-x-lg" size={14} />
                  </button>
                </div>
                <div className="dish-column-toggle-list">
                  {dishColumnOptions.map((column) => {
                    const checked = isColumnVisible(column.key);
                    const disabled = checked && visibleColumnCount <= 1;
                    return (
                      <label className="dish-column-toggle" key={column.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleColumn(column.key)}
                        />
                        <span className="dish-column-toggle-box">
                          {checked ? <Icon name="bi-check2" size={13} /> : null}
                        </span>
                        <span>{column.label}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="dish-column-reset"
                  onClick={() => setVisibleColumns(defaultDishColumnVisibility)}
                >
                  Показать все
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="dish-grid-wrap">
          <table className="dish-grid-table" style={{ "--dish-grid-min-width": `${tableMinWidth}px` }}>
            <thead>
              <tr>
                {isColumnVisible("photo") ? <th className="dish-col-photo">Фото</th> : null}
                {isColumnVisible("name") ? <th className="dish-col-name">Название</th> : null}
                {isColumnVisible("type") ? <th className="dish-col-type">Тип</th> : null}
                {isColumnVisible("unit") ? <th className="dish-col-unit">Ед. изм</th> : null}
                {isColumnVisible("cost") ? <th className="dish-col-cost">Себестоимость</th> : null}
                {isColumnVisible("price") ? <th className="dish-col-price">Цена</th> : null}
                {isColumnVisible("menu") ? <th className="dish-col-menu">Меню</th> : null}
                {isColumnVisible("printer") ? <th className="dish-col-printer">Принтер</th> : null}
                {isColumnVisible("recipe") ? <th className="dish-col-recipe">Рецепты</th> : null}
                {isColumnVisible("stock") ? <th className="dish-col-stock">Остаток</th> : null}
                {isColumnVisible("auto") ? <th className="dish-col-auto">Авто</th> : null}
                {isColumnVisible("set") ? <th className="dish-col-set">Сет</th> : null}
                {isColumnVisible("sort") ? <th className="dish-col-sort">Сорт</th> : null}
                {isColumnVisible("actions") ? <th className="dish-col-actions">Действия</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  {isColumnVisible("photo") ? (
                  <td className="dish-col-photo">
                    <button type="button" className="dish-photo-button" onClick={() => openPhotoPicker(row)} aria-label={`Выбрать фото для ${row.name}`}>
                      {row.photo ? (
                        <img className="dish-photo" src={row.photo} alt={row.name} />
                      ) : (
                        <span className="dish-photo-placeholder"><Icon name="bi-image" /></span>
                      )}
                    </button>
                  </td>
                  ) : null}
                  {isColumnVisible("name") ? <td className="dish-col-name"><button type="button" className="dish-name-link">{row.name}</button></td> : null}
                  {isColumnVisible("type") ? <td className="dish-col-type"><span className={`dish-type-pill ${row.type === "Реализация" ? "realization" : ""}`}>{row.type}</span></td> : null}
                  {isColumnVisible("unit") ? <td className="dish-col-unit">{row.unit}</td> : null}
                  {isColumnVisible("cost") ? <td className="dish-col-cost">{row.cost}</td> : null}
                  {isColumnVisible("price") ? (
                  <td className="dish-col-price">
                    <input className="dish-price-input" value={row.price} onChange={(event) => updateRow(row.id, "price", event.target.value)} />
                  </td>
                  ) : null}
                  {isColumnVisible("menu") ? <td className="dish-col-menu"><span className="dish-menu-pill">{row.menu}</span></td> : null}
                  {isColumnVisible("printer") ? <td className="dish-col-printer dish-printer-cell">{row.printer || "-"}</td> : null}
                  {isColumnVisible("recipe") ? <td className="dish-col-recipe"><button type="button" className="dish-recipe-link">{row.recipe}</button></td> : null}
                  {isColumnVisible("stock") ? (
                  <td className="dish-col-stock">
                    <button type="button" className="dish-stock-box">
                      {row.stock}
                      {row.stock !== "-" && <Icon name="bi-arrow-repeat" size={13} />}
                    </button>
                  </td>
                  ) : null}
                  {isColumnVisible("auto") ? <td className="dish-col-auto">{renderToggle(row.auto, () => updateRow(row.id, "auto", !row.auto))}</td> : null}
                  {isColumnVisible("set") ? <td className="dish-col-set">{renderToggle(row.set, () => updateRow(row.id, "set", !row.set))}</td> : null}
                  {isColumnVisible("sort") ? <td className="dish-col-sort dish-sort-cell">{row.sort}</td> : null}
                  {isColumnVisible("actions") ? (
                  <td className="dish-col-actions">
                    <div className="dish-row-actions">
                      <button type="button" onClick={() => openDrawer(row)} aria-label="Редактировать">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="danger" onClick={() => archiveDish(row.id)} aria-label="Удалить">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawerOpen && (
        <div className="nomenclature-drawer dish-drawer">
          <div className="nomenclature-drawer-card">
            <div className="nomenclature-drawer-header">
              <h2>{editing ? "Редактировать блюдо" : "Добавить блюдо"}</h2>
              <button type="button" onClick={() => setDrawerOpen(false)}><Icon name="bi-x-lg" /></button>
            </div>
            <div className="nomenclature-form">
              {["name", "sort", "price", "cost", "menu", "printer", "category", "chef"].map((field) => (
                <label key={field}>
                  <span>{fieldLabels[field]}</span>
                  <input value={form[field] || ""} onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))} />
                </label>
              ))}
              <label>
                <span>Тип</span>
                <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}>
                  <option>Блюда</option>
                  <option>Реализация</option>
                </select>
              </label>
              <label>
                <span>Ед. изм</span>
                <select value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}>
                  <option>шт</option>
                  <option>порция</option>
                  <option>кг</option>
                  <option>л</option>
                </select>
              </label>
            </div>
            <div className="nomenclature-drawer-footer">
              <button type="button" className="btn-soft" onClick={() => setDrawerOpen(false)}>Отмена</button>
              <button type="button" className="btn-primary" onClick={saveDish}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {photoPicker && (
        <div className="dish-photo-modal" role="dialog" aria-modal="true">
          <div className="dish-photo-modal__backdrop" onClick={() => setPhotoPicker(null)} />
          <div className="dish-photo-modal__card">
            <div className="dish-photo-modal__header">
              <div>
                <span>База фото</span>
                <h2>{photoPicker.name}</h2>
              </div>
              <button type="button" onClick={() => setPhotoPicker(null)} aria-label="Закрыть">
                <Icon name="bi-x-lg" />
              </button>
            </div>
            <label className="dish-photo-search">
              <Icon name="bi-search" />
              <input
                value={photoSearch}
                onChange={(event) => setPhotoSearch(event.target.value)}
                placeholder="Напишите: плов, ош, cola, мастава..."
                autoFocus
              />
            </label>
            <div className="dish-photo-modal__grid">
              {getPhotoOptions(photoPicker, photoSearch).map((photo) => (
                <button type="button" key={photo} className="dish-photo-option" onClick={() => selectPhoto(photo)}>
                  <img src={photo} alt={photoPicker.name} />
                  {photoPicker.photo === photo && <span><Icon name="bi-check2" /> Выбрано</span>}
                </button>
              ))}
            </div>
            <div className="dish-photo-modal__footer">
              <button type="button" className="btn-soft" onClick={() => setPhotoPicker(null)}>Отмена</button>
              <button type="button" className="btn-outline-danger" onClick={() => selectPhoto("")}>Убрать фото</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function getPhotoOptions(row, query = "") {
  const normalized = `${query} ${row.name}`.toLowerCase();
  if (normalized.includes("cola") || normalized.includes("кока") || normalized.includes("oc")) return photoLibrary.cola;
  if (normalized.includes("плов") || normalized.includes("osh") || normalized.includes("ош")) return photoLibrary.plov;
  if (normalized.includes("мастава") || normalized.includes("mastava")) return photoLibrary.mastava;
  if (normalized.includes("лагман") || normalized.includes("lagman")) return photoLibrary.lagman;
  if (row.category === "Напитки" || normalized.includes("suv") || normalized.includes("moxito") || normalized.includes("cocktail") || normalized.includes("сок")) return photoLibrary.drinks;
  return photoLibrary.dishes;
}

function renderToggle(value, onClick) {
  if (value === null) return <span className="dish-toggle-empty">-</span>;
  return (
    <button type="button" className={`dish-toggle ${value ? "is-on" : ""}`} onClick={onClick} aria-pressed={value}>
      <span />
    </button>
  );
}

const fieldLabels = {
  name: "Название",
  sort: "Сорт",
  price: "Цена",
  cost: "Себестоимость",
  menu: "Меню",
  printer: "Принтер",
  category: "Категория",
  chef: "Повар",
};

function SimpleNomenclaturePage({ config }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState({});

  const isRawMaterials = config.title === "Сырьё";
  const isSemiProducts = config.title === "Полуфабрикаты";
  const showSearch = !(isRawMaterials || isSemiProducts);
  const apiEndpoint = config.title === "Сырьё" ? "/inventory/ingredients" : config.title === "Полуфабрикаты" ? "/inventory/semi-products" : null;
  const editableColumns = useMemo(() => config.columns.filter((column) => column !== "Действия"), [config.columns]);

  const getDefaultCellValue = (column) => {
    if (column === "Статус") return ACTIVE;
    if (column === "Ед. изм") return "кг";
    if (column === "Состав") return "0 ингредиента";
    if (column.includes("Цена") || column.includes("Себестоимость")) return "0 UZS";
    if (column.includes("Остаток")) return "0";
    return "";
  };

  const makeFormFromRow = (row = []) => Object.fromEntries(
    editableColumns.map((column, index) => [column, row[index] ?? getDefaultCellValue(column)]),
  );

  const makeRowFromForm = () => editableColumns.map((column) => String(form[column] ?? getDefaultCellValue(column)).trim());

  useEffect(() => {
    if (!apiEndpoint) return;
    api.get(apiEndpoint)
      .then(({ data }) => {
        const items = Array.isArray(data) ? data : data?.items || [];
        const mapped = items.map((item) => {
            if (config.title === "Сырьё") {
              return [
                item.name || "",
                item.category || "",
                item.subcategory_name || item.subcategory || item.specification || "",
                item.unit || "кг",
                String(item.stock ?? "0"), String(item.min_stock ?? "0"),
                item.purchase_price ? `${Number(item.purchase_price).toLocaleString("ru-RU")} UZS` : "0 UZS",
                item.supplier_name || "", item.is_active !== false ? ACTIVE : ARCHIVED,
              ];
            }
            return [
              item.name || "", item.category || "", item.unit || "кг",
              item.cost_price ? `${Number(item.cost_price).toLocaleString("ru-RU")} UZS` : "0 UZS",
              `${item.ingredients_count ?? 0} ингредиента`, item.is_active !== false ? ACTIVE : ARCHIVED,
            ];
          });
        setRows(mapped);
      })
      .catch(() => setRows([]));
  }, [apiEndpoint]);

  const openEditor = (row = null, index = null) => {
    setEditingIndex(index);
    setForm(makeFormFromRow(row || []));
    setDrawerOpen(true);
  };

  const closeEditor = () => {
    setDrawerOpen(false);
    setEditingIndex(null);
  };

  const saveRow = (event) => {
    event.preventDefault();
    const nextRow = makeRowFromForm();
    setRows((currentRows) => {
      if (editingIndex === null) return [nextRow, ...currentRows];
      return currentRows.map((row, rowIndex) => (rowIndex === editingIndex ? nextRow : row));
    });
    closeEditor();
  };

  const removeRow = (rowIndex) => {
    setRows((currentRows) => currentRows.filter((_, index) => index !== rowIndex));
  };

  const visibleRows = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => !showSearch || row.join(" ").toLowerCase().includes(query.toLowerCase()));

  return (
    <section className={`nomenclature-page ${isRawMaterials ? "nomenclature-page--raw" : "nomenclature-page--semi"}`}>
      <div className="nomenclature-card">
        <div className="nomenclature-header">
          <div className="report-title-group">
            <span className="report-accent-bar" />
            <div>
              <h1>{config.title}</h1>
              <p>Справочник склада в Marjon-дизайне.</p>
            </div>
          </div>
          <div className="nomenclature-actions">
            <button type="button" className="btn-primary" onClick={() => openEditor()}>
              <Icon name="bi-plus" /> {config.action}
            </button>
          </div>
        </div>
        {showSearch && (
          <div className="nomenclature-filters">
            <label>
              <Icon name="bi-search" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" />
            </label>
          </div>
        )}
        <div className="nomenclature-table-wrapper">
          <table className="nomenclature-table">
            <thead>
              <tr>{config.columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {visibleRows.map(({ row, rowIndex }) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, index) => (
                    <td key={`${row[0]}-${index}`}>
                      {index === row.length - 1 ? (
                        <span className={`nomenclature-status-badge ${cell === ARCHIVED ? "is-archived" : ""}`}>
                          {cell}
                        </span>
                      ) : cell}
                    </td>
                  ))}
                  <td>
                    <div className="nomenclature-row-actions">
                      <button type="button" className="edit-action-button" onClick={() => openEditor(row, rowIndex)} aria-label="Редактировать">
                        <Icon name="bi-pencil" size={15} />
                      </button>
                      <button type="button" className="is-danger" onClick={() => removeRow(rowIndex)} aria-label="Удалить">
                        <Icon name="bi-trash3" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawerOpen && (
        <div className="nomenclature-drawer" role="dialog" aria-modal="true">
          <button type="button" className="nomenclature-drawer__backdrop" onClick={closeEditor} aria-label="Закрыть" />
          <form className="nomenclature-form" onSubmit={saveRow}>
            <div className="nomenclature-form__header">
              <div>
                <p>{config.title}</p>
                <h2>{editingIndex === null ? "Добавить позицию" : "Редактировать позицию"}</h2>
              </div>
              <button type="button" onClick={closeEditor} aria-label="Закрыть">
                <Icon name="bi-x-lg" />
              </button>
            </div>

            <div className="nomenclature-form__grid">
              {editableColumns.map((column) => (
                <label key={column}>
                  <span>{column}</span>
                  {column === "Статус" ? (
                    <select value={form[column] || ACTIVE} onChange={(event) => setForm((prev) => ({ ...prev, [column]: event.target.value }))}>
                      <option value={ACTIVE}>{ACTIVE}</option>
                      <option value={ARCHIVED}>{ARCHIVED}</option>
                    </select>
                  ) : column === "Ед. изм" ? (
                    <select value={form[column] || "кг"} onChange={(event) => setForm((prev) => ({ ...prev, [column]: event.target.value }))}>
                      <option>кг</option>
                      <option>шт</option>
                      <option>л</option>
                      <option>порция</option>
                    </select>
                  ) : (
                    <input value={form[column] || ""} onChange={(event) => setForm((prev) => ({ ...prev, [column]: event.target.value }))} />
                  )}
                </label>
              ))}
            </div>

            <div className="nomenclature-form__footer">
              <button type="button" onClick={closeEditor}>Отмена</button>
              <button type="submit">Сохранить</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

export default NomenclaturePage;
