import { useEffect, useMemo, useRef, useState } from "react";
import ReceiptPreview from "../../components/receipt/ReceiptPreview";
import ReceiptSectionEditor from "../../components/receipt/ReceiptSectionEditor";
import { isActiveConstructorBlock } from "../../components/receipt/receiptBlockCapabilities";
import { useOrg } from "../../context/OrgContext";
import { settingsService } from "../../api/settings";
import {
  CUSTOMER_BLOCK_LABELS,
  CUSTOMER_STYLE_BLOCKS,
  LINE_SPACING_OPTIONS,
  PRINTER_CONNECTION_OPTIONS,
  buildCustomerTemplate,
  getCustomerTemplate,
  normalizeLineSpacing,
  normalizePrinterConnection,
  saveCustomerTemplate,
  testPrintReceipt,
} from "../../api/receipt";
import { isAbortError } from "../../hooks/useAsyncSafety";
import "./receiptSettings.css";

// Editor-only grouping of the constructor rows. Covers every canonical
// customer block exactly once; order inside groups follows template.blocks.
// Notes: "Тип заказа" has no independent block (rendered on the orderNumber
// row); "Сумма блюд" has no toggle (rendered once, anchored to `total`).
// Collapse state lives inside ReceiptSectionEditor (UI-only, never saved).
export const CUSTOMER_RECEIPT_GROUPS = [
  { key: "header", title: "Шапка", blocks: ["logo", "restaurantName", "address", "phone"] },
  { key: "order", title: "Информация о заказе", blocks: ["orderNumber", "table", "waiter", "dateTime"] },
  { key: "items", title: "Состав заказа", blocks: ["items"] },
  { key: "totals", title: "Итоги", blocks: ["discount", "serviceFee", "vat", "total", "paymentMethod"] },
  { key: "footer", title: "Нижняя часть", blocks: ["thankYouText", "bottomOrderNumber"] },
];

