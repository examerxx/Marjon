// Экран ввода 4-значного PIN-кода.
// Маршрут: /login/pin/:employeeId. ТЗ §3.2.

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_HOME } from "../../utils/permissions";
import Icon from '../../components/Icon';

const PIN_LENGTH = 4;

export default function PinLoginPage() {
  const { employeeId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { loginPin } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const employee = state?.employee;
  const displayName = employee?.full_name || "Сотрудник";

  const submit = useMemo(() => async (value) => {
    setBusy(true);
    setError("");
    try {
      const user = await loginPin(employeeId, value);
      const role = user?.role_slugs?.[0] || (user?.is_superadmin ? "superadmin" : "owner");
      navigate(ROLE_HOME[role] || "/", { replace: true });
    } catch (e) {
      setError(e?.response?.data?.detail || "Неверный PIN-код");
      setPin("");
    } finally {
      setBusy(false);
    }
  }, [employeeId, loginPin, navigate]);

  useEffect(() => {
    if (pin.length === PIN_LENGTH && !busy) {
      submit(pin);
    }
  }, [pin, busy, submit]);

  function handleDigit(digit) {
    if (busy || pin.length >= PIN_LENGTH) return;
    setPin((p) => (p + digit).slice(0, PIN_LENGTH));
  }

  function handleBackspace() {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
    setError("");
  }

  return (
    <main className="pin-login">
      <header className="pin-login__head">
        <Link to="/login/staff" className="pin-login__back">
          <Icon name="bi-arrow-left" size={18} /> Назад к списку
        </Link>
        <div className="pin-login__user">
          <div className="pin-login__avatar">
            {employee?.photo_url ? (
              <img src={employee.photo_url} alt={displayName} />
            ) : (
              <span>{displayName.trim().charAt(0)}</span>
            )}
          </div>
          <div>
            <h1>{displayName}</h1>
            <p>{employee?.role_label || employee?.role || "Введите PIN"}</p>
          </div>
        </div>
      </header>

      <div className="pin-login__dots" aria-label="PIN">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span key={i} className={`pin-login__dot ${pin.length > i ? "is-filled" : ""}`} />
        ))}
      </div>

      {error ? <div className="pin-login__error">{error}</div> : null}

      <div className="pin-login__pad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" className="pin-login__key" onClick={() => handleDigit(String(d))} disabled={busy}>
            {d}
          </button>
        ))}
        <span className="pin-login__key pin-login__key--empty" aria-hidden="true" />
        <button type="button" className="pin-login__key" onClick={() => handleDigit("0")} disabled={busy}>
          0
        </button>
        <button type="button" className="pin-login__key pin-login__key--ghost" onClick={handleBackspace} disabled={busy} aria-label="Стереть">
          <Icon name="bi-backspace" size={18} />
        </button>
      </div>

      {busy ? <div className="pin-login__busy">Проверка…</div> : null}
    </main>
  );
}
