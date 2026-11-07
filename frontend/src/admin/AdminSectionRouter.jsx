import { useEffect, useState } from "react";

import { adminFinanceApi } from "./financeApi";

import { hqService } from "./hqService";

import { isAbortError, useLatestRequest } from "../hooks/useAsyncSafety";

import { AdminSourcesPage, OrdersNomenclaturePage, ProductNomenclaturePage, SaleCategoryPage, UnitNomenclaturePage } from "./AdminCatalog";

import { AdminEmployeesPage } from "./AdminEmployees";

import { AdminCashierBackgroundPage, AdminExpenseCategoriesPage, AdminFinanceHistoryPage, AdminFinanceOperationsPage, AdminIncomeCategoriesPage, AdminPaymentMethodsPage } from "./AdminFinance";

import { TruthfulHandbookLocationPage } from "./AdminHandbook";

import { OrganizationDirectoryPage, OrganizationStatusPage, organizationRows } from "./features/organizations";

import { StatusBadge, getAdminFinanceLoadMessage } from "./AdminShared";

import { StorageBalancePage, StorageExpensePage, StorageIncomeJournalPage, StorageIncomePage, StorageInventoryPage, StorageWriteoffPage } from "./AdminStorage";

const SECTION_API_MAP = {
  "org-list": { serviceKey: "organizations", mapRow: (r) => [r.name || "—", r.type || "—", r.branches_count == null ? "—" : String(r.branches_count), r.admin_name || r.owner_name || "—", r.status || "—"] },
  "org-status": { serviceKey: "organizationStatuses", mapRow: (r) => [r.name || "—", r.status === true ? "Активен" : r.status === false ? "Неактивен" : "—", r.updated_at || "—", "—", "—"] },
  "nom-product": { serviceKey: "products", mapRow: null },
  "nom-sale-category": { serviceKey: "categories", mapRow: (r) => [r.name || "", r.slug || "", String(r.products_count || 0), r.sort_order != null ? String(r.sort_order) : "—", r.status ? "Активна" : "Неактивна"] },
  "nom-orders": { serviceKey: "orders", mapRow: (r) => [r.order_number || r.id || "", r.date || r.created_at || "", r.customer || "—", `${Number(r.total || 0).toLocaleString("ru-RU")} UZS`, r.status || ""] },
  "nom-unit": { serviceKey: "units", mapRow: (r) => [r.name || "", r.short_name || r.code || "", r.type || "—", r.is_base ? "Базовая" : "—", r.status !== false ? "Активна" : "Неактивна"] },
  "srv-employees": { serviceKey: "departments", mapRow: (r) => [r.name || "", r.position || r.role || "—", r.department || "—", r.privileges || "—", r.status !== false ? "Активна" : "Неактивна"] },
  "srv-source": { serviceKey: "sources", mapRow: (r) => [r.name || "", r.type || "—", r.url || "—", String(r.leads_count || 0), r.status !== false ? "Активна" : "Неактивна"] },
  "bank-transactions": {
    load: (config) => adminFinanceApi.listTransactions({ size: 100 }, config),
    mapRow: (row) => [
      String(row.id),
      row.organization_id ? String(row.organization_id) : "—",
      String(row.date),
      `${Number(row.amount).toLocaleString("ru-RU")} UZS`,
      row.direction,
      row.comment ?? "—",
    ],
  },
  "set-store": { serviceKey: "storeVersions", mapRow: (r) => [r.version || r.name || "", r.platform || "—", r.release_date || "—", r.status || "Активна"] },
  "set-cashier-bg": { serviceKey: "imageBackgrounds", mapRow: null },
  "set-languages": { serviceKey: "languages", mapRow: (r) => [r.name || "", r.code || "", r.is_default ? "Да" : "Нет", r.status !== false ? "Активна" : "Неактивна"] },
};

function useAdminData(sectionKey, onNotify, enabled = true) {
  const [apiRows, setApiRows] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const beginRequest = useLatestRequest();

  useEffect(() => {
    const ownership = beginRequest();
    if (!enabled) {
      setApiRows([]);
      setLoadState("idle");
      return;
    }
    const mapping = SECTION_API_MAP[sectionKey];
    if (!mapping) {
      setApiRows([]);
      setLoadState("unsupported");
      return;
    }
    setLoadState("loading");
    const request = mapping.load
      ? mapping.load({ signal: ownership.signal })
      : hqService.listSection(mapping.serviceKey, { size: 100 }, { signal: ownership.signal });
    request
      .then(({ data }) => {
        if (!ownership.isCurrent()) return;
        const items = Array.isArray(data) ? data : data?.items || data?.results || [];
        setApiRows(mapping.mapRow ? items.map(mapping.mapRow) : []);
        setLoadState(items.length ? "success" : "empty");
      })
      .catch((error) => {
        if (!ownership.isCurrent() || isAbortError(error)) return;
        setApiRows([]);
        setLoadState("error");
        if (mapping.load) onNotify?.(getAdminFinanceLoadMessage(error));
      });
  }, [beginRequest, enabled, onNotify, sectionKey]);

  return { apiRows, loadState };
}

