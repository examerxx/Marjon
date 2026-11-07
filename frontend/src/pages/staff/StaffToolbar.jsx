import { useLayoutEffect, useRef, useState } from "react";
import Icon from "../../components/Icon";
import { roleOptions } from "./staffConstants";

// Шапка, вкладки статуса и панель фильтров списка сотрудников OWNER.
// Вынесено из StaffRolePage.jsx (FE-07B). Разметка, классы и текст сохранены 1:1;
// состояние фильтров и обработчики принадлежат оркестратору и приходят пропсами.
export default function StaffToolbar({
  pageTitle,
  openAddModal,
  activeTab,
  setActiveTab,
  draftFilters,
  setDraftFilters,
  routeRole,
  applyFilters,
  clearFilters,
  hideFilters = false,
}) {
  // CASHIER-FE-03: Reports-like header — title LEFT, action group RIGHT:
  // [Активные | Архивированные] immediately LEFT of [+ Добавить].
  // Sliding pill: one measured indicator travels under the active segment.
  const tabsRef = useRef(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  useLayoutEffect(() => {
    if (!hideFilters) return undefined;
    const container = tabsRef.current;
    if (!container) return undefined;
    const update = () => {
      const active = container.querySelector(`[data-tab="${activeTab}"]`);
      if (!active) return;
      setPill((current) => {
        const next = { left: active.offsetLeft, width: active.offsetWidth };
        return current.left === next.left && current.width === next.width
          ? current
          : next;
      });
    };
    update();
    // Segment widths change on webfont swap without any resize event —
    // observe the segments themselves so the pill never goes stale.
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(container);
      container
        .querySelectorAll("[data-tab]")
        .forEach((segment) => ro.observe(segment));
    } else {
      window.addEventListener("resize", update);
    }
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    fonts?.ready.then(update).catch(() => {});
    fonts?.addEventListener?.("loadingdone", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      fonts?.removeEventListener?.("loadingdone", update);
    };
  }, [hideFilters, activeTab]);
  if (hideFilters) {
    return (
      <header className="staff-header staff-header--cashier">
        <div className="staff-header__title">
          <span className="staff-header__accent" aria-hidden="true" />
          <div>
            <p className="staff-header__eyebrow">Пользователи</p>
            <h1>{pageTitle}</h1>
          </div>
        </div>
        <div className="staff-header__actions">
          <div
            className="staff-tabs staff-tabs--slider"
            role="tablist"
            aria-label="Статус сотрудников"
            data-active={activeTab}
            ref={tabsRef}
          >
            <span
              className="staff-tabs__indicator"
              aria-hidden="true"
              style={{
                transform: `translateX(${pill.left}px)`,
                width: pill.width,
              }}
            />
            <button
              className={activeTab === "active" ? "is-active" : ""}
              type="button"
              data-tab="active"
              onClick={() => setActiveTab("active")}
            >
              <Icon name="bi-check2-circle" size={17} />
              Активные
            </button>
            <button
              className={activeTab === "archived" ? "is-active" : ""}
              type="button"
              data-tab="archived"
              onClick={() => setActiveTab("archived")}
            >
              <Icon name="bi-archive" size={17} />
              Архивированные
            </button>
          </div>
          <button className="staff-add-button staff-add-button--cashier" type="button" onClick={openAddModal}>
            <Icon name="bi-plus" size={18} />
            Добавить +
          </button>
        </div>
      </header>
    );
  }
  return (
    <>
      <header className="staff-header">
        <div className="staff-header__title">
          <span className="staff-header__accent" aria-hidden="true" />
          <div>
            <p className="staff-header__eyebrow">Пользователи</p>
            <h1>{pageTitle}</h1>
          </div>
        </div>
        <button className="staff-add-button" type="button" onClick={openAddModal}>
          <Icon name="bi-plus" size={18} />
          Добавить +
        </button>
      </header>

      <div className="staff-tabs" role="tablist" aria-label="Статус сотрудников">
        <button
          className={activeTab === "active" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("active")}
        >
          <Icon name="bi-check2-circle" size={17} />
          Активные
        </button>
        <button
          className={activeTab === "archived" ? "is-active" : ""}
          type="button"
          onClick={() => setActiveTab("archived")}
        >
          <Icon name="bi-archive" size={17} />
          Архивированные
        </button>
      </div>

      {/* CASHIER-FE-01: /users/cashier defines the category via the route —
          the generic filter block is removed entirely (no wrapper, no gap). */}
      {!hideFilters && (
      <div className="staff-filters">
        <label>
          <span>Поиск</span>
          <div className="staff-filter-control">
            <Icon name="bi-search" size={17} />
            <input
              type="search"
              value={draftFilters.query}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="ФИО или телефон"
            />
          </div>
        </label>
        <label>
          <span>Роль</span>
          <select
            value={draftFilters.roleKey}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, roleKey: event.target.value }))
            }
            disabled={routeRole !== "all"}
          >
            <option value="">Все роли</option>
            {roleOptions.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Статус</span>
          <select
            value={draftFilters.status}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="archived">Архивированные</option>
          </select>
        </label>
        <div className="staff-filter-buttons">
          <button type="button" onClick={applyFilters}>
            <Icon name="bi-funnel" size={16} />
            Фильтровать
          </button>
          <button type="button" className="staff-clear-button" onClick={clearFilters}>
            <Icon name="bi-arrow-counterclockwise" size={16} />
            Очистить
          </button>
        </div>
      </div>
      )}
    </>
  );
}