import { useEffect, useMemo, useRef, useState } from "react";
import ReceiptPreview from "../../components/receipt/ReceiptPreview";
import ReceiptSeparatorSelect from "../../components/receipt/ReceiptSeparatorSelect";
import ReceiptSectionEditor from "../../components/receipt/ReceiptSectionEditor";
import Toast from "../../components/Toast";
import { InlineLoader } from "../../components/Loader";
import {
  CHEF_ALIGN_OPTIONS,
  CHEF_STYLE_CONTROLS,
  CHEF_WEIGHT_OPTIONS,
  KITCHEN_BLOCK_LABELS,
  KITCHEN_BLOCKS,
  LINE_SPACING_OPTIONS,
  buildKitchenTemplate,
  getKitchenTemplate,
  migrateKitchenTemplate,
  normalizeLineSpacing,
  saveKitchenTemplate,
} from "../../api/receipt";
import { isAbortError } from "../../hooks/useAsyncSafety";
import { t } from "../../i18n/t";
import "./receiptSettings.css";

// Единый с чеком клиента вид левой колонки: те же сворачиваемые группы.
// Порядок внутри групп — как в template.blocks; свернутость UI-only.
export const CHEF_RECEIPT_GROUPS = [
  { key: "order", title: "Информация о заказе", blocks: ["orderType", "orderNumber", "table", "waiter", "date"] },
  { key: "dishItems", title: "Позиции блюд", blocks: ["dishItems"] },
  { key: "sums", title: "Суммы", blocks: ["showOrderSum"] },
  { key: "notes", title: "Комментарий", blocks: ["comment"] },
];

export default function ChefReceiptSettingsPage() {
  const defaults = useMemo(() => buildKitchenTemplate(), []);
  const [template, setTemplate] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [toastClosing, setToastClosing] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const toastTimers = useRef([]);
  function clearToastTimers() {
    toastTimers.current.forEach((timer) => clearTimeout(timer));
    toastTimers.current = [];
  }
  useEffect(() => () => clearToastTimers(), []);
  function flashMessage(text) {
    clearToastTimers();
    setToastClosing(false);
    setMessage(text);
    toastTimers.current.push(setTimeout(() => setToastClosing(true), 4500));
    toastTimers.current.push(setTimeout(() => {
      setMessage("");
      setToastClosing(false);
    }, 5000));
  }
  function clearToast() {
    clearToastTimers();
    setToastClosing(false);
    setMessage("");
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    getKitchenTemplate({ signal: controller.signal })
      .then(({ template: loaded }) => {
        if (!active) return;
        setTemplate(migrateKitchenTemplate(loaded, defaults));
      })
      .catch((requestError) => {
        if (active && !isAbortError(requestError)) setError("Не удалось загрузить серверный шаблон кухни. Показан локальный черновик по умолчанию.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [defaults]);

  // PLACEHOLDER_BODY
  function toggleBlock(block) {
    setTemplate((current) => ({
      ...current,
      enabled: { ...current.enabled, [block]: !current.enabled?.[block] },
    }));
  }

  function changeBlockStyle(block, patch) {    setTemplate((current) => ({
      ...current,
      blockStyles: {
        ...(current.blockStyles || {}),
        [block]: { ...(current.blockStyles?.[block] || {}), ...patch },
      },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setConflict(false);
    clearToast();
    try {
      const { template: saved } = await saveKitchenTemplate(template);
      setTemplate((current) => ({ ...current, ...saved }));
      flashMessage("Шаблон кухонного чека сохранён на сервере.");
    } catch (err) {
      if (err.response?.status === 409) {
        setConflict(true);
        setError("Шаблон был изменён в другом месте. Обновите страницу, чтобы получить актуальную версию, затем повторите.");
      } else {
        setError(err.response?.data?.detail || "Не удалось сохранить шаблон кухни на сервере. Изменения остались только в текущем черновике.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page settings-owner-view receipt-settings-page">
      <section className="settings-card">
        <header className="settings-header receipt-header">
          <div className="receipt-header-left">
            <div className="settings-title-group">
              <span className="settings-accent-bar" />
              <div>
                <p>{t("pages.settings.chefreceiptsettingspage.nastroyki")}</p>
                <h1>{t("pages.settings.chefreceiptsettingspage.nastroyka_cheka_povara")}</h1>
              </div>
            </div>
            <div className="receipt-editor-actions receipt-editor-actions--end">
              <ReceiptSeparatorSelect value={template.separator} disabled={loading || saving}
                onChange={(separator) => setTemplate((current) => ({ ...current, separator }))} />
              <button type="button" className="receipt-btn-primary receipt-save" disabled={saving || loading} onClick={handleSave}>
                {saving ? t("staff.saving") : t("common.save")}
              </button>
            </div>
          </div>
          <div className="receipt-header-spacer" aria-hidden="true" />
        </header>

        {error ? <Toast kind="error" message={error} onClose={() => setError("")} /> : null}
        {!error && message ? <Toast kind="success" message={message} leaving={toastClosing} onClose={clearToast} /> : null}

        <div className="receipt-grid" aria-busy={loading}>
          {loading ? (
            <div className="receipt-template-loading" role="status">
              <InlineLoader text="Загрузка шаблона чека…" />
            </div>
          ) : (
          <>
          <div className="receipt-editor-col">
            <div className="receipt-editor">
              <ReceiptSectionEditor
                blocks={[...template.blocks.filter(block => block !== "dishItems"), "dishItems"]}
                enabled={template.enabled}
                labels={{ ...KITCHEN_BLOCK_LABELS, dishItems: "Текст позиций" }}
                blockStyles={template.blockStyles}
                styleBlocks={[...KITCHEN_BLOCKS, "dishItems"]}
                fixedBlocks={["dishItems"]}
                onToggle={toggleBlock}
                onStyleChange={changeBlockStyle}
                styleRowClassName="receipt-section-row__style--chef"
                sizeOptionsForBlock={(block) => CHEF_STYLE_CONTROLS[block]?.sizes || []}
                alignOptionsForBlock={(block) => (CHEF_STYLE_CONTROLS[block]?.align ? CHEF_ALIGN_OPTIONS : [])}
                weightOptionsForBlock={(block) => (CHEF_STYLE_CONTROLS[block]?.weight ? CHEF_WEIGHT_OPTIONS : [])}
                groups={CHEF_RECEIPT_GROUPS}
              />
              {/* Плотность чека стоит в самом низу: это «финальная» настройка
                  внешнего вида, её трогают после разбора блоков, а не до. */}
              <div className="receipt-section-row receipt-kitchen-spacing">
                <div className="receipt-segment-group">
                  <span>{t("pages.settings.chefreceiptsettingspage.mesto_mezhdu_strokami")}</span>
                  <div className="receipt-segments receipt-line-spacing" role="group" aria-label={t("pages.settings.chefreceiptsettingspage.mesto_mezhdu_strokami_cheka_povara")}>
                    {LINE_SPACING_OPTIONS.map((option) => (
                      <button key={option.value} type="button"
                        className={normalizeLineSpacing(template.lineSpacing, "medium") === option.value ? "is-active" : ""}
                        aria-pressed={normalizeLineSpacing(template.lineSpacing, "medium") === option.value}
                        onClick={() => setTemplate((current) => ({ ...current, lineSpacing: option.value }))}>
                        {t(option.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="receipt-preview-col">
            <ReceiptPreview type="kitchen" template={template} fitPane />
          </aside>
          </>
          )}
        </div>
      </section>
    </div>
  );
}
