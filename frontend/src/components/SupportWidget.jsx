import { useCallback, useEffect, useRef, useState } from "react";
import { settingsService } from "../api/settings";
import Icon from "./Icon";
import Toast from "./Toast";
import { useMutationLocks } from "../hooks/useAsyncSafety";
import { t } from "../i18n/t";

const text = {
  title: "Связь с поддержкой",
  close: "Закрыть",
  open: "Открыть поддержку",
  phone: "Телефон",
  message: "Сообщение",
  placeholder: "Коротко опишите вопрос...",
  send: "Отправить",
  successTitle: "Заявка принята",
  successText: "Свяжемся с вами по указанному номеру.",
  again: "Новая заявка",
};

const COUNTRIES = [
  { code: "uz", name: "Узбекистан",  dial: "998", max: 9 },
  { code: "ru", name: "Россия",       dial: "7",   max: 10 },
  { code: "kz", name: "Казахстан",   dial: "7",   max: 10 },
  { code: "kg", name: "Кыргызстан",  dial: "996", max: 9 },
  { code: "tj", name: "Таджикистан", dial: "992", max: 9 },
  { code: "tm", name: "Туркменистан",dial: "993", max: 8 },
  { code: "az", name: "Азербайджан", dial: "994", max: 9 },
  { code: "ge", name: "Грузия",      dial: "995", max: 9 },
  { code: "ua", name: "Украина",     dial: "380", max: 9 },
  { code: "by", name: "Беларусь",    dial: "375", max: 9 },
];

const onlyDigits = (v = "") => String(v).replace(/\D/g, "");

function formatLocal(digits, max) {
  const v = onlyDigits(digits).slice(0, max);
  if (max === 10) {
    if (v.length <= 3) return v;
    if (v.length <= 6) return `${v.slice(0, 3)} ${v.slice(3)}`;
    if (v.length <= 8) return `${v.slice(0, 3)} ${v.slice(3, 6)}-${v.slice(6)}`;
    return `${v.slice(0, 3)} ${v.slice(3, 6)}-${v.slice(6, 8)}-${v.slice(8)}`;
  }
  if (v.length <= 2) return v;
  if (v.length <= 5) return `${v.slice(0, 2)} ${v.slice(2)}`;
  if (v.length <= 7) return `${v.slice(0, 2)} ${v.slice(2, 5)}-${v.slice(5)}`;
  return `${v.slice(0, 2)} ${v.slice(2, 5)}-${v.slice(5, 7)}-${v.slice(7)}`;
}

