import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/marjon-logo.svg";
import brandLogo from "../assets/brand/marjon-logo.svg";
import { logout } from "../api/client";
import { canAccessPath, filterNavItems, getRole } from "../utils/permissions";
import { readStoredProfile } from "../utils/profileCache";
import { navItems } from "./sidebar/navConfig";
import SidebarSearch from "./sidebar/SidebarSearch";
import SidebarNav from "./sidebar/SidebarNav";
import SidebarAccount from "./sidebar/SidebarAccount";
import SidebarMobileNav from "./sidebar/SidebarMobileNav";

// Оркестратор сайдбара OWNER. Владеет состоянием и обработчиками навигации,
// аккаунт-меню и мобильной панели; рендер разнесён по презентационным
// подкомпонентам (FE-07B). Роли/доступы через permissions — FE-05/RBAC не меняются.
export default function Sidebar({ user, collapsed, onToggle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const closePopoverTimer = useRef(null);
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
  const role = getRole(user) || "owner";
  const displayName = user?.full_name || user?.name || user?.email || "Owner";
  const profileCardName = user?.full_name || user?.name || (user?.email ? `${user.email.slice(0, 14)}...` : "manager@marjon...");
  const profileCardRole = role;
  const profilePhoto = storedProfile.photo || logo;

  // Ролевая фильтрация пунктов меню (ТЗ §2.2)
  const visibleNavItems = useMemo(() => filterNavItems(navItems, user), [user]);
  const canOpenProfile = canAccessPath(user, "/settings/profile");
  const canOpenSupport = canAccessPath(user, "/settings/support");
  const canOpenStore = canAccessPath(user, "/store");
  const canOpenReviews = canAccessPath(user, "/reviews");
  const exactChildParentKey = useMemo(() => (
    visibleNavItems.find((item) => item.children?.some((child) => location.pathname === child.to))?.key || ""
  ), [location.pathname, visibleNavItems]);

  useEffect(() => {
    const activeParent = navItems.find((item) => item.children?.some((child) => location.pathname === child.to));
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
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
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
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
    setHoverMenu(key);
  }

  function closeCollapsedPopover() {
    if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
    closePopoverTimer.current = setTimeout(() => setHoverMenu(""), 260);
  }

  function openCollapsedAccount() {
    if (closeAccountTimer.current) clearTimeout(closeAccountTimer.current);
    if (collapsed) {
      if (closePopoverTimer.current) clearTimeout(closePopoverTimer.current);
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
      <div className="sidebar-brand">
        <div className="sidebar-brand__identity">
          <button
            className="brand-mark brand-mark--button"
            type="button"
            onClick={onToggle}
            title={collapsed ? "Открыть меню" : "Свернуть меню"}
            aria-label={collapsed ? "Открыть меню" : "Свернуть меню"}
          >
            <img src={brandLogo} alt="MARJON" className="marjon-logo" decoding="async" />
          </button>
          <div>
            <div className="brand-title">MARJON</div>
            <div className="brand-subtitle">Restaurant OS</div>
          </div>
        </div>
      </div>

      <SidebarSearch
        navItems={visibleNavItems}
        navigate={navigate}
        setPinnedMenu={setPinnedMenu}
        setOpenMenu={setOpenMenu}
      />

      <SidebarNav
        visibleNavItems={visibleNavItems}
        location={location}
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
        role={role}
        user={user}
        profilePhoto={profilePhoto}
        profileCardName={profileCardName}
        profileCardRole={profileCardRole}
        storedProfile={storedProfile}
        canOpenProfile={canOpenProfile}
        canOpenSupport={canOpenSupport}
        canOpenStore={canOpenStore}
        canOpenReviews={canOpenReviews}
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
      moreOpen={moreOpen}
      setMoreOpen={setMoreOpen}
      canOpenProfile={canOpenProfile}
      profilePhoto={profilePhoto}
      displayName={displayName}
      profileCardRole={profileCardRole}
      handleLogout={handleLogout}
      navigate={navigate}
    />
    </>
  );
}
