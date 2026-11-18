import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import NomenclaturePage, { buildNomenclatureProductPayload, mapNomenclatureProduct } from "./NomenclaturePage";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const backendProduct = {
  id: "product-uuid",
  company_id: "company-uuid",
  category_id: null,
  subcategory_id: null,
  product_type: "dish",
  printer_id: null,
  name: "Backend dish",
  description: null,
  image_url: null,
  price: 45000,
  cost_price: 18000,
  tax_rate: 0,
  unit: "шт",
  barcode: null,
  sku: null,
  is_active: true,
  is_available: true,
  sort_order: 1,
  category_name: null,
  subcategory_name: null,
  printer_name: null,
  ingredients_count: 0,
  stock: null,
  ingredients: [],
};

describe("APP nomenclature product contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [] });
  });

  it("uses the OWNER report filter shell without legacy dish controls", async () => {
    const { container } = render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    expect(container.querySelector(".settings-title-group p")).toHaveTextContent("Меню");
    expect(container.querySelector(".settings-title-group .settings-accent-bar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Блюда" })).toBeInTheDocument();
    expect(container.querySelector(".dish-stat-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("Импорт Excel")).not.toBeInTheDocument();
    expect(screen.queryByText("Настроить таблицу")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Выберите повара" })).not.toBeInTheDocument();

    const filterToggle = container.querySelector(".dishes-filter-toggle");
    expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Добавить" })).toBeInTheDocument();
    expect(container.querySelector(".dish-header-actions .report-filter-clear")).not.toBeInTheDocument();

    fireEvent.click(filterToggle);
    expect(filterToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "Поиск блюд" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Категория" })).toBeInTheDocument();
    // Категория/поиск применяются моментально — в панели кнопки нет,
    // остаётся только header-тумблер раскрытия.
    expect(screen.getAllByRole("button", { name: "Фильтровать" })).toHaveLength(1);
    expect(container.querySelector(".dish-filter-actions .report-filter-apply")).toBeNull();
    expect(container.querySelector(".dish-filter-panel .report-filter-clear")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Блюда" })).toBeInTheDocument();
  });

  it("builds schema-only create and update payloads", () => {
    const form = {
      name: "Local draft",
      sort: "4",
      type: "Реализация",
      unitId: "unit-portion",
      unit: "порция",
      cost: "12 500 UZS",
      price: "25000",
      menu: "Unsupported menu",
      subcategory: "Unsupported subcategory",
      chef: "Unsupported station",
      auto: true,
      set: true,
    };

    // V24: is_auto/is_set — реальные поля ProductCreate/ProductUpdate,
    // поэтому форма с auto/set их отправляет. menu/subcategory/chef
    // по-прежнему не уходят (их нет в схеме).
    expect(buildNomenclatureProductPayload(form)).toEqual({
      name: "Local draft",
      sort_order: 4,
      product_type: "sale",
      unit_id: "unit-portion",
      cost_price: 12500,
      price: 25000,
      is_auto: true,
      is_set: true,
    });
    expect(buildNomenclatureProductPayload(form, { isUpdate: true })).toEqual({
      name: "Local draft",
      sort_order: 4,
      product_type: "sale",
      unit_id: "unit-portion",
      cost_price: 12500,
      price: 25000,
      is_auto: true,
      is_set: true,
    });
  });

  // MONEY-DIGITS-01: буквы в сумму больше не попадают — поле фильтрует ввод
  // до цифр, поэтому «12abc34» физически становится «1 234». Мусорный «Сорт»
  // по-прежнему блокирует сохранение: валидация формы не ослаблена.
  it("keeps letters out of money fields while sort text still blocks submit", async () => {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Invalid draft" } });
    fireEvent.change(within(dialog).getByLabelText("Сорт"), { target: { value: "1e2" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "12abc34" } });
    expect(within(dialog).getByLabelText("Цена")).toHaveValue("1 234");
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    api.post.mockResolvedValue({ data: { id: "created-1", name: "Invalid draft" } });
    fireEvent.change(within(dialog).getByLabelText("Сорт"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("Себестоимость"), { target: { value: "12abc34" } });
    expect(within(dialog).getByLabelText("Себестоимость")).toHaveValue("1 234");
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    // Уходит ровно то, что видно в поле: 100 и 1 234, без «частичного» текста.
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][1]).toMatchObject({ price: 100, cost_price: 1234 });
  });

  it("maps only backend-confirmed response values", () => {
    const mapped = mapNomenclatureProduct(backendProduct);
    expect(mapped).toMatchObject({
      id: "product-uuid",
      name: "Backend dish",
      menu: "",
      subcategory: "",
      chef: "",
      // V24: is_auto/is_set — реальные backend-флаги (NOT NULL default false).
      // Отсутствие поля = false (миграция backfill'ит существующие в false),
      // legacy null-плацехолдеры "-" убраны.
      auto: false,
      set: false,
      stock: "-",
    });
    // V22: unified money display (NBSP-tolerant), backend values untouched.
    expect(mapped.price.replace(/\s/g, " ")).toBe("45 000 UZS");
    expect(mapped.cost.replace(/\s/g, " ")).toBe("18 000 UZS");
  });

  it("uses the canonical reload as the post-save source of truth", async () => {
    const created = { ...backendProduct, id: "created-uuid", name: "Server-created name", price: 777 };
    api.post.mockResolvedValue({ data: created });
    // После сохранения каталог перечитывается (позиции сдвигает сервер),
    // поэтому источник истины — ответ GET, а не локальный черновик.
    let productCalls = 0;
    api.get.mockImplementation((url) => {
      if (url === "/inventory/products") {
        productCalls += 1;
        return Promise.resolve({ data: productCalls === 1 ? [] : [created] });
      }
      return Promise.resolve({ data: [] });
    });
    render(<NomenclaturePage />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/inventory/products", expect.objectContaining({ signal: expect.any(AbortSignal) })));
    fireEvent.click(screen.getByRole("button", { name: /Добавить/ }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Local-only name" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/inventory/products", expect.objectContaining({
      name: "Local-only name",
      price: 999,
    })));
    expect(api.post.mock.calls[0][1]).not.toHaveProperty("category_name");
    expect(api.post.mock.calls[0][1]).not.toHaveProperty("subcategory_name");
    expect(api.post.mock.calls[0][1]).not.toHaveProperty("station");
    expect(api.post.mock.calls[0][1]).not.toHaveProperty("auto_write_off");
    // is_set теперь каноническое поле схемы: форма по умолчанию шлёт false.
    expect(api.post.mock.calls[0][1]).toHaveProperty("is_set", false);
    expect(await screen.findByText("Server-created name")).toBeInTheDocument();
    expect(screen.queryByText("Local-only name")).not.toBeInTheDocument();
  });

  it("uses the reloaded catalog without merging unsupported local values", async () => {
    const updated = { ...backendProduct, name: "Server-updated name", price: 88000 };
    let productCalls = 0;
    api.get.mockImplementation((url) => {
      if (url === "/inventory/products") {
        productCalls += 1;
        return Promise.resolve({ data: productCalls === 1 ? [backendProduct] : [updated] });
      }
      return Promise.resolve({ data: [] });
    });
    api.patch.mockResolvedValue({ data: updated });
    render(<NomenclaturePage />);

    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Local update" } });
    fireEvent.change(screen.getByLabelText("Цена"), { target: { value: "99000" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/inventory/products/product-uuid", expect.objectContaining({
      name: "Local update",
      price: 99000,
    })));
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty("unit");
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty("station");
    expect(await screen.findByText("Server-updated name")).toBeInTheDocument();
    expect(screen.queryByText("Local update")).not.toBeInTheDocument();
  });

  it("does not mutate product truth when save fails", async () => {
    api.get.mockResolvedValue({ data: [backendProduct] });
    api.patch.mockRejectedValue(new Error("save failed"));
    render(<NomenclaturePage />);

    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Unsaved local name" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByText("Backend dish")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved local name")).not.toBeInTheDocument();
  });
});

