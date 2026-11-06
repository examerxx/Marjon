import { useEffect, useState } from 'react'
import { ChevronDown, User } from 'lucide-react'
import { t } from '../shared/i18n'

/** Фирменный знак MARJON: два наклонных штриха и синяя капля. */
function BrandMark() {
  return (
    <svg className="topbar__logo" viewBox="0 0 76 54" role="img" aria-label="MARJON">
      <defs>
        <linearGradient id="mj-mark-a" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6be8d3" />
          <stop offset="1" stopColor="#2cc7bb" />
        </linearGradient>
        <linearGradient id="mj-mark-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#33d5cf" />
          <stop offset="1" stopColor="#0ea7ab" />
        </linearGradient>
        <linearGradient id="mj-mark-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5aa9ff" />
          <stop offset="1" stopColor="#1c43c8" />
        </linearGradient>
      </defs>
      <rect x="7" y="3" width="15" height="45" rx="7.5" fill="url(#mj-mark-a)" transform="rotate(28 14.5 25.5)" />
      <rect x="26" y="6" width="15" height="39" rx="7.5" fill="url(#mj-mark-b)" transform="rotate(28 33.5 25.5)" />
      <path
        d="M61 8c4.7 6.5 9.6 13.2 9.6 19.5A9.6 9.6 0 0 1 61 37a9.6 9.6 0 0 1-9.6-9.5C51.4 21.2 56.3 14.5 61 8Z"
        fill="url(#mj-mark-c)"
      />
    </svg>
  )
}

// В шапке — короткое имя, как в POS: «Аюпов Аъзамжон» → «Аъзамжон».
function shortName(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : String(name || '')
}

/**
 * TopBar — плавающая белая шапка: знак и имя заведения, разделы режима
 * (слот), профиль сотрудника, выход и карточка времени.
 */
export default function TopBar({
  userName,
  userRole,
  onAccount,
  children,
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__logo-mark"><BrandMark /></span>
        <span className="topbar__brand-text">
          <span className="topbar__brand-name">MARJON</span>
        </span>
      </div>

      {/* Слот «Назад»: экран заказа рендерит сюда стрелку порталом. */}
      <div className="topbar__back-slot" id="topbar-back-slot" />

      <span className="topbar__rule" aria-hidden="true" />

      {/* Центральный слот: экран заказа рендерит сюда поиск блюда. */}
      <div className="topbar__center" id="topbar-center-slot">{children}</div>

      <div className="topbar__account">
        <span className="topbar__divider" aria-hidden="true" />
        <div className="topbar__clock-card">
          <span className="topbar__time">{time}</span>
          <span className="topbar__date">{date}</span>
        </div>
        <button className="topbar__account-btn" onClick={onAccount} title={t('account')}>
          <span className="topbar__account-ico"><User size={21} /></span>
          <span className="topbar__account-text">
            <span className="topbar__account-role">{userRole ? `${userRole}:` : t('staff')}</span>
            <span className="topbar__account-name">{shortName(userName) || t('account')}</span>
          </span>
          <ChevronDown size={19} className="topbar__account-chevron" />
        </button>
      </div>
    </header>
  )
}
