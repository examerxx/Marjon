import { RefreshCw, Lock, User, Settings } from 'lucide-react'
import { t } from '../shared/i18n'
import logoUrl from '../assets/logo.svg'

/**
 * TopBar — верхняя панель для всех режимов: бренд-блок и кнопки управления.
 * Бренд повторяет веб-админку (.brand-mark / .brand-title / .brand-subtitle):
 * знак в карточке с лёгкой обводкой, рядом MARJON и тише — Restaurant OS.
 * Часы и статус связи переехали в BottomBar — в шапке они перетягивали
 * внимание кассира.
 */
export default function TopBar({
  subtitle,
  onRefresh,
  onLock,
  onSettings,
  onAccount,
  children,
}) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        {/* Знак декоративен: доступное имя даёт текст рядом */}
        <span className="topbar__logo-mark">
          <img className="topbar__logo" src={logoUrl} alt="" aria-hidden="true" />
        </span>
        <span className="topbar__brand-text">
          <span className="topbar__brand-name">MARJON</span>
          <span className="topbar__brand-tagline">Restaurant OS</span>
        </span>
        {subtitle && <span className="topbar__subtitle">{subtitle}</span>}
      </div>

      {children && <div className="topbar__center">{children}</div>}

      <div className="topbar__actions">
        {/* Слот для дропдауна разделов режима — иконка-кнопка рядом с блокировкой и настройками */}
        <div className="topbar__actions-slot" id="topbar-actions-slot" />
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
