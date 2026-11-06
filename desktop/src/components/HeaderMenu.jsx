import { useState, useEffect, useRef } from 'react'
import { MoreVertical } from 'lucide-react'

/**
 * HeaderMenu — иконка-кнопка с дропдауном для действий шапки.
 * Собирает разделы (Финансы / История / Отчёты и т.п.) в одно меню рядом с
 * блокировкой и настройками. Без подписи — только иконка, как остальные
 * кнопки шапки; название меню уходит в title/aria-label.
 * items: [{ id, label, Icon, onClick }]. Закрывается по клику вне и по Esc.
 */
export default function HeaderMenu({ title, Icon = MoreVertical, items = [], variant = 'icon', label }) {
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

  if (!items.length) return null

  return (
    <div className="hmenu" ref={ref}>
      <button
        className={variant === 'dock' ? `dock__item ${open ? 'is-active' : ''}` : `icon-btn ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
        aria-expanded={open ? 'true' : 'false'}
      >
        <Icon size={variant === 'dock' ? 26 : 22} />
        {variant === 'dock' && <span>{label || title}</span>}
      </button>
      {open && (
        <div className={`hmenu__dropdown ${variant === 'dock' ? 'hmenu__dropdown--up' : ''}`} role="menu">
          {items.map(({ id, label: itemLabel, Icon: ItemIcon, onClick }) => (
            <button
              key={id}
              className="hmenu__item"
              role="menuitem"
              onClick={() => { setOpen(false); onClick?.() }}
            >
              {ItemIcon && <ItemIcon size={18} />}
              <span>{itemLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
