import { useState, useEffect } from 'react'
import { LogOut, MapPin, RefreshCw, Building2 } from 'lucide-react'
import { companies } from '../shared/api'
import { t } from '../shared/i18n'

export default function BranchSelector({ user, onSelect, onLogout }) {
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    companies.branches()
      .then(data => {
        const list = Array.isArray(data) ? data : []
        setBranches(list)
        // Один логин = один филиал: если филиал единственный — выбираем автоматически
        if (list.length === 1) onSelect(list[0])
      })
      .catch(() => setError(t('bs_load_err')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="login-page">
      <div className="branch-selector">
        <div className="branch-selector__header">
          <div className="branch-selector__user">
            <Building2 size={28} className="brand-icon" />
            <div>
              <h1 className="branch-selector__title">{t('bs_title')}</h1>
              <p className="branch-selector__username">{user?.name || user?.email}</p>
            </div>
          </div>
          <div className="branch-selector__actions">
            <button className="icon-btn" onClick={load} title={t('refresh')}>
              <RefreshCw size={22} />
            </button>
            <button className="icon-btn icon-btn--danger" onClick={onLogout} title={t('logout')}>
              <LogOut size={22} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="branch-selector__loading">
            <div className="spinner" />
            <p>{t('bs_loading')}</p>
          </div>
        ) : error ? (
          <div className="branch-selector__error">
            <p className="error">{error}</p>
            <button className="btn btn--outline" onClick={load}>{t('retry')}</button>
          </div>
        ) : branches.length === 0 ? (
          <div className="branch-selector__empty">
            <MapPin size={48} strokeWidth={1.5} />
            <p>{t('bs_empty')}</p>
          </div>
        ) : (
          <div className="branch-grid">
            {branches.map((b) => (
              <button
                key={b.id}
                className="branch-card"
                onClick={() => onSelect(b)}
              >
                <div className="branch-card__icon">
                  <MapPin size={28} />
                </div>
                <div className="branch-card__info">
                  <span className="branch-card__name">{b.name}</span>
                  {b.address && <span className="branch-card__address">{b.address}</span>}
                  {b.city && <span className="branch-card__city">{b.city}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
