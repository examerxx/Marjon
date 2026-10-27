import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { isOwnerWebUser } from "../utils/permissions";
import { loginAsBranch, clearBranchSession } from "../auth/branchSession";
import logo from "../assets/brand/marjon-logo.svg";
import Icon from "../components/Icon";
import { useMutationLocks } from "../hooks/useAsyncSafety";
import { formatLocalPhone, getLocalPhoneDigits } from "../utils/phoneMask";
import { t } from "../i18n/t";

// Маска номера теперь общая (utils/phoneMask) — её же использует
// кухонный экран и настройки филиала. Реэкспорт оставлен, чтобы не
// ломать существующие импорты и тесты этой страницы.
export { formatLocalPhone, getLocalPhoneDigits };

const LANGUAGES = [
  // native — самоназвание языка (в меню показываем его, а не код: понятнее и профессиональнее)
  { code: "uz", short: "UZ", label: "Uzbek", native: "O‘zbekcha", flagUrl: "https://flagcdn.com/w40/uz.png" },
  { code: "ru", short: "RU", label: "Russian", native: "Русский", flagUrl: "https://flagcdn.com/w40/ru.png" },
  { code: "en", short: "EN", label: "English", native: "English", flagUrl: "https://flagcdn.com/w40/gb.png" },
];

function getLanguageCode(i18n) {
  const lang = String(i18n.resolvedLanguage || i18n.language || "ru");
  if (lang.startsWith("uz")) return "uz";
  if (lang.startsWith("en")) return "en";
  return "ru";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { loginPhone, logout } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState(() => getLanguageCode(i18n));
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  // Вход «как филиал»: отдельная форма логин+пароль филиала (не владельца).
  const [branchMode, setBranchMode] = useState(false);
  const [branchLoginVal, setBranchLoginVal] = useState("");
  const [branchPass, setBranchPass] = useState("");
  const [branchError, setBranchError] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const languageCloseTimerRef = useRef(null);
  const languageMenuRef = useRef(null);
  const { acquire, release } = useMutationLocks();

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
    if (!acquire("owner-login")) return;
    if (getLocalPhoneDigits(phone).length !== 9 || !password) {
      setError("Укажите полный номер телефона и пароль.");
      release("owner-login");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const user = await loginPhone(phone, password);
      if (!remember) localStorage.removeItem("refresh_token");
      if (!isOwnerWebUser(user)) {
        await logout().catch(() => {});
        setError("Эта учётная запись не поддерживается в Web Launch V1.");
        return;
      }
      navigate("/", { replace: true });
    } catch {
      setError(t("auth.login_error"));
    } finally {
      setLoading(false);
      release("owner-login");
    }
  }

  // На экране логина мы вне любой сессии — чистим возможные остатки маркеров
  // филиала, чтобы после выхода/протухания не висела чужая плашка.
  useEffect(() => {
    clearBranchSession();
  }, []);

  async function handleBranchSubmit(event) {
    event.preventDefault();
    if (!acquire("branch-login")) return;
    if (!branchLoginVal.trim() || !branchPass) {
      setBranchError("Укажите логин и пароль филиала.");
      release("branch-login");
      return;
    }
    setBranchError("");
    setBranchLoading(true);
    try {
      await loginAsBranch(branchLoginVal.trim(), branchPass); // при успехе — перезагрузка
    } catch (err) {
      setBranchError(err.response?.data?.detail || "Неверный логин или пароль филиала.");
      setBranchLoading(false);
      release("branch-login");
    }
  }

  const currentLanguage = selectedLanguage;
  const currentLanguageMeta = LANGUAGES.find((language) => language.code === currentLanguage) || LANGUAGES[1];

  return (
    <main className="login-pro-shell">
      <div className="login-pro-frame">
        <header className="login-pro-topbar">
          {/* Логотип и пилюля-дескриптор в одной строке (пилюля раньше была
              absolute и «прыгала» по экрану из-за vw-transform). */}
          <div className="login-pro-brandgroup">
            <a href="#" aria-label="Marjon" className="login-pro-topbrand">
              <img src={logo} alt="" width={44} height={44} decoding="async" />
              <span className="login-pro-topbrand__text">
                <span className="login-pro-topbrand__name" translate="no">Marjon</span>
                <span className="login-pro-topbrand__sub">Restaurant OS</span>
              </span>
            </a>
          </div>
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
                <img className="login-pro-lang__flag" src={currentLanguageMeta.flagUrl} alt="" width={21} height={14} decoding="async" />
                <span>{currentLanguageMeta.short}</span>
                <Icon name="bi-chevron-down" size={14} strokeWidth={2.6} />
              </button>
              <div className="login-pro-lang__menu" role="menu" onMouseEnter={openLanguageMenu}>
                {LANGUAGES.map((language) => (
                  <button
                    key={language.code}
                    type="button"
                    className={language.code === currentLanguage ? "is-active" : ""}
                    aria-current={language.code === currentLanguage ? "true" : undefined}
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
                    <img className="login-pro-lang__flag" src={language.flagUrl} alt="" width={21} height={14} decoding="async" />
                    <span className="login-pro-lang__name">{language.native}</span>
                    {language.code === currentLanguage ? (
                      <Icon name="bi-check2" size={16} strokeWidth={2.6} className="login-pro-lang__check" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <a href="#">{t("auth.sign_in")}</a>
          </div>
        </header>

        <div className="login-pro-body">
          <section className="login-pro-hero-copy">
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
              <div className="login-pro-head">
                <h2>{t("auth.welcome_title")}</h2>
                <p>{t("auth.welcome_subtitle")}</p>
              </div>

              {error ? <div className="login-pro-alert" role="alert">{error}</div> : null}

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

            <div style={{ marginTop: 14, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => { setBranchMode((v) => !v); setBranchError(""); }}
                style={{ background: "none", border: "none", color: "var(--color-interactive)", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
              >
                {branchMode ? "← Войти как владелец сети" : "Войти как филиал"}
              </button>
            </div>

            {branchMode ? (
              <form className="login-pro-card" onSubmit={handleBranchSubmit} style={{ marginTop: 12 }}>
                <div className="login-pro-head">
                  <h2>{t("pages.loginpage.vhod_filiala")}</h2>
                  <p>{t("pages.loginpage.login_i_parol_filiala_zadaet_vladelets_na_stranitse")}</p>
                </div>
                {branchError ? <div className="login-pro-alert" role="alert">{branchError}</div> : null}
                <label className="login-pro-field">
                  <span>{t("pages.loginpage.login_filiala")}</span>
                  <div className="login-pro-input-wrap">
                    <Icon name="bi-person-badge" size={18} strokeWidth={2.5} />
                    <input type="text" value={branchLoginVal} onChange={(e) => setBranchLoginVal(e.target.value)} required placeholder="+998 90 123-45-67" spellCheck="false" autoComplete="username" />
                  </div>
                </label>
                <label className="login-pro-field">
                  <span>{t("pages.loginpage.parol_filiala")}</span>
                  <div className="login-pro-input-wrap">
                    <Icon name="bi-lock" size={18} strokeWidth={2.5} />
                    <input type="password" value={branchPass} onChange={(e) => setBranchPass(e.target.value)} required placeholder={t("pages.loginpage.parol")} spellCheck="false" autoComplete="current-password" />
                  </div>
                </label>
                <button className="login-pro-submit" type="submit" disabled={branchLoading}>
                  {branchLoading ? t("auth.loading") : "Войти в филиал"}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
