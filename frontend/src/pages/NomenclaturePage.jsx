// Оркестратор раздела «Номенклатура» OWNER (FE-07B).
// Точка входа: маршрутизация по типу (dishes/raw/semi) и сборка каталога блюд
// из выделенных секций nomenclature/*. Кросс-секционное состояние живёт в
// useDishesCatalog, презентационные части — в отдельных компонентах.
// Raw → RawMaterialsPage (сырьё/ингредиенты), Semi → SemiProductsPage
// (полуфабрикаты с составом и производством) — работают против существующих
// эндпоинтов /inventory/*, без Inventory Core.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import { nomenclatureConfigs } from "./nomenclature/nomenclatureConfig";
import { useDishesCatalog } from "./nomenclature/useDishesCatalog";
import DishesToolbar from "./nomenclature/DishesToolbar";
import DishesTable from "./nomenclature/DishesTable";
import DishesDialogs from "./nomenclature/DishesDialogs";
import DishesRecipesDialog from "./nomenclature/DishesRecipesDialog";
import DishesSetDialog from "./nomenclature/DishesSetDialog";
import RawMaterialsPage from "./nomenclature/RawMaterialsPage";
import SemiProductsPage from "./nomenclature/SemiProductsPage";

// Ре-экспорт чистых контрактных функций для совместимости с тестами и импортами.
export { buildNomenclatureProductPayload, mapNomenclatureProduct } from "./nomenclature/nomenclatureData";

function NomenclaturePage({ type = "dishes" }) {
  if (type === "dishes") return <DishesCatalogPage />;
  if (type === "raw") return <RawMaterialsPage />;
  if (type === "semi") return <SemiProductsPage />;
  const config = nomenclatureConfigs[type] || nomenclatureConfigs.raw;
  return (
    <section className="nomenclature-page">
      <div className="nomenclature-card">
        <div className="nomenclature-header">
          <div className="report-title-group">
            <span className="report-accent-bar" />
            <div><h1>{config.title}</h1><p>Функция пока недоступна: Inventory Core отложен.</p></div>
          </div>
        </div>
        <div className="dashboard-empty" role="status">Backend-контракт для этого раздела не зафиксирован.</div>
      </div>
    </section>
  );
}

