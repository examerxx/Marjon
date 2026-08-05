import { useState, useEffect } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { auth } from '../shared/api'
import { t } from '../shared/i18n'

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}
// Стабильный цвет аватара по имени
const AVATAR_COLORS = ['#1db5b5', '#2563eb', '#7c3aed', '#f59e0b', '#16a34a', '#ef4444', '#0e8080', '#e11d48']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function EmployeeSelector({ branch, onSelect, onBack }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeIds, setActiveIds] = useState(() => new Set())

  function load() {
    setLoading(true); setError(false)
    auth.staffUsers(branch?.id)
      .then((data) => {
        const list = (Array.isArray(data) ? data : data?.items || []).filter((u) => u.is_active !== false)
        setStaff(list.length ? list : DEMO_STAFF)
      })
      .catch(() => { setStaff(DEMO_STAFF); setError(true) })
      .finally(() => setLoading(false))
  }
  // Кто сейчас в смене (активная сессия). Тихо игнорируем ошибки — индикатор необязателен.
  function loadActive() {
    auth.activeStaff()
      .then((ids) => setActiveIds(new Set(Array.isArray(ids) ? ids.map(String) : [])))
      .catch(() => {})
  }
  useEffect(() => {
    load(); loadActive()
    const id = setInterval(loadActive, 30000)
    return () => clearInterval(id)
  }, [branch?.id])

  return (
    <div className="emp-screen">
      <div className="emp-screen__panel">
        <header className="emp-screen__header">
          <button className="icon-btn" onClick={onBack} title={t('back')}><ArrowLeft size={22} /></button>
          <div className="emp-screen__titles">
            <h1>{t('choose_employee')}</h1>
            <p>{branch?.name || t('branch')}</p>
          </div>
          <button className="icon-btn" onClick={load} title={t('refresh')}><RefreshCw size={20} /></button>
        </header>

        {loading ? (
          <div className="emp-screen__state"><div className="spinner" /><p>{t('loading')}</p></div>
        ) : (
          <div className="emp-grid">
            {staff.map((u) => {
              const role = u.role_slug || (u.role_slugs && u.role_slugs[0])
              const inSession = activeIds.has(String(u.id))
              return (
                <button key={u.id} className={`emp-card ${inSession ? 'emp-card--online' : ''}`} onClick={() => onSelect(u)}>
                  {inSession && <span className="emp-card__session" title={t('in_session')}><span className="emp-card__session-dot" />{t('in_session')}</span>}
                  <span className="emp-card__avatar" style={{ background: avatarColor(u.name || u.email) }}>
                    {initials(u.name || u.email)}
                  </span>
                  <span className="emp-card__name">{u.name || u.email}</span>
                  <span className="emp-card__role">{t.role(role)}</span>
                </button>
              )
            })}
          </div>
        )}
        {error && <p className="emp-screen__note">{t('emp_demo_note')}</p>}
      </div>
    </div>
  )
}

const DEMO_STAFF = [
  { id: 'd1', name: 'Сардор Хамидов', role_slug: 'cashier', is_active: true },
  { id: 'd2', name: 'Зохида Каримова', role_slug: 'waiter', is_active: true },
  { id: 'd3', name: 'Азиз Рахимов', role_slug: 'cook', is_active: true },
  { id: 'd4', name: 'Дилноза Юсупова', role_slug: 'waiter', is_active: true },
  { id: 'd5', name: 'Женис Абдуллаев', role_slug: 'manager', is_active: true },
]