const categoryContent = {
  // 1) Организации
  "org-list": {
    title: "Организации",
    text: "Все организации платформы MARJON: типы, филиалы и администраторы.",
    columns: ["Организация", "Тип", "Филиалов", "Админ", "Статус"],
    rows: organizationRows.map(([name, type, branches, admin, , status]) => [name, type, branches, admin, status]),
  },
  "org-status": {
    title: "Статус организаций",
    text: "Текущие статусы подключения, модерации и блокировки клиентов.",
    columns: ["Организация", "Статус", "Изменён", "Ответственный", "Состояние"],
    rows: [
      ["Bella Italia Group", "Активна", "11.06.2026", "Не указано", "Активна"],
      ["Coffee House", "Активна", "11.06.2026", "О. Ташматов", "Активна"],
      ["Sushi Master", "На модерации", "11.06.2026", "Д. Юнусов", "На модерации"],
      ["Burger Station", "Новый", "10.06.2026", "М. Саидов", "Новый"],
    ],
  },

  // 2) Отделы — управление сотрудниками и привилегиями
  departments: {
    title: "Отделы — управление сотрудниками",
    text: "Сотрудники платформы, роли, отделы и настройка привилегий доступа.",
    columns: ["Сотрудник", "Должность", "Отдел", "Привилегии", "Статус"],
    rows: [
      ["Не указано", "Суперадмин", "Управление", "Полный доступ", "Активна"],
      ["М. Саидов", "Менеджер продаж", "Продажи", "Продажи, Отчеты", "Активна"],
      ["Д. Юнусов", "Внедренец", "Внедрение", "Организации, Склад", "Активна"],
      ["С. Абдуллаев", "Поддержка", "Поддержка", "Заявки, Чаты", "Активна"],
      ["О. Ташматов", "Финансист", "Финансы", "Финансы, Банк", "На модерации"],
    ],
  },

  // 3) Склад
  "storage-income": {
    title: "Приход товаров",
    text: "Документы прихода товаров от поставщиков на склады организаций.",
    columns: ["Документ", "Поставщик", "Позиций", "Сумма", "Статус"],
    rows: [
      ["PR-10241", "Bella Foods", "32", "18 420 000 UZS", "Проведен"],
      ["PR-10238", "Coffee Trade", "12", "4 120 000 UZS", "Проведен"],
      ["PR-10235", "Fresh Market", "48", "27 800 000 UZS", "Черновик"],
    ],
  },
  "storage-expense": {
    title: "Расход товаров",
    text: "Списание товаров со склада на кухни, бары и точки продаж.",
    columns: ["Документ", "Получатель", "Позиций", "Сумма", "Статус"],
    rows: [
      ["RS-8841", "Кухня — Ташкент", "18", "6 240 000 UZS", "Проведен"],
      ["RS-8836", "Бар — Ургенч", "9", "1 820 000 UZS", "Проведен"],
      ["RS-8830", "Кухня — Денов", "14", "3 460 000 UZS", "Ожидает"],
    ],
  },
  "storage-balance": {
    title: "Остаток",
    text: "Текущие остатки товаров и сырья по складам организаций.",
    columns: ["Товар", "Категория", "Остаток", "Ед.", "Статус"],
    rows: [
      ["Мука в/с", "Сырьё", "1 240", "кг", "В норме"],
      ["Оливковое масло", "Сырьё", "86", "л", "Низкий"],
      ["Кофе зерно", "Сырьё", "410", "кг", "В норме"],
    ],
  },
  "storage-income-journal": {
    title: "Журнал приходов",
    text: "История всех приходных документов с датами и суммами.",
    columns: ["Дата", "Документ", "Поставщик", "Сумма", "Статус"],
    rows: [
      ["11.06.2026 09:12", "PR-10241", "Bella Foods", "18 420 000 UZS", "Проведен"],
      ["10.06.2026 17:40", "PR-10238", "Coffee Trade", "4 120 000 UZS", "Проведен"],
      ["10.06.2026 11:05", "PR-10235", "Fresh Market", "27 800 000 UZS", "Черновик"],
    ],
  },
  "storage-writeoff": {
    title: "Отход товаров",
    text: "Списание товаров по причинам брака, порчи и истечения срока.",
    columns: ["Документ", "Причина", "Позиций", "Сумма", "Статус"],
    rows: [],
  },
  "storage-inventory": {
    title: "Инвентаризация",
    text: "Сверка фактических остатков со складским учётом и расхождения.",
    columns: ["Документ", "Склад", "Расхождений", "Дата", "Статус"],
    rows: [],
  },

  // 4) Номенклатура
  "nom-product": {
    title: "Продукт",
    text: "Карточки продуктов: категории, цены и единицы измерения.",
    columns: ["Продукт", "Категория", "Цена", "Ед.", "Статус"],
    rows: [
      ["Маргарита 30см", "Пицца", "48 000 UZS", "шт", "Активна"],
      ["Цезарь с курицей", "Салаты", "36 000 UZS", "шт", "Активна"],
      ["Латте 0.3", "Напитки", "22 000 UZS", "шт", "Новый"],
    ],
  },
  "nom-sale-category": {
    title: "Категория реализации",
    text: "Категории меню для реализации и их доля в продажах.",
    columns: ["Категория", "Позиций", "Доля продаж", "Обновлено", "Статус"],
    rows: [
      ["Пицца", "42", "28.4%", "11.06.2026", "Активна"],
      ["Напитки", "36", "19.1%", "11.06.2026", "Активна"],
      ["Десерты", "18", "7.6%", "10.06.2026", "Новый"],
    ],
  },
  "nom-orders": {
    title: "Заказы",
    text: "Заказы по филиалам с суммами, временем и статусом выполнения.",
    columns: ["Заказ", "Филиал", "Сумма", "Время", "Статус"],
    rows: [
      ["№ 39957057", "Ташкент", "240 600 UZS", "20:57", "Завершено"],
      ["№ 39661785", "Ургенч", "177 100 UZS", "20:56", "Завершено"],
      ["№ 39382298", "Денов", "110 000 UZS", "17:59", "Ожидает"],
    ],
  },
  "nom-unit": {
    title: "Единица измерения",
    text: "Единицы измерения номенклатуры и их точность.",
    columns: ["Единица", "Сокращение", "Тип", "Точность", "Статус"],
    rows: [
      ["Килограмм", "кг", "Вес", "0.001", "Активна"],
      ["Литр", "л", "Объём", "0.01", "Активна"],
      ["Штука", "шт", "Количество", "1", "Активна"],
    ],
  },

  // 5) Справочник
  "hb-countries": {
    title: "Страны",
    text: "Справочник стран: коды, валюты и количество регионов.",
    columns: ["Страна", "Код", "Валюта", "Регионов", "Статус"],
    rows: [
      ["Узбекистан", "UZ", "UZS", "14", "Активна"],
      ["Казахстан", "KZ", "KZT", "17", "Активна"],
      ["Таджикистан", "TJ", "TJS", "4", "Новый"],
    ],
  },
  "hb-regions": {
    title: "Регионы",
    text: "Регионы стран с количеством районов и кодами.",
    columns: ["Регион", "Страна", "Районов", "Код", "Статус"],
    rows: [
      ["Ташкент", "Узбекистан", "11", "TAS", "Активна"],
      ["Хорезм", "Узбекистан", "10", "XOR", "Активна"],
      ["Сурхандарья", "Узбекистан", "14", "SUR", "Активна"],
    ],
  },
  "hb-districts": {
    title: "Районы",
    text: "Районы регионов с кодами и датой последнего изменения.",
    columns: ["Район", "Регион", "Код", "Обновлён", "Статус"],
    rows: [
      ["Юнусабадский", "Ташкент", "TAS-01", "11.06.2026", "Активна"],
      ["Ургенчский", "Хорезм", "XOR-03", "10.06.2026", "Активна"],
      ["Денауский", "Сурхандарья", "SUR-05", "09.06.2026", "Новый"],
    ],
  },

  // 6) Услуга
  "srv-employees": {
    title: "Сотрудники",
    text: "Сотрудники клиентов: роли, филиалы и контактные данные.",
    columns: ["Сотрудник", "Роль", "Филиал", "Телефон", "Статус"],
    rows: [
      ["И. Каримов", "Менеджер", "Ташкент", "+998 90 123-45-67", "Активна"],
      ["О. Ташматов", "Кассир", "Ургенч", "+998 91 234-56-78", "Активна"],
      ["А. Рахимов", "Официант", "Денов", "+998 93 345-67-89", "Новый"],
    ],
  },
  "srv-source": {
    title: "Источник",
    text: "Источники привлечения клиентов и их конверсия.",
    columns: ["Источник", "Тип", "Лидов", "Конверсия", "Статус"],
    rows: [
      ["Instagram", "Соцсети", "184", "18.4%", "Активна"],
      ["Telegram", "Мессенджер", "96", "21.8%", "Активна"],
      ["Рекомендации", "Партнёры", "43", "32.2%", "Новый"],
    ],
  },

  // 7) Банк
  "bank-stats": {
    title: "Статистика банка",
    text: "Сводная статистика банковских операций за период.",
    columns: ["Показатель", "Значение", "Динамика", "Период", "Статус"],
    rows: [
      ["Эквайринг", "4 820 000 000 UZS", "+12.4%", "Месяц", "В норме"],
      ["Комиссия", "48 200 000 UZS", "+0.8%", "Месяц", "В норме"],
      ["Возвраты", "2 140 000 UZS", "-3.1%", "Месяц", "В норме"],
    ],
  },
  "bank-transactions": {
    title: "Транзакции банка",
    text: "Транзакции HQ Finance по авторитетному backend-ответу.",
    columns: ["ID", "Организация", "Дата", "Сумма", "Направление", "Комментарий"],
    rows: [],
  },

  // 8) Финансы
  "fin-operations": {
    title: "Денежные операции",
    text: "Приходные и расходные денежные операции платформы.",
    columns: ["Документ", "Тип", "Сумма", "Способ", "Статус"],
    rows: [
      ["OP-2241", "Приход", "240 600 UZS", "CLICK", "Проведен"],
      ["OP-2238", "Расход", "110 000 UZS", "Наличные", "Проведен"],
      ["OP-2235", "Приход", "177 100 UZS", "Terminal", "Ожидает"],
    ],
  },
  "fin-income-cat": {
    title: "Категория приходов",
    text: "Категории приходов с долей в общем обороте.",
    columns: ["Категория", "Операций", "Сумма", "Доля", "Статус"],
    rows: [
      ["Приход от продаж", "1 284", "742 000 000 UZS", "82.4%", "Активна"],
      ["Прочие поступления", "96", "41 200 000 UZS", "12.1%", "Активна"],
      ["Возвраты", "18", "4 800 000 UZS", "5.5%", "Новый"],
    ],
  },
  "fin-expense-cat": {
    title: "Категория расходов",
    text: "Категории расходов с долей в общих затратах.",
    columns: ["Категория", "Операций", "Сумма", "Доля", "Статус"],
    rows: [
      ["Закупка сырья", "412", "318 000 000 UZS", "61.2%", "Активна"],
      ["Зарплата", "58", "142 000 000 UZS", "27.4%", "Активна"],
      ["Аренда", "12", "38 000 000 UZS", "7.3%", "Активна"],
    ],
  },
  "fin-payment": {
    title: "Способ оплаты",
    text: "Способы оплаты, объёмы операций и комиссии.",
    columns: ["Способ", "Операций", "Сумма", "Комиссия", "Статус"],
    rows: [
      ["Наличные", "642", "284 000 000 UZS", "0%", "Активна"],
      ["CLICK", "418", "196 000 000 UZS", "0.8%", "Активна"],
      ["Terminal", "224", "162 000 000 UZS", "1.2%", "Активна"],
    ],
  },
  "fin-history": {
    title: "История изменений",
    text: "Журнал изменений финансовых настроек и объектов.",
    columns: ["Дата", "Объект", "Действие", "Автор", "Статус"],
    rows: [
      ["11.06.2026 11:42", "Тариф Bella Italia", "Изменён", "Не указано", "Завершено"],
      ["10.06.2026 17:40", "Категория расходов", "Создана", "О. Ташматов", "Завершено"],
      ["09.06.2026 09:18", "Способ оплаты", "Удалён", "Д. Юнусов", "Ожидает"],
    ],
  },

  // 9) Настройки
  "set-store": {
    title: "Marjon store",
    text: "Подключённые модули магазина MARJON и их подписки.",
    columns: ["Модуль", "Версия", "Подписка", "Обновлён", "Статус"],
    rows: [
      ["POS Касса", "2.4.7", "Pro", "11.06.2026", "Активна"],
      ["QR-меню", "1.8.2", "Pro", "10.06.2026", "Активна"],
      ["Аналитика", "3.1.0", "Trial", "09.06.2026", "Новый"],
    ],
  },
  "set-cashier-bg": {
    title: "Фон для кассира",
    text: "Темы и фоны интерфейса кассира по точкам продаж.",
    columns: ["Тема", "Тип", "Применена к", "Обновлён", "Статус"],
    rows: [
      ["Тёмная графитовая", "Системная", "Все кассы", "11.06.2026", "Активна"],
      ["Светлая", "Системная", "Ургенч", "10.06.2026", "Активна"],
      ["Брендовая Marjon", "Кастом", "Ташкент", "09.06.2026", "Новый"],
    ],
  },
  "set-languages": {
    title: "Языки",
    text: "Языки интерфейса платформы и их покрытие переводами.",
    columns: ["Язык", "Код", "Покрытие", "Обновлён", "Статус"],
    rows: [
      ["Русский", "RU", "100%", "11.06.2026", "Активна"],
      ["Узбекский", "UZ", "98%", "11.06.2026", "Активна"],
      ["Английский", "EN", "72%", "10.06.2026", "Новый"],
    ],
  },
};

