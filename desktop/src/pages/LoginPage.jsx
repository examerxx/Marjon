import { useState } from 'react'
import { auth } from '../shared/api'
import { Eye, EyeOff, Delete, LogOut, Settings } from 'lucide-react'
import { t } from '../shared/i18n'
import { formatPhone, fullPhone, isPhoneComplete, extractPhoneDigits } from '../shared/phone'
import logoUrl from '../assets/logo.svg'

// Знак бренда — тот же SVG, что в веб-админке и в шапке десктопа.
// Раньше на экране входа стояло просто слово «MARJON» текстом, и вход
// выглядел как другое приложение.
function BrandLogo() {
  return (
    <div className="login-card__logo">
      <span className="login-card__logo-mark">
        <img src={logoUrl} alt="" aria-hidden="true" />
      </span>
      <span className="login-card__logo-text">MARJON</span>
    </div>
  )
}

/**
 * LoginPage — двухрежимная страница входа.
 *
 * mode="admin" — первый вход на кассе: телефон+пароль аккаунта МОНOБЛОКА
 *   (карточка users/monoblock в вебе; у моноблока нет PIN). Моноблок привязан
 *   к company, филиал выбирается следующим шагом (BranchSelector).
 *   Личный логин владельца сотрудникам не показывается.
 *
 * mode="pin" — ежедневный вход сотрудников по PIN.
 *   Показывается когда терминал уже привязан к филиалу.
 */
export default function LoginPage({ mode = 'admin', onLogin, onReset, branchName, orgName, onSettings }) {
  if (mode === 'pin') {
    return <PinLogin onLogin={onLogin} onReset={onReset} branchName={branchName} orgName={orgName} />
  }
  return <MonoblockLogin onLogin={onLogin} onSettings={onSettings} />
}

/**
 * Человеческий текст ошибки входа.
 *
 * Раньше здесь стоял `err.response?.data?.detail || t('lp_branch_bad_creds')`,
 * и на 404 от сервера (адрес без /api/v1) в красной плашке показывалось сырое
 * «Not Found» — выглядело как поломка приложения, а не как неверный адрес.
 */
function loginErrorMessage(err) {
  if (!err?.response) return t('lp_no_connection')
  if (err.response.status === 404) return t('lp_server_not_found')
  return err.response.data?.detail || t('lp_branch_bad_creds')
}

// ═══════════════════════════════════════════════════
// Вход по телефону+паролю моноблока — один шаг, без выбора филиала.
// Телефон моноблока — номер под маской +998 XX XXX-XX-XX (как в 1.4).
// ═══════════════════════════════════════════════════
function MonoblockLogin({ onLogin, onSettings }) {
  const [phone, setPhone] = useState('')          // 9 локальных цифр номера филиала
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isPhoneComplete(phone)) {
      setError(t('lp_phone_incomplete'))
      return
    }
    if (!password.trim()) {
      setError(t('lp_branch_bad_creds'))
      return
    }
    setError('')
    setLoading(true)
    try {
      // Телефон моноблока в каноничном виде (+998XXXXXXXXX).
      // Ответ несёт токен + сведения о branch/company —
      // App сохранит всё атомарно и сразу перейдёт к PIN-входу сотрудника.
      const data = await auth.loginByMonoblock(fullPhone(phone), password.trim())
      onLogin(data)
    } catch (err) {
      setError(loginErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Шестерёнка доступна ДО входа: если в приложении сохранён неверный
            адрес сервера, вход всегда падает, а экран организации (где раньше
            была единственная кнопка настроек) недостижим — терминал запирался. */}
        {onSettings && (
          <button
            type="button"
            className="icon-btn login-card__settings"
            onClick={onSettings}
            title={t('s_server_addr')}
          >
            <Settings size={20} />
          </button>
        )}
        <div className="login-card__header">
          <BrandLogo />
          <p className="login-card__subtitle">{t('lp_branch_subtitle')}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-field__label">{t('lp_branch_login')}</label>
            <input
              className="login-field__input"
              type="tel"
              inputMode="tel"
              value={formatPhone(phone)}
              onChange={(e) => setPhone(extractPhoneDigits(e.target.value))}
              placeholder={t('lp_branch_login_ph')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          <div className="login-field">
            <label className="login-field__label">{t('lp_password')}</label>
            <div className="login-field__password-wrap">
              <input
                className="login-field__input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="login-field__eye"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? t('lp_logging_in') : t('lp_branch_enter')}
          </button>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// PIN-вход сотрудников
// ═══════════════════════════════════════════════════
function PinLogin({ onLogin, onReset, branchName, orgName }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handlePinSubmit(pinValue) {
    if (pinValue.length < 4) return
    setError('')
    setLoading(true)
    try {
      const tokens = await auth.loginByPin(pinValue)
      localStorage.setItem('marjon_token', tokens.access_token)
      const user = await auth.me()
      onLogin({ ...tokens, user })
    } catch (err) {
      localStorage.removeItem('marjon_token')
      setPin('')
      setError(t('lp_bad_pin'))
    } finally {
      setLoading(false)
    }
  }

  function handleDigit(digit) {
    if (pin.length >= 4) return
    const next = pin + digit
    setPin(next)
    setError('')
    if (next.length === 4) handlePinSubmit(next)
  }

  function handleBackspace() {
    setPin(prev => prev.slice(0, -1))
    setError('')
  }

  return (
    <div className="login-page">
      <div className="login-card login-card--pin">
        <div className="login-card__header">
          <BrandLogo />
          {orgName && <p className="login-card__org">{orgName}</p>}
          {branchName && <p className="login-card__subtitle">{branchName}</p>}
        </div>

        <div className="login-pin">
          <p className="login-pin__hint">{t('lp_enter_pin_hint')}</p>

          <div className="login-pin__dots">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`login-pin__dot ${i < pin.length ? 'login-pin__dot--filled' : ''} ${error && pin.length === 0 ? 'login-pin__dot--error' : ''}`}
              />
            ))}
          </div>

          {error && <p className="login-error">{error}</p>}

          <div className="login-pin__pad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'back'].map((key, idx) => {
              if (key === null) return <div key={idx} className="login-pin__key--empty" />
              if (key === 'back') {
                return (
                  <button
                    key={idx}
                    className="login-pin__key login-pin__key--action"
                    onClick={handleBackspace}
                    disabled={loading}
                  >
                    <Delete size={24} />
                  </button>
                )
              }
              return (
                <button
                  key={idx}
                  className="login-pin__key"
                  onClick={() => handleDigit(String(key))}
                  disabled={loading}
                >
                  {key}
                </button>
              )
            })}
          </div>
        </div>

        {onReset && (
          <button className="login-reset-btn" onClick={onReset}>
            <LogOut size={16} />
            {t('change_org')}
          </button>
        )}
      </div>
    </div>
  )
}
