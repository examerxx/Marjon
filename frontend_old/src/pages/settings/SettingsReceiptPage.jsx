import { useState } from "react";

function SettingsReceiptPage() {
  const [settings, setSettings] = useState({
    logo: true,
    address: true,
    phone: true,
    waiter: true,
    table: true,
    qr: true,
    footer: "Спасибо за покупку",
    width: "80mm",
    fontSize: "Средний",
  });

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  return (
    <ReceiptLayout
      title="Настройка чека"
      settings={settings}
      update={update}
      fields={[
        ["logo", "Показывать логотип"],
        ["address", "Показывать адрес"],
        ["phone", "Показывать телефон"],
        ["waiter", "Показывать официанта"],
        ["table", "Показывать номер стола"],
        ["qr", "Показывать QR"],
      ]}
      extra={(
        <>
          <label><span>Текст внизу чека</span><input value={settings.footer} onChange={(event) => update("footer", event.target.value)} /></label>
          <label><span>Ширина чека</span><select value={settings.width} onChange={(event) => update("width", event.target.value)}><option>58mm</option><option>80mm</option></select></label>
          <label><span>Размер шрифта</span><select value={settings.fontSize} onChange={(event) => update("fontSize", event.target.value)}><option>Маленький</option><option>Средний</option><option>Крупный</option></select></label>
        </>
      )}
      preview={<ReceiptPreview settings={settings} />}
    />
  );
}

function ReceiptPreview({ settings }) {
  return (
    <div className={`settings-receipt-preview ${settings.width === "58mm" ? "is-narrow" : ""}`}>
      {settings.logo ? <div className="settings-receipt-logo">MARJON</div> : null}
      <h3>SARDOR AVTO T</h3>
      {settings.address ? <p>Tashkent</p> : null}
      {settings.phone ? <p>+998 90 000 00 00</p> : null}
      <hr />
      <p>Дата: 23.06.2026</p>
      <p>Заказ №39957057</p>
      {settings.table ? <p>Стол: ЗАЛЛ, 6</p> : null}
      {settings.waiter ? <p>Официант: САБИНА</p> : null}
      <hr />
      <p>Плов x1 35 000</p>
      <p>Чай зелёный x2 12 000</p>
      <strong>Итого: 47 000 UZS</strong>
      {settings.qr ? <div className="settings-receipt-qr">QR</div> : null}
      <small>{settings.footer}</small>
    </div>
  );
}

export function ReceiptLayout({ title, settings, update, fields, extra, preview }) {
  return (
    <div className="settings-page">
      <section className="settings-card">
        <header className="settings-header">
          <div className="settings-title-group">
            <span className="settings-accent-bar" />
            <div><p>Настройки</p><h1>{title}</h1></div>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={() => window.alert("Сохранение чека будет доступно в следующей версии")}>Сохранить</button>
            <button type="button" onClick={() => window.alert("Тест печати будет доступен в следующей версии")}>Напечатать тест</button>
          </div>
        </header>
        <div className="settings-receipt-layout">
          <div className="settings-receipt-form">
            {fields.map(([key, label]) => (
              <label className="settings-toggle-row" key={key}>
                <span>{label}</span>
                <input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => update(key, event.target.checked)} />
              </label>
            ))}
            {extra}
          </div>
          <aside>{preview}</aside>
        </div>
      </section>
    </div>
  );
}

export default SettingsReceiptPage;
