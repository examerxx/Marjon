import { useEffect, useMemo, useState } from "react";
import ReceiptPreview from "../../components/receipt/ReceiptPreview";
import ReceiptSectionEditor from "../../components/receipt/ReceiptSectionEditor";
import {
  KITCHEN_BLOCK_LABELS,
  buildKitchenTemplate,
  getKitchenTemplate,
  saveKitchenTemplate,
  testPrintKitchen,
} from "../../api/receipt";
import { isAbortError } from "../../hooks/useAsyncSafety";
import "./receiptSettings.css";

export default function ChefReceiptSettingsPage() {
  const defaults = useMemo(() => buildKitchenTemplate(), []);
  const [template, setTemplate] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    getKitchenTemplate({ signal: controller.signal })
      .then(({ template: loaded }) => {
        if (!active) return;
        setTemplate({ ...defaults, ...loaded, enabled: { ...defaults.enabled, ...loaded.enabled } });
      })
      .catch((requestError) => {
        if (active && !isAbortError(requestError)) setError("Не удалось загрузить серверный шаблон кухни. Показан локальный черновик по умолчанию.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [defaults]);

  // PLACEHOLDER_BODY
  function patchTemplate(patch) {
    setTemplate((current) => ({ ...current, ...patch }));
  }

  function toggleBlock(block) {
    setTemplate((current) => ({
      ...current,
      enabled: { ...current.enabled, [block]: !current.enabled?.[block] },
    }));
  }

  function handleReset() {
    setTemplate(JSON.parse(JSON.stringify(defaults)));
    setError("");
    setConflict(false);
    setMessage("Шаблон сброшен к стандартному виду. Нажмите «Сохранить», чтобы применить.");
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setConflict(false);
    setMessage("");
    try {
      const { template: saved } = await saveKitchenTemplate(template);
      setTemplate((current) => ({ ...current, ...saved }));
      setMessage("Шаблон кухонного чека сохранён на сервере.");
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

  async function handleTestPrint() {
    setPrinting(true);
    const result = await testPrintKitchen(template);
    setPrinting(false);
    if (result.ok) setMessage("Открыто окно печати предпросмотра.");
  }

  return (
    <div className="settings-page settings-owner-view receipt-settings-page">
      <section className="settings-card">
        <header className="settings-header receipt-header">
          <div className="receipt-header-left">
            <div className="settings-title-group">
              <span className="settings-accent-bar" />
              <div>
                <p>Настройки</p>
                <h1>Настройка чека повара</h1>
              </div>
            </div>
            <div className="receipt-editor-actions receipt-editor-actions--end">
              <button type="button" className="receipt-btn-secondary" disabled={saving} onClick={handleReset}>Сбросить</button>
              <button type="button" className="receipt-btn-secondary" disabled={printing} onClick={handleTestPrint}>Печать предпросмотра</button>
            </div>
          </div>
          <div className="receipt-header-spacer" aria-hidden="true" />
        </header>

        {error ? <div className="receipt-banner receipt-banner--error" role="alert">{error}</div> : null}
        {!error && message ? <div className="receipt-banner receipt-banner--ok" role="status">{message}</div> : null}

        <div className="receipt-grid">
          <div className="receipt-editor-col">
            <div className="receipt-editor">
            <div className="receipt-subcard">
              <div className="receipt-subcard__head">
                <h3>Параметры кухни</h3>
                {loading ? <span className="receipt-subcard__hint">Загрузка...</span> : null}
              </div>
              <div className="receipt-field-grid">
                <label className="receipt-field">
                  <span>Размер бумаги</span>
                  <select value={template.paperSize} onChange={(event) => patchTemplate({ paperSize: event.target.value })}>
                    <option value="58mm">58mm</option>
                    <option value="80mm">80mm</option>
                  </select>
                </label>
                <label className="receipt-toggle-field">
                  <input type="checkbox" checked={Boolean(template.autoPrint)} onChange={(event) => patchTemplate({ autoPrint: event.target.checked })} />
                  <span>Автопечать нового заказа</span>
                </label>
              </div>
              <p className="receipt-paper-hint">Фактическая ширина печати зависит от настройки выбранного принтера. Кухонный чек печатает позиции без цен, с модификаторами и комментариями.</p>
            </div>

            <div className="receipt-subcard">
              <div className="receipt-subcard__head">
                <h3>Блоки чека</h3>
              </div>
              <ReceiptSectionEditor
                blocks={template.blocks}
                enabled={template.enabled}
                labels={KITCHEN_BLOCK_LABELS}
                onToggle={toggleBlock}
              />
            </div>

              <div className="receipt-editor-save">
                <button type="button" className="receipt-btn-primary receipt-save" disabled={saving || loading} onClick={handleSave}>
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>

          <aside className="receipt-preview-col">
            <ReceiptPreview type="kitchen" template={template} fitPane />
          </aside>
        </div>
      </section>
    </div>
  );
}
