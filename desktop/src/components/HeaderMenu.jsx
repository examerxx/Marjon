import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

/**
 * HeaderMenu — иконка-кнопка с дропдауном для действий шапки.
 * items: [{ id, label, Icon, onClick }]. Закрывается по клику вне и по Esc.
 *
 * В доке панель рендерится порталом: у .dock__nav горизонтальный скролл
 * (overflow), который срезал бы выпадающий список. Панель встаёт над кнопкой
 * маленьким окном — как прежнее меню «…» в шапке.
 */
export default function HeaderMenu({ title, Icon = MoreVertical, items = [], variant = 'icon', label }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    function onScroll() { setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  function toggle() {
    if (!open && variant === 'dock' && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({
        right: Math.max(8, window.innerWidth - r.right),
        bottom: Math.max(8, window.innerHeight - r.top + 10),
      })
    }
    setOpen((v) => !v)
  }

  if (!items.length) return null

  const dropdown = (
    <div
      ref={menuRef}
      className={`hmenu__dropdown ${variant === 'dock' ? 'hmenu__dropdown--fixed' : ''}`}
      style={variant === 'dock' ? pos || undefined : undefined}
      role="menu"
    >
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
  )

  return (
    <div className="hmenu" ref={ref}>
      <button
        ref={btnRef}
        className={variant === 'dock' ? `dock__item ${open ? 'is-active' : ''}` : `icon-btn ${open ? 'is-active' : ''}`}
        onClick={toggle}
        title={title}
        aria-label={title}
        aria-expanded={open ? 'true' : 'false'}
      >
        <Icon size={variant === 'dock' ? 26 : 22} />
        {variant === 'dock' && <span>{label || title}</span>}
      </button>
      {open && (variant === 'dock'
        ? createPortal(dropdown, document.body)
        : dropdown)}
    </div>
  )
}
