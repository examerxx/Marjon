import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import SupportWidget from "./SupportWidget";
import Topbar from "./Topbar";
import { clampToToday, todayInputValue } from "../utils/date";
import { useAuth } from "../hooks/useAuth";
import { getRole } from "../utils/permissions";

const pageMeta = {
  "/": ["Owner Dashboard", "Ключевые показатели ресторана"],
  "/warehouse": ["Склад", "Остатки и движение товаров"],
  "/warehouse/stock-in": ["Приход товаров", "Оформление поступлений"],
  "/warehouse/stock-out": ["Расход товаров", "Списание и выдача товаров"],
  "/warehouse/balance": ["Остаток", "Текущие складские остатки"],
  "/warehouse/income-log": ["Журнал приходов", "История поступлений"],
  "/warehouse/transfer": ["Перемещение", "Движение между складами"],
  "/warehouse/inventory": ["Инвентаризация", "Проверка фактических остатков"],
  "/warehouse/write-off": ["Списание", "Списание товаров и актов"],
  "/warehouse/write-off-categories": ["Категории списания", "Причины и категории списания"],
  "/warehouse/waste": ["Отход товаров", "Потери и списания"],
  "/reports": ["Отчеты", "Продажи и динамика"],
  "/reports/z-report": ["Z - Отчёт", "Итоговый кассовый отчёт смены"],
  "/reports/orders": ["Отчёт по заказам", "Заказы по статусам и периодам"],
  "/reports/tables": ["Отчёт по столам", "Загрузка и оборот столов"],
  "/reports/waiters": ["Отчёт по официантам", "Эффективность персонала зала"],
  "/reports/dishes": ["Отчёт по блюдам", "Продажи и популярность блюд"],
  "/reports/cancelled-dishes": ["Отчёт по отмененным блюдам", "Отмены и потери"],
  "/reports/debtors-creditors": ["Дебиторы и кредиторы", "Задолженности и платежи"],
  "/users": ["Сотрудники", "Команда и доступы"],
  "/users/cashier": ["Кассир", "Кассовые смены и доступы"],
  "/users/waiter": ["Официант", "Зал и заказы"],
  "/users/monoblock": ["Моноблок", "Рабочие места и терминалы"],
  "/users/kitchen": ["Кухня", "KDS и кухонная команда"],
  "/users/manager": ["Менеджер", "Управленческий доступ"],
  "/settings": ["Настройки", "Параметры платформы"],
  "/settings/clients": ["Клиенты", "Клиентская база и лояльность"],
  "/settings/place": ["Место", "Залы, столы и зоны обслуживания"],
  "/settings/payment-methods": ["Способ оплаты", "Касса и методы оплаты"],
  "/settings/units": ["Единица измерения", "Единицы склада и меню"],
  "/settings/profile": ["Настройка профиля", "Профиль ресторана и бренд"],
  "/settings/printers": ["Настройка принтеров", "Печать чеков и кухни"],
  "/settings/receipt": ["Настройка чека", "Клиентский чек"],
  "/settings/chef-receipt": ["Настройка чека повара", "Кухонный чек"],
  "/settings/support": ["Тех. поддержка", "Диагностика и обращения"],
  "/finance": ["Финансы", "Выручка и финансовые показатели"],
  "/finance/operations": ["Денежные операции", "Приходы, расходы и движения"],
  "/finance/income-categories": ["Категория приходов", "Справочник входящих средств"],
  "/finance/expense-categories": ["Категория расходов", "Справочник затрат"],
  "/nomenclature": ["Номенклатура", "Блюда и доступность"],
  "/nomenclature/dishes": ["Блюда", "Меню и доступность блюд"],
  "/nomenclature/menu": ["Продажа", "Сколько чего продалось"],
  "/nomenclature/raw-materials": ["Сырьё", "Ингредиенты и складской учёт"],
  "/nomenclature/semi-finished": ["Полуфабрикаты", "Заготовки и производство"],
  "/nomenclature/dish-categories": ["Категория блюд", "Группы меню"],
  "/nomenclature/raw-categories": ["Категория сырья", "Группы складского сырья"],
  "/nomenclature/semi-finished-categories": ["Категория полуфабрикатов", "Группы заготовок"],
  "/nomenclature/sales-categories": ["Категория реализации", "Каналы и группы продаж"],
  "/store": ["Магазин", "Заказы и продажи"],
  "/reviews": ["Отзывы", "Отзывы клиентов"],
};

export default function DashboardLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => todayInputValue());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [title, subtitle] = useMemo(() => pageMeta[location.pathname] || ["Dashboard", ""], [location.pathname]);
  const isUsersSection = location.pathname.startsWith("/users");
  const selectedDateContext = useMemo(() => ({
    user,
    selectedDate,
    setSelectedDate: (value) => setSelectedDate(clampToToday(value)),
  }), [user, selectedDate]);

  useEffect(() => {
    document.body.classList.add("dashboard-body");
    return () => document.body.classList.remove("dashboard-body");
  }, []);

  // Редирект waiter/kitchen на их рабочие места
  useEffect(() => {
    if (loading || !user) return;
    const role = getRole(user);
    if (role === "waiter" && !location.pathname.startsWith("/waiter")) {
      navigate("/waiter", { replace: true });
    } else if (role === "kitchen" && !location.pathname.startsWith("/kitchen")) {
      navigate("/kitchen", { replace: true });
    }
  }, [user, loading, location.pathname, navigate]);

  return (
    <div>
      <div className={`dashboard-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-expanded"}`}>
        <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
        <div className={`dashboard-main ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <Topbar
            title={title}
            subtitle={subtitle}
            selectedDate={selectedDate}
            onSelectedDateChange={setSelectedDate}
          />
          <main className={`dashboard-content ${isUsersSection ? "dashboard-content--staff" : ""}`}>
            <Outlet context={selectedDateContext} />
          </main>
          <SupportWidget />
        </div>
      </div>
    </div>
  );
}


