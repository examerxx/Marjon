import { useState } from "react";
import { ReceiptLayout } from "./SettingsReceiptPage";

function SettingsKitchenReceiptPage() {
  const [settings, setSettings] = useState({
    order: true,
    table: true,
    waiter: true,
    groupByWorkshop: true,
    comments: true,
    time: true,
    bigFont: true,
    onlyNew: true,
  });

  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));

  return (
    <ReceiptLayout
      title="Настройка чека повара"
      settings={settings}
      update={update}
      fields={[
        ["order", "Показывать номер заказа"],
        ["table", "Показывать стол"],
        ["waiter", "Показывать официанта"],
        ["groupByWorkshop", "Группировать по цеху"],
        ["comments", "Показывать комментарии к блюдам"],
        ["time", "Показывать время заказа"],
        ["bigFont", "Крупный шрифт для кухни"],
        ["onlyNew", "Печатать только новые блюда"],
      ]}
      preview={<KitchenPreview settings={settings} />}
    />
  );
}

function KitchenPreview({ settings }) {
  return (
    <div className={`settings-receipt-preview settings-kitchen-preview ${settings.bigFont ? "is-big" : ""}`}>
      <h3>КУХНЯ</h3>
      {settings.order ? <p>Заказ №39957057</p> : null}
      {settings.table ? <p>Стол: ЗАЛЛ, 6</p> : null}
      {settings.waiter ? <p>Официант: САБИНА</p> : null}
      {settings.time ? <p>Время: 20:57</p> : null}
      <hr />
      {settings.groupByWorkshop ? <strong>Горячий цех</strong> : null}
      <p>Плов x1</p>
      {settings.comments ? <small>Комментарий: без лука</small> : null}
      <p>Лагман x2</p>
      {settings.onlyNew ? <small>Печать: только новые блюда</small> : null}
    </div>
  );
}

export default SettingsKitchenReceiptPage;