describe("APP dishes — canonical Units V2 integration", () => {
  const units = [
    { id: "unit-global", name: "Штука", short_name: "шт", sort: 1, status: true, company_id: null, is_global: true },
    { id: "unit-company", name: "Упаковка", short_name: "уп", sort: 2, status: true, company_id: "company-uuid", is_global: false },
    { id: "unit-inactive", name: "Старая порция", short_name: "стар", sort: 3, status: false, company_id: "company-uuid", is_global: false },
  ];

  function mockDirectories(products = []) {
    api.get.mockImplementation((url) => {
      if (url === "/inventory/products") return Promise.resolve({ data: products });
      if (url === "/units") return Promise.resolve({ data: { items: units } });
      return Promise.resolve({ data: [] });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
  });

  it("loads GET /units and offers only active global/company IDs with no hardcoded options", async () => {
    mockDirectories();
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/units", expect.objectContaining({ signal: expect.any(AbortSignal) })));
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    // V19: «Ед. изм» — кастомный одиночный селект (combobox + список
    // role=option), а не нативный <select>: опции живут только в открытой панели.
    const select = within(dialog).getByRole("combobox", { name: "Ед. изм" });
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.click(select);
    expect(within(dialog).getByRole("option", { name: "Упаковка (уп)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Штука (шт)" })).toBeInTheDocument();
    // Неактивная единица не предлагается к выбору.
    expect(within(dialog).queryByRole("option", { name: /стар/ })).toBeNull();
    // Хардкод-списка нет: только то, что вернул GET /units.
    expect(within(dialog).queryByRole("option", { name: "порция" })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: "кг" })).toBeNull();
    expect(within(dialog).queryByRole("option", { name: "л" })).toBeNull();
  });

  it("creates with the selected unit UUID and renders its canonical short name", async () => {
    const created = {
      ...backendProduct,
      id: "product-with-company-unit",
      name: "Блюдо в упаковке",
      unit_id: "unit-company",
      unit: "legacy-value",
    };
    // Каталог после сохранения перечитывается — источник истины это GET.
    let productCalls = 0;
    api.get.mockImplementation((url) => {
      if (url === "/inventory/products") {
        productCalls += 1;
        return Promise.resolve({ data: productCalls === 1 ? [] : [created] });
      }
      if (url === "/units") return Promise.resolve({ data: { items: units } });
      return Promise.resolve({ data: [] });
    });
    api.post.mockResolvedValue({ data: created });
    render(<NomenclaturePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Добавить" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    const unitSelect = within(dialog).getByRole("combobox", { name: "Ед. изм" });
    await waitFor(() => expect(unitSelect).not.toBeDisabled());
    fireEvent.click(unitSelect);
    fireEvent.click(await within(dialog).findByRole("option", { name: "Упаковка (уп)" }));
    expect(unitSelect).toHaveTextContent("Упаковка (уп)");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Блюдо в упаковке" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "1000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/inventory/products", expect.objectContaining({
      unit_id: "unit-company",
    })));
    expect(api.post.mock.calls[0][1]).not.toHaveProperty("unit");
    expect(await screen.findByText("уп")).toBeInTheDocument();
  });

  it("keeps an inactive assigned unit readable in Edit and remaps table truth after reload", async () => {
    mockDirectories([{ ...backendProduct, unit_id: "unit-inactive", unit: "legacy-value" }]);
    const first = render(<NomenclaturePage />);
    expect(await screen.findByText("стар")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    const select = within(dialog).getByRole("combobox", { name: "Ед. изм" });
    // Назначенная неактивная единица остаётся читаемой в Edit.
    await waitFor(() => expect(select).toHaveTextContent("Старая порция (стар) (не активна)"));
    fireEvent.click(select);
    expect(within(dialog).getByRole("option", { name: "Старая порция (стар) (не активна)" })).toBeInTheDocument();
    first.unmount();
    render(<NomenclaturePage />);
    expect(await screen.findByText("стар")).toBeInTheDocument();
    expect(api.get.mock.calls.filter(([url]) => url === "/units").length).toBeGreaterThanOrEqual(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe("APP dishes drawer — staff shell (V2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [] });
  });

  async function openAddDrawer() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    return document.querySelector(".staff-modal--cashier-full");
  }

  it("opens the add drawer in the staff portal shell with backdrop", async () => {
    const dialog = await openAddDrawer();
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector(".staff-modal__backdrop")).toBeInTheDocument();
    expect(dialog.querySelector(".staff-form__header h2")).toHaveTextContent("Добавить блюдо");
    expect(dialog.querySelector(".staff-form__header button[aria-label='Закрыть']")).toBeInTheDocument();
  });

  it("keeps footer reachable with Отменить/Добавить and scrollable body", async () => {
    const dialog = await openAddDrawer();
    const buttons = [...dialog.querySelectorAll(".staff-form__footer button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Отменить", "Добавить"]);
    expect(dialog.querySelector(".staff-form__grid")).toBeInTheDocument();
  });

  it("closes via backdrop with exit animation before unmount", async () => {
    await openAddDrawer();
    fireEvent.click(document.querySelector(".staff-modal__backdrop"));
    const closing = document.querySelector(".staff-modal--cashier-full.is-closing");
    expect(closing).toBeInTheDocument();
    fireEvent(closing, new Event("animationend", { bubbles: true }));
    await waitFor(() => expect(document.querySelector(".staff-modal--cashier-full")).not.toBeInTheDocument());
  });

  it("uses the same shell for edit with Сохранить", async () => {
    api.get.mockResolvedValue({ data: [backendProduct] });
    render(<NomenclaturePage />);
    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    expect(dialog.querySelector(".staff-form__header h2")).toHaveTextContent("Редактировать блюдо");
    const buttons = [...dialog.querySelectorAll(".staff-form__footer button")].map((b) => b.textContent);
    expect(buttons).toEqual(["Отменить", "Сохранить"]);
  });

  it("drops the always-empty chef field but keeps truthful read-only fields", async () => {
    const dialog = await openAddDrawer();
    const scope = within(dialog);
    expect(scope.queryByLabelText("Повар")).not.toBeInTheDocument();
    // V18: Подкатегория удалена вместе с пустым read-only «Меню»
    // (категория теперь настоящий селект и отдаёт то же значение).
    expect(scope.queryByLabelText("Подкатегория")).not.toBeInTheDocument();
    expect(scope.queryByLabelText("Меню")).not.toBeInTheDocument();
    for (const label of ["Название", "Сорт", "Цена", "Себестоимость"]) {
      expect(scope.getByLabelText(label)).toBeEnabled();
    }
    // Категория/Принтер — настоящие селекты (combobox), не disabled-инпуты.
    expect(scope.getByRole("combobox", { name: "Категория" })).toBeInTheDocument();
    expect(scope.getByRole("combobox", { name: "Принтер" })).toBeInTheDocument();
  });
});

