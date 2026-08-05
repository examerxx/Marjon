import { useEffect, useState, useCallback, useRef } from 'react'
import {
  CheckCircle, Check, Clock, AlertTriangle, Volume2, VolumeX,
  LayoutGrid, CookingPot, Utensils, ShoppingBag, Bike, Ban, ChefHat, LogOut,
} from 'lucide-react'
import { kitchen } from '../../shared/api'
import StopListPanel from '../../components/StopListPanel'
import RecipeModal from '../../components/RecipeModal'
import { kitchenWS } from '../../services/kitchenWS'
import { soundService } from '../../services/sound'
import { t } from '../../shared/i18n'

// Бэкенд может отдавать наивный UTC (без таймзоны) — считаем его UTC, иначе таймеры врут
function parseTs(ts) {
  if (!ts) return Date.now()
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : ts.replace(' ', 'T') + 'Z'
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? Date.now() : t
}
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}

export default function KitchenMode({ user = {}, onBack }) {
  const FILTERS = [
    { id: 'all', label: t('all'), Icon: LayoutGrid },
    { id: 'new', label: t('new_orders'), Icon: Clock },
    { id: 'cooking', label: t('cooking_orders'), Icon: CookingPot },
    { id: 'ready', label: t('ready_orders'), Icon: CheckCircle },
  ]
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [soundOn, setSoundOn] = useState(() => soundService.enabled)
  const [filter, setFilter] = useState('all')
  const [stopOpen, setStopOpen] = useState(false)
  const [recipeProd, setRecipeProd] = useState(null)
  const [now, setNow] = useState(Date.now())
  const prevOrderIdsRef = useRef(new Set())

  // Пороги таймера из настроек (мин → мс): жёлтый и красный
  const TIMER_GREEN = (Number(localStorage.getItem('marjon_timer_yellow')) || 5) * 60000
  const TIMER_YELLOW = (Number(localStorage.getItem('marjon_timer_red')) || 10) * 60000

  const loadOrders = useCallback(() => {
    kitchen.orders(user.branch_id)
      .then((data) => {
        const list = data.items ?? data ?? []
        setOrders(list)
        trackNewOrders(list)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.branch_id])

  function trackNewOrders(list) {
    const currentIds = new Set(list.map((o) => o.id))
    const prevIds = prevOrderIdsRef.current
    if (prevIds.size > 0) {
      for (const id of currentIds) {
        if (!prevIds.has(id)) { soundService.play('newOrder'); break }
      }
    }
    prevOrderIdsRef.current = currentIds
  }

  useEffect(() => {
    loadOrders()
    const serverUrl = localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1'
    const token = localStorage.getItem('marjon_token')
    kitchenWS.connect(serverUrl, token, user.branch_id)
    const unsubs = [
      kitchenWS.on('connection', ({ status }) => { if (status === 'online') loadOrders() }),
      kitchenWS.on('new_order', () => { soundService.play('newOrder'); loadOrders() }),
      kitchenWS.on('order_updated', () => loadOrders()),
      kitchenWS.on('order_cancelled', () => { soundService.play('orderCancelled'); loadOrders() }),
    ]
    return () => { unsubs.forEach((fn) => fn()); soundService.stopAllAlerts() }
  }, [loadOrders])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    orders.forEach((order) => {
      const elapsed = now - parseTs(order.created_at)
      if (elapsed > TIMER_YELLOW) soundService.startOverdueAlert(order.id)
      else soundService.stopOverdueAlert(order.id)
    })
  }, [orders, now])

  async function handleItemDone(itemId) {
    // Оптимистично: сразу отмечаем готовым (чтобы клик по галочке всегда срабатывал визуально)
    setOrders((prev) => prev.map((order) => ({
      ...order,
      items: (order.items ?? []).map((it) => (it.id === itemId ? { ...it, status: 'ready' } : it)),
    })))
    soundService.play('orderCompleted')
    try { await kitchen.itemDone(itemId) } catch { /* оставляем оптимистичное состояние */ }
  }

  // «Заказ готов» — бэкенд ставит статус ready и уведомляет официанта.
  // Фолбэк: если эндпоинта нет, отмечаем позиции по одной.
  async function handleOrderDone(orderId) {
    try {
      await kitchen.orderReady(orderId)
    } catch {
      const order = orders.find((o) => o.id === orderId)
      const pending = (order?.items ?? []).filter((i) => i.status !== 'ready' && i.status !== 'done')
      try {
        for (const it of pending) await kitchen.itemDone(it.id)
      } catch { loadOrders(); return }
    }
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    soundService.stopOverdueAlert(orderId)
    soundService.play('orderCompleted')
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    soundService.enabled = next
    if (!next) soundService.stopAllAlerts()
  }

  function getTimerState(createdAt) {
    const elapsed = now - parseTs(createdAt)
    if (elapsed < TIMER_GREEN) return 'green'
    if (elapsed < TIMER_YELLOW) return 'yellow'
    return 'red'
  }
  function formatElapsed(createdAt) {
    const elapsed = Math.max(0, Math.floor((now - parseTs(createdAt)) / 1000))
    const min = Math.floor(elapsed / 60)
    const sec = elapsed % 60
    return `${min}:${sec.toString().padStart(2, '0')}`
  }

  function matchFilter(o, f) {
    if (f === 'new') return o.status === 'new' || o.status === 'pending'
    if (f === 'cooking') return o.status === 'cooking' || o.status === 'in_progress'
    if (f === 'ready') return o.status === 'ready'
    return true
  }
  const filteredOrders = filter === 'all' ? orders : orders.filter((o) => matchFilter(o, filter))
  const inWork = orders.filter((o) => o.status === 'cooking' || o.status === 'in_progress').length

  return (
    <div className="floor">
      <aside className="ws-side">
        <button className="zone zone--exit" onClick={onBack}>
          <LogOut size={20} />
          <span className="zone__name">{t('logout')}</span>
        </button>
        <div className="ws-side__label">{t('queue')}</div>
        <nav className="ws-side__nav">
          {FILTERS.map(({ id, label, Icon }) => {
            const count = id === 'all' ? orders.length : orders.filter((o) => matchFilter(o, id)).length
            return (
              <button key={id} className={`zone ${filter === id ? 'zone--active' : ''}`} onClick={() => setFilter(id)}>
                <Icon size={20} />
                <span className="zone__name">{label}</span>
                <span className="zone__count">{count}</span>
              </button>
            )
          })}
        </nav>
        <div className="ws-side__spacer" />
        <button className="zone" onClick={() => setStopOpen(true)}>
          <Ban size={20} />
          <span className="zone__name">{t('stoplist')}</span>
        </button>
      </aside>

      <main className="ws__main">
        <div className="board__head">
          <div className="board__title">
            <h2>{t('mode_kitchen')}</h2>
            <span className="board__subtitle">{orders.length} {t('orders_low')} · {inWork} {t('in_work')}</span>
          </div>
          <div className="board__head-right">
            <button className={`btn btn--outline btn--sm ${soundOn ? '' : 'is-muted'}`} onClick={toggleSound}>
              {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
              {soundOn ? t('sound_on') : t('sound_off')}
            </button>
          </div>
        </div>

        <div className="board__scroll">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('loading_orders')}</p></div>
          ) : filteredOrders.length === 0 ? (
            <div className="kitchen-empty">
              <CheckCircle size={64} strokeWidth={1} />
              <p>{t('no_orders')}</p>
              <span className="kitchen-empty__hint">{t('new_orders_auto')}</span>
            </div>
          ) : (
            <div className="kitchen-grid">
              {filteredOrders.map((order) => (
                <KitchenCard
                  key={order.id}
                  order={order}
                  timerState={getTimerState(order.created_at)}
                  elapsed={formatElapsed(order.created_at)}
                  onItemDone={handleItemDone}
                  onOrderDone={handleOrderDone}
                  onShowRecipe={setRecipeProd}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {stopOpen && <StopListPanel onClose={() => setStopOpen(false)} />}
      {recipeProd && <RecipeModal product={recipeProd} onClose={() => setRecipeProd(null)} />}
    </div>
  )
}

function orderTypeIcon(type) {
  if (type === 'takeaway') return <ShoppingBag size={15} strokeWidth={2} />
  if (type === 'delivery') return <Bike size={15} strokeWidth={2} />
  return <Utensils size={15} strokeWidth={2} />
}

function KitchenCard({ order, timerState, elapsed, onItemDone, onOrderDone, onShowRecipe }) {
  const items = order.items ?? []
  const doneCount = items.filter((i) => i.status === 'ready' || i.status === 'done').length
  const allDone = items.length > 0 && doneCount === items.length

  return (
    <div className={`kitchen-card timer-${timerState}`}>
      <div className="kitchen-card__header">
        <div className="kitchen-card__info">
          <span className="kitchen-card__number">#{order.order_number || order.id}</span>
          {order.table_number && <span className="kitchen-card__table">{t('table')} {order.table_number}</span>}
          {order.order_type && <span className="kitchen-card__type">{orderTypeIcon(order.order_type)}</span>}
        </div>
        <div className="kitchen-card__timer">
          <Clock size={14} />
          <span>{elapsed}</span>
        </div>
      </div>

      {order.note && (
        <div className="kitchen-card__note"><AlertTriangle size={14} /><span>{order.note}</span></div>
      )}

      <div className="kitchen-card__progress">
        <div className="kitchen-card__progress-bar" style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }} />
      </div>

      <ul className="kitchen-card__items">
        {items.map((item) => {
          const done = item.status === 'ready' || item.status === 'done'
          return (
            <li key={item.id} className={`kitchen-item ${done ? 'kitchen-item--done' : ''}`}>
              <span className="kitchen-item__qty">{item.quantity}×</span>
              <div className="kitchen-item__body">
                <span className="kitchen-item__name">{item.name || item.product_name}</span>
                {item.note && <span className="kitchen-item__note">{item.note}</span>}
              </div>
              {item.product_id && (
                <button
                  className="kitchen-item__recipe"
                  onClick={() => onShowRecipe({ id: item.product_id, name: item.name || item.product_name })}
                  title={t('tech_card')}
                >
                  <ChefHat size={18} />
                </button>
              )}
              {!done ? (
                <button className="kitchen-item__done-btn" onClick={() => onItemDone(item.id)} title={t('done')}>
                  <Check size={24} strokeWidth={3} />
                </button>
              ) : (
                <CheckCircle size={22} className="kitchen-item__check" />
              )}
            </li>
          )
        })}
      </ul>

      {allDone && (
        <button className="kitchen-card__complete" onClick={() => onOrderDone(order.id)}>
          <CheckCircle size={20} />
          {t('order_ready_give')}
        </button>
      )}
    </div>
  )
}
