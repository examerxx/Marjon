import { useEffect, useMemo, useRef, useState } from "react";
import ReceiptPreview from "../../components/receipt/ReceiptPreview";
import ReceiptSectionEditor from "../../components/receipt/ReceiptSectionEditor";
import { isActiveConstructorBlock } from "../../components/receipt/receiptBlockCapabilities";
import { useOrg } from "../../context/OrgContext";
import { settingsService } from "../../api/settings";
import {
  CUSTOMER_BLOCK_LABELS,
  CUSTOMER_STYLE_BLOCKS,
  buildCustomerTemplate,
  getCustomerTemplate,
  saveCustomerTemplate,
  testPrintReceipt,
} from "../../api/receipt";
import { isAbortError } from "../../hooks/useAsyncSafety";
import "./receiptSettings.css";

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

  function renderLogoExtra(block) {
    if (block !== "logo" || !template.enabled?.logo) return null;
    return (
      <div className="receipt-logo-field">
        {org?.logo ? (
          <img className="receipt-logo-thumb" src={org.logo} alt="Логотип компании" />
        ) : (
          <span className="receipt-logo-empty">Логотип компании не установлен</span>
        )}
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
            {uploadingLogo ? "Загрузка..." : org?.logo ? "Заменить логотип" : "Выбрать логотип"}
          </button>
          {org?.logo ? (
            <button type="button" className="receipt-btn-secondary" disabled={uploadingLogo} onClick={handleLogoDelete}>
              Убрать
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
              <button type="button" className="receipt-btn-secondary" disabled={saving} onClick={handleReset}>Сбросить</button>
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
            <div className="receipt-subcard">
              <div className="receipt-subcard__head">
                <h3>Параметры</h3>
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
                <label className="receipt-field">
                  <span>Название</span>
                  <input value={template.restaurantName || ""} onChange={(event) => patchTemplate({ restaurantName: event.target.value })} />
                </label>
                <label className="receipt-field">
                  <span>Адрес</span>
                  <input value={template.address || ""} onChange={(event) => patchTemplate({ address: event.target.value })} />
                </label>
                <label className="receipt-field">
                  <span>Телефон</span>
                  <input value={template.phone || ""} onChange={(event) => patchTemplate({ phone: event.target.value })} />
                </label>
              </div>
              <p className="receipt-paper-hint">Фактическая ширина печати зависит от настройки выбранного принтера.</p>
              <label className="receipt-field receipt-field--wide">
                <span>Текст благодарности</span>
                <input value={template.thankYouText || ""} onChange={(event) => patchTemplate({ thankYouText: event.target.value })} />
              </label>
              <label className="receipt-field receipt-field--wide">
                <span>Нижний текст</span>
                <textarea rows="3" value={template.footerText || ""} onChange={(event) => patchTemplate({ footerText: event.target.value })} />
              </label>
            </div>

            <div className="receipt-subcard">
              <div className="receipt-subcard__head">
                <h3>Блоки чека</h3>
              </div>
              {/* Unknown legacy keys (e.g. retired "qr") never get an editor
                  row: every visible toggle must have a real preview effect. */}
              <ReceiptSectionEditor
                blocks={(template.blocks || []).filter(isActiveConstructorBlock)}
                enabled={template.enabled}
                labels={CUSTOMER_BLOCK_LABELS}
                blockStyles={template.blockStyles}
                styleBlocks={CUSTOMER_STYLE_BLOCKS}
                onToggle={toggleBlock}
                onStyleChange={changeBlockStyle}
                renderBlockExtra={renderLogoExtra}
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
            <ReceiptPreview type="customer" template={template} org={org} fitPane />
          </aside>
        </div>
      </section>
    </div>
  );
}
