// Модальные окна каталога блюд OWNER: боковая форма и выбор фото из базы.
// Разметка перенесена из NomenclaturePage.jsx (FE-07B) без изменений.
// Часть полей (меню/подкатегория/принтер/категория/повар/ед. изм) остаётся
// read-only — write contract под них не подключён.
import Icon from "../../components/Icon";
import { fieldLabels } from "./nomenclatureConfig";
import { getPhotoOptions } from "./nomenclatureData";
import DishesModifiers from "./DishesModifiers";

export default function DishesDialogs({
  drawerOpen,
  editing,
  saving,
  setDrawerOpen,
  form,
  setForm,
  saveDish,
  photoPicker,
  setPhotoPicker,
  photoSearch,
  setPhotoSearch,
  selectPhoto,
  modGroups,
  setModGroups,
  modLoading,
  modError,
  saveModGroup,
  removeModGroup,
}) {
  return (
    <>
      {drawerOpen && (
        <div className="nomenclature-drawer dish-drawer">
          <div className="nomenclature-drawer-card">
            <div className="nomenclature-drawer-header">
              <h2>{editing ? "Редактировать блюдо" : "Добавить блюдо"}</h2>
              <button type="button" disabled={saving} onClick={() => setDrawerOpen(false)}><Icon name="bi-x-lg" /></button>
            </div>
            <div className="nomenclature-form">
              {["name", "sort", "price", "cost", "menu", "subcategory", "printer", "category", "chef"].map((field) => {
                const unsupported = ["menu", "subcategory", "printer", "category", "chef"].includes(field);
                return (
                <label key={field}>
                  <span>{fieldLabels[field]}</span>
                  <input
                    value={form[field] || ""}
                    disabled={unsupported}
                    title={unsupported ? "Поле доступно только для чтения: write contract не подключён." : undefined}
                    onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))}
                  />
                </label>
                );
              })}
              <label>
                <span>Тип</span>
                <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}>
                  <option>Блюда</option>
                  <option>Реализация</option>
                </select>
              </label>
              <label>
                <span>Ед. изм</span>
                <select
                  value={form.unit}
                  disabled={Boolean(editing)}
                  title={editing ? "Изменение единицы измерения не поддерживается backend update contract." : undefined}
                  onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                >
                  <option>шт</option>
                  <option>порция</option>
                  <option>кг</option>
                  <option>л</option>
                </select>
              </label>
            </div>

            <DishesModifiers
              editing={editing}
              modGroups={modGroups}
              setModGroups={setModGroups}
              modLoading={modLoading}
              modError={modError}
              saveModGroup={saveModGroup}
              removeModGroup={removeModGroup}
            />

            <div className="nomenclature-drawer-footer">
              <button type="button" className="btn-soft" disabled={saving} onClick={() => setDrawerOpen(false)}>Отмена</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={saveDish}>{saving ? "Сохранение…" : "Сохранить"}</button>
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
    </>
  );
}
