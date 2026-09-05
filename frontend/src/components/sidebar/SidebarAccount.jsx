import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon";
import { sidebarLanguages } from "./navConfig";

// Меню аккаунта сайдбара OWNER (профиль, язык, магазин, отзывы, выход).
// Вынесено из Sidebar.jsx (FE-07B). Разметка, классы и поведение сохранены 1:1;
// состояние и обработчики принадлежат оркестратору Sidebar и приходят пропсами.
export default function SidebarAccount({
  accountRef,
  accountOpen,
  setAccountOpen,
  collapsed,
  displayName,
  role,
  user,
  profilePhoto,
  profileCardName,
  profileCardRole,
  storedProfile,
  canOpenProfile,
  canOpenSupport,
  canOpenStore,
  canOpenReviews,
  lang,
  langPanelOpen,
  setLangPanelOpen,
  selectLang,
  closeAccountAndSelectMenu,
  handleLogout,
  openCollapsedAccount,
  closeCollapsedAccount,
}) {
  // Presence model so the panel animates OUT before unmounting (smooth close),
  // not just a hard conditional unmount. `render` keeps the node mounted while
  // closing; `closing` drives the exit animation; animationend clears it.
  const [render, setRender] = useState(accountOpen);
  const [closing, setClosing] = useState(false);
  const [langRender, setLangRender] = useState(langPanelOpen);
  const [langClosing, setLangClosing] = useState(false);
  useEffect(() => {
    if (accountOpen) { setRender(true); setClosing(false); }
    else if (render) { setClosing(true); }
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

  return (
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
          onAnimationEnd={handleMenuAnimEnd}
          onMouseEnter={openCollapsedAccount}
          onMouseLeave={closeCollapsedAccount}
        >
          <div className="sidebar-account__head">
            <div className="sidebar-account__head-avatar">
              <img src={profilePhoto} alt={displayName} decoding="async" />
            </div>
            <div className="sidebar-account__head-meta">
              <strong>{displayName}</strong>
              <span>{role} · {user?.company_name || "MARJON"}</span>
            </div>
            <Icon name="bi-chevron-up" size={16} className="sidebar-account__head-arrow" />
          </div>
          {canOpenProfile ? (
            <Link className="sidebar-account__item" to="/settings/profile" role="menuitem" onClick={() => closeAccountAndSelectMenu("settings")}>
              <Icon name="bi-person-gear" size={16} />
              <span>Настройка профиля</span>
            </Link>
          ) : null}
          {canOpenSupport ? (
            <Link className="sidebar-account__item" to="/settings/support" role="menuitem" onClick={() => closeAccountAndSelectMenu("settings")}>
              <Icon name="bi-headset" size={16} />
              <span>Тех. поддержка</span>
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
                Язык
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
                aria-label="Выбор языка"
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
                    aria-label={`${language.label}: ${language.native}`}
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
              <span>Магазин</span>
            </Link>
          ) : null}
          {canOpenReviews ? (
            <Link className="sidebar-account__item" to="/reviews" role="menuitem" onClick={() => closeAccountAndSelectMenu("")}>
              <Icon name="bi-chat-left" size={16} />
              <span>Отзывы</span>
            </Link>
          ) : null}

          <button type="button" className="sidebar-account__item sidebar-account__item--danger" role="menuitem" onClick={handleLogout}>
            <Icon name="bi-box-arrow-right" size={16} />
            <span>Выйти</span>
          </button>
        </div>
      ) : null}

      {collapsed && accountOpen ? (
        <div
          className="sidebar-account__hover-bridge"
          aria-hidden="true"
          onMouseEnter={openCollapsedAccount}
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
          <strong>{profileCardName}</strong>
          <span>{profileCardRole}</span>
          <em>{user?.company_name || "MARJON"}</em>
        </div>
        <Icon name="bi-chevron-right" size={16} className="sidebar-user__arrow" />
      </button>
    </div>
  );
}
