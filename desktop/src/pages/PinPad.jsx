import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Delete, Play } from 'lucide-react'
import { t } from '../shared/i18n'

// PIN — ровно 4 цифры. Кнопки подтверждения нет: код проверяется сам, как
// только набрано 4 цифры. Пятая цифра не принимается — ввод не растёт.
const PIN_MIN = 4
const PIN_MAX = 4
// Неверный код: точки коротко дрожат и гаснут. Пауза только на анимацию —
// раньше ввод «висел» 800 мс, и казалось, что касса задумалась.
const ERROR_SHAKE_MS = 450

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

/** PinPad — ввод PIN выбранного сотрудника. onSubmit(pin) → Promise. 4 цифры,
 *  проверка автоматическая, без кнопки «✓».
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
  const role = employee.role_slug || (employee.role_slugs && employee.role_slugs[0])
  // Личный код вводят без выбора сотрудника: тогда шапку с аватаром не рисуем.
  const hasEmployee = Boolean(employee.name || employee.email)

  // pinRef — синхронный источник истины: гасит гонку при быстром вводе (state
  // обновляется асинхронно, ref — сразу). lockRef — синхронный замок отправки.
  const pinRef = useRef('')
  const lockRef = useRef(false)
  const errorTimer = useRef(null)

  const submit = useCallback(async (value) => {
    if (lockRef.current || value.length < PIN_MIN) return
    lockRef.current = true // замок сразу — повторная отправка игнорируется
    clearTimeout(errorTimer.current)
    setError(false)
    try {
      await onSubmit(value)
    } catch {
      // Ошибка сразу: ввод сбрасывается, точки 450 мс дрожат и гаснут.
      pinRef.current = ''
      setError(true)
      errorTimer.current = setTimeout(() => {
        setPin('')
        setError(false)
      }, ERROR_SHAKE_MS)
    } finally {
      lockRef.current = false
    }
  }, [onSubmit])

  const press = useCallback((d) => {
    if (pinRef.current.length >= PIN_MAX) return
    // Новая цифра после ошибки — гасим дрожание, ввод начинается заново.
    clearTimeout(errorTimer.current)
    setError(false)
    const next = pinRef.current + d
    pinRef.current = next
    setPin(next)
    if (next.length >= PIN_MIN) submit(next)
  }, [submit])

  const back = useCallback(() => {
    clearTimeout(errorTimer.current)
    setError(false)
    pinRef.current = pinRef.current.slice(0, -1)
    setPin(pinRef.current)
  }, [])

  useEffect(() => () => clearTimeout(errorTimer.current), [])

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

  // Последняя ячейка сетки пустая: подтверждения больше нет, «0» остаётся
  // по центру, ⌫ — справа.
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'back']

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
              {/* Ровно 4 точки: код длиннее четырёх цифр не принимается */}
              {Array.from({ length: PIN_MIN }, (_, i) => (
                <span key={i} className={`pinpad__dot ${i < pin.length ? 'pinpad__dot--filled' : ''}`} />
              ))}
            </div>

            <div className="pinpad__grid">
              {KEYS.map((k, i) => {
                if (k === null) return <span key={i} className="pinpad__key pinpad__key--empty" aria-hidden="true" />
                if (k === 'back') return (
                  <button key={i} type="button" className="pinpad__key pinpad__key--action" onClick={back} aria-label={t('back')}>
                    <Delete size={26} />
                  </button>
                )
                return (
                  <button key={i} type="button" className="pinpad__key" onClick={() => press(k)}>{k}</button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