// V16 — дровер Add/Edit: первый ряд [Сорт | Название] (сорт ~30%, имя ~70%),
// V18 — первый ряд [Сорт ~22% | Название ~78%]; Подкатегория удалена;
// Категория/Принтер — настоящие single-селекты канонических справочников
// (категории — тот же GET /inventory/categories, принтеры — GET /printers
// как у Настройки → Принтеры); выбор хранит canonical ID и уходит в payload
// только когда выбран (поля backend nullable). Футер V16 сохранён.
describe("APP dishes drawer data selects — compact sort, no subcategory, real dropdowns (V18)", () => {
  const dishesCss = readFileSync(join(process.cwd(), "src", "styles", "owner", "dishes.css"), "utf8");
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [] });
  });

  async function openAddDrawer() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    return document.querySelector(".staff-modal--cashier-full");
  }

  function gridLabels(dialog) {
    return [...dialog.querySelectorAll(".staff-form__grid label, .staff-form__grid .dish-form-field > span")]
      .map((l) => (l.tagName === "LABEL" ? l.querySelector(":scope > span")?.textContent : l.textContent));
  }

  it("puts Сорт left and Название right in the first row (sort compact ~22%)", async () => {
    const dialog = await openAddDrawer();
    const firstRow = dialog.querySelector(".dish-first-row");
    expect(firstRow).toBeInTheDocument();
    const cells = [...firstRow.querySelectorAll(":scope > label")].map((l) => l.querySelector("span")?.textContent);
    expect(cells).toEqual(["Сорт", "Название"]);
    // Асимметрия 11/89 задана CSS, не инлайном (сорт — узкий слот).
    const rowRule = dishesCss.match(/\.dish-drawer \.dish-first-row\s*\{([^}]*)\}/)?.[1] || "";
    expect(rowRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*11fr\)\s*minmax\(0,\s*89fr\)/);
    expect(gridLabels(dialog)[0]).toBe("Сорт");
    expect(gridLabels(dialog)[1]).toBe("Название");
  });

  it("orders the numeric row as Себестоимость then Цена with bindings intact", async () => {
    const dialog = await openAddDrawer();
    const labels = gridLabels(dialog);
    expect(labels[2]).toBe("Себестоимость");
    expect(labels[3]).toBe("Цена");
    const scope = within(dialog);
    for (const label of ["Название", "Сорт", "Себестоимость", "Цена"]) {
      expect(scope.getByLabelText(label)).toBeEnabled();
    }
    fireEvent.change(scope.getByLabelText("Название"), { target: { value: "Плов" } });
    expect(scope.getByLabelText("Название")).toHaveValue("Плов");
    fireEvent.change(scope.getByLabelText("Сорт"), { target: { value: "7" } });
    expect(scope.getByLabelText("Сорт")).toHaveValue("7");
  });

  it("keeps remaining fields with unchanged bindings (no Подкатегория)", async () => {
    const dialog = await openAddDrawer();
    const labels = gridLabels(dialog);
    // V18/V19: «Тип» и read-only «Меню» убраны, остальные поля на месте
    // (порядок DOM: cost → price → категория → ед. изм → принтер).
    expect(labels.slice(2)).toEqual(["Себестоимость", "Цена", "Категория", "Ед. изм", "Принтер", "Дополнительный принтер"]);
    expect(labels).not.toContain("Подкатегория");
    expect(dialog.querySelector(".dish-drawer__body")).not.toBeNull();
  });

  it("builds payload with canonical IDs only when selected, never subcategory", () => {
    const base = { name: "Плов", sort: "3", type: "Блюда", unitId: "unit-portion", unit: "порция", cost: "", price: "25000" };
    // Пустая себестоимость = 0 (не «поле не задано»): backend-схема
    // принимает cost_price как Decimal | None, и 0 — честное значение.
    expect(buildNomenclatureProductPayload(base)).toEqual({
      name: "Плов",
      sort_order: 3,
      product_type: "dish",
      unit_id: "unit-portion",
      price: 25000,
      cost_price: 0,
    });
    expect(buildNomenclatureProductPayload({ ...base, categoryId: "c1", printerId: "pr1" })).toEqual({
      name: "Плов",
      sort_order: 3,
      product_type: "dish",
      unit_id: "unit-portion",
      price: 25000,
      cost_price: 0,
      category_id: "c1",
      printer_id: "pr1",
    });
  });

  it("pins the footer with a real header/body/footer layout (no hacks)", async () => {
    const dialog = await openAddDrawer();
    expect(dialog.classList.contains("dish-drawer")).toBe(true);
    // Тело скроллится, футер ужата быть не может.
    const bodyRule = dishesCss.match(/\.dish-drawer \.dish-drawer__body\s*\{([^}]*)\}/)?.[1] || "";
    expect(bodyRule).toMatch(/flex:\s*1 1 auto/);
    expect(bodyRule).toMatch(/overflow-y:\s*auto/);
    const footerRule = dishesCss.match(/\.dish-drawer \.staff-form__footer\s*\{([^}]*)\}/)?.[1] || "";
    expect(footerRule).toMatch(/flex-shrink:\s*0/);
    expect(footerRule).not.toMatch(/position:\s*absolute/);
    expect(footerRule).not.toMatch(/position:\s*fixed/);
    expect(footerRule).not.toMatch(/transform/);
    expect(footerRule).not.toMatch(/margin:\s*-/);
    // DOM-структура: header / body / footer.
    expect(dialog.querySelector(".staff-form__header")).toBeInTheDocument();
    expect(dialog.querySelector(".dish-drawer__body")).toBeInTheDocument();
    expect(dialog.querySelector(".dish-drawer__body .staff-form__grid")).toBeInTheDocument();
    expect(dialog.querySelector(".staff-form__footer")).toBeInTheDocument();
  });

  it("keeps Add/Edit layout parity (only CTA text differs)", async () => {
    const { unmount } = render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    const addDialog = document.querySelector(".staff-modal--cashier-full");
    const addLabels = gridLabels(addDialog);
    const addButtons = [...addDialog.querySelectorAll(".staff-form__footer button")].map((b) => b.textContent);
    expect(addButtons).toEqual(["Отменить", "Добавить"]);
    unmount();
    api.get.mockResolvedValue({ data: [backendProduct] });
    render(<NomenclaturePage />);
    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const editDialog = document.querySelector(".staff-modal--cashier-full.dish-drawer");
    expect(gridLabels(editDialog)).toEqual(addLabels);
    const editButtons = [...editDialog.querySelectorAll(".staff-form__footer button")].map((b) => b.textContent);
    expect(editButtons).toEqual(["Отменить", "Сохранить"]);
  });

  it("renders real category options from the canonical directory (no fakes)", async () => {
    api.get.mockImplementation((path) => (
      String(path).includes("/inventory/categories")
        ? Promise.resolve({ data: [{ id: "c9", name: "Супы", sort_order: 1, is_active: true }] })
        : Promise.resolve({ data: [] })
    ));
    const dialog = await openAddDrawer();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Категория" }));
    expect(await within(dialog).findByRole("option", { name: "Супы" })).toBeInTheDocument();
    // Выбор хранит canonical ID и показывает имя.
    fireEvent.click(within(dialog).getByRole("option", { name: "Супы" }));
    expect(within(dialog).getByRole("combobox", { name: "Категория" })).toHaveTextContent("Супы");
  });

  it("renders real printers from Settings with inactive marked, selectable", async () => {
    api.get.mockImplementation((path) => {
      if (String(path).includes("/printers")) {
        return Promise.resolve({ data: [
          { id: "pr1", name: "Кухня", is_active: true },
          { id: "pr2", name: "Бар", is_active: false },
        ] });
      }
      return Promise.resolve({ data: [] });
    });
    const dialog = await openAddDrawer();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Принтер" }));
    expect(await within(dialog).findByRole("option", { name: "Кухня" })).toBeInTheDocument();
    // Неактивный честно помечен, без выдуманной политики запрета.
    expect(within(dialog).getByRole("option", { name: "Бар (не активен)" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Бар (не активен)" }));
    expect(within(dialog).getByRole("combobox", { name: "Принтер" })).toHaveTextContent("Бар (не активен)");
  });

  it("preserves saved category/printer selection when editing", async () => {
    const saved = {
      ...backendProduct,
      name: "Плов",
      category_name: "Супы",
      printer_name: "Кухня",
    };
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) {
        return Promise.resolve({ data: [{ id: "c9", name: "Супы", sort_order: 1, is_active: true }] });
      }
      if (String(path).includes("/printers")) {
        return Promise.resolve({ data: [{ id: "pr7", name: "Кухня", is_active: true }] });
      }
      return Promise.resolve({ data: [saved] });
    });
    render(<NomenclaturePage />);
    expect(await screen.findByText("Плов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = document.querySelector(".staff-modal--cashier-full.dish-drawer");
    expect(within(dialog).getByRole("combobox", { name: "Категория" })).toHaveTextContent("Супы");
    expect(within(dialog).getByRole("combobox", { name: "Принтер" })).toHaveTextContent("Кухня");
    expect(dialog.querySelector(".dish-drawer__body").textContent).not.toMatch(/Подкатегория/);
  });

  it("shows truthful selector states while loading or unavailable", async () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    const dialog = await openAddDrawer();
    expect(within(dialog).getByRole("combobox", { name: "Категория" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Принтер" })).toBeDisabled();
  });
});

describe("APP dishes catalog template (V3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) {
        return Promise.resolve({ data: [{ id: "c1", name: "Супы", slug: "dish-supy", sort_order: 1, is_active: true }] });
      }
      return Promise.resolve({ data: [] });
    });
  });

  async function openFilters() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(document.querySelector(".dishes-filter-toggle"));
    return document;
  }

  function finishDropdownExit() {
    const panel = document.querySelector(".orders-filter-select__panel.is-closing");
    if (!panel) return;
    for (const eventName of ["animationend", "webkitAnimationEnd"]) {
      const event = new Event(eventName, { bubbles: true });
      Object.defineProperty(event, "animationName", { value: "owner-report-panel-out" });
      fireEvent(panel, event);
    }
  }

  it("renders the category multi-select with live backend options and checkboxes", async () => {
    await openFilters();
    const trigger = screen.getByRole("combobox", { name: "Категория" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.closest(".orders-filter-select")).toBeInTheDocument();
    expect(trigger).not.toBeDisabled();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Без catch-all: только canonical опции, каждая с чекбоксом.
    expect(screen.queryByRole("option", { name: "Все категории" })).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Супы" })).toBeInTheDocument();
    expect(document.querySelectorAll(".owner-msel__check")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "Игры" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Горячие блюда" })).not.toBeInTheDocument();
  });

  it("selects a category, applies the filter and unchecks it inside the panel", async () => {
    await openFilters();
    fireEvent.click(screen.getByRole("combobox", { name: "Категория" }));
    fireEvent.click(await screen.findByRole("option", { name: "Супы" }));
    // Мультиселект: панель осталась открытой, строка checked.
    expect(document.querySelector(".orders-filter-select__panel:not(.is-closing)")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Супы" })).toHaveAttribute("aria-selected", "true");
    // Категория применяется моментально — кнопки «Фильтровать» в панели нет.
    expect(screen.getByRole("combobox", { name: "Категория" })).toHaveTextContent("Супы");
    // Сброс — повторным кликом (uncheck), без catch-all опции.
    fireEvent.click(screen.getByRole("option", { name: "Супы" }));
    expect(screen.getByRole("combobox", { name: "Категория" })).toHaveTextContent("Категория");
  });

  it("closes the category panel with Escape without touching the draft", async () => {
    await openFilters();
    fireEvent.click(screen.getByRole("combobox", { name: "Категория" }));
    expect(document.querySelector(".orders-filter-select__panel:not(.is-closing)")).toBeInTheDocument();
    fireEvent.keyDown(document.querySelector(".dish-filter-panel .orders-filter-select"), { key: "Escape" });
    expect(document.querySelector(".orders-filter-select__panel.is-closing")).toBeInTheDocument();
    finishDropdownExit();
    expect(document.querySelector(".orders-filter-select__panel")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Категория" })).toHaveTextContent("Категория");
  });

  it("disables the category control truthfully when categories fail to load", async () => {
    api.get.mockImplementation((path) => (
      String(path).includes("/inventory/categories")
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ data: [] })
    ));
    await openFilters();
    const trigger = screen.getByRole("combobox", { name: "Категория" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Категории недоступны");
    expect(screen.queryByRole("option", { name: "Горячие блюда" })).not.toBeInTheDocument();
  });

  it("shows no fake options when categories come back empty", async () => {
    api.get.mockImplementation((path) => Promise.resolve({ data: [] }));
    await openFilters();
    // Пустой справочник: выбирать нечего — контрол truthfully disabled,
    // никаких выдуманных опций (включая бывший catch-all).
    const trigger = screen.getByRole("combobox", { name: "Категория" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("Категория");
    expect(screen.queryByRole("option", { name: "Все категории" })).not.toBeInTheDocument();
  });

  it("filters rows by the selected canonical category id", async () => {
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) {
        return Promise.resolve({ data: [
          { id: "c1", name: "Супы", slug: "dish-supy", sort_order: 1, is_active: true },
          { id: "c2", name: "Десерты", slug: "dish-deserty", sort_order: 2, is_active: true },
        ] });
      }
      if (String(path).includes("/inventory/products")) {
        return Promise.resolve({ data: [
          { id: "p1", name: "Суп один", category_name: "Супы" },
          { id: "p2", name: "Торт один", category_name: "Десерты" },
        ] });
      }
      return Promise.resolve({ data: [] });
    });
    await openFilters();
    fireEvent.click(screen.getByRole("combobox", { name: "Категория" }));
    fireEvent.click(await screen.findByRole("option", { name: "Десерты" }));
    finishDropdownExit();
    // Фильтр по canonical id применяется сразу при выборе категории.
    expect(screen.getByText("Торт один")).toBeInTheDocument();
    expect(screen.queryByText("Суп один")).not.toBeInTheDocument();
  });

  it("shows the PNG empty state as a wrapper overlay when no rows match", async () => {
    await openFilters();
    const overlay = document.querySelector(".dish-grid-wrap.is-empty .dish-empty-overlay");
    expect(overlay).toBeInTheDocument();
    // Оверлей — сиблинг скролл-контейнера, НЕ широкая ячейка таблицы.
    expect(document.querySelector(".dish-empty-cell")).not.toBeInTheDocument();
    const emptyImg = overlay.querySelector(".owner-report-empty-image");
    expect(emptyImg).toBeInTheDocument();
    expect(emptyImg).toHaveAttribute("src", expect.stringContaining(".png"));
    expect(screen.getByText("Блюда не найдены")).toBeInTheDocument();
  });

  it("add drawer keeps a clean staff footer without the modifiers helper", async () => {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    expect(dialog.querySelector(".dish-mods__hint")).not.toBeInTheDocument();
    const footer = dialog.querySelector(".staff-form__footer");
    expect(footer).toBeInTheDocument();
    expect([...footer.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Отменить", "Добавить"]);
  });

  it("uses the exact settings table shell without viewport forcing", async () => {
    await openFilters();
    expect(document.querySelector(".settings-table-wrapper.dish-grid-wrap")).toBeInTheDocument();
    expect(document.querySelector("table.settings-table.dish-grid-table")).toBeInTheDocument();
    const css = readFileSync(join(process.cwd(), "src", "styles", "owner", "dishes.css"), "utf8");
    expect(css).not.toMatch(/\.dish-catalog-page[^{]*\{[^}]*min-height:\s*calc\(100dvh/);
    expect(css).not.toMatch(/\.dish-catalog-card[^{]*\{[^}]*min-height:\s*calc\(100dvh/);
  });
});
describe("APP dish photo (V4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
  });

  async function openAddDrawer() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    return document.querySelector(".staff-modal--cashier-full");
  }

  it("shows the staff photo block with backend-supported formats only", async () => {
    const dialog = await openAddDrawer();
    const photo = dialog.querySelector(".cashier-photo");
    expect(photo).toBeInTheDocument();
    expect(photo.querySelector(".staff-avatar--large")).toBeInTheDocument();
    const input = photo.querySelector("input[type='file']");
    expect(input.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect(photo.textContent).toContain("Загрузить фото");
  });

  it("rejects unsupported file types without any request", async () => {
    const dialog = await openAddDrawer();
    const input = dialog.querySelector(".cashier-photo__upload input[type='file']");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await screen.findByText("Поддерживаются только JPG, PNG и WebP.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("previews the picked file and uploads it after product creation", async () => {
    api.post.mockImplementation((path, payload) => {
      if (String(path).endsWith("/photo")) {
        expect(payload instanceof FormData).toBe(true);
        return Promise.resolve({ data: { ...backendProduct, id: "created-uuid", name: "С фото", image_url: "https://cdn.test/p.jpg" } });
      }
      api.get.mockImplementation((url) => Promise.resolve({ data: url === "/inventory/products"
        ? [{ ...backendProduct, id: "created-uuid", name: "С фото" }] : [] }));
      return Promise.resolve({ data: { ...backendProduct, id: "created-uuid", name: "С фото" } });
    });
    const dialog = await openAddDrawer();
    const input = dialog.querySelector(".cashier-photo__upload input[type='file']");
    fireEvent.change(input, { target: { files: [new File(["pixels"], "dish.png", { type: "image/png" })] } });
    const preview = await within(dialog).findByAltText("Новое фото блюда");
    expect(preview.getAttribute("src")).toMatch(/^blob:/);
    expect(dialog.textContent).toContain("Заменить фото");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "С фото" } });
    fireEvent.change(within(dialog).getByLabelText("Сорт"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      "/inventory/products/created-uuid/photo",
      expect.any(FormData),
    ));
    expect(screen.getByText("С фото")).toBeInTheDocument();
  });

  it("keeps the product but reports truthfully when photo upload fails", async () => {
    api.post.mockImplementation((path) => {
      if (String(path).endsWith("/photo")) {
        return Promise.reject({ response: { data: { detail: "Хранилище недоступно" } } });
      }
      api.get.mockImplementation((url) => Promise.resolve({ data: url === "/inventory/products"
        ? [{ ...backendProduct, id: "created-uuid", name: "Без фото" }] : [] }));
      return Promise.resolve({ data: { ...backendProduct, id: "created-uuid", name: "Без фото" } });
    });
    const dialog = await openAddDrawer();
    const input = dialog.querySelector(".cashier-photo__upload input[type='file']");
    fireEvent.change(input, { target: { files: [new File(["pixels"], "dish.png", { type: "image/png" })] } });
    await within(dialog).findByAltText("Новое фото блюда");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "Без фото" } });
    fireEvent.change(within(dialog).getByLabelText("Сорт"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText(/сохранено, но фото не загружено/);
    expect(screen.getByText("Без фото")).toBeInTheDocument();
    expect(document.querySelector(".staff-modal--cashier-full")).toBeInTheDocument();
  });

  it("V20 keeps the picked file after upload failure so retry needs no duplicate product", async () => {
    let photoAttempts = 0;
    api.post.mockImplementation((path) => {
      if (String(path).endsWith("/photo")) {
        photoAttempts += 1;
        if (photoAttempts === 1) {
          return Promise.reject({ response: { data: { detail: "Хранилище недоступно" } } });
        }
        return Promise.resolve({ data: { ...backendProduct, id: "created-uuid", name: "С фото", image_url: "https://cdn.test/p.jpg" } });
      }
      return Promise.resolve({ data: { ...backendProduct, id: "created-uuid", name: "С фото" } });
    });
    const dialog = await openAddDrawer();
    const input = dialog.querySelector(".cashier-photo__upload input[type='file']");
    fireEvent.change(input, { target: { files: [new File(["pixels"], "dish.png", { type: "image/png" })] } });
    await within(dialog).findByAltText("Новое фото блюда");
    fireEvent.change(within(dialog).getByLabelText("Название"), { target: { value: "С фото" } });
    fireEvent.change(within(dialog).getByLabelText("Сорт"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Цена"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить" }));
    await screen.findByText(/сохранено, но фото не загружено/);
    // Файл и превью сохранены — повтор использует тот же product ID (PATCH).
    // (Блюдо уже создано, поэтому дровер честно перешёл в режим редактирования.)
    expect(await within(dialog).findByAltText("Фото блюда")).toBeInTheDocument();
    api.patch.mockResolvedValue({ data: { ...backendProduct, id: "created-uuid", name: "С фото" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(photoAttempts).toBe(2));
    const creates = api.post.mock.calls.filter(([path]) => path === "/inventory/products");
    const updates = api.patch.mock.calls.filter(([path]) => path === "/inventory/products/created-uuid");
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(1);
  });

  it("edit shows the current real image with replace action and no demo URLs", async () => {
    api.get.mockImplementation((path) => (
      String(path).includes("/inventory/products")
        ? Promise.resolve({ data: [{ ...backendProduct, image_url: "https://cdn.test/real.jpg" }] })
        : Promise.resolve({ data: [] })
    ));
    render(<NomenclaturePage />);
    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = document.querySelector(".staff-modal--cashier-full");
    const current = dialog.querySelector(".cashier-photo img");
    expect(current.getAttribute("src")).toBe("https://cdn.test/real.jpg");
    expect(dialog.textContent).toContain("Заменить фото");
    const srcs = [...dialog.querySelectorAll("img")].map((img) => img.getAttribute("src") || "");
    expect(srcs.every((src) => !/unsplash|picsum|placeholder|demo/i.test(src))).toBe(true);
  });
});

// V9 — восстановление нормальной OWNER-оболочки: Блюда НЕ тащат page-контекст
// Настроек (settings-owner-view), а переиспользуют ТОЛЬКО безопасные leaf-
// примитивы (settings-card / settings-header / settings-table-wrapper /
// settings-table). Dishes-CSS владеет ТОЛЬКО скроллом, min-width, sticky,
// оверлеем, no-hover и inline-полями; визуалом владеет shared.
// Проверяем DOM-структуру + отсутствие дублирования + удаление legacy.
describe("APP dishes panel + table exact Settings template (V9)", () => {
  const dishesCss = readFileSync(join(process.cwd(), "src", "styles", "owner", "dishes.css"), "utf8");
  const settingsCss = readFileSync(join(process.cwd(), "src", "styles", "owner", "settings.css"), "utf8");
  const overridesCss = readFileSync(join(process.cwd(), "src", "styles", "react-overrides.css"), "utf8");
  const pageSrc = readFileSync(join(process.cwd(), "src", "pages", "NomenclaturePage.jsx"), "utf8");
  const tableSrc = readFileSync(join(process.cwd(), "src", "pages", "nomenclature", "DishesTable.jsx"), "utf8");

  it("does NOT attach the shell-breaking Settings page context", () => {
    // settings-owner-view — контекст страницы Настроек (shell-семантика);
    // на корне раздела Меню его быть не должно. Единственное допустимое
    // место — портал модалки подтверждения: он живёт вне shell, а стили
    // settings-modal/settings-drawer объявлены под этим контекстом.
    const pageRoot = pageSrc.match(/<section className="nomenclature-page[^"]*"/)?.[0] || "";
    expect(pageRoot).not.toMatch(/settings-owner-view/);
    const occurrences = [...pageSrc.matchAll(/settings-owner-view/g)];
    expect(occurrences).toHaveLength(1);
    expect(pageSrc).toMatch(/settings-owner-view dishcat-modal-layer dish-confirm-layer/);
  });

  it("reuses only safe leaf primitives (settings-card/table)", () => {
    // Панель — тот же settings-card как leaf (без page-контекста).
    expect(pageSrc).toMatch(/settings-card/);
    // V13 — буквальный клон структуры эталона: section + header элементы
    // и то же вложение (header > title-group + actions), без page-контекста.
    expect(pageSrc).toMatch(/<section className="dish-catalog-card owner-report-surface settings-card">/);
    expect(pageSrc).toMatch(/<header className="settings-header dish-catalog-header">/);
    expect(pageSrc).not.toMatch(/<div className="settings-header dish-catalog-header">/);
    // Таблица — тот же settings-table-wrapper / settings-table, скролл —
    // только overflow-обёртка dish-grid-scroll (без визуала карточки).
    expect(tableSrc).toMatch(/settings-table-wrapper/);
    expect(tableSrc).toMatch(/settings-table dish-grid-table/);
    expect(tableSrc).toMatch(/dish-grid-scroll/);
    // Эталон .settings-table th в самом деле задаёт базу шапки.
    expect(settingsCss).toMatch(/\.settings-table th\s*\{[^}]*background:\s*var\(--blue-50/);
    expect(settingsCss).toMatch(/\.settings-table th\s*\{[^}]*color:\s*#456174/);
  });

  it("does not duplicate TH/TD/radius visual (shared owns it, legacy removed)", () => {
    // Dishes НЕ переопределяет фон/цвет шапки — выигрывает общий примитив
    // одинаково для обеих страниц (live: blue-50 / #456174 1-в-1).
    expect(dishesCss).not.toMatch(/\.owner-report-view \.dish-grid-table th\s*\{[^}]*background:\s*var\(--blue-50/);
    expect(dishesCss).not.toMatch(/\.owner-report-view \.dish-grid-table th\s*\{[^}]*color:\s*#456174/);
    // Радиусы 20px и одинарный divider — из shared (.settings-table),
    // dish-дублирование удалено.
    expect(dishesCss).not.toMatch(/\.dish-grid-table th:first-child\s*\{[^}]*border-top-left-radius/);
    expect(dishesCss).not.toMatch(/\.dish-grid-table th:last-child\s*\{[^}]*border-top-right-radius/);
    expect(dishesCss).not.toMatch(/\.owner-report-view \.dish-grid-table td\s*\{[^}]*border-bottom/);
    // Shared владеет радиусами 20px.
    expect(settingsCss).toMatch(/\.settings-table th:first-child\s*\{[^}]*border-top-left-radius:\s*20px/);
    expect(settingsCss).toMatch(/\.settings-table th:last-child\s*\{[^}]*border-top-right-radius:\s*20px/);
    // Legacy dish-переопределения TH/TD/радиусов/hover удалены хирургически.
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-table th\s*\{[^}]*background:\s*var\(--dish-header-bg/);
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-table th\s*\{[^}]*color:\s*#58708d/);
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-table tbody tr:hover td/);
  });

  it("keeps scrolling internal while its vertical control lives outside the table", () => {
    const scrollRule = dishesCss.match(/\.owner-report-view \.dish-grid-scroll\s*\{([^}]*)\}/)?.[1] || "";
    expect(scrollRule).toMatch(/overflow-x:\s*auto/);
    expect(scrollRule).toMatch(/overflow-y:\s*auto/);
    expect(scrollRule).toMatch(/min-height:\s*0/);
    expect(scrollRule).toMatch(/overscroll-behavior:\s*contain/);
    expect(scrollRule).toMatch(/scrollbar-width:\s*none/);
    expect(scrollRule).toMatch(/-ms-overflow-style:\s*none/);
    expect(dishesCss).toMatch(/\.dish-grid-scroll::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
    expect(dishesCss).toMatch(/\.catalog-external-scrollbar::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
    expect(dishesCss).toMatch(/\.dish-grid-scroll::-webkit-scrollbar\s*\{[^}]*height:\s*0/);
    // Внешняя обёртка остаётся в пределах видимой ширины (нет оверфлоу страницы).
    const wrapRule = dishesCss.match(/\.owner-report-view \.dish-grid-wrap\s*\{([^}]*)\}/)?.[1] || "";
    expect(wrapRule).toMatch(/max-width:\s*100%/);
  });

  it("gives the table wrapper no inner padding / reserved scrollbar gutter", () => {
    // «Странный паддинг внутри» обёртки шёл от legacy scrollbar-gutter: stable
    // both-edges + overflow:scroll. Внешняя обёртка клипует (overflow:hidden),
    // прокрутка живёт в .dish-grid-scroll с scrollbar-gutter: auto.
    const wrapRule = dishesCss.match(/\.owner-report-view \.dish-grid-wrap\s*\{([^}]*)\}/)?.[1] || "";
    expect(wrapRule).toMatch(/padding:\s*0/);
    expect(wrapRule).toMatch(/overflow:\s*hidden/);
    const scrollRule = dishesCss.match(/\.owner-report-view \.dish-grid-scroll\s*\{([^}]*)\}/)?.[1] || "";
    expect(scrollRule).toMatch(/scrollbar-gutter:\s*auto/);
    expect(scrollRule).not.toMatch(/stable both-edges/);
  });

  it("uses the available viewport without giant fixed heights or priority overrides", () => {
    expect(dishesCss).not.toMatch(/\.dish-catalog-card[^{]*\{[^}]*min-height:\s*(100vh|100dvh|calc\(100)/);
    expect(dishesCss).not.toMatch(/\.dish-catalog-card[^{]*\{[^}]*[;\s]height:\s*100%/);
    // Приоритетные декларации запрещены дизайн-системой (слои @layer).
    expect(dishesCss).not.toMatch(/!\s*important/i);
  });

  it("bounds long lists to the available shell height and keeps the bottom border stationary", () => {
    const pageRules = [...dishesCss.matchAll(/\.dish-catalog-page\.owner-report-view\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(pageRules.some((rule) => /height:\s*100%/.test(rule) && /flex-direction:\s*column/.test(rule))).toBe(true);
    const card = dishesCss.match(/\.dish-catalog-page\.owner-report-view \.dish-catalog-card\s*\{([^}]*)\}/)?.[1] || "";
    expect(card).toMatch(/max-height:\s*100%/);
    expect(card).toMatch(/min-height:\s*0/);
    expect(card).toMatch(/border:\s*1px solid/);
    const wrap = dishesCss.match(/\.owner-report-view \.dish-grid-wrap\s*\{([^}]*)\}/)?.[1] || "";
    expect(wrap).toMatch(/flex:\s*0 1 auto/);
    expect(wrap).toMatch(/min-height:\s*0/);
    expect(wrap).toMatch(/border:\s*1px solid/);
    expect(dishesCss).toMatch(/\.dish-catalog-card > :not\(\.dish-grid-wrap\)\s*\{[^}]*flex-shrink:\s*0/);
    expect(dishesCss).toMatch(/\.dish-grid-table thead th\s*\{[^}]*position:\s*sticky/);
    expect(card).toMatch(/flex:\s*0 1 auto/);
    const table = dishesCss.match(/\.owner-report-view \.dish-grid-table\s*\{([^}]*)\}/)?.[1] || "";
    expect(table).toMatch(/min-height:\s*0/);
    expect(table).toMatch(/height:\s*auto/);
    expect(dishesCss).toMatch(/@media\s*\(min-width:\s*1025px\)[\s\S]*?\.dashboard-content:has\(\.dish-catalog-page\.owner-report-view\)\s*\{[^}]*padding-bottom:\s*12px/);
  });

  it("shrink-wraps real rows, removes fake end padding and rounds the wrapper focus ring", () => {
    const scroll = dishesCss.match(/\.owner-report-view \.dish-grid-scroll\s*\{([^}]*)\}/)?.[1] || "";
    expect(scroll).toMatch(/flex:\s*0 1 auto/);
    const end = dishesCss.match(/\.dish-grid-wrap:not\(\.is-empty\) \.dish-grid-scroll\s*\{([^}]*)\}/)?.[1] || "";
    expect(end).toMatch(/padding-bottom:\s*0/);
    expect(end).not.toMatch(/48px/);
    expect(dishesCss).toMatch(/\.dish-grid-wrap:has\(> \.dish-grid-scroll:focus-visible\)\s*\{[^}]*outline:\s*2px solid/);
    expect(dishesCss).toMatch(/\.dish-grid-wrap\.is-empty\s*\{[^}]*height:\s*270px/);
  });

  it("resets page padding to 0 so edge gutters are 1:1 with other OWNER pages", () => {
    // Каталог блюд сбрасывает поле страницы (padding:0, как .settings-owner-view
    // у эталона) и полагается на оболочку, но НЕ несёт сам page-контекст.
    const pageRules = [...dishesCss.matchAll(/\.dish-catalog-page\.owner-report-view\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(pageRules.some((body) => /padding:\s*0/.test(body))).toBe(true);
    expect(settingsCss).toMatch(/\.settings-owner-view\s*\{[^}]*padding:\s*0/);
    expect(pageSrc).toMatch(/dish-catalog-page owner-report-view/);
  });

  it("aligns top spacing with the template on desktop only (V14)", () => {
    // Только padding-top, только ≥1025px: карточка начинается на той же Y.
    // Лево/право/низ/ширина/breakpoint-ы не трогаем.
    expect(dishesCss).toMatch(
      /@media\s*\(\s*min-width:\s*1025px\s*\)[\s\S]{1,400}?\.dashboard-content:has\(\.dish-catalog-page\)\s*\{[^}]*padding-top:\s*14px/,
    );
    const blocks = [...dishesCss.matchAll(/\.dashboard-content:has\(\.dish-catalog-page\)\s*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const body of blocks) {
      expect(body).not.toMatch(/padding-bottom/);
      expect(body).not.toMatch(/overflow/);
      expect(body).not.toMatch(/width/);
    }
  });

  it("clips table corners exactly like the template (V14, no table-level radius)", () => {
    // Видимый радиус/клиппинг владеет settings-table-wrapper (20px) + углы TH.
    // Таблица и скролл-слой радиуса НЕ имеют (legacy 18px удалён) — тот же
    // механизм, что у эталона (wrap clip + TH corners).
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-table\s*\{[^}]*border-radius/);
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-table\s*\{[^}]*overflow:\s*hidden/);
    expect(dishesCss).not.toMatch(/\.dish-grid-table\s*\{[^}]*border-radius/);
    expect(settingsCss).toMatch(/\.settings-table-wrapper\s*\{[^}]*border-radius:\s*20px/);
  });

  it("keeps a safe inline-only shell gutter (no shell-breaking ownership)", () => {
    // V9: ширина карточки — из dish-скоупа ТОЛЬКО padding-inline 16px.
    // Верх/низ/overflow принадлежат нормальной оболочке (не трогаем).
    const gutter = dishesCss.match(/\.dashboard-content:has\(\.dish-catalog-page\)\s*\{([^}]*)\}/)?.[1] || "";
    expect(gutter).toMatch(/padding-left:\s*16px/);
    expect(gutter).toMatch(/padding-right:\s*16px/);
    expect(gutter).not.toMatch(/padding-top/);
    expect(gutter).not.toMatch(/padding-bottom/);
    expect(gutter).not.toMatch(/overflow/);
    expect(settingsCss).toMatch(/\.dashboard-content:has\(\.settings-owner-view\)/);
    // Legacy dish-оболочка (padding-bottom 8px / overflow hidden) удалена.
    expect(overridesCss).not.toMatch(/body\.dashboard-body:has\(\.dish-catalog-page\) \.dashboard-content\s*\{[^}]*padding-bottom:\s*8px/);
    expect(overridesCss).not.toMatch(/body\.dashboard-body:has\(\.dish-catalog-page\) \.dashboard-content\s*\{[^}]*overflow:\s*hidden/);
    // Legacy gutter stable both-edges удалён (остался только auto).
    expect(overridesCss).not.toMatch(/\.dish-catalog-page \.dish-grid-wrap[^}]*scrollbar-gutter:\s*stable both-edges/);
  });

  it("clones the template header display mode without the page context (V13)", () => {
    // Тот же grid-режим, что вариант .settings-owner-view .settings-header,
    // но dish-скоупом (page-контекст запрещён): зеркальные значения.
    const headerRule = dishesCss.match(/\.dish-catalog-page \.dish-catalog-header\s*\{([^}]*)\}/)?.[1] || "";
    expect(headerRule).toMatch(/display:\s*grid/);
    expect(headerRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
    // H1 идёт тем же наследственным путём, что эталон (не normal-пин V11).
    expect(dishesCss).toMatch(/\.dish-catalog-header \.settings-title-group h1\s*\{[^}]*line-height:\s*inherit/);
    expect(dishesCss).not.toMatch(/\.dish-catalog-header \.settings-title-group h1\s*\{[^}]*line-height:\s*normal/);
    // Same header skin; the card may now shrink its table to the shell height.
    const cardRule = dishesCss.match(/\.dish-catalog-page\.owner-report-view \.dish-catalog-card\s*\{([^}]*)\}/)?.[1] || "";
    expect(cardRule).toMatch(/display:\s*flex/);
    expect(cardRule).toMatch(/flex-direction:\s*column/);
    expect(cardRule).toMatch(/flex:\s*0 1 auto/);
    expect(cardRule).toMatch(/max-height:\s*100%/);
  });

  it("aligns inner header geometry with the template (V11 leaf pins)", () => {
    // Accent 44px + H1 neutral-950/normal + подпись 12/18 — живые значения
    // эталона; пины scoped под Блюда и бьют legacy dish-правила.
    expect(dishesCss).toMatch(/\.dish-catalog-header \.settings-accent-bar\s*\{[^}]*height:\s*44px/);
    expect(dishesCss).toMatch(/\.dish-catalog-header \.settings-title-group h1\s*\{[^}]*color:\s*var\(--neutral-950/);
    expect(dishesCss).toMatch(/\.dish-catalog-header \.settings-title-group p\s*\{[^}]*line-height:\s*18px/);
    // Кнопки не редизайним: их геометрия/функциональность untouched.
    expect(dishesCss).not.toMatch(/\.dish-add-button\s*\{[^}]*height:\s*42px/);
  });

  it("preserves normal desktop main-content positioning (no dup nav at 1440)", () => {
    // Ни dishes.css, ни page не трогают sidebar/main/topbar/nav/shell:
    // позиционированием владеет нормальная оболочка.
    expect(dishesCss).not.toMatch(/\.dashboard-shell/);
    expect(dishesCss).not.toMatch(/\.dashboard-main/);
    expect(dishesCss).not.toMatch(/\.dashboard-topbar/);
    expect(dishesCss).not.toMatch(/\.dashboard-sidebar/);
    expect(dishesCss).not.toMatch(/mobile-bottom-nav/);
    // :has допустим только для позиционирования плавающего виджета поддержки —
    // оболочкой (shell/main/topbar/sidebar/content) страница не владеет.
    const hasRules = [...dishesCss.matchAll(/body\.dashboard-body:has\([^{]*\{[^}]*\}/g)].map((m) => m[0]);
    for (const rule of hasRules) {
      expect(rule).toMatch(/\.support-widget/);
    }
    expect(pageSrc).not.toMatch(/mobile-bottom-nav/);
    expect(pageSrc).not.toMatch(/dashboard-shell/);
  });

  it("keeps the V30 row hover tint scoped to the dishes table only", () => {
    const hoverRow = dishesCss.match(/\.owner-report-view \.dish-grid-table tbody tr:hover\s*\{([^}]*)\}/)?.[1] || "";
    const hoverCell = dishesCss.match(/\.owner-report-view \.dish-grid-table tbody tr:hover td\s*\{([^}]*)\}/)?.[1] || "";
    // V30: строка подсвечивается neutral-50, ячейки прозрачны (тинт строки
    // виден), контролы сохраняют свои состояния.
    expect(hoverRow).toMatch(/background:\s*var\(--neutral-50/);
    expect(hoverCell).toMatch(/background:\s*transparent/);
    // Правило строго скоупнуто под каталог блюд.
    expect(dishesCss).not.toMatch(/\.settings-table tbody tr:hover\s*\{[^}]*neutral-50/);
  });

  it("gives the empty table a compact template height only when empty (V12, no 360 floor)", () => {
    // 360px пол удалён — пустая обёртка компактная (270px), без vh/dvh.
    expect(dishesCss).not.toMatch(/min-height:\s*360px/);
    const wrapRule = dishesCss.match(/\.dish-grid-wrap\.is-empty\s*\{([^}]*)\}/)?.[1] || "";
    expect(wrapRule).toMatch(/height:\s*270px/);
    expect(wrapRule).toMatch(/flex-basis:\s*270px/);
    const minRule = dishesCss.match(/\.dish-grid-wrap\.is-empty \.dish-grid-scroll\s*\{([^}]*)\}/)?.[1] || "";
    // Скролл-слой не задаёт собственный пол — высоту даёт обёртка.
    expect(minRule).toMatch(/min-height:\s*0/);
    expect(dishesCss).not.toMatch(/\.dish-grid-wrap\.is-empty[^}]*100dvh/);
    expect(dishesCss).not.toMatch(/\.dish-grid-wrap\.is-empty[^}]*100vh/);
    // PNG пустого состояния — компактный display-размер того же ассета.
    expect(dishesCss).toMatch(/\.dish-empty-overlay \.owner-report-empty-image\s*\{[^}]*height:\s*120px/);
    // Оверлей позиционируется абсолютно относительно видимой обёртки и не ловит
    // события (скроллбар остаётся доступным).
    const overlay = dishesCss.match(/\.owner-report-view \.dish-empty-overlay\s*\{([^}]*)\}/)?.[1] || "";
    expect(overlay).toMatch(/position:\s*absolute/);
    expect(overlay).toMatch(/pointer-events:\s*none/);
    expect(overlay).toMatch(/place-items:\s*center/);
  });
});

