import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import i18n from "../i18n";
import logo from "../assets/marjon-logo.svg";
import brandLogo from "../assets/brand/marjon-neon-logo-v110.png";
import { logout } from "../api/client";
import { canAccessPath, filterNavItems } from "../utils/permissions";
import { readStoredProfile } from "../utils/profileCache";
import { useProfilePhoto } from "../hooks/useProfilePhoto";
import { isNavPathActive, navItems } from "./sidebar/navConfig";
import SidebarSearch from "./sidebar/SidebarSearch";
import SidebarNav from "./sidebar/SidebarNav";
import SidebarAccount from "./sidebar/SidebarAccount";
import SidebarMobileNav from "./sidebar/SidebarMobileNav";
import DarkShellWaves from "./preview/DarkShellWaves";
import { t } from "../i18n/t";

// Оркестратор сайдбара OWNER. Владеет состоянием и обработчиками навигации,
// аккаунт-меню и мобильной панели; рендер разнесён по презентационным
// подкомпонентам (FE-07B). Роли/доступы через permissions — FE-05/RBAC не меняются.
export default function Sidebar({ user, collapsed, onToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const dashboardTo = import.meta.env.DEV && new URLSearchParams(location.search).get("previewData") === "1"
    ? "/?previewData=1"
    : "/";
  const closeAccountTimer = useRef(null);
  const [openMenu, setOpenMenu] = useState("");
  const [pinnedMenu, setPinnedMenu] = useState("");
  const [hoverMenu, setHoverMenu] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [langPanelOpen, setLangPanelOpen] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem("marjon_lang") || "ru");
  const [storedProfile, setStoredProfile] = useState(() => readStoredProfile(user?.id));
  const accountRef = useRef(null);
  // Server identity wins over obsolete browser-only profile overrides.
  const displayName = user?.name || user?.full_name || user?.email || "Owner";
  const profileCardName = user?.name || user?.full_name || (user?.email ? `${user.email.slice(0, 14)}...` : "manager@marjon...");
  const serverPhoto = useProfilePhoto(user);
  const profilePhoto = serverPhoto || logo;

  // Ролевая фильтрация пунктов меню (ТЗ §2.2)
  const visibleNavItems = useMemo(() => filterNavItems(navItems, user), [user]);
  const canOpenProfile = canAccessPath(user, "/settings/profile");
  const canOpenSupport = canAccessPath(user, "/settings/support");
  const canOpenStore = canAccessPath(user, "/store");
  const exactChildParentKey = useMemo(() => (
    visibleNavItems.find((item) => item.children?.some((child) => isNavPathActive(location.pathname, child.to)))?.key || ""
  ), [location.pathname, visibleNavItems]);

  useEffect(() => {
    const activeParent = navItems.find((item) => item.children?.some((child) => isNavPathActive(location.pathname, child.to)));
    if (activeParent) {
      setPinnedMenu(activeParent.key);
      setOpenMenu(activeParent.key);
    } else {
      setPinnedMenu("");
      setOpenMenu("");
    }
  }, [location.pathname]);

  useEffect(() => { setAccountOpen(false); setLangPanelOpen(false); }, [location.pathname]);
  useEffect(() => { setHoverMenu(""); }, [location.pathname]);
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  useEffect(() => {
    setStoredProfile(readStoredProfile(user?.id));
    const syncStoredProfile = (event) => {
      if (event?.detail?.userId && String(event.detail.userId) !== String(user?.id || "")) return;
      setStoredProfile(readStoredProfile(user?.id));
    };
    window.addEventListener("storage", syncStoredProfile);
    window.addEventListener("marjon-profile-updated", syncStoredProfile);
    return () => {
      window.removeEventListener("storage", syncStoredProfile);
      window.removeEventListener("marjon-profile-updated", syncStoredProfile);
    };
  }, [user?.id]);

  useEffect(() => () => {
    if (closeAccountTimer.current) clearTimeout(closeAccountTimer.current);
  }, []);

  useEffect(() => {
    if (!accountOpen) {
      setLangPanelOpen(false);
      return undefined;
    }
    function onDocClick(event) {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function selectLang(code) {
    setLang(code);
    localStorage.setItem("marjon_lang", code);
    // Раньше выбор языка только писался в localStorage: интерфейс оставался
    // на прежнем языке до перезагрузки страницы, и переключатель выглядел
    // сломанным. Теперь язык применяется сразу и запоминается для всех
    // экранов (в т.ч. для экрана входа).
    try {
      i18n.changeLanguage(code);
      document.documentElement.lang = code;
    } catch { /* i18n не инициализирован — язык применится после перезагрузки */ }
    setLangPanelOpen(false);
  }

  function closeAccountAndSelectMenu(menuKey = "") {
    setAccountOpen(false);
    setLangPanelOpen(false);
    setPinnedMenu(menuKey);
    setOpenMenu(menuKey);
    setHoverMenu("");
  }

  function openCollapsedPopover(key) {
    if (collapsed && accountOpen) return;
    setHoverMenu(key);
  }

  function closeCollapsedPopover() {
    setHoverMenu("");
  }

  function openCollapsedAccount() {
    if (closeAccountTimer.current) clearTimeout(closeAccountTimer.current);
    if (collapsed) {
      setHoverMenu("");
      setAccountOpen(true);
    }
  }

  function closeCollapsedAccount() {
    if (closeAccountTimer.current) clearTimeout(closeAccountTimer.current);
    if (collapsed) {
      closeAccountTimer.current = setTimeout(() => setAccountOpen(false), 260);
    }
  }

  return (
    <>
    <aside className={`dashboard-sidebar ${collapsed ? "is-collapsed" : ""}`} id="dashboardSidebar">
      <DarkShellWaves variant="sidebar" />
      <div className="sidebar-brand">
        <div className="sidebar-brand__identity">
          <button
            className="brand-mark brand-mark--button"
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t("sidebar.open_menu") : t("sidebar.collapse_menu")}
          >
            <img src={brandLogo} alt="MARJON" className="marjon-logo" decoding="async" />
          </button>
          <div>
            <div className="brand-subtitle">ERP SYSTEM</div>
            <div className="brand-title">MARJON</div>
          </div>
        </div>
      </div>

      <SidebarSearch
        collapsed={collapsed}
        navItems={visibleNavItems}
        navigate={navigate}
        setPinnedMenu={setPinnedMenu}
        setOpenMenu={setOpenMenu}
      />

      <SidebarNav
        visibleNavItems={visibleNavItems}
        location={location}
        dashboardTo={dashboardTo}
        collapsed={collapsed}
        openMenu={openMenu}
        pinnedMenu={pinnedMenu}
        hoverMenu={hoverMenu}
        exactChildParentKey={exactChildParentKey}
        setPinnedMenu={setPinnedMenu}
        setOpenMenu={setOpenMenu}
        setHoverMenu={setHoverMenu}
        openCollapsedPopover={openCollapsedPopover}
        closeCollapsedPopover={closeCollapsedPopover}
      />

      <SidebarAccount
        accountRef={accountRef}
        accountOpen={accountOpen}
        setAccountOpen={setAccountOpen}
        collapsed={collapsed}
        displayName={displayName}
        user={user}
        profilePhoto={profilePhoto}
        profileCardName={profileCardName}
        storedProfile={{ ...storedProfile, photo: serverPhoto }}
        canOpenProfile={canOpenProfile}
        canOpenSupport={canOpenSupport}
        canOpenStore={canOpenStore}
        lang={lang}
        langPanelOpen={langPanelOpen}
        setLangPanelOpen={setLangPanelOpen}
        selectLang={selectLang}
        closeAccountAndSelectMenu={closeAccountAndSelectMenu}
        handleLogout={handleLogout}
        openCollapsedAccount={openCollapsedAccount}
        closeCollapsedAccount={closeCollapsedAccount}
      />
    </aside>
    {/* Mobile bottom nav — вне aside, чтобы transform сайдбара не ломал position:fixed */}
    <SidebarMobileNav
      visibleNavItems={visibleNavItems}
      location={location}
      dashboardTo={dashboardTo}
      moreOpen={moreOpen}
      setMoreOpen={setMoreOpen}
      canOpenProfile={canOpenProfile}
      profilePhoto={profilePhoto}
      displayName={displayName}
      handleLogout={handleLogout}
      navigate={navigate}
    />
    </>
  );
}
