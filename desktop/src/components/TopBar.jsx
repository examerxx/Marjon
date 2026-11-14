import { useEffect, useState } from 'react'
import { ChevronDown, Lock, User } from 'lucide-react'
import { t } from '../shared/i18n'
import brandMark from '../assets/brand-mark.png'

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
  onLock,
  sync,
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
        <span className="topbar__logo-mark">
          <img className="topbar__logo" src={brandMark} alt="MARJON" />
        </span>
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
        {sync && (!sync.online || sync.dead > 0 || sync.pending > 0) && (
          <span
            className={`topbar__sync ${!sync.online ? 'topbar__sync--offline' : sync.dead > 0 ? 'topbar__sync--failed' : ''}`}
            title={!sync.online ? t('offline') : sync.dead > 0 ? (sync.lastError || t('sync_failed')) : t('queue_hint')}
          >
            <span className="topbar__sync-dot" aria-hidden="true" />
            {!sync.online
              ? t('offline')
              : `${sync.dead > 0 ? t('sync_failed') : t('queue_hint')}: ${sync.dead > 0 ? sync.dead : sync.pending}`}
          </span>
        )}
        {onLock && (
          <button className="topbar__lock" onClick={onLock} title={t('nav_lock')} aria-label={t('nav_lock')}>
            <Lock size={21} />
          </button>
        )}
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
