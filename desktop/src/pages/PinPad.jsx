import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Delete } from 'lucide-react'
import { t } from '../shared/i18n'

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

/** PinPad — ввод PIN выбранного сотрудника. onSubmit(pin) → Promise. */
export default function PinPad({ employee = {}, onSubmit, onBack }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const role = employee.role_slug || (employee.role_slugs && employee.role_slugs[0])

  const submit = useCallback(async (value) => {
    if (busy || value.length < 4) return
    setBusy(true); setError(false)
    try {
      await onSubmit(value)
    } catch {
      setError(true)
      setPin('')
      setTimeout(() => setError(false), 600)
    } finally {
      setBusy(false)
    }
  }, [busy, onSubmit])

  const press = useCallback((d) => {
    setPin((prev) => {
      if (prev.length >= 8) return prev
      const next = prev + d
      if (next.length === 4) setTimeout(() => submit(next), 120)
      return next
    })
  }, [submit])

  const back = useCallback(() => setPin((p) => p.slice(0, -1)), [])

  useEffect(() => {
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') back()
      else if (e.key === 'Enter') submit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, back, submit, pin])

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back']

  return (
    <div className="pinpad-screen">
      <div className="pinpad">
        <button className="pinpad__back" onClick={onBack}><ArrowLeft size={20} /> {t('back')}</button>

        <div className="pinpad__user">
          <span className="pinpad__avatar">{initials(employee.name || employee.email)}</span>
          <span className="pinpad__name">{employee.name || employee.email}</span>
          <span className="pinpad__role">{t.role(role)}</span>
        </div>

        <div className={`pinpad__dots ${error ? 'pinpad__dots--error' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
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

        <button className="pinpad__submit" onClick={() => submit(pin)} disabled={pin.length < 4 || busy}>
          {busy ? t('check') : t('enter')}
        </button>
      </div>
    </div>
  )
}
