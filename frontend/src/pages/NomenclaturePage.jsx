// Оркестратор раздела «Номенклатура» OWNER (FE-07B).
// Точка входа: маршрутизация по типу (dishes/raw/semi) и сборка каталога блюд
// из выделенных секций nomenclature/*. Кросс-секционное состояние живёт в
// useDishesCatalog, презентационные части — в отдельных компонентах.
// Raw/Semi и Inventory Core остаются отложенными; ProductCategory не
// переинтерпретируется как категория сырья.
import Icon from "../components/Icon";
import { nomenclatureConfigs } from "./nomenclature/nomenclatureConfig";
import { useDishesCatalog } from "./nomenclature/useDishesCatalog";
import DishesStatGrid from "./nomenclature/DishesStatGrid";
import DishesToolbar from "./nomenclature/DishesToolbar";
import DishesTable from "./nomenclature/DishesTable";
import DishesDialogs from "./nomenclature/DishesDialogs";

// Ре-экспорт чистых контрактных функций для совместимости с тестами и импортами.
export { buildNomenclatureProductPayload, mapNomenclatureProduct } from "./nomenclature/nomenclatureData";

function NomenclaturePage({ type = "dishes" }) {
  if (type === "dishes") return <DishesCatalogPage />;
  const config = nomenclatureConfigs[type] || nomenclatureConfigs.raw;
  return (
    <section className="nomenclature-page">
      <div className="nomenclature-card">
        <div className="nomenclature-header">
          <div className="report-title-group">
            <span className="report-accent-bar" />
            <div><h1>{config.title}</h1><p>Функция пока недоступна: Raw/Semi и Inventory Core отложены.</p></div>
          </div>
        </div>
        <div className="dashboard-empty" role="status">Backend-контракт для этого раздела не зафиксирован.</div>
      </div>
    </section>
  );
}

function DishesCatalogPage() {
  const catalog = useDishesCatalog();

  if (catalog.apiError && !catalog.apiLoading) {
    return <section className="nomenclature-page dish-catalog-page"><div className="login-error" role="alert">{catalog.apiError}</div></section>;
  }

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
            <button type="button" className="btn-primary" onClick={() => catalog.openDrawer()}>
              <Icon name="bi-plus" /> Добавить
            </button>
          </div>
        </div>

        {catalog.actionError ? <div className="login-error" role="alert">{catalog.actionError}</div> : null}

        <DishesStatGrid
          computedStats={catalog.computedStats}
          statFilter={catalog.statFilter}
          setStatFilter={catalog.setStatFilter}
        />

        <DishesToolbar
          draftFilters={catalog.draftFilters}
          setDraftFilters={catalog.setDraftFilters}
          setFilters={catalog.setFilters}
          settingsOpen={catalog.settingsOpen}
          setSettingsOpen={catalog.setSettingsOpen}
          isColumnVisible={catalog.isColumnVisible}
          visibleColumnCount={catalog.visibleColumnCount}
          toggleColumn={catalog.toggleColumn}
          setVisibleColumns={catalog.setVisibleColumns}
        />

        <DishesTable
          filteredRows={catalog.filteredRows}
          isColumnVisible={catalog.isColumnVisible}
          tableMinWidth={catalog.tableMinWidth}
          updateRow={catalog.updateRow}
          openDrawer={catalog.openDrawer}
          archiveDish={catalog.archiveDish}
          openPhotoPicker={catalog.openPhotoPicker}
          saving={catalog.saving}
          pendingDeleteId={catalog.pendingDeleteId}
        />
      </div>

      <DishesDialogs
        drawerOpen={catalog.drawerOpen}
        editing={catalog.editing}
        saving={catalog.saving}
        setDrawerOpen={catalog.setDrawerOpen}
        form={catalog.form}
        setForm={catalog.setForm}
        saveDish={catalog.saveDish}
        photoPicker={catalog.photoPicker}
        setPhotoPicker={catalog.setPhotoPicker}
        photoSearch={catalog.photoSearch}
        setPhotoSearch={catalog.setPhotoSearch}
        selectPhoto={catalog.selectPhoto}
        modGroups={catalog.modGroups}
        setModGroups={catalog.setModGroups}
        modLoading={catalog.modLoading}
        modError={catalog.modError}
        saveModGroup={catalog.saveModGroup}
        removeModGroup={catalog.removeModGroup}
      />
    </section>
  );
}

export default NomenclaturePage;
