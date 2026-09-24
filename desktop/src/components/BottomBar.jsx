import { useState, useEffect } from 'react'
import { Minus, User } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * BottomBar — нижняя панель с кнопкой сворачивания, краткой информацией
 * о текущей сессии, статусом связи и часами (переехали сюда из шапки —
 * здесь они не мешают).
 * Критична для touch-моноблоков без стандартного taskbar Windows.
 */
export default function BottomBar({ userName, branchName, mode, isOnline = true, queued = 0, onMinimize }) {
  const [time, setTime] = useState(formatTime)

  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 1000)
    return () => clearInterval(id)
  }, [])

  const handleMinimize = () => {
    if (onMinimize) {
      onMinimize()
    } else if (window.electron?.minimize) {
      window.electron.minimize()
    }
  }

  return (
    <footer className="bottombar">
      <div className="bottombar__info">
        {userName && (
          <span className="bottombar__name flex items-center gap-sm">
            <User size={14} />
            {userName}
          </span>
        )}
        {mode && <span> · <span className="bottombar__mode">{mode}</span></span>}
        {branchName && <span> · {branchName}</span>}
      </div>

      {/* Статус связи: тихий в норме, заметный только при обрыве */}
      <span className={`bottombar__status ${isOnline ? '' : 'bottombar__status--offline'}`}>
        <span className={`status-dot ${isOnline ? 'status-dot--online' : 'status-dot--offline'}`} />
        {isOnline ? t('online') : t('offline')}
      </span>
      {queued > 0 && (
        <span className="bottombar__queue" title={t('queue_hint')}>↻ {queued}</span>
      )}

      <span className="bottombar__clock">{time}</span>

      <button className="bottombar__minimize" onClick={handleMinimize} title={t('minimize')}>
        <Minus size={18} />
      </button>
    </footer>
  )
}

function formatTime() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