export function CategoryPage({ active, search, onCreate, onRowDetail, onNotify, onInnerBackChange }) {
  const content = categoryContent[active] || categoryContent["org-list"];
  const organizationPageOwnsData = active === "org-list" || active === "org-status";
  const { apiRows, loadState } = useAdminData(active, onNotify, !organizationPageOwnsData);
  if (active === "org-list") {
    return <OrganizationDirectoryPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "org-status") {
    return <OrganizationStatusPage search={search} onNotify={onNotify} />;
  }
  if (active === "storage-income") {
    return <StorageIncomePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-expense") {
    return <StorageExpensePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-balance") {
    return <StorageBalancePage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-income-journal") {
    return <StorageIncomeJournalPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "storage-writeoff") {
    return <StorageWriteoffPage search={search} onNotify={onNotify} />;
  }
  if (active === "storage-inventory") {
    return <StorageInventoryPage search={search} onNotify={onNotify} onInnerBackChange={onInnerBackChange} />;
  }
  if (active === "nom-product") {
    return <ProductNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-sale-category") {
    return <SaleCategoryPage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-orders") {
    return <OrdersNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "nom-unit") {
    return <UnitNomenclaturePage search={search} onNotify={onNotify} />;
  }
  if (active === "hb-countries" || active === "hb-regions" || active === "hb-districts") {
    return <TruthfulHandbookLocationPage active={active} search={search} />;
  }
  if (active === "srv-employees") {
    return <AdminEmployeesPage search={search} onNotify={onNotify} />;
  }
  if (active === "srv-source") {
    return <AdminSourcesPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-operations") {
    return <AdminFinanceOperationsPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-income-cat") {
    return <AdminIncomeCategoriesPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-expense-cat") {
    return <AdminExpenseCategoriesPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-payment") {
    return <AdminPaymentMethodsPage search={search} onNotify={onNotify} />;
  }
  if (active === "fin-history") {
    return <AdminFinanceHistoryPage search={search} onNotify={onNotify} />;
  }
  if (active === "set-cashier-bg") {
    return <AdminCashierBackgroundPage search={search} onNotify={onNotify} />;
  }
  const dataRows = apiRows;
  const rows = dataRows.filter((row) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return row.some((cell) => String(cell).toLowerCase().includes(query));
  });
  return (
    <section className="admin-category-page">
      {loadState === "loading" ? <div className="admin-data-state" role="status">Загрузка данных...</div> : null}
      {loadState === "error" ? <div className="admin-data-state" role="alert">Не удалось загрузить данные.</div> : null}
      {loadState === "unsupported" ? <div className="admin-data-state" role="status">Backend источник не подключён.</div> : null}
      <div className="admin-panel-head">
        <div>
          <h2>{content.title}</h2>
          <p>{content.text}</p>
        </div>
        {active !== "bank-transactions" ? <button type="button" onClick={() => onCreate(active)}>Создать</button> : null}
      </div>
      <div className="admin-category-table">
        <div className="admin-category-table__row admin-category-table__head" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }}>
          {content.columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.map((row, rowIndex) => (
          <div className="admin-category-table__row" style={{ gridTemplateColumns: `repeat(${content.columns.length}, minmax(0, 1fr))` }} key={rowIndex} role="button" tabIndex={0} onClick={() => onRowDetail(content.title, content.columns, row)} onKeyDown={(event) => { if (event.key === "Enter") onRowDetail(content.title, content.columns, row); }}>
            {row.map((cell, index) => content.columns[index] === "Статус" ? <StatusBadge status={cell} key={index} /> : <span key={index}>{cell}</span>)}
          </div>
        ))}
        {loadState === "empty" ? <div className="admin-data-state" role="status">Список пуст.</div> : null}
      </div>
    </section>
  );
}
