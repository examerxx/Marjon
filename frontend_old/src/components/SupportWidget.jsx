import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import Icon from "./Icon";

const text = {
  title: "Связь с поддержкой",
  subtitle: "Ответим по кассе, складу и доступам",
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
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [localPhone, setLocalPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const menuRef = useRef(null);
  const btnRef = useRef(null);

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

  function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const phone = `+${country.dial}${onlyDigits(localPhone)}`;
    api.post("/support/tickets", { phone, message: message.trim() })
      .then(() => setSent(true))
      .catch(() => setSent(true))
      .finally(() => setSending(false));
  }

  function closeWidget() {
    setOpen(false);
    setSent(false);
  }

  const phonePlaceholder = country.max === 10 ? "XXX XXX-XX-XX" : "XX XXX-XX-XX";

  return (
    <div className={`support-widget ${open ? "is-open" : ""}`}>
      {open ? (
        <section className="support-widget__panel" aria-label={text.title}>
          <header className="support-widget__header">
            <span className="support-widget__header-icon" aria-hidden="true">
              <Icon name="bi-headset" size={18} />
            </span>
            <div>
              <strong>{text.title}</strong>
              <small>{text.subtitle}</small>
            </div>
            <button className="support-widget__close" type="button" aria-label={text.close} onClick={closeWidget}>
              <Icon name="bi-x-lg" size={18} />
            </button>
          </header>

          {sent ? (
            <div className="support-widget__success">
              <span className="support-widget__success-icon" aria-hidden="true">
                <Icon name="bi-check2" size={32} />
              </span>
              <strong>{text.successTitle}</strong>
              <p>{text.successText}</p>
              <button type="button" onClick={() => { setLocalPhone(""); setMessage(""); setSent(false); }}>
                {text.again}
              </button>
            </div>
          ) : (
            <form className="support-widget__form" onSubmit={handleSubmit}>
              <label className="support-widget__field">
                <span>{text.phone}</span>
                <div className="support-widget__phone">
                  <button
                    type="button"
                    className="support-widget__country"
                    aria-expanded={menuOpen}
                    aria-haspopup="listbox"
                    ref={btnRef}
                    onClick={openMenu}
                  >
                    <img src={flagUrl(country.code)} alt={country.name} />
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
                          <span>{c.name}</span>
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
                    aria-label={text.phone}
                  />
                </div>
              </label>

              <label className="support-widget__field">
                <span>{text.message}</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={text.placeholder}
                  rows={4}
                />
              </label>

              <button className="support-widget__submit" type="submit" disabled={!message.trim() || sending}>
                <Icon name={sending ? "bi-arrow-repeat" : "bi-send"} size={16} />
                <span>{sending ? "Отправка..." : text.send}</span>
              </button>
            </form>
          )}
        </section>
      ) : null}

      <button
        className="support-widget__toggle"
        type="button"
        aria-label={open ? text.close : text.open}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? "bi-x-lg" : "bi-headset"} size={20} />
      </button>
    </div>
  );
}
