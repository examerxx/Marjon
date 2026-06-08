import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, login } from "../api/client";
import logo from "../assets/marjon-logo.png";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      const { data: profile } = await api.get("/auth/me");
      const role = profile.role_slugs?.[0];
      const target = role === "waiter" ? "/waiter" : role === "kitchen" ? "/kitchen" : "/";
      if (!remember) {
        localStorage.removeItem("refresh_token");
      }
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось войти. Проверьте email и пароль.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-pro-shell">
      <section className="login-pro-brand">
        <div className="login-pro-brand__noise" />
        <div className="login-pro-brand__content">
          <img src={logo} alt="MARJON" className="login-pro-mark" decoding="async" />
          <h1>MARJON</h1>
          <p>Единая платформа для зала, кухни, доставки и аналитики ресторана.</p>
          <div className="login-pro-bullets">
            <span>Онлайн-меню и заказ по QR-коду</span>
            <span>Кухонный экран в реальном времени</span>
            <span>Отчеты и аналитика продаж</span>
            <span>Click, Payme, Uzum</span>
          </div>
        </div>
      </section>

      <section className="login-pro-panel">
        <form className="login-pro-card" onSubmit={handleSubmit}>
          <div className="login-pro-head">
            <div className="login-pro-logo-row">
              <img src={logo} alt="MARJON" decoding="async" />
              <div><strong>MARJON</strong><span>Restaurant OS</span></div>
            </div>
            <div className="login-pro-divider" />
            <h2>Добро пожаловать</h2>
            <p>Войдите в рабочее место вашего ресторана.</p>
          </div>

          {error ? <div className="login-pro-alert">{error}</div> : null}

          <label className="login-pro-field">
            <span>ЛОГИН / EMAIL</span>
            <div className="login-pro-input-wrap"><i className="bi bi-person" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="owner@marjon.uz" spellCheck="false" /></div>
          </label>

          <label className="login-pro-field">
            <span>ПАРОЛЬ</span>
            <div className="login-pro-input-wrap"><i className="bi bi-lock" /><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Marjon2026!" spellCheck="false" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Скрыть" : "Показать"}</button></div>
          </label>

          <div className="login-pro-row login-pro-row--single">
            <label className="login-pro-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> <span>Запомнить меня</span></label>
          </div>

          <button className="login-pro-submit" type="submit" disabled={loading}>{loading ? "Вход..." : "Войти"}</button>

          <p className="login-pro-foot">Нет аккаунта? <span>Свяжитесь с нами</span></p>
        </form>
      </section>
    </main>
  );
}
