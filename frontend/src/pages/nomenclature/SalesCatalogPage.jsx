// Каталог «Товары» OWNER — визуальная копия «Блюд» 1:1, но БЕЗ колонки
// и диалога рецептов. Источник тот же канонический GET
// /inventory/products?include_all=true (useDishesCatalog); строки фильтруются
// клиентски по type === "Реализация" (product_type "sale" backend).
// Категории фильтра/дровера — только sales-slug из GET /inventory/categories.
// Новые позиции создаются с product_type "sale" (пресет формы).
// Архив/восстановление — тот же centered confirm, текст про товар.
// Бэкенд отдельно дорабатывать не нужно: CRUD продуктов и категорий общий.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import { getCategories } from "../../api/categories";
import { isAbortError, useLatestRequest } from "../../hooks/useAsyncSafety";
import { useDishesCatalog } from "./useDishesCatalog";
import DishesToolbar from "./DishesToolbar";
import DishesTable from "./DishesTable";
import DishesDialogs from "./DishesDialogs";
import { t } from "../../i18n/t";

export default function SalesCatalogPage() {
  const catalog = useDishesCatalog();
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Архив/восстановление через centered confirm (копия блюд, текст про товар).
  const [pendingAction, setPendingAction] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Категории товаров: живые sales-slug + distinct из строк (как сырьё).
  const [salesCats, setSalesCats] = useState([]);
  const [salesCatsError, setSalesCatsError] = useState(false);
  const beginCatRequest = useLatestRequest();
  // Скользящий индикатор таблов (тот же механизм, что у Блюд).
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
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [catalog.showArchived]);

  useEffect(() => {
    const request = beginCatRequest();
    setSalesCatsError(false);
    getCategories({ signal: request.signal })
      .then(({ data }) => {
        if (!request.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || [];
        setSalesCats(
          items
            .filter((item) => String(item?.slug || "").startsWith("sales") && item?.is_active !== false)
            .map((item) => ({ id: String(item.id), name: String(item.name || "").trim() }))
            .filter((item) => item.name)
            .sort((a, b) => a.name.localeCompare(b.name, "ru")),
        );
      })
      .catch((err) => {
        if (!request.isCurrent() || isAbortError(err)) return;
        setSalesCats([]);
        setSalesCatsError(true);
      });
  }, [beginCatRequest]);

  // Только Реализация; поиск/категория/статус уже применены хуком.
  const saleRows = useMemo(
    () => catalog.filteredRows.filter((row) => row.type === "Реализация"),
    [catalog.filteredRows],
  );

  // Создание — всегда товар (product_type "sale"); правка хранит свой тип.
  const openSalesDrawer = (row = null) => {
    catalog.openDrawer(row);
    if (!row) catalog.setForm((prev) => ({ ...prev, type: "Реализация" }));
  };

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

  // Рецептов у товаров нет: колонка скрыта всегда.
  const isSaleColumnVisible = (key) => (key === "recipe" ? false : catalog.isColumnVisible(key));

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
              <p>{t("pages.nomenclature.salescatalogpage.menyu")}</p>
              <h1>{t("pages.nomenclature.salescatalogpage.tovary")}</h1>
            </div>
          </div>
          <div className="settings-actions dish-header-actions">
            <div className="dish-status-tabs" role="tablist" aria-label={t("pages.nomenclature.salescatalogpage.status_tovarov")} ref={tabsRef}>
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
               {t("pages.nomenclature.salescatalogpage.aktivnye")}
              </button>
              <button
                type="button"
                role="tab"
                data-tab="archived"
                aria-selected={catalog.showArchived}
                className={catalog.showArchived ? "is-active" : ""}
                onClick={() => catalog.setShowArchived(true)}
              >
               {t("pages.nomenclature.salescatalogpage.arhivirovannye")}
              </button>
            </div>
            <button
              type="button"
              className="dishes-filter-toggle"
              aria-expanded={filtersOpen}
              aria-controls="sales-catalog-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Icon name="bi-sliders" size={17} /> {t("pages.nomenclature.salescatalogpage.filtrovat")}
            </button>
            <button type="button" className="dish-add-button" onClick={() => openSalesDrawer()}>
              <Icon name="bi-plus" size={18} /> {t("pages.nomenclature.salescatalogpage.dobavit")}
            </button>
          </div>
        </header>

        {catalog.actionError ? <div className="login-error" role="alert">{catalog.actionError}</div> : null}

        <DishesToolbar
          draftFilters={catalog.draftFilters}
          setDraftFilters={catalog.setDraftFilters}
          setFilters={catalog.setFilters}
          filtersOpen={filtersOpen}
          closeFilters={() => setFiltersOpen(false)}
          categoryOptions={salesCats}
          categoriesUnavailable={salesCatsError}
        />

        <DishesTable
          filteredRows={saleRows}
          isColumnVisible={isSaleColumnVisible}
          tableMinWidth={catalog.tableMinWidth}
          visibleColumnCount={catalog.visibleColumnCount}
          updateRow={catalog.updateRow}
          togglingId={catalog.togglingId}
          printerOptions={catalog.printerOptions}
          openDrawer={openSalesDrawer}
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
          tableAriaLabel={t("nav.goods")}
          scrollAriaLabel={t("pages.nomenclature.sales_table_scroll")}
          emptyTitle={t("pages.nomenclature.goods_not_found")}
        />
      </section>

      {pendingAction ? createPortal(
        <div className="settings-owner-view dishcat-modal-layer dish-confirm-layer">
          <div className="settings-drawer settings-modal-overlay" role="presentation">
            <div className="settings-drawer__backdrop" onClick={confirmBusy ? undefined : closeConfirm} />
            <form
              className="settings-form settings-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sale-confirm-title"
              onSubmit={(event) => {
                event.preventDefault();
                runConfirm();
              }}
            >
              <header className="settings-form__header">
                <span className="settings-accent-bar" />
                <div>
                  <p>{pendingAction.mode === "archive" ? t("common.confirm.archive_title") : t("common.confirm.restore_title")}</p>
                  <h2 id="sale-confirm-title">
                    {pendingAction.mode === "archive" ? t("common.confirm.archive_goods") : t("common.confirm.restore_goods")}
                  </h2>
                </div>
                <button type="button" disabled={confirmBusy} onClick={closeConfirm} aria-label={t("pages.nomenclature.salescatalogpage.zakryt")}>
                  <Icon name="bi-x-lg" size={20} />
                </button>
              </header>
              <p className="settings-form__context">
                {pendingAction.mode === "archive" ? (
                  <>{t("pages.nomenclature.salescatalogpage.tovar")} <strong>«{pendingAction.row.name}»</strong> {t("pages.nomenclature.salescatalogpage.budet_peremeschen_v_arhiv")}</>
                ) : (
                  <>{t("pages.nomenclature.salescatalogpage.tovar")} <strong>«{pendingAction.row.name}»</strong> {t("pages.nomenclature.salescatalogpage.vernetsya_v_spisok_aktivnyh")}</>
                )}
              </p>
              <footer className="settings-form__footer">
                <button type="button" disabled={confirmBusy} onClick={closeConfirm}>
                 {t("pages.nomenclature.salescatalogpage.otmena")}
                </button>
                {pendingAction.mode === "archive" ? (
                  <button type="submit" className="dishcat-confirm__delete" disabled={confirmBusy}>
                    {confirmBusy ? t("common.confirm.archive_busy") : t("common.confirm.archive_action")}
                  </button>
                ) : (
                  <button type="submit" className="dish-add-button" disabled={confirmBusy}>
                    {confirmBusy ? t("common.confirm.restore_busy") : t("common.confirm.restore_action")}
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
        categoryOptions={salesCats}
        categoriesLoading={false}
        categoriesUnavailable={salesCatsError}
        printerOptions={catalog.printerOptions}
        printersLoading={catalog.printerOptionsLoading}
        printersUnavailable={catalog.printerOptionsError}
        unitOptions={catalog.unitOptions}
        unitsLoading={catalog.unitOptionsLoading}
        unitsUnavailable={catalog.unitOptionsError}
        photoPreview={catalog.photoPreview}
        handlePhotoChange={catalog.handlePhotoChange}
        hideKindSwitch
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
