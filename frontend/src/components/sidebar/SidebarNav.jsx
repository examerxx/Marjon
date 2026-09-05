import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";

const SUBMENU_RETRACT_MS = 260;

// Десктопное дерево навигации сайдбара OWNER.
// Вынесено из Sidebar.jsx (FE-07B). Разметка, классы и поведение сохранены 1:1;
// всё состояние по-прежнему принадлежит оркестратору Sidebar и приходит пропсами.
export default function SidebarNav({
  visibleNavItems,
  location,
  collapsed,
  openMenu,
  pinnedMenu,
  hoverMenu,
  exactChildParentKey,
  setPinnedMenu,
  setOpenMenu,
  setHoverMenu,
  openCollapsedPopover,
  closeCollapsedPopover,
}) {
  const popoverHosts = useRef(new Map());
  const [popoverPlacement, setPopoverPlacement] = useState({ key: "", top: 0 });
  // Свёрнутый рельс показывает подкатегории поповером, поэтому инлайновая панель
  // ему не нужна. Но убрать её из DOM в тот же кадр, когда рельс начинает
  // сворачиваться, — значит потерять анимацию выхода: панель исчезает мгновенно,
  // а хост продолжает двигаться (рывок). Держим панель на время выхода и
  // размонтируем после него; при рендере уже свёрнутого рельса её нет вовсе.
  const [collapsedSnapshot, setCollapsedSnapshot] = useState(collapsed);
  const [retracting, setRetracting] = useState(false);
  if (collapsedSnapshot !== collapsed) {
    setCollapsedSnapshot(collapsed);
    setRetracting(collapsed);
  }
  const inlineSubmenuMounted = !collapsed || retracting;

  useEffect(() => {
    if (!retracting) return undefined;
    const timer = setTimeout(() => setRetracting(false), SUBMENU_RETRACT_MS);
    return () => clearTimeout(timer);
  }, [retracting]);

  useLayoutEffect(() => {
    if (!collapsed || !hoverMenu) return;
    const host = popoverHosts.current.get(hoverMenu);
    const popover = host?.querySelector(".sidebar-collapsed-popover");
    if (!host || !popover) return;

    const sidebar = host.closest(".dashboard-sidebar");
    const topbar = document.querySelector(".dashboard-topbar");
    const account = sidebar?.querySelector(".sidebar-account");
    const measurePopover = () => {
      const hostRect = host.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const topbarBottom = topbar?.getBoundingClientRect().bottom || 0;
      const accountTop = account?.getBoundingClientRect().top || window.innerHeight;
      const topBoundary = Math.max(8, topbarBottom + 8);
      const bottomBoundary = Math.min(window.innerHeight - 8, accountTop - 8);
      const maxTop = Math.max(topBoundary, bottomBoundary - popoverRect.height);
      const viewportTop = Math.min(Math.max(hostRect.top, topBoundary), maxTop);
      const top = Math.round(viewportTop - hostRect.top);

      setPopoverPlacement((current) => (
        current.key === hoverMenu && current.top === top ? current : { key: hoverMenu, top }
      ));
    };

    measurePopover();
    window.addEventListener("resize", measurePopover);
    return () => window.removeEventListener("resize", measurePopover);
  }, [collapsed, hoverMenu, visibleNavItems]);

  return (
    <div className="sidebar-nav-scroll">
      <nav className="sidebar-nav" aria-label="Навигация">
        {visibleNavItems.map((item) => {
        const hasChildren = Boolean(item.children?.length);
        const childActive = hasChildren && item.children.some((child) => location.pathname === child.to);
        const active = exactChildParentKey
          ? item.key === exactChildParentKey
          : item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to) || childActive;
        const submenuOpen = !collapsed && (openMenu === item.key || pinnedMenu === item.key);
        const popoverOpen = collapsed && hoverMenu === item.key;

        if (hasChildren) {
          return (
            <div
              key={item.key}
              ref={(node) => {
                if (node) popoverHosts.current.set(item.key, node);
                else popoverHosts.current.delete(item.key);
              }}
              className={`sidebar-nav-item has-submenu ${active ? "is-active" : ""} ${submenuOpen ? "is-open" : ""} ${popoverOpen ? "has-popover" : ""}`}
              onMouseEnter={() => {
                if (collapsed) {
                  openCollapsedPopover(item.key);
                }
              }}
              onMouseLeave={() => {
                if (collapsed) {
                  closeCollapsedPopover();
                }
              }}
            >
              <button
                className={`sidebar-link sidebar-link--button ${active ? "is-active" : ""}`}
                type="button"
                onClick={() => {
                  if (pinnedMenu === item.key) {
                    setPinnedMenu("");
                    setOpenMenu("");
                  } else {
                    setPinnedMenu(item.key);
                    setOpenMenu(item.key);
                  }
                }}
                aria-expanded={collapsed ? popoverOpen : submenuOpen}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon"><Icon name={item.icon} size={18} /></span>
                <span>{item.label}</span>
                <Icon name="bi-chevron-right" size={18} className="sidebar-link__chevron" aria-hidden="true" />
              </button>
              {inlineSubmenuMounted ? (
                <div className="sidebar-submenu">
                  {item.children.map((child) => (
                    <Link
                      key={child.key}
                      className={`sidebar-submenu__link ${location.pathname === child.to ? "is-active" : ""}`}
                      to={child.to}
                      onClick={() => {
                        setPinnedMenu(item.key);
                        setOpenMenu(item.key);
                      }}
                    >
                      <span className="sidebar-submenu__dot" aria-hidden="true" />
                      <span className="sidebar-submenu__icon"><Icon name={child.icon || "bi-circle"} size={child.icon ? 16 : 8} /></span>
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : null}
              {collapsed ? (
                <div
                  className="sidebar-collapsed-popover"
                  style={popoverPlacement.key === item.key ? { top: `${popoverPlacement.top}px` } : undefined}
                  onMouseEnter={() => openCollapsedPopover(item.key)}
                  onMouseLeave={closeCollapsedPopover}
                >
                  {item.children.map((child) => (
                    <Link
                      key={child.key}
                      className={`sidebar-collapsed-popover__link ${location.pathname === child.to ? "is-active" : ""}`}
                      to={child.to}
                      onClick={() => {
                        setPinnedMenu(item.key);
                        setOpenMenu(item.key);
                        setHoverMenu("");
                      }}
                    >
                      <span className="sidebar-collapsed-popover__icon">
                        <Icon name={child.icon || "bi-circle"} size={16} />
                      </span>
                      <span>{child.label}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <div key={item.key} className={`sidebar-nav-item ${active ? "is-active" : ""}`}>
            <Link
              className={`sidebar-link ${active ? "is-active" : ""}`}
              to={item.to}
              onClick={() => {
                setPinnedMenu("");
                setOpenMenu("");
              }}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebar-icon"><Icon name={item.icon} size={18} /></span>
              <span>{item.label}</span>
            </Link>
          </div>
        );
        })}
      </nav>
    </div>
  );
}
