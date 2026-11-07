import { useState, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Icon from "../Icon";
import { sidebarLanguages } from "./navConfig";

// Меню аккаунта сайдбара OWNER (профиль, язык, магазин, отзывы, выход).
// Вынесено из Sidebar.jsx (FE-07B). Разметка, классы и поведение сохранены 1:1;
// состояние и обработчики принадлежат оркестратору Sidebar и приходят пропсами.
export default function SidebarAccount({
  accountRef,
  accountOpen,
  setAccountOpen,
  collapsed: railCollapsed,
  displayName,
  user,
  profilePhoto,
  profileCardName,
  storedProfile,
  canOpenProfile,
  canOpenSupport,
  canOpenStore,
  lang,
  langPanelOpen,
  setLangPanelOpen,
  selectLang,
  closeAccountAndSelectMenu,
  handleLogout,
  openCollapsedAccount,
  closeCollapsedAccount,
}) {
  const { t } = useTranslation();
  const [profileHost, setProfileHost] = useState(null);
  useLayoutEffect(() => { setProfileHost(document.getElementById("preview-topbar-profile")); }, []);
  const collapsed = profileHost ? false : railCollapsed;
  // Presence model so the panel animates OUT before unmounting (smooth close),
  // not just a hard conditional unmount. `render` keeps the node mounted while
  // closing; `closing` drives the exit animation; animationend clears it.
  const [render, setRender] = useState(accountOpen);
  const [closing, setClosing] = useState(false);
  const [langRender, setLangRender] = useState(langPanelOpen);
  const [langClosing, setLangClosing] = useState(false);
  useEffect(() => {
    if (accountOpen) { setRender(true); setClosing(false); }
    else if (render) {
      setClosing(true);
      const timer = setTimeout(() => { setClosing(false); setRender(false); }, 190);
      return () => clearTimeout(timer);
    }
  }, [accountOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (langPanelOpen) { setLangRender(true); setLangClosing(false); }
    else if (langRender) { setLangClosing(true); }
  }, [langPanelOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleMenuAnimEnd = (event) => {
    if (closing && ["owner-account-menu-out", "owner-account-flyout-out"].includes(event.animationName)) {
      setClosing(false);
      setRender(false);
    }
  };
  const handleLangPanelAnimEnd = (event) => {
    if (langClosing && event.animationName === "owner-lang-panel-out") {
      setLangClosing(false);
      setLangRender(false);
    }
  };
  // Selected-language binding: the compact trigger reflects the actual `lang`.
  const activeLang = sidebarLanguages.find((l) => l.code === lang) || sidebarLanguages[1];

  const account = (
    <div
      className={`sidebar-account ${accountOpen ? "is-open" : ""}`}
      ref={accountRef}
      onMouseEnter={openCollapsedAccount}
      onMouseLeave={closeCollapsedAccount}
    >
      {render ? (
        <div
          className={`sidebar-account__menu ${closing ? "is-closing" : ""}`}
          role="menu"
          inert={closing ? "" : undefined}
          aria-hidden={closing || undefined}
          onAnimationEnd={handleMenuAnimEnd}
          onMouseEnter={openCollapsedAccount}
          onMouseLeave={closeCollapsedAccount}
        >
          {!profileHost && <div className="sidebar-account__head">
            <div className={`sidebar-user__avatar ${storedProfile.photo ? "sidebar-user__avatar--photo" : ""}`}>
              <img src={profilePhoto} alt={displayName} className="sidebar-user-logo" decoding="async" />
            </div>
            <div className="sidebar-account__head-meta">
              <strong>{displayName}</strong>
            </div>
          </div>}
          <div id="preview-profile-balance" />
          {canOpenProfile ? (
            <Link className="sidebar-account__item" to="/settings/profile" role="menuitem" onClick={() => closeAccountAndSelectMenu("settings")}>
              <Icon name="bi-person-gear" size={16} />
              <span>{t("nav.profile_settings")}</span>
            </Link>
          ) : null}
          {canOpenSupport ? (
            <Link className="sidebar-account__item" to="/settings/support" role="menuitem" onClick={() => closeAccountAndSelectMenu("settings")}>
              <Icon name="bi-headset" size={16} />
              <span>{t("sidebar.support")}</span>
            </Link>
          ) : null}

          <div className={`sidebar-account__lang ${langPanelOpen ? "is-open" : ""} ${langRender ? "has-panel" : ""}`}>
            <button
              type="button"
              className="sidebar-account__lang-trigger"
              onClick={() => setLangPanelOpen((open) => !open)}
              aria-expanded={langPanelOpen}
              aria-haspopup="menu"
            >
              <span className="sidebar-account__lang-label">
                <Icon name="bi-translate" size={16} />
                {t("sidebar.language")}
              </span>
              <span className="sidebar-account__lang-current">
                <span className="sidebar-account__lang-current-flag" aria-hidden="true">
                  <img src={activeLang.flagUrl} alt="" loading="lazy" decoding="async" />
                </span>
                {activeLang.short}
              </span>
              <Icon name="bi-chevron-down" size={14} className="sidebar-account__lang-chevron" aria-hidden="true" />
            </button>
            {langRender ? (
              <div
                className={`sidebar-account__lang-panel ${langClosing ? "is-closing" : ""}`}
                role="menu"
                aria-label={t("sidebar.language")}
                onAnimationEnd={handleLangPanelAnimEnd}
              >
                {sidebarLanguages.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    className={lang === language.code ? "is-active" : ""}
                    onClick={() => selectLang(language.code)}
                    role="menuitemradio"
                    aria-checked={lang === language.code}
                    aria-label={`${t(language.labelKey, language.label)}: ${language.native}`}
                  >
                    <span className="sidebar-account__lang-flag" aria-hidden="true">
                      <img src={language.flagUrl} alt="" loading="lazy" decoding="async" />
                    </span>
                    <span className="sidebar-account__lang-code">{language.short}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {canOpenStore ? (
            <Link className="sidebar-account__item" to="/store" role="menuitem" onClick={() => closeAccountAndSelectMenu("")}>
              <Icon name="bi-shop" size={16} />
              <span>{t("sidebar.store")}</span>
            </Link>
          ) : null}

          <button type="button" className="sidebar-account__item sidebar-account__item--danger" role="menuitem" onClick={handleLogout}>
            <Icon name="bi-box-arrow-right" size={16} />
            <span>{t("sidebar.logout_action")}</span>
          </button>
        </div>
      ) : null}

      {collapsed && accountOpen ? (
        <div
          className="sidebar-account__hover-bridge"
          aria-hidden="true"
          onMouseLeave={closeCollapsedAccount}
        />
      ) : null}

      <button
        type="button"
        className="sidebar-user sidebar-user--button"
        onClick={() => setAccountOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={accountOpen}
      >
        <div className={`sidebar-user__avatar ${storedProfile.photo ? "sidebar-user__avatar--photo" : ""}`}>
          <img src={profilePhoto} alt={displayName} className="sidebar-user-logo" decoding="async" />
        </div>
        <div className="sidebar-user__meta">
          <strong className="sidebar-user__name" title={displayName}>{profileCardName}</strong>
          <em>{user?.company_name || "MARJON"}</em>
        </div>
        <Icon name="bi-chevron-right" size={16} className="sidebar-user__arrow" />
      </button>
    </div>
  );
  return profileHost ? createPortal(account, profileHost) : null;
}
