import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Delete } from 'lucide-react'
import { t } from '../shared/i18n'

// Длина PIN-кода фиксирована: все PIN 4-значные. Пад не принимает 5-ю цифру
// и отправляет автоматически по вводу 4-й (без задержки).
const PIN_LENGTH = 4

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

/** PinPad — ввод PIN выбранного сотрудника. onSubmit(pin) → Promise. Ровно 4 цифры.
 *  title — необязательный заголовок (напр. «Экран заблокирован»).
 *  onBack — если не передан, кнопка «Назад» скрыта (режим блокировки). */
export default function PinPad({ employee = {}, onSubmit, onBack, title }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const role = employee.role_slug || (employee.role_slugs && employee.role_slugs[0])

  // pinRef — синхронный источник истины: гасит гонку при быстром вводе (state
  // обновляется асинхронно, ref — сразу). lockRef — синхронный замок отправки.
  const pinRef = useRef('')
  const lockRef = useRef(false)

  const submit = useCallback(async (value) => {
    if (lockRef.current || value.length < PIN_LENGTH) return
    lockRef.current = true   // замок сразу — быстрые клики после 4-й цифры игнорируются
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
    // Жёсткий лимит длины: 5-ю цифру не набрать даже при очень быстрых кликах
    if (lockRef.current || pinRef.current.length >= PIN_LENGTH) return
    const next = pinRef.current + d
    pinRef.current = next
    setPin(next)
    // Набрали полный PIN — сразу проверяем (без задержки)
    if (next.length >= PIN_LENGTH) submit(next)
  }, [submit])

  const back = useCallback(() => {
    pinRef.current = pinRef.current.slice(0, -1)
    setPin(pinRef.current)
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Enter') submit(pinRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, back, submit])

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']

  return (
    <div className="pinpad-screen">
      <div className="pinpad">
        {onBack && <button className="pinpad__back" onClick={onBack}><ArrowLeft size={24} /> {t('back')}</button>}

        {title && <h2 className="pinpad__title">{title}</h2>}

        <div className="pinpad__user">
          <span className="pinpad__avatar">{initials(employee.name || employee.email)}</span>
          <span className="pinpad__name">{employee.name || employee.email}</span>
          <span className="pinpad__role">{t.role(role)}</span>
        </div>

        <div className={`pinpad__dots ${error ? 'pinpad__dots--error' : ''}`}>
          {/* Фиксированные 4 точки: PIN всегда 4-значный */}
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} className={`pinpad__dot ${i < pin.length ? 'pinpad__dot--filled' : ''}`} />
          ))}
        </div>

        <div className="pinpad__grid">
          {KEYS.map((k, i) => {
            if (k === '') return <span key={i} className="pinpad__key pinpad__key--empty" />
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

        <button className="pinpad__submit" onClick={() => submit(pin)} disabled={pin.length < PIN_LENGTH || busy}>
          {busy ? t('check') : t('enter')}
        </button>
      </div>
    </div>
  )
}
