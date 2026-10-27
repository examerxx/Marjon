// Таблица каталога блюд OWNER с учётом видимых колонок.
// Порядок: СОРТ→ФОТО→НАЗВАНИЕ→ЕД.ИЗМ→КАТЕГОРИЯ→СЕБЕСТ→ЦЕНА→ПРИНТЕР→
// РЕЦЕПТЫ→ДЕЙСТВИЯ. Принтер — две строки (имя + IP из
// GET /printers по printerId, без UUID и без однострочного склеивания).
// Флаг is_auto остаётся в данных, но не отображается в таблице.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../../components/Icon";
import ReportEmptyState from "../../components/ReportEmptyState";
import ExternalTableScrollbar from "../../components/ExternalTableScrollbar";
import useInstantWheel, { isInstantWheelRequested } from "../../hooks/useInstantWheel";
import recipeBookPng from "../../assets/recipes-cook-book.png";
import setComboPng from "../../assets/set-combo.png";
import { SUPPORTED_DISH_PHOTO_TYPES } from "./useDishesCatalog";
import { t } from "../../i18n/t";
import "../../styles/shared/catalog-scrollbar-arrows.css";

// Себестоимость/цена приходят с суффиксом «UZS»; в таблице показываем «сум».
function displayDishMoney(value) {
  return String(value ?? "").replace(/\s*UZS$/i, " сум");
}


// V24 — ячейка принтера: первая строка имя, вторая IP (muted).
// Источник: row.printer (printer_name) + row.printerIp, fallback —
// справочник printers по printerId. Пусто → "-". UUID не показываем.
function PrinterCell({ row, printers = [] }) {
  const lookup = row.printerId ? printers.find((p) => String(p.id) === String(row.printerId)) : null;
  const name = String(row.printer || lookup?.name || "").trim();
  const ip = String(row.printerIp || lookup?.ip || "").trim();
  if (!name && !ip) return <span className="dish-printer-empty">-</span>;
  return (
    <span className="dish-printer-lines">
      <span className="dish-printer-name">{name || "-"}</span>
      {ip ? <span className="dish-printer-ip">{ip}</span> : null}
    </span>
  );
}

// V22 — Остаток: честный компактный бейдж реального backend-значения
// (stock: число = mint, "0" = red/neutral, "-" = пусто). V25: колонка
// Остаток убрана из таблицы (бейдж оставлен для совместимости тестов
// и возможных будущих мест, в таблице не рендерится).
function StockBadge({ value }) {
  if (value === "-") return <span className="dish-stock-badge is-empty">-</span>;
  const amount = Number(String(value).replace(/\s/g, ""));
  return (
    <span className={`dish-stock-badge ${amount > 0 ? "is-positive" : "is-zero"}`}>{value}</span>
  );
}

// Exact user-provided PNG alpha mask; the badge supplies its state color.
function RecipePngIcon() {
  return (
    <span
      className="dish-recipe-icon"
      aria-hidden="true"
      style={{ maskImage: `url(${recipeBookPng})`, WebkitMaskImage: `url(${recipeBookPng})` }}
    />
  );
}

// Пользовательская иконка комбо (D:\Marjon elements\Сет.png → set-combo.png):
// та же mask-техника — цвет даёт бейдж. Крупнее книжки рецептов.
function SetPngIcon() {
  return (
    <span
      className="dish-recipe-icon dish-set-icon"
      aria-hidden="true"
      style={{ maskImage: `url(${setComboPng})`, WebkitMaskImage: `url(${setComboPng})` }}
    />
  );
}

// V25 — Рецепты: честный компактный бейдж реального backend-счётчика
// ingredients_count (product_ingredients через ProductService).
// V26: визуал по референсу — icon + text-ссылка, не бейдж и не "-".
// Есть состав → синий "Рецепты (N шт)"; нет → нейтрально-чёрный "Рецепты".
// Кликабельного редактора состава для блюд в MARJON нет (см. аудит ниже),
// поэтому это span без fake-навигации, курсор обычный.
function RecipeBadge({ count, onClick }) {
  const amount = Number(count) || 0;
  if (amount > 0) {
    return (
      <button type="button" className="dish-recipe-link is-filled" onClick={onClick} aria-haspopup="dialog">
        <RecipePngIcon />{t("pages.nomenclature.dishestable.retsepty")}{amount} {t("pages.nomenclature.dishestable.sht")}
      </button>
    );
  }
  return (
    <button type="button" className="dish-recipe-link is-empty" onClick={onClick} aria-haspopup="dialog">
      <RecipePngIcon />{t("pages.nomenclature.dishestable.retsepty_2")}
    </button>
  );
}

