import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Check, User } from 'lucide-react'
import { t } from '../shared/i18n'

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

/**
 * WaiterPicker — кастомный селект ответственного официанта у позиции заказа.
 * Нативный <select> на кассе слишком мелкий для пальца, поэтому свой список:
 * крупная кнопка + строки по 48px. Список раскрывается В ПОТОКЕ (не absolute):
 * .modal__body скроллится (overflow-y: auto) и обрезал бы всплывающую панель.
 * Триггер тянется на всю доступную ширину контейнера.
 *
 * props:
 *   value — id текущего официанта (или пусто)
 *   staff — [{ id, name, email }]
 *   onChange(id) — выбор официанта
 *   label — подпись над значением (по умолчанию «сменить официанта у позиции»)
 *   disabled — идёт сохранение
 */
export default function WaiterPicker({ value, staff = [], onChange, label, disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
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
        <span className="wpick__label">{label || t('change_item_waiter')}</span>
        <span className={`wpick__value ${current ? '' : 'wpick__value--empty'}`}>
          {current
            ? <span className="wpick__avatar">{initials(currentName)}</span>
            : <User size={16} className="wpick__ico" />}
          {currentName}
        </span>
        <ChevronDown size={18} className="wpick__chev" />
      </button>

      {open && (
        <div className="wpick__list" role="listbox">
          {staff.map((s) => {
            const name = s.name || s.email
            const on = String(s.id) === String(value || '')
            return (
              <button key={s.id} type="button" role="option" aria-selected={on}
                className={`wpick__opt ${on ? 'wpick__opt--on' : ''}`} onClick={() => pick(s.id)}>
                <span className="wpick__avatar">{initials(name)}</span>
                <span className="wpick__opt-name">{name}</span>
                {on && <Check size={18} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
