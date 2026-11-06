import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Delete, Play } from 'lucide-react'
import { t } from '../shared/i18n'

// PIN задаётся в карточке сотрудника: от 4 до 8 цифр. Пад принимает 4–8
// цифр и проверяет код по кнопке подтверждения (или Enter). Раньше ввод
// ограничивался 4 цифрами с автопроверкой — 5–8-значный PIN из веб-админки
// было невозможно набрать.
const PIN_MIN = 4
const PIN_MAX = 8

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

/** PinPad — ввод PIN выбранного сотрудника. onSubmit(pin) → Promise. 4–8 цифр.
 *  title — необязательный заголовок (напр. «Экран заблокирован»).
 *  onBack — если не передан, кнопка «Назад» скрыта (режим блокировки).
 *  shiftClosed — PIN верный, но смена не открыта: вместо цифр показываем
 *  «Открыть смену», иначе кассир не может начать работу. */
export default function PinPad({
  employee = {},
  onSubmit,
  onBack,
  title,
  shiftClosed = false,
  shiftBusy = false,
  shiftError = '',
  onOpenShift,
  onCancelShift,
}) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const role = employee.role_slug || (employee.role_slugs && employee.role_slugs[0])
  // Личный код вводят без выбора сотрудника: тогда шапку с аватаром не рисуем.
  const hasEmployee = Boolean(employee.name || employee.email)

  // pinRef — синхронный источник истины: гасит гонку при быстром вводе (state
  // обновляется асинхронно, ref — сразу). lockRef — синхронный замок отправки.
  const pinRef = useRef('')
  const lockRef = useRef(false)

  const submit = useCallback(async (value) => {
    if (lockRef.current || value.length < PIN_MIN) return
    lockRef.current = true   // замок сразу — повторные клики по «✓» игнорируются
    setBusy(true); setError(false)
    try {
      await onSubmit(value)
    } catch {
      // Неверный PIN — сбрасываем ввод и точки (иначе следующая попытка
      // «дублирует» цифры поверх старых).
      pinRef.current = ''
      setPin('')
      setError(true)
      setTimeout(() => setError(false), 600)
    } finally {
      lockRef.current = false
      setBusy(false)
    }
  }, [onSubmit])

  const press = useCallback((d) => {
    if (lockRef.current || pinRef.current.length >= PIN_MAX) return
    const next = pinRef.current + d
    pinRef.current = next
    setPin(next)
    // 8 — максимум, дальше цифр нет: такой код проверяем сразу. 4–7 цифр
    // ждут кнопки «✓», иначе 5–8-значный PIN не набрать.
    if (next.length >= PIN_MAX) submit(next)
  }, [submit])

  const back = useCallback(() => {
    pinRef.current = pinRef.current.slice(0, -1)
    setPin(pinRef.current)
  }, [])

  useEffect(() => {
    // На экране «смена закрыта» клавиатура не должна вводить PIN в никуда.
    if (shiftClosed) return undefined
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Enter') submit(pinRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, back, submit, shiftClosed])

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ok', '0', 'back']

  return (
    <div className="pinpad-screen">
      <div className="pinpad">
        {onBack && <button className="pinpad__back" onClick={onBack}><ArrowLeft size={24} /> {t('back')}</button>}

        {title && !shiftClosed && <h2 className="pinpad__title">{title}</h2>}

        {!shiftClosed && hasEmployee && (
          <div className="pinpad__user">
            <span className="pinpad__avatar">{initials(employee.name || employee.email)}</span>
            <span className="pinpad__name">{employee.name || employee.email}</span>
            <span className="pinpad__role">{t.role(role)}</span>
          </div>
        )}

        {shiftClosed ? (
          <div className="pinpad__shift">
            {hasEmployee && (
              <div className="pinpad__shift-user">
                <span className="pinpad__shift-avatar">{initials(employee.name || employee.email)}</span>
                <span className="pinpad__shift-who">
                  <span className="pinpad__shift-name">{employee.name || employee.email}</span>
                  <span className="pinpad__shift-role">{t.role(role)}</span>
                </span>
              </div>
            )}
            <h2 className="pinpad__shift-title">{t('shift_closed_title')}</h2>
            <p className="pinpad__shift-text">{t('shift_closed_text')}</p>
            {shiftError && <p className="pinpad__shift-error">{shiftError}</p>}
            <button className="pinpad__shift-open" onClick={onOpenShift} disabled={shiftBusy}>
              <Play size={20} /> {shiftBusy ? t('loading') : t('open_shift')}
            </button>
            {onCancelShift && (
              <button className="pinpad__shift-cancel" onClick={onCancelShift} disabled={shiftBusy}>
                {t('cancel')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={`pinpad__dots ${error ? 'pinpad__dots--error' : ''}`}>
              {/* 4 точки по умолчанию; при вводе 5–8-й цифры дорожка растёт */}
              {Array.from({ length: Math.max(PIN_MIN, pin.length) }, (_, i) => (
                <span key={i} className={`pinpad__dot ${i < pin.length ? 'pinpad__dot--filled' : ''}`} />
              ))}
            </div>

            <div className="pinpad__grid">
              {KEYS.map((k, i) => {
                if (k === 'ok') return (
                  <button
                    key={i}
                    type="button"
                    className="pinpad__key pinpad__key--action pinpad__key--ok"
                    onClick={() => submit(pinRef.current)}
                    disabled={busy || pin.length < PIN_MIN}
                    aria-label={t('enter')}
                  >
                    <Play size={26} />
                  </button>
                )
                if (k === 'back') return (
                  <button key={i} className="pinpad__key pinpad__key--action" onClick={back} disabled={busy}>
                    <Delete size={26} />
                  </button>
                )
                return (
                  <button key={i} className="pinpad__key" onClick={() => press(k)} disabled={busy}>{k}</button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
