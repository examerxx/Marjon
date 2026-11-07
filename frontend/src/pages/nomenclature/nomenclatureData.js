// Чистые преобразования и справочные функции раздела «Блюда» OWNER.
// Вынесено из NomenclaturePage.jsx (FE-07B) без изменения логики: маппинг
// backend-ответа, парсинг чисел и сборка payload сохранены 1:1.
// V21: подбор фото из демо-библиотеки удалён (кастомное фото-окно убрано;
// фото грузится только нативным пикером через uploadProductPhoto).

export function matchesDishStatFilter(row, filterKey) {
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
      // «Себестоимость указана» — по итогу (база + состав), а не по одной
      // ручной базе: блюдо с пустой базой и заполненным рецептом свою
      // себестоимость имеет.
      return Number(row.costTotalValue) > 0;
    case "orange:1":
      return !(Number(row.costTotalValue) > 0);
    case "violet:0":
      return Boolean(row.printer);
    case "violet:1":
      return !row.printer;
    default:
      return true;
  }
}

export function unitDisplayLabel(unit) {
  return String(unit?.short_name || unit?.name || "").trim();
}

// Подпись опции в селектах выбора ед. изм: «Килограмм (Кг)» — полное имя
// из Настройки → Единицы + короткое в скобках. ТОЛЬКО подпись: значением
// опции остаётся короткое имя (канон хранения), unitDisplayLabel выше —
// канон таблиц/суффиксов. Без полного имени — просто короткое.
export function unitOptionLabel(unit) {
  const short = String(unit?.short_name || "").trim();
  const full = String(unit?.name || "").trim();
  if (short && full && short.toLowerCase() !== full.toLowerCase()) {
    return `${full} (${short})`;
  }
  return short || full;
}

export function mapNomenclatureProduct(item, units = []) {
  const unitId = item.unit_id ? String(item.unit_id) : null;
  const canonicalUnit = unitId
    ? units.find((unit) => String(unit.id) === unitId)
    : null;
  return {
    id: item.id,
    name: item.name || "",
    sort: item.sort_order != null ? String(item.sort_order) : "—",
    type: item.product_type === "sale" ? "Реализация" : "Блюда",
    unitId,
    unit: unitDisplayLabel(canonicalUnit) || item.unit || "—",
    cost: item.cost_price != null ? formatNomenclatureMoneyDisplay(item.cost_price) : "—",
    // Себестоимость = ручная база (cost) + состав. База остаётся в cost —
    // её правит дровер; costTotal только показывается в таблице. Если бы
    // дровер читал итог, сохранение записывало бы его обратно в базу и
    // сумма росла бы с каждым открытием карточки.
    costTotal: item.cost_total != null ? formatNomenclatureMoneyDisplay(item.cost_total) : null,
    // Числом — для фильтров статистики: сравнение с готовой строкой
    // («0 UZS») ломалось бы при любой смене формата денег на экране.
    costTotalValue: item.cost_total != null ? Number(item.cost_total) : null,
    recipeCost: item.recipe_cost != null ? Number(item.recipe_cost) : 0,
    price: item.price != null ? formatNomenclatureMoneyDisplay(item.price) : "—",
    menu: item.category_name || "",
    subcategory: item.subcategory_name || "",
    printer: item.printer_name || "",
    // V24: IP принтера — канонический Printer.ip_address. Backend Product
    // отдаёт только printer_name; IP резолвится фронтом через справочник
    // GET /printers по printerId (см. DishesTable). printerIp из ответа
    // (если появится printer_ip) — приоритетный источник, без дублирования
    // IP на Product и без хардкода.
    printerIp: item.printer_ip || item.printerIp || "",
    recipe: `Рецепт (${item.ingredients_count ?? 0} шт)`,
    // V25: канонический счётчик состава для колонки РЕЦЕПТЫ (тот же
    // ingredients_count, что даёт ProductService._attach_aggregates из
    // product_ingredients; 0 = нет рецепта, не фейк). stock-маппинг ниже
    // сохранён 1:1 (используется contract-тестами и фильтрами).
    ingredientsCount: Number.isFinite(Number(item.ingredients_count)) ? Number(item.ingredients_count) : 0,
    // V38: счётчик состава сета (set_items_count backend, 0 = пуст/не сет).
    setItemsCount: Number.isFinite(Number(item.set_items_count)) ? Number(item.set_items_count) : 0,
    recipeIngredients: Array.isArray(item.ingredients) ? item.ingredients : null,
    stock: item.stock != null ? String(item.stock) : "-",
    // V24: реальные backend-флаги is_auto/is_set (NOT NULL default false).
    // Legacy null-плацехолдеры "-" убраны: отсутствие поля = false
    // (миграция backfill'ит существующие товары в false).
    auto: typeof item.is_auto === "boolean" ? item.is_auto : typeof item.auto === "boolean" ? item.auto : false,
    set: typeof item.is_set === "boolean" ? item.is_set : typeof item.set === "boolean" ? item.set : false,
    // V39 — доступен для сетов (тумблер колонки СЕТ, фильтр Товара панели).
    allowInSets: item.allow_in_sets === true,
    active: item.is_active !== false,
    category: item.category_name || "",
    // V19 — канонические IDs из ответа (для preselect дровера: id → id,
    // а не имя → id). Null, когда backend не вернул.
    categoryId: item.category_id ? String(item.category_id) : null,
    printerId: item.printer_id ? String(item.printer_id) : null,
    chef: "",
    photo: item.image_url || "",
    // V46: шаг порции (null/undefined = целые порции).
    portionStep: item.portion_step != null ? String(item.portion_step) : "",
  };
}