function DishesCatalogPage() {
  const catalog = useDishesCatalog();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recipeDish, setRecipeDish] = useState(null);
  const recipeTriggerRef = useRef(null);
  // Состав сета: открывается кнопкой Сет из колонки рецептов (is_set rows).
  const [setDish, setSetDish] = useState(null);
  const setTriggerRef = useRef(null);
  // Архив/восстановление через centered confirm (тот же OWNER-шелл, что у
  // удаления категорий). pendingAction = { mode: "archive" | "restore", row }.
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Скользящий индикатор таблов (тот же механизм, что у Сотрудников:
  // измеренный offsetLeft/offsetWidth активного сегмента → translateX/width,
  // transition 250ms MARJON ease; ResizeObserver + fonts.ready против stale).
  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    const container = tabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector("[data-tab].is-active");
      if (!active) return;
      setPill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
    };
    update();
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container.querySelectorAll("[data-tab]").forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    fonts?.ready.then(update).catch(() => {});
    fonts?.addEventListener?.("loadingdone", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      fonts?.removeEventListener?.("loadingdone", update);
    };
  }, [catalog.showArchived]);

  const closeConfirm = () => {
    if (confirmBusy) return;
    setPendingAction(null);
  };

  useLayoutEffect(() => {
    if (!pendingAction) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const runConfirm = async () => {
    if (!pendingAction || confirmBusy) return;
    setConfirmBusy(true);
    try {
      const ok = pendingAction.mode === "archive"
        ? await catalog.archiveDish(pendingAction.row.id)
        : await catalog.restoreDish(pendingAction.row.id);
      if (ok) setPendingAction(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  if (catalog.apiError && !catalog.apiLoading) {
    return <section className="nomenclature-page dish-catalog-page"><div className="login-error" role="alert">{catalog.apiError}</div></section>;
  }

  return (
    <section className="nomenclature-page dish-catalog-page owner-report-view">
      <section className="dish-catalog-card owner-report-surface settings-card">
        <header className="settings-header dish-catalog-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" aria-hidden="true" />
            <div>
              <p>Меню</p>
              <h1>Блюда</h1>
            </div>
          </div>
          <div className="settings-actions dish-header-actions">
            <div className="dish-status-tabs" role="tablist" aria-label="Статус блюд" ref={tabsRef}>
              <span
                className="dish-status-tabs__indicator"
                aria-hidden="true"
                style={{
                  transform: `translateX(${pill.left}px)`,
                  width: pill.width,
                }}
              />
              <button
                type="button"
                role="tab"
                data-tab="active"
                aria-selected={!catalog.showArchived}
                className={catalog.showArchived ? "" : "is-active"}
                onClick={() => catalog.setShowArchived(false)}
              >
                Активные
              </button>
              <button
                type="button"
                role="tab"
                data-tab="archived"
                aria-selected={catalog.showArchived}
                className={catalog.showArchived ? "is-active" : ""}
                onClick={() => catalog.setShowArchived(true)}
              >
                Архивированные
              </button>
            </div>
            <button
              type="button"
              className="dishes-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls="dishes-catalog-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Icon name="bi-sliders" size={17} /> Фильтровать
            </button>
            <button type="button" className="dish-add-button" onClick={() => catalog.openDrawer()}>
              <Icon name="bi-plus" size={18} /> Добавить
            </button>
          </div>
        </header>

        {catalog.actionError ? <div className="login-error" role="alert">{catalog.actionError}</div> : null}

        <DishesToolbar
          draftFilters={catalog.draftFilters}
          setDraftFilters={catalog.setDraftFilters}
          setFilters={catalog.setFilters}
          filters={catalog.filters}
          filtersOpen={filtersOpen}
          closeFilters={() => setFiltersOpen(false)}
          categoryOptions={catalog.filterCategories}
          categoriesUnavailable={catalog.filterCategoriesError}
        />

        <DishesTable
          filteredRows={catalog.filteredRows.filter((row) => row.type !== "Реализация")}
          isColumnVisible={catalog.isColumnVisible}
          tableMinWidth={catalog.tableMinWidth}
          visibleColumnCount={catalog.visibleColumnCount}
          updateRow={catalog.updateRow}
          togglingId={catalog.togglingId}
          printerOptions={catalog.printerOptions}
          openDrawer={catalog.openDrawer}
          openRecipes={(row, trigger) => {
            recipeTriggerRef.current = trigger;
            setRecipeDish(row);
          }}
          onOpenSet={(row, trigger) => {
            setTriggerRef.current = trigger;
            setSetDish(row);
          }}
          archiveDish={catalog.archiveDish}
          onArchiveRequest={(row) => setPendingAction({ mode: "archive", row })}
          restoreDish={catalog.restoreDish}
          onRestoreRequest={(row) => setPendingAction({ mode: "restore", row })}
          restoringId={catalog.restoringId}
          showArchived={catalog.showArchived}
          uploadDishPhoto={catalog.uploadDishPhoto}
          photoUploadingId={catalog.photoUploadingId}
          saving={catalog.saving}
          pendingDeleteId={catalog.pendingDeleteId}
        />
      </section>

      {recipeDish && (
        <DishesRecipesDialog
          dish={recipeDish}
          onClose={() => setRecipeDish(null)}
          returnFocusRef={recipeTriggerRef}
          onSave={catalog.saveRecipe}
          onChanged={(fresh) => setRecipeDish((current) => (
            current && String(current.id) === String(fresh.id) ? { ...current, ...fresh } : current
          ))}
        />
      )}

      {setDish && (
        <DishesSetDialog
          dish={setDish}
          rows={catalog.filteredRows}
          onClose={() => setSetDish(null)}
          returnFocusRef={setTriggerRef}
          onSave={catalog.saveSetItems}
        />
      )}

      {pendingAction ? createPortal(
        <div className="settings-owner-view dishcat-modal-layer dish-confirm-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={confirmBusy ? undefined : closeConfirm} />
            <form
              className="settings-form settings-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="dish-confirm-title"
              onSubmit={(event) => {
                event.preventDefault();
                runConfirm();
              }}
            >
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>{pendingAction.mode === "archive" ? "Архивация" : "Восстановление"}</p>
                  <h2 id="dish-confirm-title">
                    {pendingAction.mode === "archive" ? "Архивировать блюдо?" : "Восстановить блюдо?"}
                  </h2>
                </div>
                <button type="button" disabled={confirmBusy} onClick={closeConfirm} aria-label="Закрыть">
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <p className="settings-form__context">
                {pendingAction.mode === "archive" ? (
                  <>Блюдо <strong>«{pendingAction.row.name}»</strong> будет перемещено в архив.</>
                ) : (
                  <>Блюдо <strong>«{pendingAction.row.name}»</strong> вернётся в список активных.</>
                )}
              </p>
              <footer className="settings-form__footer">
                <button type="button" disabled={confirmBusy} onClick={closeConfirm}>
                  Отмена
                </button>
                {pendingAction.mode === "archive" ? (
                  <button type="submit" className="dishcat-confirm__delete" disabled={confirmBusy}>
                    {confirmBusy ? "Архивация..." : "Архивировать"}
                  </button>
                ) : (
                  <button type="submit" className="dish-add-button" disabled={confirmBusy}>
                    {confirmBusy ? "Восстановление..." : "Восстановить"}
                  </button>
                )}
              </footer>
            </form>
          </div>
        </div>,
        document.body,
      ) : null}

      <DishesDialogs
        drawerOpen={catalog.drawerOpen}
        drawerClosing={catalog.drawerClosing}
        requestCloseDrawer={catalog.requestCloseDrawer}
        finishCloseDrawer={catalog.finishCloseDrawer}
        editing={catalog.editing}
        saving={catalog.saving}
        setDrawerOpen={catalog.setDrawerOpen}
        form={catalog.form}
        setForm={catalog.setForm}
        saveDish={catalog.saveDish}
        categoryOptions={catalog.filterCategories}
        categoriesLoading={catalog.filterCategoriesLoading}
        categoriesUnavailable={catalog.filterCategoriesError}
        onCreateCategory={catalog.createDishCategory}
        printerOptions={catalog.printerOptions}
        printersLoading={catalog.printerOptionsLoading}
        printersUnavailable={catalog.printerOptionsError}
        unitOptions={catalog.unitOptions}
        unitsLoading={catalog.unitOptionsLoading}
        unitsUnavailable={catalog.unitOptionsError}
        photoPreview={catalog.photoPreview}
        handlePhotoChange={catalog.handlePhotoChange}
        modGroups={catalog.modGroups}
        setModGroups={catalog.setModGroups}
        modLoading={catalog.modLoading}
        modError={catalog.modError}
        onClearModError={catalog.clearModError}
        saveModGroup={catalog.saveModGroup}
        removeModGroup={catalog.removeModGroup}
      />
    </section>
  );
}

export default NomenclaturePage;