// V10 — регрессия OWNER-оболочки: mobile-bottom-nav — прямой flex-ребёнок
// .dashboard-shell (всегда в DOM, видимость — только CSS). На десктопе wider
// 1024 он обязан быть display:none и не занимать место (иначе ~417px коридор
// между sidebar и main). Проверяем источник/каскад на уровне исходников:
// base-правило вне media, block-вариант внутри канонического max-width:1024,
// импорт в main.jsx, отсутствие JS-гейтинга по ширине.
describe("APP owner shell mobile-nav regression (V10)", () => {
  const overridesCss = readFileSync(join(process.cwd(), "src", "styles", "react-overrides.css"), "utf8");
  const mainJsx = readFileSync(join(process.cwd(), "src", "main.jsx"), "utf8");
  const sidebarSrc = readFileSync(join(process.cwd(), "src", "components", "Sidebar.jsx"), "utf8");
  const mobileNavSrc = readFileSync(
    join(process.cwd(), "src", "components", "sidebar", "SidebarMobileNav.jsx"), "utf8",
  );

  it("hides mobile-bottom-nav on desktop at the shell source (display:none outside media)", () => {
    // Base display:none обязан существовать как самостоятельное правило.
    expect(overridesCss).toMatch(/\.mobile-bottom-nav\s*\{\s*display:\s*none/);
    // Block-вариант живёт внутри канонического брейкпоинта max-width:1024
    // (не изобретённого): ищем media-блок, содержащий это правило.
    const mediaRe = /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]{1,2000}?\.mobile-bottom-nav\s*\{[^}]*display:\s*block/;
    expect(mediaRe.test(overridesCss)).toBe(true);
  });

  it("imports the shell stylesheet into the app entry (no missing import)", () => {
    expect(mainJsx).toMatch(/styles\/react-overrides\.css/);
  });

  it("keeps mobile-nav visibility CSS-driven (no JS width gating)", () => {
    // Компонент всегда в DOM (flex-ребёнок shell) — видимостью владеет CSS.
    expect(sidebarSrc).toMatch(/SidebarMobileNav/);
    expect(mobileNavSrc).toMatch(/mobile-bottom-nav/);
    expect(sidebarSrc).not.toMatch(/matchMedia/);
    expect(sidebarSrc).not.toMatch(/innerWidth/);
    expect(mobileNavSrc).not.toMatch(/matchMedia/);
    expect(mobileNavSrc).not.toMatch(/innerWidth/);
  });

  it("never hides mobile-nav via Dishes-only selectors or !important", () => {
    const dishesCss = readFileSync(join(process.cwd(), "src", "styles", "owner", "dishes.css"), "utf8");
    expect(dishesCss).not.toMatch(/mobile-bottom-nav/);
    expect(overridesCss).not.toMatch(/\.dish-catalog-page[^{]*\.mobile-bottom-nav/);
    expect(overridesCss).not.toMatch(/\.nomenclature-page[^{]*\.mobile-bottom-nav/);
    expect(dishesCss).not.toMatch(/!\s*important/i);
  });
});

// V7 — пустое состояние вынесено оверлеем вне скролл-контейнера, поэтому его
// центр не зависит от min-width таблицы и scrollLeft. Проверяем именно
// архитектуру DOM (jsdom не считает layout, но структура = гарантия).
describe("APP dishes empty-state overlay architecture (V7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [] });
  });

  it("renders the empty overlay as a sibling OUTSIDE the horizontal scroll container", async () => {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const wrap = document.querySelector(".dish-grid-wrap.is-empty");
    const scroll = wrap.querySelector(".dish-grid-scroll");
    const overlay = wrap.querySelector(".dish-empty-overlay");
    expect(scroll).toBeInTheDocument();
    expect(overlay).toBeInTheDocument();
    // Таблица (широкая, со скроллом) живёт в scroll-контейнере…
    expect(scroll.querySelector("table.dish-grid-table")).toBeInTheDocument();
    // …а оверлей НЕ внутри него — значит scrollLeft/min-width таблицы на него
    // не влияют. Оверлей — прямой ребёнок видимой обёртки.
    expect(scroll.querySelector(".dish-empty-overlay")).toBeNull();
    expect(overlay.parentElement).toBe(wrap);
    // Пустое состояние НЕ рендерится как широкая ячейка таблицы.
    expect(document.querySelector(".dish-empty-cell")).toBeNull();
  });

  it("keeps the header columns inside the scrollable table when empty", async () => {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const scroll = document.querySelector(".dish-grid-wrap.is-empty .dish-grid-scroll");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("aria-label", "Таблица блюд с прокруткой");
    expect(scroll).toHaveAttribute("tabindex", "0");
    const headers = [...scroll.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Фото", "Название", "Ед. изм", "Цена"]));
  });

  it("hides the overlay and shows rows in the scroll table when populated", async () => {
    api.get.mockImplementation((path) => (
      String(path).includes("/inventory/products")
        ? Promise.resolve({ data: [{ id: "p1", name: "Плов" }] })
        : Promise.resolve({ data: [] })
    ));
    render(<NomenclaturePage />);
    expect(await screen.findByText("Плов")).toBeInTheDocument();
    expect(document.querySelector(".dish-empty-overlay")).toBeNull();
    expect(document.querySelector(".dish-grid-wrap.is-empty")).toBeNull();
    expect(document.querySelector(".dish-grid-scroll table.dish-grid-table")).toBeInTheDocument();
  });
});