export function parseNomenclatureMoney(value, fallback = null) {
  const input = String(value ?? "").trim().replace(/\s*UZS$/i, "").trim();
  if (!input) return fallback;
  if (!/^(?:\d+|\d{1,3}(?:[  ]\d{3})+)(?:[.,]\d{1,2})?$/.test(input)) return fallback;
  const parsed = Number(input.replace(/[  ]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseNomenclatureSort(value) {
  const input = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(input) ? Number(input) : Number.NaN;
}

// V22 — единый показ денег в таблице: целые группируются ("40 000 UZS"),
// дробные сохраняются в ru-RU виде ("40 000,50 UZS"). Только display:
// backend-значения не мутируют, сырьё для формы парсится отдельно.
export function formatNomenclatureMoneyDisplay(value) {
  const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number)) return "—";
  const text = Number.isInteger(number)
    ? number.toLocaleString("ru-RU", { maximumFractionDigits: 0 })
    : number.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return `${text} UZS`;
}

export function buildNomenclatureProductPayload(form, { isUpdate = false } = {}) {
  const payload = {
    name: String(form.name || "").trim(),
    sort_order: parseNomenclatureSort(form.sort),
    product_type: form.type === "Реализация" ? "sale" : "dish",
    price: parseNomenclatureMoney(form.price, 0),
  };
  const costPrice = parseNomenclatureMoney(form.cost, 0);
  if (typeof form.active === "boolean") payload.is_active = form.active;
  if (typeof form.auto === "boolean") payload.is_auto = form.auto;
  if (typeof form.set === "boolean") payload.is_set = form.set;
  if (costPrice !== null) payload.cost_price = costPrice;
  // Unit selection is canonical by UUID in both create and update. The
  // display label comes from GET /units and is never used to infer an id.
  if (form.unitId) payload.unit_id = form.unitId;
  // V18 — канонические связи (все nullable в ProductCreate/ProductUpdate):
  // шлём ТОЛЬКО выбранные id; пусто = omit (backend оставляет как есть/null).
  // subcategory_id не шлём никогда (поле удалено из дровера).
  if (form.categoryId) payload.category_id = form.categoryId;
  if (form.printerId) payload.printer_id = form.printerId;
  // V46: шаг порции — шлём только если выбран валидный шаг.
  const step = String(form.portionStep || "").trim().replace(",", ".");
  if (step && ["0.1", "0.25", "0.5"].includes(step)) payload.portion_step = Number(step);
  return payload;
}

// Демо-строки блюд (использовались для превью каталога до backend-контракта).
// Сохранено 1:1 из NomenclaturePage.jsx; в рантайме сейчас не подключено.
export function demoDishRows() {
  return [
    {
      id: "demo-dish-plov",
      name: "Плов",
      sort: "1",
      type: "Блюда",
      unit: "порция",
      cost: "18 000 UZS",
      price: "45000",
      menu: "Горячие блюда",
      subcategory: "Основные блюда",
      printer: "Кухня",
      recipe: "Рецепт (8 шт)",
      stock: "42",
      auto: true,
      set: false,
      category: "Горячие блюда",
      chef: "Повар 1",
      photo: "",
    },
    {
      id: "demo-dish-shashlik",
      name: "Шашлык",
      sort: "2",
      type: "Блюда",
      unit: "порция",
      cost: "32 000 UZS",
      price: "60000",
      menu: "Гриль",
      subcategory: "Мясные блюда",
      printer: "Мангал",
      recipe: "Рецепт (6 шт)",
      stock: "36",
      auto: true,
      set: false,
      category: "Гриль",
      chef: "Повар 2",
      photo: "",
    },
    {
      id: "demo-dish-lagman",
      name: "Лагман",
      sort: "3",
      type: "Блюда",
      unit: "порция",
      cost: "16 000 UZS",
      price: "35000",
      menu: "Горячие блюда",
      subcategory: "Супы",
      printer: "Кухня",
      recipe: "Рецепт (7 шт)",
      stock: "31",
      auto: true,
      set: false,
      category: "Горячие блюда",
      chef: "Повар 1",
      photo: "",
    },
    {
      id: "demo-dish-salad",
      name: "Салат микс",
      sort: "4",
      type: "Блюда",
      unit: "порция",
      cost: "11 000 UZS",
      price: "30000",
      menu: "Салаты",
      subcategory: "Свежие салаты",
      printer: "Холодный цех",
      recipe: "Рецепт (5 шт)",
      stock: "24",
      auto: true,
      set: false,
      category: "Салаты",
      chef: "Повар 2",
      photo: "",
    },
    {
      id: "demo-sale-ayran",
      name: "Айран",
      sort: "5",
      type: "Реализация",
      unit: "шт",
      cost: "5 000 UZS",
      price: "10000",
      menu: "Напитки",
      subcategory: "Кисломолочные",
      printer: "Бар",
      recipe: "Рецепт (2 шт)",
      stock: "54",
      auto: false,
      set: false,
      category: "Напитки",
      chef: "Бар",
      photo: "",
    },
  ];
}

