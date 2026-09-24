// Редактор групп добавок (модификаторов) блюда внутри боковой формы каталога.
// Группа = набор опций (напр. «Добавки»: яйцо +3000, сыр +5000). Переключатель
// «Показывать на кассе» (show_in_pos) решает, увидит ли кассир группу в десктопе.
// Каждая группа сохраняется отдельной кнопкой — свой POST/PATCH, как у долей/паролей.
import { useState } from "react";
import Icon from "../../components/Icon";

// Пустая новая группа с одной пустой опцией.
const emptyGroup = () => ({
  name: "",
  min_select: 0,
  max_select: 1,
  is_required: false,
  show_in_pos: true,
  modifiers: [{ name: "", price_delta: "0", is_default: false, sort_order: 0 }],
});

export default function DishesModifiers({ editing, modGroups, setModGroups, modLoading, modError, saveModGroup, removeModGroup }) {
  const [dirty, setDirty] = useState({});   // groupKey → true, если есть несохранённые правки

  if (!editing?.id) {
    return (
      <div className="dish-mods">
        <p className="dish-mods__hint">Сохраните блюдо, чтобы добавить к нему добавки.</p>
      </div>
    );
  }

  const groupKey = (group, index) => group.id || `new-${index}`;
  const markDirty = (key) => setDirty((prev) => ({ ...prev, [key]: true }));

  const patchGroup = (index, patch) => {
    setModGroups((current) => current.map((g, i) => (i === index ? { ...g, ...patch } : g)));
    markDirty(groupKey(modGroups[index], index));
  };

  const patchModifier = (gi, mi, patch) => {
    setModGroups((current) => current.map((g, i) => {
      if (i !== gi) return g;
      const modifiers = (g.modifiers || []).map((m, j) => (j === mi ? { ...m, ...patch } : m));
      return { ...g, modifiers };
    }));
    markDirty(groupKey(modGroups[gi], gi));
  };

  const addModifier = (gi) => {
    setModGroups((current) => current.map((g, i) => {
      if (i !== gi) return g;
      const modifiers = [...(g.modifiers || []), { name: "", price_delta: "0", is_default: false, sort_order: (g.modifiers || []).length }];
      return { ...g, modifiers };
    }));
    markDirty(groupKey(modGroups[gi], gi));
  };

  const removeModifier = (gi, mi) => {
    setModGroups((current) => current.map((g, i) => {
      if (i !== gi) return g;
      return { ...g, modifiers: (g.modifiers || []).filter((_, j) => j !== mi) };
    }));
    markDirty(groupKey(modGroups[gi], gi));
  };

  const addGroup = () => {
    setModGroups((current) => [...current, emptyGroup()]);
  };

  const handleSave = async (group, index) => {
    await saveModGroup(group);
    setDirty((prev) => ({ ...prev, [groupKey(group, index)]: false }));
  };

  return (
    <div className="dish-mods">
      <div className="dish-mods__head">
        <h3>Добавки</h3>
        <p className="dish-mods__hint">Например «Яйцо», «Сыр» с наценкой. Переключатель «На кассе» решает, видит ли кассир группу в десктопе.</p>
      </div>

      {modError ? <div className="login-error" role="alert">{modError}</div> : null}
      {modLoading ? <p className="dish-mods__hint">Загрузка добавок…</p> : null}

      {modGroups.map((group, gi) => {
        const key = groupKey(group, gi);
        return (
          <div className="dish-mods__group" key={key}>
            <div className="dish-mods__group-head">
              <input
                className="dish-mods__group-name"
                value={group.name || ""}
                placeholder="Название группы (напр. Добавки)"
                onChange={(event) => patchGroup(gi, { name: event.target.value })}
              />
              <button type="button" className="dish-mods__icon-btn" title="Удалить группу" onClick={() => removeModGroup(group.id)}>
                <Icon name="bi-trash" />
              </button>
            </div>

            <div className="dish-mods__group-opts">
              <label className="dish-mods__inline">
                <span>Мин.</span>
                <input type="number" min="0" value={group.min_select ?? 0}
                  onChange={(event) => patchGroup(gi, { min_select: event.target.value })} />
              </label>
              <label className="dish-mods__inline">
                <span>Макс.</span>
                <input type="number" min="1" value={group.max_select ?? 1}
                  onChange={(event) => patchGroup(gi, { max_select: event.target.value })} />
              </label>
              <label className="dish-mods__inline dish-mods__inline--check">
                <input type="checkbox" checked={Boolean(group.is_required)}
                  onChange={(event) => patchGroup(gi, { is_required: event.target.checked })} />
                <span>Обязательно</span>
              </label>
              <label className="dish-mods__inline dish-mods__inline--check">
                <input type="checkbox" checked={group.show_in_pos !== false}
                  onChange={(event) => patchGroup(gi, { show_in_pos: event.target.checked })} />
                <span>На кассе</span>
              </label>
            </div>

            <div className="dish-mods__opts">
              {(group.modifiers || []).map((mod, mi) => (
                <div className="dish-mods__opt" key={mod.id || `m-${mi}`}>
                  <input
                    className="dish-mods__opt-name"
                    value={mod.name || ""}
                    placeholder="Название (напр. Яйцо)"
                    onChange={(event) => patchModifier(gi, mi, { name: event.target.value })}
                  />
                  <input
                    className="dish-mods__opt-price"
                    type="number"
                    value={mod.price_delta ?? "0"}
                    placeholder="0"
                    onChange={(event) => patchModifier(gi, mi, { price_delta: event.target.value })}
                  />
                  <span className="dish-mods__opt-cur">UZS</span>
                  <button type="button" className="dish-mods__icon-btn" title="Удалить опцию" onClick={() => removeModifier(gi, mi)}>
                    <Icon name="bi-x-lg" />
                  </button>
                </div>
              ))}
              <button type="button" className="btn-soft dish-mods__add-opt" onClick={() => addModifier(gi)}>
                <Icon name="bi-plus" /> Опция
              </button>
            </div>

            <div className="dish-mods__group-footer">
              <button type="button" className="btn-primary" disabled={!dirty[key]} onClick={() => handleSave(group, gi)}>
                Сохранить группу
              </button>
            </div>
          </div>
        );
      })}

      <button type="button" className="btn-soft dish-mods__add-group" onClick={addGroup}>
        <Icon name="bi-plus-circle" /> Добавить группу
      </button>
    </div>
  );
}
