import { Minus, User } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * BottomBar — нижняя панель с кнопкой сворачивания
 * и краткой информацией о текущей сессии.
 * Критична для touch-моноблоков без стандартного taskbar Windows.
 */
export default function BottomBar({ userName, branchName, mode, onMinimize }) {
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
          <span className="flex items-center gap-sm">
            <User size={14} />
            {userName}
          </span>
        )}
        {branchName && <span> · {branchName}</span>}
        {mode && <span> · {mode}</span>}
      </div>

      <button className="bottombar__minimize" onClick={handleMinimize} title={t('minimize')}>
        <Minus size={18} />
      </button>
    </footer>
  )
}
