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

function moveBlock(blocks, block, direction) {
  const index = blocks.indexOf(block);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return blocks;
  const next = [...blocks];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export default function ChefReceiptSettingsPage() {
  const defaults = useMemo(() => buildKitchenTemplate(), []);
  const [template, setTemplate] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    getKitchenTemplate()
      .then(({ template: loaded, source }) => {
        if (!active) return;
        setTemplate({ ...defaults, ...loaded, enabled: { ...defaults.enabled, ...loaded.enabled } });
        setMessage(source === "local" ? "Шаблон загружен из локального кеша." : "");
      })
      .catch(() => setError("Не удалось загрузить шаблон кухни. Используются значения по умолчанию."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [defaults]);

  function patchTemplate(patch) {
    setTemplate((current) => ({ ...current, ...patch }));
  }

  function toggleBlock(block) {
    setTemplate((current) => ({
      ...current,
      enabled: { ...current.enabled, [block]: !current.enabled?.[block] },
    }));
  }

  function move(block, direction) {
    setTemplate((current) => ({ ...current, blocks: moveBlock(current.blocks, block, direction) }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    const { source } = await saveKitchenTemplate(template);
    setSaving(false);
    setMessage(source === "api" ? "Шаблон кухонного чека сохранён." : "API недоступен. Шаблон сохранён локально.");
  }

  async function handleTestPrint() {
    setPrinting(true);
    setError("");
    setMessage("");
    const result = await testPrintKitchen(template);
    setPrinting(false);
    if (result.ok) {
      setMessage("Тестовая печать кухни отправлена.");
    } else {
      setError(result.detail);
    }
  }

  return (
    <section className="receipt-page">

      {error ? <div className="message message-error">{error}</div> : null}

      <div className="receipt-layout">
        <div className="receipt-settings card card-pad">
          <div className="receipt-panel-title">
            <h3>Параметры кухни</h3>
            {loading ? <span>Загрузка...</span> : null}
          </div>
          <div className="receipt-control-grid">
            <label className="receipt-field">
              <span>Размер бумаги</span>
              <select value={template.paperSize} onChange={(event) => patchTemplate({ paperSize: event.target.value })}>
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
              </select>
            </label>
            <label className="receipt-switch">
              <input
                type="checkbox"
                checked={Boolean(template.autoPrint)}
                onChange={(event) => patchTemplate({ autoPrint: event.target.checked })}
              />
              <span>Автопечать нового заказа</span>
            </label>
          </div>

          <div className="receipt-kitchen-hint">
            <strong>Кухонный чек</strong>
            <p>Номер заказа выводится крупно, позиции печатаются без цен, с модификаторами и комментариями.</p>
          </div>

          <div className="receipt-panel-title">
            <h3>Блоки чека</h3>
            <span>Порядок и видимость</span>
          </div>
          <ReceiptSectionEditor
            blocks={template.blocks}
            enabled={template.enabled}
            labels={KITCHEN_BLOCK_LABELS}
            onToggle={toggleBlock}
            onMove={move}
          />
        </div>

        <aside className="receipt-preview-sticky">
          <ReceiptPreview type="kitchen" template={template} />
        </aside>
      </div>
    </section>
  );
}
