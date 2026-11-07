import { Outlet, useLocation } from "react-router-dom";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import SupportWidget from "./SupportWidget";
import Topbar from "./Topbar";
import BranchSessionBanner from "./BranchSessionBanner";
import { resolvePageMeta } from "./pageMeta";
import { clampToToday, todayInputValue } from "../utils/date";
import { useAuth } from "../hooks/useAuth";
import "./dashboardStartup.css";

const TABLE_REPORT_PATHS = new Set([
  "/reports/orders",
  "/reports/tables",
  "/reports/waiters",
  "/reports/dishes",
  "/reports/cancelled-dishes",
]);

// Страницы «Сырьё» и «Полуфабрикаты» используют шаблон раздела «Сотрудники»
// (.staff-page/.staff-card), поэтому им нужна та же раскладка контента, что и
// у /users: без двойного отступа (.staff-page padding:0 + узкий padding у
// content). Без этого .staff-page сохраняет дефолтные 26px и карточка уезжает.
const STAFF_LAYOUT_PATHS = new Set([
  "/nomenclature/raw-materials",
  "/nomenclature/semi-finished",
]);

export default function DashboardLayout() {
  const location = useLocation();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => todayInputValue());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shellReady, setShellReady] = useState(false);
  const shellRef = useRef(null);

  const [title, subtitle] = useMemo(() => resolvePageMeta(location.pathname), [location.pathname]);
  const isUsersSection = location.pathname.startsWith("/users");
  const isStaffLayout = isUsersSection || STAFF_LAYOUT_PATHS.has(location.pathname);
  const isTableReport = TABLE_REPORT_PATHS.has(location.pathname);
  const selectedDateContext = useMemo(() => ({
    user,
    selectedDate,
    setSelectedDate: (value) => setSelectedDate(clampToToday(value)),
  }), [user, selectedDate]);

  // OWNER shell scope must exist BEFORE first paint: the approved light shell
  // rules are scoped under body.dashboard-body, while legacy layered rules
  // paint the shell dark. useLayoutEffect flushes synchronously after DOM
  // mutations and before the browser paints, so frame #1 is already correct.
  // (useEffect would run after first paint => one dark flash frame.)
  useLayoutEffect(() => {
    document.body.classList.add("dashboard-body");
    document.body.classList.add("marjon-dark-shell");
    // Resolve the scoped shell geometry without treating first mount as a
    // sidebar toggle. Subsequent user-triggered collapse animations are intact.
    shellRef.current?.getBoundingClientRect();
    const frame = requestAnimationFrame(() => setShellReady(true));
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("dashboard-body");
      document.body.classList.remove("marjon-dark-shell");
    };
  }, []);

  return (
    <div>
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <defs>
          <filter id="marjon-dark-card-art" colorInterpolationFilters="sRGB">
            {/* Use colour separation as alpha: fade the pale backing, keep the coloured objects. */}
            <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="artGray" />
            <feBlend in="SourceGraphic" in2="artGray" mode="difference" result="artChroma" />
            <feColorMatrix in="artChroma" type="matrix"
              values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  4 4 4 0 -0.88"
              result="artMask" />
            <feComposite in="SourceGraphic" in2="artMask" operator="in" />
          </filter>
        </defs>
      </svg>
      <BranchSessionBanner />
      <div ref={shellRef} data-shell-initializing={shellReady ? undefined : ""} className={`dashboard-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-expanded"}`}>
        <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((value) => !value)} />
        <div className="dashboard-workspace">
        <Topbar title={title} selectedDate={selectedDate} floatingShell onToggleMenu={() => setSidebarCollapsed(value => !value)} />
        <div className={`dashboard-main ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <main className={`dashboard-content${isStaffLayout ? " dashboard-content--staff" : ""}${isTableReport ? " dashboard-content--table-report" : ""}`}>
            <Outlet context={selectedDateContext} />
          </main>
          <SupportWidget />
        </div>
        </div>
      </div>
    </div>
  );
}


