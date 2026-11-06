import { useEffect, useState } from 'react'
import { ChevronDown, LogOut, User, UtensilsCrossed } from 'lucide-react'
import { t } from '../shared/i18n'
import logoUrl from '../assets/logo-mark.png'

/**
 * TopBar — плавающая белая шапка рабочего экрана: бренд, заведение,
 * разделы режима (слот), профиль сотрудника, выход и карточка времени.
 * Часы переехали сюда из нижней панели: в доке они не помещались рядом
 * с крупными вкладками.
 */
export default function TopBar({
  venueName,
  userName,
  userRole,
  onAccount,
  onExit,
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
        {/* Знак декоративен: доступное имя даёт текст рядом */}
        <span className="topbar__logo-mark">
          <img className="topbar__logo" src={logoUrl} alt="" aria-hidden="true" />
        </span>
        <span className="topbar__brand-text">
          <span className="topbar__brand-name">MARJON</span>
          <span className="topbar__brand-tagline">Restaurant OS</span>
        </span>
      </div>

      {/* Слот «Назад»: экран заказа рендерит сюда стрелку порталом. */}
      <div className="topbar__back-slot" id="topbar-back-slot" />

      <span className="topbar__rule" aria-hidden="true" />

      {venueName && (
        <div className="topbar__venue" title={venueName}>
          <UtensilsCrossed size={18} />
          <span>{venueName}</span>
        </div>
      )}

      {/* Разделы режима: «События / Заказы / Меню / Блокировка» приходят порталом. */}
      <nav className="topbar__nav" id="topbar-nav-slot" aria-label={t('menu_more')} />

      {/* Центральный слот: экран заказа рендерит сюда поиск блюда. */}
      <div className="topbar__center" id="topbar-center-slot">{children}</div>

      <div className="topbar__account">
        <button className="topbar__account-btn" onClick={onAccount} title={t('account')}>
          <span className="topbar__account-ico"><User size={19} /></span>
          <span className="topbar__account-text">
            <span className="topbar__account-role">{userRole ? `${userRole}:` : t('staff')}</span>
            <span className="topbar__account-name">{userName || t('account')}</span>
          </span>
          <ChevronDown size={18} className="topbar__account-chevron" />
        </button>
        {onExit && (
          <button className="topbar__exit" onClick={onExit} title={t('logout')} aria-label={t('logout')}>
            <LogOut size={20} />
          </button>
        )}
        <div className="topbar__clock-card">
          <span className="topbar__time">{time}</span>
          <span className="topbar__date">{date}</span>
        </div>
      </div>
    </header>
  )
}
