// Модальные окна каталога блюд OWNER: боковая форма.
// Форма добавления/редактирования использует shell staff-примитива
// (staff-modal--cashier-full + staff-form--cashier, портал в body) 1:1.
// V18: «Подкатегория» удалена из формы (в payload её не было никогда —
// backend-поля category_id/subcategory_id/printer_id опциональны).
// Категория/Принтер — настоящие single-селекты канонических справочников
// (категории — тот же GET /inventory/categories, что у фильтра; принтеры —
// GET /printers как у Настройки → Принтеры). Выбор хранит canonical ID и
// уходит в payload только когда выбран (иначе omit). Поле «Повар» удалено:
// backend всегда отдаёт chef:"", пустой disabled-инпут не несёт смысла.
// V21: кастомное окно «База фото» удалено — фото выбирается нативным
// OS-пикером (input[type=file] в строке таблицы и в дровере) и грузится
// только через POST /inventory/products/{id}/photo.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import Toast from "../../components/Toast";
import { catalogService } from "../../api/catalog";
import { fieldLabels } from "./nomenclatureConfig";
import DishSingleSelect from "./DishSingleSelect";
import DishPhotoViewer from "../../components/DishPhotoViewer";
import { t } from "../../i18n/t";

// Browser “Copy image” supplies a file, often alongside HTML/text. Never use
// those strings as URLs: the normal photo pipeline only accepts image files.
function transferredPhoto(data) {
  const file = Array.from(data?.files || []).find((item) => item.type.startsWith("image/"));
  if (file) return file;
  for (const item of Array.from(data?.items || [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const image = item.getAsFile();
    if (image) return image;
  }
  return null;
}

function hasPhotoTransfer(data) {
  // Files cannot always be read until drop (the browser's protected mode).
  const files = Array.from(data?.files || []);
  const items = Array.from(data?.items || []);
  if (files.length) return files.some((file) => file.type.startsWith("image/"));
  if (items.length) return items.some((item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")));
  return Array.from(data?.types || []).includes("Files");
}

// MONEY-DIGITS-01: в поле суммы можно ввести только цифры и один десятичный
// разделитель. Буквы, минус, «сум», лишние разделители отбрасываются ещё до
// форматирования, поэтому «EFOIEWHFiWEJ» в поле физически не попадает.
// Дробная часть ограничена двумя знаками (как в parseNomenclatureMoney).
function sanitizeMoneyInput(value) {
  const text = String(value ?? "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(text)) return "";
  const [head, ...rest] = text.split(/[.,]/);
  const integer = head.replace(/^0+(?=\d)/, "");
  if (!rest.length) return integer;
  return `${integer},${rest.join("").slice(0, 2)}`;
}

function groupMoneyInput(value) {
  const clean = sanitizeMoneyInput(value);
  if (!clean) return "";
  const [integer, fraction] = clean.split(",");
  const grouped = (integer || "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

// label нужен как aria-label: декоративные «сум»/measure-спаны лежат внутри
// <label>, и без явного имени доступное имя поля становится
// «Цена12abc34сум» (значение вклеивается в подпись).
function DishMoneyInput({ value, onChange, label }) {
  const inputRef = useRef(null);
  const measureRef = useRef(null);
  const suffixRef = useRef(null);
  const caretRef = useRef(null);
  const positionSuffix = () => {
    const input = inputRef.current;
    const measure = measureRef.current;
    const suffix = suffixRef.current;
    if (!input || !measure || !suffix) return;
    const styles = getComputedStyle(input);
    measure.style.font = styles.font;
    measure.style.letterSpacing = styles.letterSpacing;
    // Match the input's line box so currency and digits share a baseline.
    suffix.style.fontFamily = styles.fontFamily;
    suffix.style.fontSize = styles.fontSize;
    suffix.style.lineHeight = styles.lineHeight;
    suffix.style.letterSpacing = styles.letterSpacing;
    const start = parseFloat(styles.paddingLeft) + parseFloat(styles.borderLeftWidth);
    const end = start + measure.getBoundingClientRect().width - input.scrollLeft;
    suffix.style.left = `${Math.max(start, Math.min(end + 4, input.clientWidth - suffix.offsetWidth - 14))}px`;
  };
  useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current === document.activeElement) {
      inputRef.current.setSelectionRange(caretRef.current, caretRef.current);
    }
    caretRef.current = null;
    positionSuffix();
  });
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(positionSuffix);
    observer.observe(inputRef.current);
    return () => observer.disconnect();
  }, []);
  return (
    <span className="dish-money-field">
    <input
      ref={inputRef}
      className="dish-money-input"
      inputMode="decimal"
      pattern="[0-9 ]*[.,]?[0-9]*"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      placeholder={t("pages.nomenclature.dishesdialogs.0_sum")}
      value={groupMoneyInput(value)}
      onScroll={positionSuffix}
      // Живая валидация до вставки: одиночный недопустимый символ (набор с
      // клавиатуры) не попадает в поле вовсе. Вставка из буфера проходит —
      // её чистит onChange, поэтому «12 000 сум» превращается в «12 000».
      onBeforeInput={(event) => {
        const data = event.nativeEvent?.data;
        if (data && data.length === 1 && /[^\d.,]/.test(data)) event.preventDefault();
      }}
      onChange={(event) => {
        const input = event.target;
        const raw = input.value;
        const caret = input.selectionStart ?? raw.length;
        // Значимые символы (цифры и запятая) слева от курсора — по ним
        // восстанавливаем позицию после перегруппировки разрядов.
        const meaningfulBeforeCaret = raw.slice(0, caret).replace(/[^\d,]/g, "").length;
        const formatted = groupMoneyInput(raw);
        let position = 0;
        let seen = 0;
        while (position < formatted.length && seen < meaningfulBeforeCaret) {
          if (/[\d,]/.test(formatted[position])) seen++;
          position++;
        }
        caretRef.current = position;
        if (formatted === groupMoneyInput(value)) {
          // Значение не изменилось (буква/лишний разделитель отброшены):
          // React не перерисует input, поэтому чистим DOM вручную.
          input.value = formatted;
          input.setSelectionRange(position, position);
          caretRef.current = null;
        }
        onChange(formatted);
      }}
    />
    <span className="dish-money-measure-clip" aria-hidden="true">
      <span ref={measureRef} className="dish-money-measure">{groupMoneyInput(value)}</span>
    </span>
    {String(value ?? "").trim() && <span ref={suffixRef} className="dish-money-suffix" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.sum")}</span>}
    </span>
  );
}

export default function DishesDialogs({
  drawerOpen,
  drawerClosing,
  requestCloseDrawer,
  finishCloseDrawer,
  editing,
  saving,
  setDrawerOpen,
  form,
  setForm,
  saveDish,
  categoryOptions = [],
  categoriesLoading = false,
  categoriesUnavailable = false,
  onCreateCategory = null,
  printerOptions = [],
  printersLoading = false,
  printersUnavailable = false,
  unitOptions = [],
  unitsLoading = false,
  unitsUnavailable = false,
  photoFile,
  photoPreview,
  handlePhotoChange,
  // Товары: сет создать нельзя — верхний сегмент Блюдо|Сет скрыт.
  hideKindSwitch = false,
}) {
  const closeDrawer = () => {
    if (requestCloseDrawer) requestCloseDrawer();
    else setDrawerOpen(false);
  };
  // Отдельная кнопка удаления доступна и мышкой, и на сенсорном экране.
  // Она открывает подтверждение, confirm — PATCH image_url:null.
  // Только сохранённое фото (form.photo без несохранённого превью);
  // таблица обновится при следующей загрузке каталога.
  const [photoConfirm, setPhotoConfirm] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const closePhotoViewer = useCallback(() => setPhotoViewerOpen(false), []);
  const displayedPhoto = photoPreview || form.photo;
  useEffect(() => {
    setPhotoViewerOpen(false);
  }, [drawerOpen, displayedPhoto]);
  const [photoDragActive, setPhotoDragActive] = useState(false);
  const photoDragDepth = useRef(0);
  const photoDropEnabled = drawerOpen && !drawerClosing && !saving && !photoConfirm && !photoViewerOpen;
  const clearPhotoDrag = () => {
    photoDragDepth.current = 0;
    setPhotoDragActive(false);
  };
  useEffect(() => {
    clearPhotoDrag();
    if (!photoDropEnabled) return;
    // Clear even if the drag is cancelled or dropped elsewhere on the page.
    document.addEventListener("dragend", clearPhotoDrag);
    document.addEventListener("drop", clearPhotoDrag);
    return () => {
      document.removeEventListener("dragend", clearPhotoDrag);
      document.removeEventListener("drop", clearPhotoDrag);
    };
  }, [photoDropEnabled]);
  const canDeletePhoto = Boolean(editing?.id) && Boolean(form.photo) && !photoPreview;
  useEffect(() => {
    if (!drawerOpen || drawerClosing || saving || photoConfirm || photoViewerOpen) return;
    const pastePhoto = (event) => {
      if (event.defaultPrevented) return;
      const file = transferredPhoto(event.clipboardData);
      if (!file) return; // Ordinary text paste must keep its native behaviour.
      event.preventDefault();
      handlePhotoChange({ target: { files: [file] } });
    };
    // The drawer may have no focused input immediately after opening.
    document.addEventListener("paste", pastePhoto);
    return () => document.removeEventListener("paste", pastePhoto);
  }, [drawerOpen, drawerClosing, saving, photoConfirm, photoViewerOpen, handlePhotoChange]);

  const dropPhoto = (event) => {
    event.preventDefault(); // Do not let the browser navigate to a dropped file.
    clearPhotoDrag();
    if (!photoDropEnabled) return;
    const file = transferredPhoto(event.dataTransfer);
    if (file) handlePhotoChange({ target: { files: [file] } });
  };
  useEffect(() => {
    setPhotoConfirm(false);
    setPhotoError("");
  }, [form.photo]);

  async function confirmPhotoRemove() {
    if (!editing?.id || photoRemoving) return;
    setPhotoRemoving(true);
    setPhotoError("");
    try {
      await catalogService.updateProduct(editing.id, { image_url: null });
      setForm((prev) => ({ ...prev, photo: "" }));
      setPhotoConfirm(false);
    } catch (err) {
      setPhotoError(err.response?.data?.detail || err.message || "Не удалось удалить фото.");
    } finally {
      setPhotoRemoving(false);
    }
  }
  // V19 — preselect по каноническим IDs: явный выбор формы → id строки
  // (categoryId/printerId из ответа backend) → резолв сохранённого имени
  // через живые справочники. Несовпадение (удалённая запись) = пусто = omit
  // в payload (backend держит). ID не выдумываем.
  const selectedCategoryId = form.categoryId
    ?? (form.category_id ? String(form.category_id) : null)
    ?? categoryOptions.find((item) => item.name === form.category)?.id
    ?? "";
  const selectedPrinterId = form.printerId
    ?? (form.printer_id ? String(form.printer_id) : null)
    ?? printerOptions.find((item) => item.name === form.printer)?.id
    ?? "";
  const selectedUnitId = form.unitId
    ?? (form.unit_id ? String(form.unit_id) : null)
    ?? "";
  const selectableUnits = unitOptions.filter((item) => item.active || item.id === selectedUnitId);
  if (selectedUnitId && !selectableUnits.some((item) => item.id === selectedUnitId)) {
    selectableUnits.push({
      id: selectedUnitId,
      label: form.unit || "Недоступная единица",
      active: false,
    });
  }
  // ARCHIVE V1 — editing a dish whose category was archived must not
  // silently erase its saved category: keep the current value selectable
  // (same pattern as units above). New assignments still offer actives only.
  const selectableCategories = categoryOptions.filter((item) => item && item.id);
  if (selectedCategoryId && !selectableCategories.some((item) => String(item.id) === String(selectedCategoryId))) {
    selectableCategories.push({
      id: selectedCategoryId,
      name: form.category || "Архивная категория",
    });
  }
  const pickCategory = (id) => {
    const found = selectableCategories.find((item) => String(item.id) === String(id));
    setForm((prev) => ({ ...prev, categoryId: id, category: found ? found.name : "" }));
  };
  // Создание категории из дровера: POST через каталог, затем автовыбор новой.
  const handleCreateCategory = async (name) => {
    if (!onCreateCategory) throw new Error("Создание категорий недоступно.");
    const created = await onCreateCategory(name);
    if (created?.id) {
      setForm((prev) => ({ ...prev, categoryId: String(created.id), category: String(created.name || name) }));
    }
    return created;
  };
  const pickPrinter = (id) => {
    const found = printerOptions.find((item) => item.id === id);
    setForm((prev) => ({ ...prev, printerId: id, printer: found ? found.name : "" }));
  };
  const pickUnit = (id) => {
    const found = unitOptions.find((item) => item.id === id);
    setForm((prev) => ({ ...prev, unitId: id, unit: found?.label || prev.unit || "" }));
  };
  // Верхний сегмент Блюдо|Сет управляет режимом при создании.
  const isSetMode = form.set === true;
  const pickKind = (isSet) => {
    if (saving) return;
    setForm((prev) => ({ ...prev, set: isSet }));
  };
  // Скользящая пилюля сегмента (как Активные|Архивированные): замер
  // активной кнопки, transition едет сам. Кнопки равной ширины (flex),
  // размер не прыгает при переключении. Первый замер — без слайда.
  // Свитч абсолютно отцентрован в шапке: ширина заголовка не двигает его.
  const kindTabsRef = useRef(null);
  const [kindPill, setKindPill] = useState({ left: 0, width: 0 });
  const [kindSettled, setKindSettled] = useState(false);
  useLayoutEffect(() => {
    const update = () => {
      const active = kindTabsRef.current?.querySelector("[data-kind].is-active");
      if (!active) return;
      setKindPill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width ? current : next;
      });
      setKindSettled(true);
    };
    update();
    window.addEventListener("resize", update);
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    fonts?.ready.then(update).catch(() => {});
    return () => window.removeEventListener("resize", update);
  }, [isSetMode, drawerOpen]);
  // Направление слайда окна: в сет — вход справа, обратно — слева.
  // При открытии слайда нет (атрибут сброшен — окно стоит спокойно).
  const prevSetRef = useRef(isSetMode);
  const [slideDir, setSlideDir] = useState(null);
  useEffect(() => {
    if (prevSetRef.current === isSetMode) return;
    prevSetRef.current = isSetMode;
    setSlideDir(isSetMode ? "right" : "left");
  }, [isSetMode]);
  useEffect(() => {
    if (drawerOpen) setSlideDir(null);
  }, [drawerOpen]);
  // Общие поля обеих раскладок (один источник — без дублей в ветках).
  const unitField = (
    <div className="dish-form-field">
      <span className="dish-form-field__label" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.ed_izm")}</span>
      <DishSingleSelect
        label={t("pages.nomenclature.dishesdialogs.ed_izm")}
        placeholder={t("pages.nomenclature.dishesdialogs.ed_izm")}
        options={selectableUnits.map((item) => ({
          value: item.id,
          label: item.active ? item.label : `${item.label} (не активна)`,
        }))}
        value={selectedUnitId}
        onChange={pickUnit}
        disabled={unitsUnavailable || saving}
        loading={unitsLoading}
        disabledLabel="Единицы измерения недоступны"
      />
    </div>
  );
  const categoryField = (
    <div className="dish-form-field">
      <span className="dish-form-field__label" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.kategoriya")}</span>
      <DishSingleSelect
        label={t("pages.nomenclature.dishesdialogs.kategoriya")}
        placeholder={t("pages.nomenclature.dishesdialogs.kategoriya")}
        options={selectableCategories.map((item) => ({ value: item.id, label: item.name }))}
        value={selectedCategoryId}
        onChange={pickCategory}
        disabled={categoriesUnavailable}
        loading={categoriesLoading}
        disabledLabel={t("common.categories_unavailable")}
        onCreateNew={onCreateCategory ? handleCreateCategory : null}
        createLabel="+ Новая категория"
        searchable
        searchPlaceholder="Поиск категории"
      />
    </div>
  );
  const printerField = (wide) => (
    <div className={`dish-form-field${wide ? " dish-form__wide" : ""}`}>
      <span className="dish-form-field__label" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.printer")}</span>
      <DishSingleSelect
        label={t("pages.nomenclature.dishesdialogs.printer")}
        placeholder={t("pages.nomenclature.dishesdialogs.printer")}
        options={printerOptions.map((item) => ({
          value: item.id,
          label: item.active ? item.name : t("staff.printer_inactive", { name: item.name }),
        }))}
        value={selectedPrinterId}
        onChange={pickPrinter}
        disabled={printersUnavailable}
        loading={printersLoading}
        disabledLabel={t("common.printers_unavailable")}
      />
    </div>
  );
  return (
    <>
      {drawerOpen && createPortal(
        <div
          className={`staff-modal staff-modal--cashier-full dish-drawer${drawerClosing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={editing
            ? (isSetMode ? t("pages.nomenclature.dishesdialogs.redaktirovat_set") : t("pages.nomenclature.dishesdialogs.redaktirovat_blyudo"))
            : (isSetMode ? t("pages.nomenclature.dishesdialogs.dobavit_set") : t("pages.nomenclature.dishesdialogs.dobavit_blyudo"))}
          onAnimationEnd={drawerClosing && finishCloseDrawer ? () => finishCloseDrawer() : undefined}
        >
          <div className="staff-modal__backdrop" onClick={saving ? undefined : closeDrawer} />
          <form
            className="staff-form staff-form--cashier"
            onSubmit={(event) => { event.preventDefault(); saveDish(); }}
          >
            <div className="staff-form__header">
              <div>
                <p>{editing ? t("staff.editing") : isSetMode ? t("pages.nomenclature.dishesdialogs.novyy_set") : t("pages.nomenclature.dishesdialogs.novoe_blyudo")}</p>
                <h2>
                  {editing
                    ? (isSetMode ? t("pages.nomenclature.dishesdialogs.redaktirovat_set") : t("pages.nomenclature.dishesdialogs.redaktirovat_blyudo"))
                    : (isSetMode ? t("pages.nomenclature.dishesdialogs.dobavit_set") : t("pages.nomenclature.dishesdialogs.dobavit_blyudo"))}
                </h2>
              </div>
              {!editing && !hideKindSwitch ? (
              <div className={`dish-kind-switch${kindSettled ? " is-settled" : ""}`} role="tablist" aria-label={t("pages.nomenclature.dishesdialogs.tip_pozitsii")} ref={kindTabsRef}>
                <span
                  className="dish-kind-switch__indicator"
                  aria-hidden="true"
                  style={{ transform: `translateX(${kindPill.left}px)`, width: kindPill.width }}
                />
                <button
                  type="button"
                  role="tab"
                  data-kind="dish"
                  aria-selected={!isSetMode}
                  className={!isSetMode ? "is-active" : ""}
                  disabled={saving}
                  onClick={() => pickKind(false)}
                >
                 {t("pages.nomenclature.dishesdialogs.blyudo")}
                </button>
                <button
                  type="button"
                  role="tab"
                  data-kind="set"
                  aria-selected={isSetMode}
                  className={isSetMode ? "is-active" : ""}
                  disabled={saving}
                  onClick={() => pickKind(true)}
                >
                 {t("pages.nomenclature.dishesdialogs.set")}
                </button>
              </div>
              ) : null}
              <button type="button" disabled={saving} onClick={closeDrawer} aria-label={t("pages.nomenclature.dishesdialogs.zakryt")}>
                <Icon name="bi-x-lg" size={20} />
              </button>
            </div>
            <div className="dish-drawer__body">
              <div
                {...(slideDir ? { "data-slide": slideDir } : null)}
                className="dish-drawer__animated"
                onAnimationEnd={(event) => {
                  // Слайд отыграл — снимаем атрибут, чтобы следующий
                  // переключатель запускал анимацию заново (без remount:
                  // фокус и ноды формы сохраняются).
                  if (event.target === event.currentTarget) setSlideDir(null);
                }}
              >
              <div
                className={`cashier-photo${photoDropEnabled && photoDragActive ? " is-drag-over" : ""}`}
                onDragEnter={(event) => {
                  if (!photoDropEnabled || !hasPhotoTransfer(event.dataTransfer)) return;
                  event.preventDefault();
                  photoDragDepth.current += 1;
                  setPhotoDragActive(true);
                }}
                onDragLeave={() => {
                  photoDragDepth.current = Math.max(0, photoDragDepth.current - 1);
                  if (!photoDragDepth.current) setPhotoDragActive(false);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  const acceptsPhoto = photoDropEnabled && hasPhotoTransfer(event.dataTransfer);
                  event.dataTransfer.dropEffect = acceptsPhoto ? "copy" : "none";
                  setPhotoDragActive(acceptsPhoto);
                }}
                onDrop={dropPhoto}
              >
                {displayedPhoto ? (
                  <button
                    type="button"
                    className="staff-avatar staff-avatar--large dish-drawer-photo-preview"
                    onClick={() => setPhotoViewerOpen(true)}
                    aria-label={`Открыть фото ${form.name || "блюда"}`}
                    aria-haspopup="dialog"
                  >
                    <img src={displayedPhoto} alt={editing ? t("pages.nomenclature.dishesdialogs.foto_blyuda") : t("pages.nomenclature.dishesdialogs.novoe_foto_blyuda")} />
                  </button>
                ) : (
                  <div className="staff-avatar staff-avatar--large">
                    <Icon name="bi-image" size={26} />
                  </div>
                )}
                <div className="cashier-photo__body">
                  <span>{t("pages.nomenclature.dishesdialogs.foto")}</span>
                  <div className="dish-photo-actions">
                  <label className="cashier-photo__upload">
                    <Icon name="bi-camera" size={16} />
                    {photoPreview || form.photo ? t("pages.nomenclature.dishesdialogs.zamenit_foto") : t("pages.nomenclature.dishesdialogs.zagruzit_foto")}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={saving}
                      onChange={handlePhotoChange}
                      aria-label={t("pages.nomenclature.dishesdialogs.zagruzit_foto_blyuda")}
                    />
                  </label>
                  {canDeletePhoto ? (
                    <button
                      type="button"
                      className="cashier-photo__upload dish-photo-delete-action"
                      onClick={() => setPhotoConfirm(true)}
                      disabled={saving || photoRemoving}
                      aria-label={t("pages.nomenclature.dishesdialogs.udalit_foto_blyuda")}
                    >
                      <Icon name="bi-trash3" size={16} />
                     {t("pages.nomenclature.dishesdialogs.udalit_foto")}
                    </button>
                  ) : null}
                  </div>
                </div>
              </div>
              {photoConfirm ? (
                <div className="dish-photo-confirm" role="dialog" aria-label={t("pages.nomenclature.dishesdialogs.udalit_foto_blyuda")}>
                  <strong>{t("pages.nomenclature.dishesdialogs.udalit_foto_2")}</strong>
                  <span>{t("pages.nomenclature.dishesdialogs.foto_blyuda_budet_udaleno_bez_vozmozhnosti")}</span>
                  {photoError ? <Toast kind="error" message={photoError} onClose={() => setPhotoError("")} /> : null}
                  <div className="dish-photo-confirm__actions">
                    <button type="button" disabled={photoRemoving} onClick={() => setPhotoConfirm(false)}>
                     {t("pages.nomenclature.dishesdialogs.otmena")}
                    </button>
                    <button type="button" className="danger" disabled={photoRemoving} onClick={confirmPhotoRemove}>
                      {photoRemoving ? t("common.deleting") : t("common.delete")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="staff-form__grid">
                <div className="dish-first-row">
                  <label className="dish-sort-field">
                    <span>{t(fieldLabels.sort)}</span>
                    <input
                      value={form.sort || ""}
                      onChange={(event) => setForm((prev) => ({ ...prev, sort: event.target.value }))}
                    />
                  </label>
                  <label className="dish-name-field">
                    <span>{t(fieldLabels.name)}</span>
                    <input
                      value={form.name || ""}
                      onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    />
                  </label>
                </div>
                {isSetMode ? (
                  <>
                    <label>
                      <span>{t(fieldLabels.price)}</span>
                      <DishMoneyInput
                        label={t(fieldLabels.price)}
                        value={form.price || ""}
                        onChange={(value) => setForm((prev) => ({ ...prev, price: value }))}
                      />
                    </label>
                    {categoryField}
                    {unitField}
                    {printerField(false)}
                    <div className="dish-form-field">
                      <span className="dish-form-field__label" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.shag_portsii")}</span>
                      <DishSingleSelect
                        label={t("pages.nomenclature.dishesdialogs.shag_portsii")}
                        placeholder={t("pages.nomenclature.dishesdialogs.tselye")}
                        options={[
                          { value: "", label: t("pages.nomenclature.dishesdialogs.tselye_1") },
                          { value: "0.1", label: "0.1" },
                          { value: "0.25", label: "0.25" },
                          { value: "0.5", label: "0.5" },
                        ]}
                        value={String(form.portionStep ?? "")}
                        onChange={(value) => setForm((prev) => ({ ...prev, portionStep: value }))}
                        disabled={saving}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {["cost", "price"].map((field) => (
                      <label key={field}>
                        <span>{t(fieldLabels[field])}</span>
                        <DishMoneyInput
                          label={t(fieldLabels[field])}
                          value={form[field] || ""}
                          onChange={(value) => setForm((prev) => ({ ...prev, [field]: value }))}
                        />
                      </label>
                    ))}
                    {categoryField}
                    {unitField}
                    {printerField(false)}
                    <div className="dish-form-field">
                      <span className="dish-form-field__label" aria-hidden="true">{t("pages.nomenclature.dishesdialogs.shag_portsii")}</span>
                      <DishSingleSelect
                        label={t("pages.nomenclature.dishesdialogs.shag_portsii")}
                        placeholder={t("pages.nomenclature.dishesdialogs.tselye")}
                        options={[
                          { value: "", label: t("pages.nomenclature.dishesdialogs.tselye_1") },
                          { value: "0.1", label: "0.1" },
                          { value: "0.25", label: "0.25" },
                          { value: "0.5", label: "0.5" },
                        ]}
                        value={String(form.portionStep ?? "")}
                        onChange={(value) => setForm((prev) => ({ ...prev, portionStep: value }))}
                        disabled={saving}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="dish-form-switches">
                {[
                  { field: "active", label: t("pages.nomenclature.dishesdialogs.status"), value: form.active !== false },
                ].map(({ field, label, value }) => (
                  <div className="dish-form-switch-row" key={field}>
                    <span className="dish-form-switch-label">{label}</span>
                    <div className="dish-form-switch-control">
                      <button
                        type="button"
                        role="switch"
                        aria-label={label}
                        aria-checked={value}
                        className={`dish-form-switch${value ? " is-on" : ""}`}
                        disabled={saving}
                        onClick={() => setForm((prev) => ({ ...prev, [field]: !value }))}
                      >
                        <span aria-hidden="true" />
                      </button>
                      {field === "active" && (
                        <span className={`dish-form-status${value ? " is-active" : ""}`}>
                          {value ? t("staff.active") : t("staff.inactive")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              </div>

            </div>

            <div className="staff-form__footer">
              <button type="button" disabled={saving} onClick={closeDrawer}>{t("pages.nomenclature.dishesdialogs.otmenit")}</button>
              <button type="submit" disabled={saving}>{saving ? t("staff.saving") : editing ? t("common.save") : t("common.add")}</button>
            </div>
          </form>
        </div>,
        document.body,
      )}
      {drawerOpen && photoViewerOpen && displayedPhoto && (
        <DishPhotoViewer photo={displayedPhoto} name={form.name || "блюда"} onClose={closePhotoViewer} />
      )}
    </>
  );
}
