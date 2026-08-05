import { useState, useEffect } from 'react'
import { RefreshCw, Lock, User, Settings } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * TopBar — верхняя панель для всех режимов.
 * Часы, название, статус соединения, кнопки управления.
 */
export default function TopBar({
  title = 'MARJON',
  subtitle,
  isOnline = true,
  queued = 0,
  onRefresh,
  onLock,
  onSettings,
  onAccount,
  children,
}) {
  const [time, setTime] = useState(formatTime)

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="topbar">
      <span className="topbar__clock">{time}</span>

      <div className="topbar__brand">
        <span className="topbar__title">{title}</span>
        {subtitle && <span className="topbar__subtitle">{subtitle}</span>}
      </div>

      {children && <div className="topbar__center">{children}</div>}

      <div className="topbar__status">
        <div className={`status-dot ${isOnline ? 'status-dot--online' : 'status-dot--offline'}`} />
        <span className="topbar__status-text">
          {isOnline ? t('online') : t('offline')}
        </span>
        {queued > 0 && (
          <span className="topbar__queue" title={t('queue_hint')}>↻ {queued}</span>
        )}
      </div>

      <div className="topbar__actions">
        {onRefresh && (
          <button className="icon-btn" onClick={onRefresh} title={t('refresh')}>
            <RefreshCw size={22} />
          </button>
        )}
        {onLock && (
          <button className="icon-btn" onClick={onLock} title={t('lock_screen')}>
            <Lock size={22} />
          </button>
        )}
        {onSettings && (
          <button className="icon-btn" onClick={onSettings} title={t('settings')}>
            <Settings size={22} />
          </button>
        )}
        {onAccount && (
          <button className="icon-btn" onClick={onAccount} title={t('account')}>
            <User size={22} />
          </button>
        )}
      </div>
    </header>
  )
}

function formatTime() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