// V21 — нативный OS-пикер фото прямо из строки: клик → скрытый input[type=file]
// → выбранный файл уходит в uploadDishPhoto (тот же id, без дубля блюда).
// Есть фото — клик открывает увеличенный просмотр по центру (п.11);
// пикер остаётся только для пустых ячеек.
function DishPhotoCell({ row, uploading, onPick, onPreview }) {
  const inputRef = useRef(null);
  const hasPhoto = Boolean(row.photo);
  return (
    <td className="dish-col-photo">
      <button
        type="button"
        className="dish-photo-button"
        disabled={uploading}
        aria-busy={uploading || undefined}
        onClick={() => {
          if (hasPhoto) onPreview?.(row);
          else inputRef.current?.click();
        }}
        aria-label={hasPhoto ? t("pages.menupage.open_photo", { name: row.name }) : t("pages.nomenclature.dishestable.choose_photo", { name: row.name })}
        {...(hasPhoto ? { "aria-haspopup": "dialog" } : null)}
      >
        {row.photo ? (
          // loading=lazy + размеры: без них браузер декодировал все фото
          // каталога сразу, и при прокрутке к концу списка кадры проваливались
          // (декодирование картинок шло в том же кадре, что и скролл).
          <img
            className="dish-photo"
            src={row.photo}
            alt={row.name}
            width={42}
            height={42}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="dish-photo-placeholder"><Icon name="bi-image" /></span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPORTED_DISH_PHOTO_TYPES.join(",")}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onPick(row.id, event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </td>
  );
}

export default function DishesTable({
  filteredRows,
  isColumnVisible,
  tableMinWidth,
  printerOptions = [],
  openDrawer,
  openRecipes,
  archiveDish,
  onArchiveRequest,
  restoreDish,
  onRestoreRequest,
  restoringId = null,
  showArchived = false,
  uploadDishPhoto,
  photoUploadingId,
  saving,
  pendingDeleteId,
  // Переиспользование для «Товаров»: свои подписи при том же скелете.
  tableAriaLabel = "Блюда",
  scrollAriaLabel = "Таблица блюд с прокруткой",
  emptyTitle = "Блюда не найдены",
  // Открытие состава сета (кнопка Сет); без хендлера — статичный текст.
  onOpenSet,
}) {
  const isEmpty = !filteredRows.length;
  const scrollRef = useRef(null);
  // ?wheel=instant — сравнение «физика Chrome» против точного колеса 1:1.
  useInstantWheel(scrollRef, isInstantWheelRequested());
  // Увеличенный просмотр фото по центру (только строки с фото).
  // Уход — той же анимацией, что приход (is-closing 160ms, как zoom
  // в диалогах рецептов/сета); размонтирование только после неё.
  const [preview, setPreview] = useState(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const previewTimer = useRef(null);

  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  function closePreview() {
    if (previewClosing) return;
    setPreviewClosing(true);
    previewTimer.current = window.setTimeout(() => {
      setPreview(null);
      setPreviewClosing(false);
    }, 160);
  }

  function openPreview(dish) {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setPreviewClosing(false);
    setPreview({ src: dish.photo, name: dish.name });
  }

  useEffect(() => {
    if (!preview) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event) {
      if (event.key === "Escape") closePreview();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  return (
    <div className={`settings-table-wrapper dish-grid-wrap${isEmpty ? " is-empty" : ""}`}>
      <div ref={scrollRef} className="dish-grid-scroll" role="region" aria-label={t(scrollAriaLabel)} tabIndex={0}>
        <table className="settings-table dish-grid-table" aria-label={t(tableAriaLabel)} style={{ "--dish-grid-min-width": `${tableMinWidth}px` }}>
        <thead>
          <tr>
            {isColumnVisible("sort") ? <th className="dish-col-sort">{t("pages.nomenclature.dishestable.sort")}</th> : null}
            {isColumnVisible("photo") ? <th className="dish-col-photo">{t("pages.nomenclature.dishestable.foto")}</th> : null}
            {isColumnVisible("name") ? <th className="dish-col-name">{t("pages.nomenclature.dishestable.nazvanie")}</th> : null}
            {isColumnVisible("unit") ? <th className="dish-col-unit">{t("pages.nomenclature.dishestable.ed_izm")}</th> : null}
            {isColumnVisible("category") ? <th className="dish-col-category">{t("pages.nomenclature.dishestable.kategoriya")}</th> : null}
            {isColumnVisible("cost") ? <th className="dish-col-cost">{t("pages.nomenclature.dishestable.sebestoimost")}</th> : null}
            {isColumnVisible("price") ? <th className="dish-col-price">{t("pages.nomenclature.dishestable.tsena")}</th> : null}
            {isColumnVisible("printer") ? <th className="dish-col-printer">{t("pages.nomenclature.dishestable.printer")}</th> : null}
            {isColumnVisible("recipe") ? <th className="dish-col-recipe">{t("pages.nomenclature.dishestable.retsepty_2")}</th> : null}
            {isColumnVisible("actions") ? <th className="dish-col-actions">{t("pages.nomenclature.dishestable.deystviya")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row) => (
            <tr key={row.id}>
              {isColumnVisible("sort") ? <td className="dish-col-sort dish-sort-cell">{row.sort}</td> : null}
              {isColumnVisible("photo") ? (
                <DishPhotoCell
                  row={row}
                  uploading={photoUploadingId === row.id}
                  onPick={uploadDishPhoto}
                  onPreview={openPreview}
                />
              ) : null}
              {isColumnVisible("name") ? <td className="dish-col-name"><span className="dish-name-text" title={row.name}>{row.name}</span></td> : null}
              {isColumnVisible("unit") ? <td className="dish-col-unit">{row.unit}</td> : null}
              {isColumnVisible("category") ? (
                <td className="dish-col-category">
                  {String(row.category || "").trim()
                    ? <span className="dish-category-text" title={row.category}>{row.category}</span>
                    : <span className="dish-category-empty">-</span>}
                </td>
              ) : null}
              {isColumnVisible("cost") ? <td className="dish-col-cost dish-money-cell">{displayDishMoney(row.costTotal ?? row.cost)}</td> : null}
              {isColumnVisible("price") ? <td className="dish-col-price dish-money-cell"><span className="dish-price-text">{displayDishMoney(row.price)}</span></td> : null}
              {isColumnVisible("printer") ? <td className="dish-col-printer dish-printer-cell"><PrinterCell row={row} printers={printerOptions} /></td> : null}
              {isColumnVisible("recipe") ? (
              <td className="dish-col-recipe">
                {row.set === true ? (
                  onOpenSet ? (
                    <button
                      type="button"
                      className={`dish-recipe-link ${Number(row.setItemsCount) > 0 ? "is-filled" : "is-empty"}`}
                      onClick={(event) => onOpenSet(row, event.currentTarget)}
                      aria-haspopup="dialog"
                      aria-label={t("pages.nomenclature.dishestable.open_set", { name: row.name })}
                    >
                      <SetPngIcon />{Number(row.setItemsCount) > 0 ? `Сет (${row.setItemsCount} шт)` : "Сет"}
                    </button>
                  ) : (
                    <span className="dish-set-text"><SetPngIcon />{t("pages.nomenclature.dishestable.set")}</span>
                  )
                ) : (
                  <RecipeBadge count={row.ingredientsCount} onClick={(event) => openRecipes?.(row, event.currentTarget)} />
                )}
              </td>
              ) : null}
              {isColumnVisible("actions") ? (
              <td className="dish-col-actions">
                <div className="dish-row-actions">
                  <button type="button" disabled={saving || pendingDeleteId === row.id} onClick={() => openDrawer(row)} aria-label={t("pages.nomenclature.dishestable.redaktirovat")}>
                    <Icon name="bi-pencil" size={15} />
                  </button>
                  {showArchived ? (
                    <button
                      type="button"
                      className="dish-restore-action"
                      disabled={restoringId === row.id}
                      onClick={() => (onRestoreRequest ? onRestoreRequest(row) : restoreDish?.(row.id))}
                      aria-label={t("pages.nomenclature.dishestable.vosstanovit")}
                      title={t("pages.nomenclature.dishestable.vosstanovit")}
                    >
                      <Icon name="bi-arrow-counterclockwise" size={15} />
                    </button>
                  ) : (
                    <button type="button" className="danger" disabled={pendingDeleteId === row.id} onClick={() => (onArchiveRequest ? onArchiveRequest(row) : archiveDish(row.id))} aria-label={t("pages.nomenclature.dishestable.udalit")}>
                      <Icon name="bi-trash3" size={15} />
                    </button>
                  )}
                </div>
              </td>
              ) : null}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <ExternalTableScrollbar targetRef={scrollRef} label={t("pages.nomenclature.dishestable.scroll_label", { label: t(scrollAriaLabel) })} />
      {isEmpty ? (
        <div className="dish-empty-overlay">
          <ReportEmptyState title={t(emptyTitle)} />
        </div>
      ) : null}
      {preview ? createPortal(
        <div className={`dish-photo-viewer-layer${previewClosing ? " is-closing" : ""}`}>
          <div
            className="dish-photo-viewer-overlay"
            role="presentation"
            onClick={closePreview}
          />
          <div
            className="dish-photo-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={t("pages.nomenclature.dishestable.dish_photo", { name: preview.name })}
          >
            <button
              type="button"
              className="dish-photo-viewer__close"
              onClick={closePreview}
              aria-label={t("pages.nomenclature.dishestable.zakryt_foto")}
            >
              <Icon name="bi-x-lg" size={18} />
            </button>
            <img src={preview.src} alt={`Фото блюда «${preview.name}»`} />
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
