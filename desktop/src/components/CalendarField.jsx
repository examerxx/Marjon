import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { t } from '../shared/i18n'
import { todayISO } from '../shared/time'

// Кастомный календарь вместо нативного <input type="date">:
// кнопка DD.MM.YYYY → дропдаун с сеткой месяца и листанием ← →.
const MONTHS = t('cal_months').split(',')
const DAYS = t('cal_days').split(',')

function iso(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
function fmt(isoStr) {
  if (!isoStr) return '—'
  const [y, m, d] = isoStr.split('-')
  return `${d}.${m}.${y}`
}

export default function CalendarField({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => {
    const b = value ? new Date(value + 'T00:00:00') : new Date()
    return { y: b.getFullYear(), m: b.getMonth() }
  })
  const ref = useRef(null)

  // Клик вне календаря закрывает дропдаун
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function toggle() {
    if (!open) {
      const b = value ? new Date(value + 'T00:00:00') : new Date()
      setView({ y: b.getFullYear(), m: b.getMonth() })
    }
    setOpen((v) => !v)
  }

  function shift(delta) {
    setView(({ y, m }) => {
      const nm = m + delta
      if (nm < 0) return { y: y - 1, m: 11 }
      if (nm > 11) return { y: y + 1, m: 0 }
      return { y, m: nm }
    })
  }

  const todayIso = todayISO()
  const startPad = (new Date(view.y, view.m, 1).getDay() + 6) % 7 // неделя с понедельника
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="cal-field" ref={ref}>
      <button type="button" className="input cal-field__btn" onClick={toggle}>
        <Calendar size={16} /> {fmt(value)}
      </button>
      {open && (
        <div className="cal-pop">
          <div className="cal-pop__head">
            <button type="button" className="icon-btn cal-pop__nav" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
            <span className="cal-pop__title">{MONTHS[view.m]} {view.y}</span>
            <button type="button" className="icon-btn cal-pop__nav" onClick={() => shift(1)}><ChevronRight size={18} /></button>
          </div>
          <div className="cal-pop__days">
            {DAYS.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="cal-pop__grid">
            {cells.map((d, i) => {
              if (d == null) return <span key={`pad${i}`} className="cal-day cal-day--pad" />
              const dIso = iso(view.y, view.m, d)
              const cls = ['cal-day', dIso === value ? 'cal-day--selected' : '', dIso === todayIso ? 'cal-day--today' : ''].filter(Boolean).join(' ')
              return (
                <button key={d} type="button" className={cls} onClick={() => { onChange(dIso); setOpen(false) }}>{d}</button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