export default function ReceiptSettingsPage() {
  const { org, reload: reloadOrg } = useOrg();
  const defaults = useMemo(() => buildCustomerTemplate(org), [org]);
  const [template, setTemplate] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  // Standalone card collapse state is UI-only (never saved, never sent):
  // params + line-spacing panels reuse the group collapse language.
  const [openPanels, setOpenPanels] = useState(() => ({ additional: true }));
  function togglePanel(key) {
    setOpenPanels((current) => ({ ...current, [key]: !current[key] }));
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    getCustomerTemplate(org, { signal: controller.signal })
      .then(({ template: loaded }) => {
        if (!active) return;
        setTemplate({
          ...defaults,
          ...loaded,
          enabled: { ...defaults.enabled, ...loaded.enabled },
          blockStyles: { ...defaults.blockStyles, ...loaded.blockStyles },
          positions: { ...defaults.positions, ...loaded.positions },
        });
      })
      .catch((requestError) => {
        if (active && !isAbortError(requestError)) setError("Не удалось загрузить серверный шаблон чека. Показан локальный черновик по умолчанию.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; controller.abort(); };
  }, [defaults, org]);

  // PLACEHOLDER_HANDLERS
  function patchTemplate(patch) {
    setTemplate((current) => ({ ...current, ...patch }));
  }

  function toggleBlock(block) {
    setTemplate((current) => ({
      ...current,
      enabled: { ...current.enabled, [block]: !current.enabled?.[block] },
    }));
  }

  function changeBlockStyle(block, patch) {
    setTemplate((current) => ({
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
    setMessage("");
    try {
      const { template: saved } = await saveCustomerTemplate(template);
      setTemplate((current) => ({ ...current, ...saved }));
      setMessage("Шаблон чека сохранён на сервере.");
    } catch (err) {
      if (err.response?.status === 409) {
        setConflict(true);
        setError("Шаблон был изменён в другом месте. Обновите страницу, чтобы получить актуальную версию, затем повторите.");
      } else {
        setError(err.response?.data?.detail || "Не удалось сохранить шаблон чека на сервере. Изменения остались только в текущем черновике.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleTestPrint() {
    setPrinting(true);
    const result = await testPrintReceipt(template);
    setPrinting(false);
    if (result.ok) setMessage("Открыто окно печати предпросмотра.");
  }

  // Company logo for the logo block: real upload through the canonical
  // POST /companies/me/logo (jpg/png/webp, persisted as Company.logo_key),
  // then the org profile is reloaded so the preview shows the confirmed
  // server URL. No base64, no localStorage, no fake success.
  async function handleLogoFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Поддерживаются только jpg, png, webp.");
      return;
    }
    if (uploadingLogo) return;
    setUploadingLogo(true);
    setError("");
    setMessage("");
    try {
      await settingsService.uploadCompanyLogo(file);
      await reloadOrg();
      setMessage("Логотип загружен.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось загрузить логотип.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoDelete() {
    setUploadingLogo(true);
    setError("");
    setMessage("");
    try {
      await settingsService.deleteCompanyLogo();
      await reloadOrg();
      setMessage("Логотип удалён.");
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось удалить логотип.");
    } finally {
      setUploadingLogo(false);
    }
  }

  // Block extras always render their UI: the animated row-details wrapper
  // (ReceiptSectionEditor) owns visibility, so OFF hides with animation
  // while values survive in template state. Never cleared on toggle.
  function renderBlockExtra(block) {
    if (block === "restaurantName") {
      return (
        <div className="receipt-block-extra">
          <label className="receipt-field">
            <span>Название</span>
            <input
              value={template.restaurantName || ""}
              onChange={(event) => patchTemplate({ restaurantName: event.target.value })}
            />
          </label>
        </div>
      );
    }
    if (block === "address" || block === "phone") {
      const isAddress = block === "address";
      return (
        <div className="receipt-block-extra">
          <label className="receipt-field">
            <span>{isAddress ? "Адрес" : "Телефон"}</span>
            <input
              value={isAddress ? template.address || "" : template.phone || ""}
              onChange={(event) => patchTemplate(isAddress
                ? { address: event.target.value }
                : { phone: event.target.value })}
            />
          </label>
        </div>
      );
    }
    if (block === "thankYouText") {
      return (
        <div className="receipt-block-extra">
          <label className="receipt-field">
            <span>Комментарий к чеку</span>
            <input
              value={template.thankYouText || ""}
              onChange={(event) => patchTemplate({ thankYouText: event.target.value })}
            />
          </label>
        </div>
      );
    }
    if (block !== "logo") return null;
    return (
      <div className="receipt-logo-field">
        {org?.logo ? (
          <img className="receipt-logo-thumb" src={org.logo} alt="Логотип компании" />
        ) : (
          <span className="receipt-logo-empty">Логотип компании не установлен</span>
        )}
        {org?.logo ? (
          <span className="receipt-logo-name">Логотип компании</span>
        ) : null}
        <div className="receipt-logo-actions">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Файл логотипа"
            disabled={uploadingLogo}
            onChange={handleLogoFile}
            hidden
          />
          <button
            type="button"
            className="receipt-btn-secondary"
            disabled={uploadingLogo}
            onClick={() => logoInputRef.current?.click()}
          >
            {uploadingLogo ? "Загрузка..." : org?.logo ? "Заменить" : "Выбрать логотип"}
          </button>
          {org?.logo ? (
            <button type="button" className="receipt-btn-secondary" disabled={uploadingLogo} onClick={handleLogoDelete}>
              Удалить
            </button>
          ) : null}
        </div>
      </div>
    );
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
                <h1>Настройка чека</h1>
              </div>
            </div>
            <div className="receipt-editor-actions receipt-editor-actions--end">
              <button type="button" className="receipt-btn-secondary" disabled={printing} onClick={handleTestPrint}>Печать предпросмотра</button>
            </div>
          </div>
          <div className="receipt-header-spacer" aria-hidden="true" />
        </header>

        {conflict ? <div className="receipt-banner receipt-banner--error" role="alert">{error}</div> : null}
        {!conflict && error ? <div className="receipt-banner receipt-banner--error" role="alert">{error}</div> : null}
        {!error && message ? <div className="receipt-banner receipt-banner--ok" role="status">{message}</div> : null}

        <div className="receipt-grid">
          <div className="receipt-editor-col">
            <div className="receipt-editor">
            {/* Unknown legacy keys (e.g. retired "qr") never get an editor
                 row: every visible toggle must have a real preview effect.
                 Discount/VAT are intentionally hidden from the editor (their
                 stored enabled state still applies to already-saved
                 templates in preview and print); use serviceFee/total. */}
            <ReceiptSectionEditor
              blocks={(template.blocks || []).filter(isActiveConstructorBlock).filter((block) => block !== "discount" && block !== "vat")}
              enabled={template.enabled}
              labels={CUSTOMER_BLOCK_LABELS}
              blockStyles={template.blockStyles}
              styleBlocks={CUSTOMER_STYLE_BLOCKS}
              onToggle={toggleBlock}
              onStyleChange={changeBlockStyle}
              renderBlockExtra={renderBlockExtra}
              groups={CUSTOMER_RECEIPT_GROUPS}
            />

              <section className="receipt-section-group" data-settings-section="additional">
                <button
                  type="button"
                  className="receipt-section-group__header"
                  aria-expanded={openPanels.additional}
                  onClick={() => togglePanel("additional")}
                >
                  <span className="receipt-section-group__title">Дополнительные настройки</span>
                  <span className="receipt-section-group__chevron" aria-hidden="true" />
                </button>
                <div className={`receipt-section-group__body${openPanels.additional ? " is-open" : ""}`}>
                  <div className="receipt-section-group__inner">
                    <div className="receipt-duo">
                      <div className="receipt-duo-col">
                        <span className="receipt-duo-label">Место между строками</span>
                        <div className="receipt-segments receipt-line-spacing" role="group" aria-label="Место между строками чека">
                          {LINE_SPACING_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={normalizeLineSpacing(template.lineSpacing) === option.value ? "is-active" : ""}
                              onClick={() => patchTemplate({ lineSpacing: option.value })}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="receipt-duo-col">
                        <span className="receipt-duo-label">Подключение принтера</span>
                        <div className="receipt-segments receipt-line-spacing" role="group" aria-label="Подключение принтера">
                          {PRINTER_CONNECTION_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={normalizePrinterConnection(template.printerConnection) === option.value ? "is-active" : ""}
                              onClick={() => patchTemplate({ printerConnection: option.value })}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <div className="receipt-editor-save">
                <button type="button" className="receipt-btn-primary receipt-save" disabled={saving || loading} onClick={handleSave}>
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>

          <aside className="receipt-preview-col">
            <ReceiptPreview type="customer" template={template} org={org} fitPane />
          </aside>
        </div>
      </section>
    </div>
  );
}
