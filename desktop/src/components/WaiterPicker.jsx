import { createPortal } from 'react-dom'
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { ChevronDown, Check, User } from 'lucide-react'
import { t } from '../shared/i18n'

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

export default function WaiterPicker({ value, staff = [], onChange, label, disabled = false, hideLabel = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const listRef = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      const below = innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const height = Math.min(264, Math.max(below, above))
      setPosition({
        position: 'fixed', left: rect.left, right: 'auto', width: rect.width,
        top: below >= Math.min(264, above) ? rect.bottom + 6 : Math.max(6, rect.top - height - 6),
        maxHeight: height, zIndex: 10000,
      })
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Пока идёт сохранение — список закрываем, чтобы не выбрали второго подряд
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  const pick = useCallback((id) => {
    setOpen(false)
    if (String(id || '') !== String(value || '')) onChange?.(id)
  }, [onChange, value])

  const current = staff.find((s) => String(s.id) === String(value || '')) || null
  const currentName = current ? (current.name || current.email) : t('waiter_not_set')

  return (
    <div className={`wpick ${open ? 'wpick--open' : ''}`} ref={ref}>
      <button type="button" className="wpick__trigger" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {!hideLabel && <span className="wpick__label">{label || t('change_item_waiter')}</span>}
        <span className={`wpick__value ${current ? '' : 'wpick__value--empty'}`}>
          {current
            ? (hideLabel ? <User size={16} className="wpick__ico" /> : <span className="wpick__avatar">{initials(currentName)}</span>)
            : <User size={16} className="wpick__ico" />}
          {currentName}
        </span>
        <ChevronDown size={18} className="wpick__chev" />
      </button>

      {open && position && createPortal(
        <div className={`wpick__list${hideLabel ? ' wpick__list--plain' : ''}`} ref={listRef} role="listbox" style={position}>
          {staff.map((s) => {
            const name = s.name || s.email
            const on = String(s.id) === String(value || '')
            return (
              <button key={s.id} type="button" role="option" aria-selected={on}
                className={`wpick__opt ${on ? 'wpick__opt--on' : ''}`} onClick={() => pick(s.id)}>
                {hideLabel ? <User size={16} className="wpick__ico" /> : <span className="wpick__avatar">{initials(name)}</span>}
                <span className="wpick__opt-name">{name}</span>
                {on && <Check size={18} />}
              </button>
            )
          })}
        </div>, document.body
      )}
    </div>
  )
}
