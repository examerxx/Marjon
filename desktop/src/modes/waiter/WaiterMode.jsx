import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Minus, Search, X, Users, Clock, CheckCircle, Coffee, Utensils,
  LayoutGrid, Armchair, DoorClosed, Sun, Wine, CalendarClock, RefreshCw, ArrowLeft, LogOut, Printer,
} from 'lucide-react'
import { orders, menu, halls as hallsApi, printers as printersApi } from '../../shared/api'
import { onPrintJob } from '../../shared/ws'
import DishModal from '../../components/DishModal'
import { t } from '../../shared/i18n'

const STATUS_COLORS = {
  new: 'var(--color-info)', accepted: 'var(--color-brand)',
  cooking: 'var(--color-warning)', ready: 'var(--color-success)',
}
const ACTIVE_STATUSES = new Set(['new', 'accepted', 'cooking', 'ready', 'pending'])


function zoneIcon(name = '') {
  const n = name.toLowerCase()
  if (n.includes('террас')) return Sun
  if (n.includes('бар')) return Wine
  if (n.includes('кабин')) return DoorClosed
  if (n.includes('бронь') || n.includes('бран')) return CalendarClock
  return Armchair
}
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || 'U'
}
function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function WaiterMode({ user = {}, branch = {}, onBack, onLogout }) {
  const [zones, setZones] = useState([])          // [{id,name,tables:[...]}]
  const [orderList, setOrderList] = useState([])
  const [activeZone, setActiveZone] = useState('all')
  const [loading, setLoading] = useState(true)

  const [view, setView] = useState('floor')        // floor | detail | new
  const [selectedTable, setSelectedTable] = useState(null)

  // Создание заказа
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [orderNote, setOrderNote] = useState('')
  const [guests, setGuests] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [editLine, setEditLine] = useState(null)
  const [printerMap, setPrinterMap] = useState({})
  const [addToOrderId, setAddToOrderId] = useState(null)   // id заказа, в который ДОБАВЛЯЕМ блюда

  const loadData = useCallback(() => {
    hallsApi.list(user.branch_id)
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.items || []
        setZones(list.length ? list : demoZones())
      })
      .catch(() => setZones(demoZones()))

    orders.list({ branch_id: user.branch_id })
      .then((data) => {
        const all = Array.isArray(data) ? data : data?.items || []
        setOrderList(all.filter((o) => ACTIVE_STATUSES.has(o.status)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.branch_id])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 20000)
    return () => clearInterval(id)
  }, [loadData])

  useEffect(() => {
    if (view !== 'new') return
    menu.products().then((d) => setProducts(Array.isArray(d) ? d : d?.items || [])).catch(() => {})
    menu.categories().then((d) => setCategories(Array.isArray(d) ? d : d?.items || [])).catch(() => {})
  }, [view])

  // Принтеры филиала + обработчик заданий печати (терминал официанта тоже может печатать)
  useEffect(() => {
    printersApi.list().then((pl) => {
      const map = {}; (pl.items ?? pl ?? []).forEach((p) => { map[p.id] = p }); setPrinterMap(map)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    return onPrintJob(async (msg) => {
      if (msg.event !== 'print_job') return
      const printer = printerMap[msg.printer_id]
      if (!printer) return
      try {
        await window.electron?.print({ ip: printer.ip_address, port: printer.port ?? 9100, payloadBase64: msg.payload, copies: msg.copies ?? 1 })
        await printersApi.jobDone(msg.job_id)
      } catch (err) { console.error('[print]', err) }
    })
  }, [printerMap])

  // Перекинуть позицию на другой стол
  async function moveItemToTable(order, item) {
    const num = window.prompt(t('move_to_table'))
    if (num === null || String(num).trim() === '') return
    try { await orders.moveItem(order.id, item.id, String(num).trim()); setView('floor'); loadData() }
    catch (e) { alert(e?.response?.data?.detail || e.message) }
  }
  // Печать чека клиента (официант печатает сам)
  async function printReceipt(order) {
    if (!order?.id) return
    const pr = Object.values(printerMap).find((p) => p.printer_type === 'receipt' && p.branch_id === user.branch_id)
    if (!pr) { alert(t('no_receipt_printer')); return }
    try { await printersApi.printReceipt({ order_id: order.id, printer_id: pr.id, copies: 1 }) }
    catch (e) { alert(e?.response?.data?.detail || e.message) }
  }

  // ── Данные столов ──
  const allTables = zones.flatMap((z) =>
    (z.tables || []).map((t) => ({ ...t, zoneId: z.id, zoneName: z.name }))
  )
  function orderFor(number) {
    return orderList.find((o) => String(o.table_number) === String(number))
  }
  function tableStatus(number) {
    const o = orderFor(number)
    if (!o) return 'free'
    if (o.receipt_printed_at) return 'await'
    return o.status === 'ready' ? 'ready' : 'busy'
  }

  const freeCount = (list) => list.filter((t) => tableStatus(t.number) === 'free').length
  const zoneNav = [
    { id: 'all', name: t('all'), count: freeCount(allTables), Icon: LayoutGrid },
    ...zones.map((z) => ({ id: z.id, name: z.name, count: freeCount(z.tables || []), Icon: zoneIcon(z.name) })),
  ]
  const shownZones = activeZone === 'all' ? zones : zones.filter((z) => z.id === activeZone)
  const busyCount = allTables.filter((t) => tableStatus(t.number) !== 'free').length
  const shownCount = (activeZone === 'all' ? allTables : allTables.filter((t) => t.zoneId === activeZone)).length

  function handleTableTap(table) {
    const o = orderFor(table.number)
    if (o) {
      setSelectedTable({ ...table, order: o })
      setView('detail')
    } else {
      openNewOrder(table)
    }
  }
  function openNewOrder(table) {
    setSelectedTable(table)
    // Если у стола уже есть заказ — ДОБАВЛЯЕМ в него (а не создаём новый)
    setAddToOrderId(table?.order?.id || null)
    setCart([]); setOrderNote(''); setGuests(1); setSearch(''); setActiveCat(null)
    setView('new')
  }

  // ── Каталог/корзина ──
  const filteredProducts = products.filter((p) => {
    if (p.is_active === false) return false
    if (activeCat && p.category_id !== activeCat) return false
    if (search && !(p.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  function addToCart(product) {
    if (product.is_available === false || product.in_stop_list) return // в стоп-листе
    setCart((prev) => [...prev, { lineId: `${Date.now()}-${Math.random()}`, product, qty: 1, price: Number(product.price) || 0, note: '' }])
  }
  function saveEdit({ quantity, price, note, takeaway }) {
    setCart((prev) => prev.map((i) => i.lineId === editLine.lineId ? { ...i, qty: quantity, price, note, takeaway } : i))
    setEditLine(null)
  }
  function updateQty(lineId, d) {
    setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, qty: i.qty + d } : i).filter((i) => i.qty > 0))
  }
  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * i.qty, 0)

  async function submitOrder() {
    if (!cart.length) return
    setSubmitting(true)
    try {
      if (addToOrderId) {
        // Дополняем существующий заказ (старые блюда сохраняются)
        for (const i of cart) {
          await orders.addItem(addToOrderId, { product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: !!i.takeaway })
        }
        // Авто-статус: заказ снова «готовится»
        try { await orders.updateStatus(addToOrderId, 'cooking') } catch { /* офлайн-очередь */ }
      } else {
        await orders.create({
          branch_id: user.branch_id,
          order_type: 'dine_in',
          table_number: selectedTable?.number != null ? String(selectedTable.number) : null,
          guests_count: guests,
          note: orderNote || null,
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.qty, price: i.price, note: i.note || null, takeaway: !!i.takeaway })),
        })
      }
      setAddToOrderId(null)
      setView('floor'); loadData()
    } catch (err) {
      alert(err?.response?.data?.detail || t('create_order_error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="floor">
      {/* Сайдбар локаций */}
      <aside className="ws-side">
        <button className="zone zone--exit" onClick={onBack}>
          <LogOut size={20} />
          <span className="zone__name">{t('logout')}</span>
        </button>
        <div className="ws-side__label">{t('locations')}</div>
        <nav className="ws-side__nav">
          {zoneNav.map(({ id, name, count, Icon }) => (
            <button
              key={id}
              className={`zone ${activeZone === id ? 'zone--active' : ''}`}
              onClick={() => { setActiveZone(id); setView('floor') }}
            >
              <Icon size={20} />
              <span className="zone__name">{name}</span>
              <span className="zone__count">{count}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Основная область */}
      <main className="ws__main">
        {view === 'floor' && (
          <>
            <div className="board__head">
              <div className="board__title">
                <h2>{activeZone === 'all' ? t('all_tables') : (zones.find((z) => z.id === activeZone)?.name || t('hall'))}</h2>
                <span className="board__subtitle">{shownCount} {t('tables_low')} · {busyCount} {t('busy_low')}</span>
              </div>
              <div className="board__head-right">
                <div className="legend">
                  <span className="legend__item"><span className="legend__swatch legend__swatch--free" /> {t('free')}</span>
                  <span className="legend__item"><span className="legend__swatch legend__swatch--busy" /> {t('busy')}</span>
                  <span className="legend__item"><span className="legend__swatch legend__swatch--check" /> {t('ready')}</span>
                </div>
                <button className="btn btn--primary btn--sm" onClick={() => openNewOrder(null)}>
                  <Plus size={18} /> {t('new_order')}
                </button>
              </div>
            </div>

            <div className="board__scroll">
              {loading ? (
                <p className="empty-text">{t('loading')}</p>
              ) : shownZones.length === 0 ? (
                <p className="empty-text">{t('no_halls')}</p>
              ) : shownZones.map((z) => (
                <section className="tgroup" key={z.id}>
                  <div className="tgroup__title">{z.name} <span>{(z.tables || []).length} {t('tables_low')}</span></div>
                  <div className="tgrid">
                    {(z.tables || []).map((tb) => {
                      const o = orderFor(tb.number)
                      const st = tableStatus(tb.number)
                      const variant = st === 'free' ? 'free' : st === 'ready' ? 'check' : st === 'await' ? 'pay' : 'busy'
                      return (
                        <button key={tb.id ?? tb.number} className={`tcard tcard--${variant}`} onClick={() => handleTableTap(tb)}>
                          <div className="tcard__top">
                            <span className="tcard__num">{tb.number}</span>
                            <span className="tcard__seats"><Users /> {tb.capacity || tb.seats || 4}</span>
                          </div>
                          {o ? (
                            <>
                              <span className="tcard__client">{t('order_no')} #{o.order_number ?? ''}</span>
                              <span className="tcard__meta">
                                <Clock /> {formatTime(o.created_at)}
                                {o.total_amount != null && (
                                  <span className="tcard__amount">{Number(o.total_amount).toLocaleString('ru-RU')} {t('currency')}</span>
                                )}
                              </span>
                            </>
                          ) : (
                            <div className="tcard__spacer" />
                          )}
                          <span className="tcard__status">{t(st)}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {view === 'detail' && selectedTable && (
          <div className="waiter-detail">
            <header className="waiter-detail__header">
              <button className="btn-ghost btn--lg" onClick={() => setView('floor')}><ArrowLeft size={22} /> {t('back')}</button>
              <h2>{t('table')} {selectedTable.number}</h2>
              <span className="status-badge" style={{ background: STATUS_COLORS[selectedTable.order?.status] || 'var(--color-text-muted)' }}>
                {selectedTable.order?.status ? t.status(selectedTable.order.status) : ''}
              </span>
            </header>
            <div className="waiter-detail__order">
              <div className="waiter-detail__meta">
                <span>{t('order_no')} #{selectedTable.order?.order_number}</span>
                <span><Clock size={14} /> {formatTime(selectedTable.order?.created_at)}</span>
                <span>{Number(selectedTable.order?.total_amount || 0).toLocaleString('ru-RU')} {t('currency')}</span>
              </div>
              <ul className="waiter-detail__items">
                {(selectedTable.order?.items ?? []).map((item) => (
                  <li key={item.id} className={`detail-item detail-item--${item.status || 'new'}`}>
                    <span className="detail-item__qty">×{item.quantity}</span>
                    <span className="detail-item__name">{item.name || item.product_name}{item.takeaway ? <span className="cart-tag">{t('takeaway')}</span> : null}</span>
                    <button type="button" className="detail-item__move" title={t('move_to_table')} onClick={() => moveItemToTable(selectedTable.order, item)}>
                      <ArrowLeft size={15} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <span className="detail-item__status">
                      {item.status === 'ready' && <CheckCircle size={16} />}
                      {item.status === 'cooking' && <Coffee size={16} />}
                      {item.status ? t.status(item.status) : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="waiter-detail__actions">
                <button className="btn-primary btn--lg" onClick={() => openNewOrder(selectedTable)}>
                  <Plus size={18} /> {t('add_dishes')}
                </button>
                <button className="btn-success btn--lg" onClick={() => printReceipt(selectedTable.order)}>
                  <Printer size={18} /> {t('print_receipt')}
                </button>
              </div>
            </div>
          </div>
        )}

        {view === 'new' && (
          <div className="waiter-new-order">
            <header className="waiter-new-order__header">
              <button className="btn-ghost" onClick={() => setView('floor')}><X size={20} /></button>
              <h2>{selectedTable ? `${t('table')} ${selectedTable.number}` : t('no_table')}{' · ' + t('new_order')}</h2>
            </header>
            <div className="waiter-new-order__body">
              <div className="waiter-catalog">
                <div className="waiter-catalog__search">
                  <Search size={18} />
                  <input placeholder={t('search_dish')} value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search && <button className="btn-icon-sm" onClick={() => setSearch('')}><X size={16} /></button>}
                </div>
                <div className="waiter-catalog__cats">
                  <button className={`cat-btn ${!activeCat ? 'cat-btn--active' : ''}`} onClick={() => setActiveCat(null)}>{t('all')}</button>
                  {categories.map((c) => (
                    <button key={c.id} className={`cat-btn ${activeCat === c.id ? 'cat-btn--active' : ''}`} onClick={() => setActiveCat(c.id)}>{c.name}</button>
                  ))}
                </div>
                <div className="waiter-catalog__grid">
                  {filteredProducts.length === 0 ? (
                    <p className="empty-text">{t('no_dishes')}</p>
                  ) : filteredProducts.map((p) => (
                    <button key={p.id} className="product-tile" onClick={() => addToCart(p)}>
                      <Utensils size={20} />
                      <span className="product-tile__name">{p.name}</span>
                      <span className="product-tile__price">{Number(p.price || 0).toLocaleString('ru-RU')} {t('currency')}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="waiter-cart">
                <div className="waiter-cart__meta">
                  <label>{t('guests')}:
                    <input type="number" min="1" max="20" value={guests} onChange={(e) => setGuests(Number(e.target.value) || 1)} />
                  </label>
                  <input className="waiter-cart__note" placeholder={t('order_comment')} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
                </div>
                <div className="waiter-cart__items">
                  {cart.length === 0 ? (
                    <p className="empty-text">{t('add_dishes_empty')}</p>
                  ) : cart.map((item) => (
                    <div key={item.lineId} className="cart-row">
                      <button type="button" className="cart-row__info" onClick={() => setEditLine(item)} title={t('edit')}>
                        <span className="cart-row__name">{item.product.name}{item.takeaway && <span className="cart-tag">{t('takeaway')}</span>}</span>
                        {item.note && <span className="cart-row__note">{item.note}</span>}
                      </button>
                      <div className="cart-row__qty">
                        <button onClick={() => updateQty(item.lineId, -1)}><Minus size={16} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.lineId, 1)}><Plus size={16} /></button>
                      </div>
                      <span className="cart-row__sum">{(Number(item.price || 0) * item.qty).toLocaleString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
                {cart.length > 0 && (
                  <div className="waiter-cart__footer">
                    <div className="waiter-cart__total">{t('total')}: <strong>{cartTotal.toLocaleString('ru-RU')} {t('currency')}</strong></div>
                    <button className="btn-primary btn--xl" onClick={submitOrder} disabled={submitting}>
                      {submitting ? t('sending') : t('to_kitchen')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {editLine && (
        <DishModal
          product={editLine.product}
          line={editLine}
          onSubmit={saveEdit}
          onRemove={() => { updateQty(editLine.lineId, -editLine.qty); setEditLine(null) }}
          onClose={() => setEditLine(null)}
        />
      )}
    </div>
  )
}

function demoZones() {
  const mk = (n, seats, num) => ({ id: `d${num}`, number: num, capacity: seats })
  return [
    { id: 'z-hall', name: 'Зал', tables: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, 4, n)) },
    { id: 'z-terrace', name: 'Терраса', tables: [9, 10, 11, 12].map((n) => mk(n, 4, n)) },
    { id: 'z-cabin', name: 'Кабина', tables: [13, 14].map((n) => mk(n, 6, n)) },
  ]
}