// V19 — Категория/Принтер формы: кастомные single-селекты семьи
// orders-filter-select (как фильтр/Reports), НЕ нативные <select>.
// Портал дровера вне .dish-catalog-page, поэтому скоуп правил —
// :is(.dish-catalog-page, .dish-drawer). Preselect — по каноническим ID
// из ответа (category_id/printer_id), не по имени.
describe("APP dishes drawer custom selects (V19)", () => {
  const dishesCss = readFileSync(join(process.cwd(), "src", "styles", "owner", "dishes.css"), "utf8");
  const CATS = [{ id: "c1", name: "Супы", sort_order: 1, is_active: true }];
  const PRINTERS = [
    { id: "pr1", name: "Кухня", is_active: true },
    { id: "pr2", name: "Бар", is_active: false },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) return Promise.resolve({ data: CATS });
      if (String(path).includes("/printers")) return Promise.resolve({ data: PRINTERS });
      return Promise.resolve({ data: [] });
    });
  });

  async function openAddDrawer() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    return document.querySelector(".staff-modal--cashier-full.dish-drawer");
  }

  it("renders no native selects and keeps panels closed by default", async () => {
    const dialog = await openAddDrawer();
    const body = dialog.querySelector(".dish-drawer__body");
    // V18/V19: нативных <select> в дровере не осталось — все поля
    // на кастомных селектах (Категория/Ед. изм/Принтер).
    expect(body.querySelectorAll("select").length).toBe(0);
    expect(body.querySelector(".dish-form-field select")).toBeNull();
    expect(body.querySelector(".dish-form-field .orders-filter-select__trigger")).toBeInTheDocument();
    expect(body.querySelector(".orders-filter-select__panel")).toBeNull();
  });

  it("opens the custom panel on click and picks a canonical ID, then closes", async () => {
    const dialog = await openAddDrawer();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Категория" }));
    expect(await within(dialog).findByRole("option", { name: "Супы" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Супы" }));
    expect(within(dialog).getByRole("combobox", { name: "Категория" })).toHaveTextContent("Супы");
  });

  it("shows real printers with inactive marked and binds printer IDs", async () => {
    const dialog = await openAddDrawer();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Принтер" }));
    expect(await within(dialog).findByRole("option", { name: "Кухня" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Бар (не активен)" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Бар (не активен)" }));
    expect(within(dialog).getByRole("combobox", { name: "Принтер" })).toHaveTextContent("Бар (не активен)");
  });

  it("prefers canonical response IDs over name lookup on edit", async () => {
    const saved = {
      ...backendProduct,
      name: "Плов",
      category_id: "c1",
      category_name: "УДАЛЕНО-ИЗ-СПРАВОЧНИКА",
      printer_id: "pr2",
      printer_name: "ДРУГОЕ-ИМЯ",
    };
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/categories")) return Promise.resolve({ data: CATS });
      if (String(path).includes("/printers")) return Promise.resolve({ data: PRINTERS });
      return Promise.resolve({ data: [saved] });
    });
    render(<NomenclaturePage />);
    expect(await screen.findByText("Плов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    const dialog = document.querySelector(".staff-modal--cashier-full.dish-drawer");
    // ID выиграли у несовпадающих имён: Супы (c1), Бар (pr2).
    expect(within(dialog).getByRole("combobox", { name: "Категория" })).toHaveTextContent("Супы");
    expect(within(dialog).getByRole("combobox", { name: "Принтер" })).toHaveTextContent("Бар (не активен)");
  });

  it("keeps canonical IDs in row mapping and drawer scope out of shell", async () => {
    expect(mapNomenclatureProduct({ ...backendProduct, category_id: "c1", printer_id: "pr9" })).toMatchObject({
      categoryId: "c1",
      printerId: "pr9",
    });
    // Скоуп селектов покрывает и дровер (портал вне страницы), и общий
    // staff-drawer (там тот же контрол — поле «Принтер» у сотрудника).
    expect(dishesCss).toMatch(/:is\(\.dish-catalog-page,\s*\.dish-drawer,\s*\.dish-recipes-dialog[^)]*\) \.orders-filter-select/);
    expect(dishesCss).not.toMatch(/\.dashboard-shell[^{]*orders-filter-select/);
  });
});

// V20 — функциональные разрывы: ретрай фото без дубля, контракт добавок,
// маппинг колонок. Backend/storage чинит другая сторона (см. handoff в отчёте);
// здесь — только frontend-безопасное + честные состояния без фейков.
describe("APP dishes functional gaps (V20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockResolvedValue({ data: [] });
  });

  it("hides add-ons and does not fetch or mutate saved modifier groups", async () => {
    api.get.mockImplementation((path) => {
      if (String(path).includes("/inventory/products")) return Promise.resolve({ data: [{ ...backendProduct, id: "d9" }] });
      return Promise.resolve({ data: [] });
    });
    render(<NomenclaturePage />);
    expect(await screen.findByText("Backend dish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
    expect(screen.queryByText("Добавки")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить группу" })).not.toBeInTheDocument();
    expect(api.get.mock.calls.some(([path]) => String(path).includes("modifier-groups"))).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("maps every table column from its own backend aggregate (documented)", () => {
    const row = mapNomenclatureProduct({
      id: "x", name: "Плов", product_type: "dish", unit: "порция",
      cost_price: 18000, price: 45000, category_name: "Горячие блюда",
      subcategory_name: "Супы", printer_name: "Кухня",
    });
    expect(row.menu).toBe("Горячие блюда"); // backend без menu-сущности: МЕНЮ = category_name (исторический контракт)
    expect(row.subcategory).toBe("Супы");
    expect(row.printer).toBe("Кухня");
    expect(row.category).toBe("Горячие блюда");
    expect(row.name).toBe("Плов");
  });
});

// V17 — категория каталога: shared Reports-мультиселект (ReportMultiSelect).
// Без «Все категории» (пустой массив = без ограничения), checkbox-ряды,
// панель не закрывается при тоггле, сводка formatSelectedLabels, OR по
// полному загруженному датасету, Очистить сбрасывает всё. Без выдуманных
// данных и без новых backend-параметров (фильтрация клиентская).
describe("APP dishes category multi-select (V17)", () => {
  const CATS = [
    { id: "c1", name: "Напитки", sort_order: 1, is_active: true },
    { id: "c2", name: "Горячие блюда", sort_order: 2, is_active: true },
  ];
  const PRODS = [
    { id: "p1", name: "Кола", category_name: "Напитки" },
    { id: "p2", name: "Плов", category_name: "Горячие блюда" },
    { id: "p3", name: "Чай", category_name: "Напитки" },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    api.get.mockImplementation((path) => (
      String(path).includes("/inventory/categories")
        ? Promise.resolve({ data: { items: CATS } })
        : Promise.resolve({ data: { items: PRODS } })
    ));
  });

  function applyPanelFilters() {
    // Кнопки «Фильтровать» в панели больше нет: категория применяется
    // моментально при клике по опции. Хелпер оставлен точкой расширения,
    // чтобы тесты читались как раньше.
  }

  async function openCategory() {
    render(<NomenclaturePage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // Шапка: toggle раскрытия панели; внутри панели: apply-кнопка.
    fireEvent.click(document.querySelector(".dishes-filter-toggle"));
    fireEvent.click(screen.getByRole("combobox", { name: "Категория" }));
  }

  it("renders only canonical categories with checkboxes, no catch-all option", async () => {
    await openCategory();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toHaveLength(2);
    expect(document.querySelector(".dish-filter-panel")?.textContent).not.toMatch(/Все категории/);
    expect(document.querySelectorAll(".owner-msel__check")).toHaveLength(2);
  });

  it("toggles multiple rows without closing and persists summary + reopen state", async () => {
    await openCategory();
    fireEvent.click(screen.getByRole("option", { name: "Напитки" }));
    // Панель осталась открытой, первая строка checked.
    expect(screen.getByRole("listbox", { hidden: false })).toBeInTheDocument();
    expect(document.querySelectorAll(".owner-msel__option.is-checked")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "Горячие блюда" }));
    expect(document.querySelectorAll(".owner-msel__option.is-checked")).toHaveLength(2);
    // Сводка как в Reports: имена через запятую в порядке опций.
    expect(screen.getByRole("combobox", { name: "Категория" }).textContent).toMatch(/Напитки, Горячие блюда/);
    // Закрыть/открыть — выбор сохранён (draft, не сброшен).
    fireEvent.keyDown(document.querySelector(".orders-filter-select"), { key: "Escape" });
    fireEvent.click(screen.getByRole("combobox", { name: "Категория" }));
    expect(document.querySelectorAll(".owner-msel__option.is-checked")).toHaveLength(2);
  });

  it("applies OR semantics over the full dataset and Clear resets everything", async () => {
    await openCategory();
    fireEvent.click(screen.getByRole("option", { name: "Напитки" }));
    applyPanelFilters();
    expect(await screen.findByText("Кола")).toBeInTheDocument();
    expect(screen.getByText("Чай")).toBeInTheDocument();
    expect(screen.queryByText("Плов")).not.toBeInTheDocument();
    fireEvent.click(document.querySelector(".dishes-filter-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Очистить" }));
    expect(await screen.findByText("Плов")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Категория" }).textContent).toBe("Категория");
  });

  it("keeps category state as canonical ID arrays (no invented contract)", async () => {
    const hookSrc = readFileSync(join(process.cwd(), "src", "pages", "nomenclature", "useDishesCatalog.js"), "utf8");
    expect(hookSrc).toMatch(/category:\s*\[\]/);
    expect(hookSrc).not.toMatch(/category_ids/);
    expect(hookSrc).not.toMatch(/categoryId=/);
    const toolbarSrc = readFileSync(join(process.cwd(), "src", "pages", "nomenclature", "DishesToolbar.jsx"), "utf8");
    expect(toolbarSrc).toMatch(/ReportMultiSelect/);
    expect(toolbarSrc).not.toMatch(/Все категории/);
    expect(toolbarSrc).not.toMatch(/DishCategorySelect/);
  });
});
