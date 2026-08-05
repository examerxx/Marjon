import { useState, useEffect, useCallback } from 'react'
import { X, Ban, Search, Check } from 'lucide-react'
import { menu } from '../shared/api'
import { t } from '../shared/i18n'

function isStopped(p) { return p.is_available === false || p.in_stop_list === true }

export default function StopListPanel({ onClose }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyStop, setOnlyStop] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    menu.products()
      .then((d) => setProducts(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  async function toggle(p) {
    const makeAvailable = isStopped(p) // сейчас в стопе → делаем доступным
    setBusyId(p.id)
    setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_available: makeAvailable, in_stop_list: !makeAvailable } : x))
    try { await menu.setAvailable(p.id, makeAvailable) } catch { load() } finally { setBusyId(null) }
  }

  const shown = products.filter((p) => {
    if (onlyStop && !isStopped(p)) return false
    if (search && !(p.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const stopCount = products.filter(isStopped).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal stop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><Ban size={20} /> {t('stoplist')} {stopCount > 0 && <span className="stop-count">{stopCount}</span>}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="stop-controls">
          <div className="cashier-products__search" style={{ padding: 0, border: 'none', flex: 1 }}>
            <Search size={18} className="search-icon" />
            <input className="search-input" placeholder={t('search_dish')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className={`filter-chip ${onlyStop ? 'filter-chip--active' : ''}`} onClick={() => setOnlyStop((v) => !v)}>{t('only_stop')}</button>
        </div>

        <div className="modal__body stop-body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('loading')}</p></div>
          ) : shown.length === 0 ? (
            <p className="settings-hint">{t('nothing_found')}</p>
          ) : (
            <div className="stop-list">
              {shown.map((p) => {
                const stopped = isStopped(p)
                return (
                  <div className={`stop-row ${stopped ? 'stop-row--off' : ''}`} key={p.id}>
                    <div className="stop-row__info">
                      <span className="stop-row__name">{p.name}</span>
                      <span className="stop-row__price">{Number(p.price || 0).toLocaleString('ru-RU')} {t('currency')}</span>
                    </div>
                    <button
                      className={`btn btn--sm ${stopped ? 'btn--primary' : 'btn--danger'}`}
                      disabled={busyId === p.id}
                      onClick={() => toggle(p)}
                    >
                      {stopped ? <><Check size={16} /> {t('return_item')}</> : <><Ban size={16} /> {t('to_stop')}</>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
