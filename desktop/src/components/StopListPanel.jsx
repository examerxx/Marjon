import { useState, useEffect, useCallback } from 'react'
import { X, Ban, Search, Check, Utensils, ArrowLeft } from 'lucide-react'
import { menu } from '../shared/api'
import { can } from '../shared/permissions'
import { t } from '../shared/i18n'
import { toast } from './Toast'

function isStopped(p) { return p.is_available === false || p.in_stop_list === true }

/**
 * Стоп-лист = доступность блюд. Редактирование gated правом 'can_edit_stop_list':
 * сейчас право приходит из user.permissions (веб-админка владельца),
 * пустой объект прав = разрешено всё (совместимость со старыми аккаунтами).
 *
 * Два экрана в одном оверлее (оверлей развёрнут на весь экран через .modal-overlay):
 *  - сетка блюд крупными карточками с фото (как в выборе блюд на кассе);
 *  - по клику на карточку — отдельный экран блюда: доступность + дневной лимит порций.
 */
export default function StopListPanel({ user, onClose }) {
  const canEdit = can(user, 'can_edit_stop_list')
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyStop, setOnlyStop] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // Выбранное блюдо (экран деталей). Держим id, а объект берём из products —
  // тогда оптимистичные правки доступности/лимита сразу видны на экране деталей.
  const [selectedId, setSelectedId] = useState(null)
  // D3 «максимум блюда»: черновики ввода лимита по id и id блюда в процессе сохранения.
  const [limitDraft, setLimitDraft] = useState({})
  const [limitBusyId, setLimitBusyId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    menu.products()
      .then((d) => setProducts(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  async function toggle(p) {
    if (!canEdit) return
    const makeAvailable = isStopped(p) // сейчас в стопе → делаем доступным
    setBusyId(p.id)
    setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, is_available: makeAvailable, in_stop_list: !makeAvailable } : x))
    try { await menu.setAvailable(p.id, makeAvailable) }
    catch (e) { toast(e?.response?.data?.detail || e.message, 'error'); load() }
    finally { setBusyId(null) }
  }

  // Значение поля лимита: приоритет у черновика ввода, иначе сохранённый лимит ('' = без лимита).
  function draftFor(p) {
    return limitDraft[p.id] !== undefined ? limitDraft[p.id] : (p.daily_limit ?? '')
  }

  // D3: сохранить/снять дневной максимум порций. Пусто → снять лимит (null),
  // иначе целое ≥1. Бэкенд при задании числа обнуляет счётчик и снимает со стопа.
  async function saveLimit(p) {
    if (!canEdit) return
    const raw = String(draftFor(p)).trim()
    let value = null
    if (raw !== '') {
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n) || n < 1) { toast(t('limit_invalid'), 'error'); return }
      value = n
    }
    setLimitBusyId(p.id)
    try {
      const updated = await menu.setLimit(p.id, value)
      setProducts((prev) => prev.map((x) => x.id === p.id ? { ...x, ...updated } : x))
      setLimitDraft((prev) => { const next = { ...prev }; delete next[p.id]; return next })
      toast(value === null ? t('limit_cleared') : t('limit_saved'), 'success')
    } catch (e) {
      toast(e?.response?.data?.detail || e.message, 'error')
    } finally {
      setLimitBusyId(null)
    }
  }

  const shown = products.filter((p) => {
    if (onlyStop && !isStopped(p)) return false
    if (search && !(p.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const stopCount = products.filter(isStopped).length
  const selected = selectedId != null ? products.find((p) => p.id === selectedId) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal stop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="stop-title">
            {selected ? (
              <button className="icon-btn" onClick={() => setSelectedId(null)} title={t('back')}><ArrowLeft size={26} /></button>
            ) : (
              <Ban size={20} />
            )}
            <span>{selected ? selected.name : t('stoplist')}</span>
            {!selected && stopCount > 0 && <span className="stop-count">{stopCount}</span>}
          </h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        {/* Поиск/фильтр — только на экране сетки */}
        {!selected && (
          <div className="stop-controls">
            <div className="cashier-products__search" style={{ flex: 1 }}>
              <Search size={18} className="search-icon" />
              <input className="search-input" placeholder={t('search_dish')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button className={`filter-chip ${onlyStop ? 'filter-chip--active' : ''}`} onClick={() => setOnlyStop((v) => !v)}>{t('only_stop')}</button>
          </div>
        )}

        <div className="modal__body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('loading')}</p></div>
          ) : selected ? (
            /* ── Экран блюда: доступность + дневной лимит порций ── */
            <div className="stop-detail">
              <div className="stop-detail__aside">
                <span className="stop-detail__thumb">
                  {selected.image_url ? <img src={selected.image_url} alt="" /> : <Utensils size={64} />}
                </span>
                <span className="stop-detail__name">{selected.name}</span>
                <span className="stop-detail__price">{Number(selected.price || 0).toLocaleString('ru-RU')} {t('currency')}</span>
                <span className={`stop-detail__status ${isStopped(selected) ? 'is-stop' : 'is-ok'}`}>
                  {isStopped(selected) ? <><Ban size={15} /> {t('in_stop')}</> : <><Check size={15} /> {t('available')}</>}
                </span>
              </div>

              {canEdit && (
                <div className="stop-detail__main">
                  <section className="stop-detail__section">
                    <span className="stop-detail__section-title">{t('availability')}</span>
                    <button
                      className={`btn btn--lg ${isStopped(selected) ? 'btn--primary' : 'btn--danger-soft'} stop-detail__toggle`}
                      disabled={busyId === selected.id}
                      onClick={() => toggle(selected)}
                    >
                      {isStopped(selected) ? <><Check size={18} /> {t('return_item')}</> : <><Ban size={18} /> {t('to_stop')}</>}
                    </button>
                  </section>

                  {/* D3 «максимум блюда»: дневной лимит порций (авто-стоп при исчерпании) */}
                  <section className="stop-detail__section">
                    <span className="stop-detail__section-title">{t('daily_max')}</span>
                    <p className="stop-detail__hint">{t('limit_hint')}</p>
                    <div className="stop-detail__limit-row">
                      <input
                        className="stop-detail__limit-input"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        placeholder={t('no_limit')}
                        value={draftFor(selected)}
                        disabled={limitBusyId === selected.id}
                        onChange={(e) => setLimitDraft((prev) => ({ ...prev, [selected.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLimit(selected) }}
                      />
                      <button className="btn btn--lg btn--primary" disabled={limitBusyId === selected.id} onClick={() => saveLimit(selected)}>{t('save')}</button>
                    </div>
                    {selected.daily_limit != null && (
                      <p className="stop-detail__sold">{t('sold')}: <strong>{selected.sold_count ?? 0}</strong> / {selected.daily_limit}</p>
                    )}
                  </section>
                </div>
              )}
            </div>
          ) : shown.length === 0 ? (
            <p className="settings-hint">{t('nothing_found')}</p>
          ) : (
            /* ── Сетка блюд крупными карточками с фото (как в выборе блюд на кассе) ── */
            <div className="stop-grid">
              {shown.map((p) => {
                const stopped = isStopped(p)
                return (
                  <button key={p.id} className={`product-card ${stopped ? 'product-card--stop' : ''}`} onClick={() => setSelectedId(p.id)}>
                    <span className="product-card__thumb">
                      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <Utensils size={26} />}
                    </span>
                    <span className="product-card__name">{p.name}</span>
                    <span className="product-card__price">{Number(p.price || 0).toLocaleString('ru-RU')} {t('currency')}</span>
                    {stopped && <span className="product-card__stop">STOP</span>}
                    {p.daily_limit != null && <span className="product-card__limit">{p.sold_count ?? 0}/{p.daily_limit}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
