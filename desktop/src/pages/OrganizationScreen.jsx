import { useState, useEffect } from 'react'
import { Settings, LogIn, Phone, LogOut } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * OrganizationScreen — экран организации (домашний, до входа сотрудника).
 * Фон-фото, часы, название заведения, кнопка «Войти» (KIRISH),
 * шестерёнка настроек и телефон поддержки. По мотивам ZimZim.
 */
export default function OrganizationScreen({ orgName, branchName, supportPhone, onEnter, onSettings, onReset }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="org-screen">
      <div className="org-screen__overlay" />

      <button className="org-screen__settings" onClick={onSettings} title={t('settings')}>
        <Settings size={24} />
      </button>

      {onReset && (
        <button className="org-screen__reset" onClick={onReset} title={t('change_org')}>
          <LogOut size={18} /> {t('change_org')}
        </button>
      )}

      <div className="org-screen__content">
        <div className="org-screen__brand">
          <div className="org-screen__mark">M</div>
          <div className="org-screen__names">
            <span className="org-screen__org">{orgName || 'MARJON'}</span>
            {branchName && <span className="org-screen__branch">{branchName}</span>}
          </div>
        </div>

        <div className="org-screen__clock">{time}</div>
        <div className="org-screen__date">{date}</div>

        <button className="org-screen__enter" onClick={onEnter}>
          <LogIn size={22} strokeWidth={2.2} />
          {t('enter')}
        </button>
      </div>

      <div className="org-screen__support">
        <Phone size={15} />
        {t('support')}: {supportPhone || '+998 (77) 343 00 19'}
      </div>
    </div>
  )
}