function flagUrl(code) {
  return `https://flagcdn.com/w40/${code}.png`;
}

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  // Видимость кнопки — canonical company-поле show_support_button
  // Wait for backend to avoid flashing the button when persisted OFF.
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  const [entering, setEntering] = useState(false);
  const [hiding, setHiding] = useState(false);
  const hideTimer = useRef(null);
  const enterFrame = useRef(null);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [localPhone, setLocalPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [menuPos, setMenuPos] = useState(null);
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const mutationLocks = useMutationLocks();

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocClick(e) {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  // Canonical visibility: show_support_button из GET /companies/me.
  // При выключении панель сначала закрывается, затем кнопка мягко уходит
  // (is-hiding → unmount); при включении — появляется. Только backend.
  const applyVisibility = useCallback((show) => {
    clearTimeout(hideTimer.current);
    cancelAnimationFrame(enterFrame.current);
    if (show) {
      setHiding(false);
      if (!visibleRef.current) {
        visibleRef.current = true;
        setVisible(true);
        setEntering(true);
        // Two frames let the mounted entering style paint before transitioning.
        enterFrame.current = requestAnimationFrame(() => {
          enterFrame.current = requestAnimationFrame(() => setEntering(false));
        });
      } else {
        setEntering(false);
      }
      return;
    }
    setEntering(false);
    setOpen(false);
    setMenuOpen(false);
    setSent(false);
    setSendError("");
    if (!visibleRef.current) return;
    setHiding(true);
    hideTimer.current = setTimeout(() => {
      visibleRef.current = false;
      setVisible(false);
      setHiding(false);
    }, 200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let receivedUpdate = false;
    settingsService.getCompanyProfile()
      .then(({ data }) => {
        if (!cancelled && !receivedUpdate) applyVisibility(data?.show_support_button !== false);
      })
      .catch(() => {
        if (!cancelled && !receivedUpdate) applyVisibility(true);
      });
    function onProfileUpdated(event) {
      const value = event?.detail?.show_support_button;
      if (typeof value !== "boolean") return;
      receivedUpdate = true;
      applyVisibility(value);
    }
    window.addEventListener("marjon:company-profile-updated", onProfileUpdated);
    return () => {
      cancelled = true;
      clearTimeout(hideTimer.current);
      cancelAnimationFrame(enterFrame.current);
      window.removeEventListener("marjon:company-profile-updated", onProfileUpdated);
    };
  }, [applyVisibility]);

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 7, left: rect.left });
    setMenuOpen((v) => !v);
  }

  function selectCountry(c) {
    setCountry(c);
    setLocalPhone("");
    setMenuOpen(false);
  }

  function handlePhoneChange(e) {
    setLocalPhone(onlyDigits(e.target.value).slice(0, country.max));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || !mutationLocks.acquire("support-send")) return;
    setSending(true);
    setSendError("");
    const phone = `+${country.dial}${onlyDigits(localPhone)}`;
    try {
      await settingsService.createSupportTicket({ phone, message: message.trim() });
      setSent(true);
    } catch (error) {
      setSendError(error.response?.data?.detail || "Не удалось отправить сообщение. Попробуйте ещё раз.");
    } finally {
      setSending(false);
      mutationLocks.release("support-send");
    }
  }

  function closeWidget() {
    if (sending) return;
    setOpen(false);
    setSent(false);
    setSendError("");
  }

  const phonePlaceholder = country.max === 10 ? "XXX XXX-XX-XX" : "XX XXX-XX-XX";

  if (!visible) return null;

  return (
    <div className={`support-widget${open ? " is-open" : ""}${hiding ? " is-hiding" : ""}${entering ? " is-entering" : ""}`} aria-hidden={hiding || entering || undefined}>
      {open ? (
        <section className="support-widget__panel" aria-label={t(text.title)}>
          <header className="support-widget__header">
            <span className="support-widget__header-icon" aria-hidden="true">
              <Icon name="bi-headset" size={18} />
            </span>
            <div>
              <strong>{t(text.title)}</strong>
            </div>
            <button className="support-widget__close" type="button" aria-label={t(text.close)} onClick={closeWidget} disabled={sending}>
              <Icon name="bi-x-lg" size={18} />
            </button>
          </header>

          {sent ? (
            <div className="support-widget__success">
              <span className="support-widget__success-icon" aria-hidden="true">
                <Icon name="bi-check2" size={32} />
              </span>
              <strong>{t(text.successTitle)}</strong>
              <p>{t(text.successText)}</p>
              <button type="button" onClick={() => { setLocalPhone(""); setMessage(""); setSent(false); }}>
                {t(text.again)}
              </button>
            </div>
          ) : (
            <form className="support-widget__form" onSubmit={handleSubmit}>
              <label className="support-widget__field">
                <span>{t(text.phone)}</span>
                <div className="support-widget__phone">
                  <button
                    type="button"
                    className="support-widget__country"
                    aria-expanded={menuOpen}
                    aria-haspopup="listbox"
                    ref={btnRef}
                    onClick={openMenu}
                    disabled={sending}
                  >
                    <img src={flagUrl(country.code)} alt={t(country.name)} />
                  </button>

                  {menuOpen && menuPos && (
                    <div
                      className="support-widget__country-menu"
                      role="listbox"
                      ref={menuRef}
                      style={{ position: "fixed", top: menuPos.top, left: menuPos.left }}
                    >
                      {COUNTRIES.map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          role="option"
                          aria-selected={c.code === country.code}
                          className={c.code === country.code ? "is-active" : ""}
                          onClick={() => selectCountry(c)}
                        >
                          <img src={flagUrl(c.code)} alt="" />
                          <span>{t(c.name)}</span>
                          <b>+{c.dial}</b>
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="support-widget__dial-code">+{country.dial}</span>
                  <input
                    value={formatLocal(localPhone, country.max)}
                    onChange={handlePhoneChange}
                    placeholder={phonePlaceholder}
                    inputMode="tel"
                    aria-label={t(text.phone)}
                    disabled={sending}
                  />
                </div>
              </label>

              <label className="support-widget__field">
                <span>{t(text.message)}</span>
                <textarea
                  value={message}
                  onChange={(e) => { setMessage(e.target.value); setSendError(""); }}
                  placeholder={t(text.placeholder)}
                  rows={4}
                  disabled={sending}
                />
              </label>

              {sendError ? <Toast kind="error" message={sendError} onClose={() => setSendError("")} /> : null}

              <button className="support-widget__submit" type="submit" disabled={!message.trim() || sending}>
                <Icon name={sending ? "bi-arrow-repeat" : "bi-send"} size={16} />
                <span>{sending ? t("components.supportwidget.otpravka") : t(text.send)}</span>
              </button>
            </form>
          )}
        </section>
      ) : null}

      <button
        className="support-widget__toggle"
        type="button"
        aria-label={open ? t(text.close) : t(text.open)}
        aria-expanded={open}
        onClick={() => { if (!sending) setOpen((v) => !v); }}
        disabled={(open && sending) || hiding || entering}
      >
        <Icon name={open ? "bi-x-lg" : "bi-headset"} size={20} />
      </button>
    </div>
  );
}
