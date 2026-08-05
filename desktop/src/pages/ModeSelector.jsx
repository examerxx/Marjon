import { ShoppingCart, ChefHat, UtensilsCrossed, LogOut, ArrowLeft } from 'lucide-react'
import { t } from '../shared/i18n'

export default function ModeSelector({ user, branch, onSelect, onBack, onLogout }) {
  const MODES = [
    { id: 'cashier', label: t('mode_cashier'), description: t('md_cashier_desc'), icon: ShoppingCart, color: 'var(--color-brand)' },
    { id: 'kitchen', label: t('mode_kitchen'), description: t('md_kitchen_desc'), icon: ChefHat, color: 'var(--color-warning)' },
    { id: 'waiter', label: t('mode_waiter'), description: t('md_waiter_desc'), icon: UtensilsCrossed, color: 'var(--color-success)' },
  ]
  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 680 }}>
        <div className="login-header">
          <button className="icon-btn" onClick={onBack} title={t('md_back')}>
            <ArrowLeft size={22} />
          </button>
          <div className="login-header__info">
            <h1 className="login-logo">{t('md_title')}</h1>
            <p className="login-subtitle">{branch?.name}</p>
          </div>
          <button className="icon-btn" onClick={onLogout} title={t('logout')}>
            <LogOut size={22} />
          </button>
        </div>

        <p className="branch-hint">{t('md_hint')}</p>

        <div className="mode-grid">
          {MODES.map(({ id, label, description, icon: Icon, color }) => (
            <button
              key={id}
              className="mode-card"
              onClick={() => onSelect(id)}
            >
              <div className="mode-card__icon" style={{ background: color }}>
                <Icon size={36} color="#fff" strokeWidth={1.8} />
              </div>
              <div className="mode-card__text">
                <span className="mode-card__label">{label}</span>
                <span className="mode-card__desc">{description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
