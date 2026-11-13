// OWNER-панель фильтрации каталога блюд. Disclosure/filter pattern
// страницы «Отчёт по заказам»; категория — shared Reports-примитив
// ReportMultiSelect (checkbox-ряды, панель не закрывается при тоггле,
// сводка formatSelectedLabels, состояние — массив canonical IDs).
import { useState } from "react";
import Icon from "../../components/Icon";
import ReportMultiSelect, { formatSelectedLabels } from "../../components/ReportMultiSelect";
import { t } from "../../i18n/t";

const EMPTY_FILTERS = { search: "", category: [] };

export function dishCategorySummary(selected, options) {
  return formatSelectedLabels(selected, options);
}

export default function DishesToolbar({
  draftFilters,
  setDraftFilters,
  setFilters,
  filters = { search: "", category: [] },
  filtersOpen,
  closeFilters,
  categoryOptions = [],
  categoriesUnavailable = false,
}) {
  // Single-open оркестрация дропдауна категории (как dishFilterPanelProps
  // в Reports): toggle не закрывает панель, закрытие — outside/Escape/toggle.
  const [panelState, setPanelState] = useState({ active: "", closing: "", pending: "" });
  function requestPanel(panelId) {
    setPanelState((current) => {
      if (current.closing) {
        const nextPending = current.pending === panelId ? "" : panelId;
        return { ...current, pending: nextPending };
      }
      if (!current.active) return panelId ? { active: panelId, closing: "", pending: "" } : current;
      return {
        active: "",
        closing: current.active,
        pending: current.active === panelId ? "" : panelId,
      };
    });
  }
  function completePanelExit(panelId) {
    setPanelState((current) => {
      if (current.closing !== panelId) return current;
      return { active: current.pending, closing: "", pending: "" };
    });
  }
  function closeCategoryPanel() {
    requestPanel("");
  }
  // Категория применяется моментально (без кнопки Фильтровать):
  // черновик и активный фильтр синхронны, введённый поиск не трогаем.
  const toggleCategory = (value) => {
    const list = Array.isArray(draftFilters.category) ? draftFilters.category : [];
    const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    setDraftFilters((prev) => ({ ...prev, category: next }));
    setFilters({ search: filters?.search || "", category: next });
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    closeFilters();
  };
  const draftCategory = Array.isArray(draftFilters.category) ? draftFilters.category : [];
  const categorySelectOptions = categoryOptions.map((item) => (
    typeof item === "string" ? { value: item, label: item } : { value: item.id, label: item.name }
  ));

  return (
    <div className={`orders-filter-collapse dish-filter-collapse${filtersOpen ? " is-open" : ""}`}>
      <div className="orders-filter-collapse__inner" inert={!filtersOpen ? true : undefined}>
        <div className="report-filters-grid dish-filter-panel" id="dishes-catalog-filters" aria-label={t("pages.nomenclature.dishestoolbar.filtry_kataloga_blyud")}>
          <label className="report-filter-input">
            <Icon name="bi-search" size={17} />
            <input
              aria-label={t("pages.nomenclature.dishestoolbar.poisk_blyud")}
              value={draftFilters.search}
              onChange={(event) => {
                const next = event.target.value;
                setDraftFilters((prev) => ({ ...prev, search: next }));
                setFilters({
                  search: next,
                  category: Array.isArray(filters?.category) ? filters.category : [],
                });
              }}
              placeholder={t("pages.nomenclature.dishestoolbar.poisk")}
            />
          </label>
          <ReportMultiSelect
            filterKey="dish-category"
            label={t("pages.nomenclature.dishestoolbar.kategoriya")}
            placeholder={categoriesUnavailable ? t("pages.nomenclature.dishestoolbar.kategorii_nedostupny") : t("pages.nomenclature.dishestoolbar.kategoriya")}
            options={categorySelectOptions}
            selected={draftCategory}
            onToggle={toggleCategory}
            disabled={categoriesUnavailable || categorySelectOptions.length === 0}
            open={panelState.active === "category"}
            closing={panelState.closing === "category"}
            onOpen={() => requestPanel("category")}
            onClose={closeCategoryPanel}
            onExitComplete={() => completePanelExit("category")}
          />
          <div className="report-filter-buttons dish-filter-actions">
            <button type="button" className="report-filter-clear" onClick={clearFilters}>
              <Icon name="bi-x-circle" size={17} /> {t("pages.nomenclature.dishestoolbar.ochistit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
