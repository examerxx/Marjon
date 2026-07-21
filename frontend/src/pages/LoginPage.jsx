import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { getRole, ROLE_HOME } from "../utils/permissions";
import logo from "../assets/marjon-logo.svg";
import Icon from "../components/Icon";

const LANGUAGES = [
  { code: "uz", short: "UZ", label: "Uzbek", flagUrl: "https://flagcdn.com/w40/uz.png" },
  { code: "ru", short: "RU", label: "Russian", flagUrl: "https://flagcdn.com/w40/ru.png" },
  { code: "en", short: "EN", label: "English", flagUrl: "https://flagcdn.com/w40/gb.png" },
];

function getLocalPhoneDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const body = digits.startsWith("998") ? digits.slice(3) : digits;
  return body.slice(0, 9);
}

function formatLocalPhone(raw) {
  const local = getLocalPhoneDigits(raw);

  if (local.length <= 2) return local;
  if (local.length <= 5) return `${local.slice(0, 2)} ${local.slice(2)}`;
  if (local.length <= 7) return `${local.slice(0, 2)} ${local.slice(2, 5)}-${local.slice(5)}`;
  return `${local.slice(0, 2)} ${local.slice(2, 5)}-${local.slice(5, 7)}-${local.slice(7)}`;
}

function getLanguageCode(i18n) {
  const lang = String(i18n.resolvedLanguage || i18n.language || "ru");
  if (lang.startsWith("uz")) return "uz";
  if (lang.startsWith("en")) return "en";
  return "ru";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { loginPhone } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(() => getLanguageCode(i18n));
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageCloseTimerRef = useRef(null);
  const languageMenuRef = useRef(null);

  useEffect(() => {
    function handleDocumentPointerDown(event) {
      if (!languageMenuRef.current?.contains(event.target)) {
        closeLanguageMenuNow();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);

    return () => {
      clearTimeout(languageCloseTimerRef.current);
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, []);

  useEffect(() => {
    function syncLanguage(language) {
      const normalizedLanguage = getLanguageCode({ language, resolvedLanguage: language });
      setSelectedLanguage(normalizedLanguage);
      document.documentElement.lang = normalizedLanguage;
    }

    syncLanguage(i18n.language || i18n.resolvedLanguage);
    i18n.on("languageChanged", syncLanguage);

    return () => i18n.off("languageChanged", syncLanguage);
  }, [i18n]);

  function handlePhoneChange(e) {
    setPhone(getLocalPhoneDigits(e.target.value));
  }

  function openLanguageMenu() {
    clearTimeout(languageCloseTimerRef.current);
    setLanguageMenuOpen(true);
  }

  function closeLanguageMenu() {
    clearTimeout(languageCloseTimerRef.current);
    languageCloseTimerRef.current = setTimeout(() => setLanguageMenuOpen(false), 520);
  }

  function closeLanguageMenuNow() {
    clearTimeout(languageCloseTimerRef.current);
    setLanguageMenuOpen(false);
  }

  function handleLanguageBlur(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      closeLanguageMenu();
    }
  }

  function handleLanguageChange(language) {
    setSelectedLanguage(language);
    document.documentElement.lang = language;
    localStorage.setItem("marjon_lang", language);
    void i18n.changeLanguage(language);
    closeLanguageMenuNow();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await loginPhone(phone, password);
      if (!remember) localStorage.removeItem("refresh_token");
      const role = getRole(user);
      navigate(ROLE_HOME[role] || "/", { replace: true });
    } catch {
      setError(t("auth.login_error"));
    } finally {
      setLoading(false);
    }
  }

  const currentLanguage = selectedLanguage;
  const currentLanguageMeta = LANGUAGES.find((language) => language.code === currentLanguage) || LANGUAGES[1];

  return (
    <main className="login-pro-shell">
      <div className="login-pro-frame">
        <header className="login-pro-topbar">
          <a href="#" aria-label="Marjon" className="login-pro-topbrand">
            <img src={logo} alt="" decoding="async" />
            <span>Marjon</span>
          </a>
          <nav aria-label={t("sidebar.navigation")}>
            <a href="#">{t("auth.home")}</a>
            <a href="#">{t("auth.cafe")}</a>
            <a href="#">{t("nav.menu")}</a>
            <a href="#">{t("auth.contact")}</a>
          </nav>
          <div className="login-pro-top-actions">
            <div
              ref={languageMenuRef}
              className={`login-pro-lang${languageMenuOpen ? " is-open" : ""}`}
              onMouseEnter={openLanguageMenu}
              onMouseLeave={closeLanguageMenu}
              onFocus={openLanguageMenu}
              onBlur={handleLanguageBlur}
            >
              <button
                type="button"
                className="login-pro-lang__button"
                aria-label={t("auth.language_toggle")}
                aria-haspopup="menu"
                aria-expanded={languageMenuOpen}
                onClick={() => setLanguageMenuOpen((open) => !open)}
              >
                <img className="login-pro-lang__flag" src={currentLanguageMeta.flagUrl} alt="" decoding="async" />
                <span>{currentLanguageMeta.short}</span>
                <Icon name="bi-chevron-down" size={14} strokeWidth={2.6} />
              </button>
              <div className="login-pro-lang__menu" role="menu" onMouseEnter={openLanguageMenu}>
                {LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    className={language.code === currentLanguage ? "is-active" : ""}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleLanguageChange(language.code);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleLanguageChange(language.code);
                    }}
                    onClick={(event) => event.preventDefault()}
                    role="menuitem"
                  >
                    <img className="login-pro-lang__flag" src={language.flagUrl} alt="" decoding="async" />
                    <span>{language.short}</span>
                  </button>
                ))}
              </div>
            </div>
            <a href="#">{t("auth.sign_in")}</a>
            <a href="#" className="login-pro-register">{t("auth.register")}</a>
          </div>
        </header>

        <div className="login-pro-body">
          <section className="login-pro-hero-copy">
            <span className="login-pro-hero-copy__badge">{t("auth.hero_badge")}</span>
            <h1>
              <span>{t("auth.hero_title_start")}</span>{" "}
              <strong>{t("auth.hero_title_accent")}</strong>
              {t("auth.hero_title_end") ? <> {t("auth.hero_title_end")}</> : null}
            </h1>
            <p>{t("auth.hero_text")}</p>
            <ul>
              <li>
                <Icon name="bi-clipboard-check" size={32} strokeWidth={1.9} />
                <span>{t("auth.hero_feature_orders")}</span>
              </li>
              <li>
                <Icon name="bi-box" size={32} strokeWidth={1.9} />
                <span>{t("auth.hero_feature_stock")}</span>
              </li>
              <li>
                <Icon name="bi-bar-chart-line" size={32} strokeWidth={1.9} />
                <span>{t("auth.hero_feature_reports")}</span>
              </li>
            </ul>
          </section>

          <section className="login-pro-media" aria-hidden="true" />

          <section className="login-pro-panel">
            <form className="login-pro-card" onSubmit={handleSubmit}>
              <div className="login-pro-logo-row">
                <img src={logo} alt="MARJON" decoding="async" />
                <div>
                  <strong>MARJON</strong>
                  <span>KAFE ADMIN</span>
                </div>
              </div>
              <div className="login-pro-divider" />

              <div className="login-pro-head">
                <h2>{t("auth.welcome_title")}</h2>
                <p>{t("auth.welcome_subtitle")}</p>
              </div>

              {error ? <div className="login-pro-alert">{error}</div> : null}

              <label className="login-pro-field">
                <span>{t("auth.phone_label")}</span>
                <div className="login-pro-input-wrap login-pro-input-wrap--phone">
                  <Icon name="bi-telephone" size={18} strokeWidth={2.5} />
                  <strong className="login-pro-phone-prefix">+998</strong>
                  <input
                    type="tel"
                    value={formatLocalPhone(phone)}
                    onChange={handlePhoneChange}
                    required
                    autoComplete="tel-national"
                    spellCheck="false"
                    inputMode="numeric"
                    placeholder="90 123-45-67"
                  />
                </div>
              </label>

              <label className="login-pro-field">
                <span>{t("auth.password_label")}</span>
                <div className="login-pro-input-wrap">
                  <Icon name="bi-lock" size={18} strokeWidth={2.5} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder={t("auth.password_placeholder")}
                    spellCheck="false"
                  />
                  <button type="button" className="login-pro-eye" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t("auth.hide_password") : t("auth.show_password")}>
                    <Icon name={showPassword ? "bi-eye-slash" : "bi-eye"} size={18} />
                  </button>
                </div>
              </label>

              <div className="login-pro-row">
                <label className="login-pro-check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>{t("auth.remember_me")}</span>
                </label>
                <a href="#" className="login-pro-forgot">{t("auth.forgot_password")}</a>
              </div>

              <button className="login-pro-submit" type="submit" disabled={loading}>
                {loading ? t("auth.loading") : t("auth.sign_in")}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
