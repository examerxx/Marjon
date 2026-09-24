import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Minus, Search, X, Users, Clock, CheckCircle, Coffee, Utensils,
  LayoutGrid, Armchair, DoorClosed, Sun, Wine, CalendarClock, RefreshCw, ArrowLeft, Printer,
  Trash2, Ban, Shuffle, ShoppingBag,
} from 'lucide-react'
import { orders, menu, halls as hallsApi, printers as printersApi, auth } from '../../shared/api'
import { onPrintJob } from '../../shared/ws'
import DishModal from '../../components/DishModal'
import InputPromptModal from '../../components/InputPromptModal'
import { toast } from '../../components/Toast'
import { t } from '../../shared/i18n'
import { can, must } from '../../shared/permissions'
import { formatQty } from '../../shared/qty'

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
  const [promptCfg, setPromptCfg] = useState(null)         // модалка ввода (номер стола при переносе блюда)

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
      } catch (err) { console.error('[print]', err); toast(t('print_failed'), 'error') }
    })
  }, [printerMap])

  // Опасные действия официанта (перенос/удаление блюда, смена стола, отмена
  // заказа) разрешены ТОЛЬКО при праве can_manage_orders из админки И
  // подтверждаются отдельным PIN. verifyPin логинит по PIN и проверяет право
  // у введённого сотрудника, не меняя текущую сессию. При успехе — запускаем
  // само действие (оно откроет свою модалку поверх этой).
  function requirePin(action) {
    setPromptCfg({
      title: t('confirm_pin'),
      hint: t('enter_pin'),
      type: 'password',
      submitLabel: t('pin_confirm'),
      onSubmit: async (pin) => {
        const u = await auth.verifyPin(pin)
        if (!must(u, 'can_manage_orders')) throw new Error(t('no_permission'))
        action()
      },
    })
  }

  // Перекинуть позицию на другой стол. window.prompt в Electron не работает —
  // номер спрашиваем в своей модалке (как в кассе).
  function moveItemToTable(order, item) {
    setPromptCfg({
      title: t('move_to_table'),
      hint: t('move_to_table'),
      options: allTables.map((table) => ({
        value: String(table.number),
        label: `${t('table')} ${table.number}`,
      })),
      submitLabel: t('save'),
      onSubmit: async (num) => {
        await orders.moveItem(order.id, item.id, String(num).trim())
        setPromptCfg(null); setView('floor'); loadData()
      },
    })
  }
  // Удаление позиции из заказа официантом (если есть право). Причина обязательна —
  // журналируется на бэкенде (аудит удалений/переносов).
  function removeDishItem(order, item) {
    setPromptCfg({
      title: t('delete_dish'),
      hint: t('delete_reason'),
      placeholder: t('delete_reason_ph'),
      submitLabel: t('delete_dish'),
      onSubmit: async (reason) => {
        await orders.removeItem(order.id, item.id, reason)
        setPromptCfg(null)
        // Обновляем открытый заказ свежими данными; если он опустел и закрылся — к столам
        try {
          const fresh = await orders.get(order.id)
          setSelectedTable((prev) => (prev ? { ...prev, order: fresh } : prev))
        } catch { setView('floor') }
        loadData()
      },
    })
  }
  // Отмена всего заказа официантом (если есть право). Причина обязательна.
  function cancelWholeOrder(order) {
    setPromptCfg({
      title: t('cancel_order'),
      hint: t('cancel_comment'),
      placeholder: t('cancel_comment_ph'),
      submitLabel: t('cancel_order'),
      onSubmit: async (reason) => {
        await orders.cancel(order.id, undefined, reason)
        setPromptCfg(null); setView('floor'); loadData()
      },
    })
  }
  // Передать ВЕСЬ заказ на другой стол (не отдельное блюдо) — 3.1: смена стола заказа.
  function reassignTable(order) {
    setPromptCfg({
      title: t('move_table'),
      hint: t('move_to_table'),
      options: allTables.map((table) => ({
        value: String(table.number),
        label: `${t('table')} ${table.number}`,
      })),
      initial: order.table_number || '',
      extra: { label: t('move_reason'), placeholder: t('move_reason_ph') },
      submitLabel: t('save'),
      onSubmit: async (num, reason) => {
        await orders.update(order.id, { table_number: String(num).trim(), reason: reason || undefined })
        setPromptCfg(null); setView('floor'); loadData()
      },
    })
  }
  // Печать чека клиента (официант печатает сам)
  async function printReceipt(order) {
    if (!order?.id) return
    const pr = Object.values(printerMap).find((p) => p.printer_type === 'receipt' && p.branch_id === user.branch_id)
    if (!pr) { toast(t('no_receipt_printer'), 'error'); return }
    try { await printersApi.printReceipt({ order_id: order.id, printer_id: pr.id, copies: 1 }); toast(t('receipt_sent')) }
    catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : ''), 'error') }
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
  // Считаем ТОЛЬКО по видимой вкладке (иначе «Кабина» показывала занятость всех зон).
  const shownTables = activeZone === 'all' ? allTables : allTables.filter((tb) => tb.zoneId === activeZone)
  const shownCount = shownTables.length
  const busyCount = shownTables.filter((tb) => tableStatus(tb.number) !== 'free').length
  // Разбивка для легенды (сумма = shownCount): свободно / занято / готово.
  const cFree = shownTables.filter((tb) => tableStatus(tb.number) === 'free').length
  const cReady = shownTables.filter((tb) => tableStatus(tb.number) === 'ready').length
  const cBusy = shownCount - cFree - cReady

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
  function saveEdit({ quantity, price, note, takeaway, modifiers }) {
    setCart((prev) => prev.map((i) => i.lineId === editLine.lineId ? { ...i, qty: quantity, price, note, takeaway, modifiers: modifiers || [] } : i))
    setEditLine(null)
  }
  function updateQty(lineId, d) {
    setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, qty: i.qty + d } : i).filter((i) => i.qty > 0))
  }
  function removeLine(lineId) { setCart((prev) => prev.filter((i) => i.lineId !== lineId)) }
  // «С собой» переключается прямо в строке корзины (не заходя в модалку блюда)
  function toggleTakeaway(lineId) {
    setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, takeaway: !i.takeaway } : i))
  }
  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * i.qty, 0)
  const itemCount = cart.reduce((s, i) => s + i.qty, 0)

  async function submitOrder() {
    if (!cart.length) return
    setSubmitting(true)
    try {
      if (addToOrderId) {
        // Дополняем существующий заказ (старые блюда сохраняются)
        for (const i of cart) {
          await orders.addItem(addToOrderId, { product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: !!i.takeaway, modifiers: i.modifiers || [] })
        }
        // Авто-статус: заказ снова «готовится»
        try { await orders.updateStatus(addToOrderId, 'cooking') } catch { /* офлайн-очередь */ }
      } else {
        await orders.create({
          branch_id: user.branch_id,
          order_type: 'dine_in',
          table_number: selectedTable?.number != null ? String(selectedTable.number) : null,
          persons_count: guests,
          note: orderNote || null,
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: !!i.takeaway, modifiers: i.modifiers || [] })),
        })
      }
      setAddToOrderId(null)
      setView('floor'); loadData()
    } catch (err) {
      toast(err?.response?.data?.detail || t('create_order_error'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ═══ Вид: новый заказ (меню + корзина) — светлый, идентичен экрану кассира ═══
  if (view === 'new') {
    return (
      <div className="floor">
        <aside className="ws-side">
          <button className="zone zone--exit" onClick={() => setView('floor')}>
            <ArrowLeft size={20} />
            <span className="zone__name">{t('to_tables')}</span>
          </button>
          <div className="ws-side__label">{t('categories')}</div>
          <nav className="ws-side__nav">
            <button className={`zone ${!activeCat ? 'zone--active' : ''}`} onClick={() => setActiveCat(null)}>
              <LayoutGrid size={20} /><span className="zone__name">{t('all')}</span>
            </button>
            {categories.map((c) => (
              <button key={c.id} className={`zone ${activeCat === c.id ? 'zone--active' : ''}`} onClick={() => setActiveCat(c.id)}>
                <span className="zone__name">{c.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="ws__main">
          <div className="board__head">
            <div className="board__title">
              <h2>{selectedTable ? `${t('table')} ${selectedTable.number}` : t('new_order')}</h2>
              <span className="board__subtitle">{itemCount} {t('items_low')} · {cartTotal.toLocaleString('ru-RU')} {t('currency')}</span>
            </div>
            <div className="board__head-right">
              <div className="cashier-products__search">
                <Search size={18} className="search-icon" />
                <input className="search-input" placeholder={t('search_dish')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="cashier-work">
            <div className="cashier-products">
              <div className="cashier-products__grid">
                {filteredProducts.length === 0 ? <p className="empty-text">{t('no_dishes')}</p> : filteredProducts.map((p) => {
                  const stopped = p.is_available === false || p.in_stop_list
                  return (
                    <button key={p.id} className={`product-card ${stopped ? 'product-card--stop' : ''}`} onClick={() => addToCart(p)}>
                      <span className="product-card__thumb">
                        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <Utensils size={26} />}
                      </span>
                      <span className="product-card__name">{p.name}</span>
                      <span className="product-card__price">{Number(p.price || 0).toLocaleString('ru-RU')} {t('currency')}</span>
                      {stopped && <span className="product-card__stop">STOP</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            <aside className="cashier-cart">
              <div className="cashier-cart__header"><ShoppingBag size={20} /><span>{t('order')}</span><span className="cart-count">{itemCount}</span></div>
              <div className="cashier-cart__items">
                {cart.length === 0 ? <p className="cart-empty">{t('tap_dish_hint')}</p> : cart.map((item) => (
                  <div key={item.lineId} className="cart-item">
                    <button type="button" className="cart-item__info" onClick={() => setEditLine(item)} title={t('edit')}>
                      <span className="cart-item__name">{item.product?.name}</span>
                      {item.note && <span className="cart-row__note">{item.note}</span>}
                      <span className="cart-item__price">{(Number(item.price || 0) * item.qty).toLocaleString('ru-RU')} {t('currency')}</span>
                    </button>
                    {/* «С собой» — тумблер рядом с названием и ценой; за столом
                        по праву can_takeaway_at_table (веб-админка) */}
                    {can(user, 'can_takeaway_at_table') && (
                      <button
                        type="button"
                        className={`cart-take ${item.takeaway ? 'cart-take--on' : ''}`}
                        onClick={() => toggleTakeaway(item.lineId)}
                        title={t('takeaway')}
                        aria-pressed={item.takeaway ? 'true' : 'false'}
                      >
                        <span className="cart-take__label">{t('takeaway')}</span>
                        <span className={`toggle ${item.takeaway ? 'toggle--on' : ''}`}><span className="toggle__dot" /></span>
                      </button>
                    )}
                    <div className="cart-item__controls">
                      <button className="qty-btn" onClick={() => updateQty(item.lineId, -1)}><Minus size={16} /></button>
                      <span className="qty-value">{item.qty}</span>
                      <button className="qty-btn" onClick={() => updateQty(item.lineId, 1)}><Plus size={16} /></button>
                      {can(user, 'can_delete_dishes') && <button className="qty-btn qty-btn--delete" onClick={() => removeLine(item.lineId)}><Trash2 size={16} /></button>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="cashier-cart__guests">
                <label>{t('guests')}</label>
                <input type="number" min="1" max="50" value={guests} onChange={(e) => setGuests(Number(e.target.value) || 1)} />
              </div>
              {cart.length > 0 && (
                <input className="cashier-cart__note" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder={t('comment')} />
              )}
              <div className="cashier-cart__total">
                <div className="total-row total-row--final"><span>{t('total')}</span><span>{cartTotal.toLocaleString('ru-RU')} {t('currency')}</span></div>
              </div>
              <div className="cashier-cart__actions">
                <button className="cart-btn cart-btn--pay" disabled={cart.length === 0 || submitting} onClick={submitOrder}>
                  {submitting ? <span className="btn-spinner" aria-hidden="true" /> : <Plus size={20} />} {addToOrderId ? t('add_dishes') : t('to_kitchen')}
                </button>
              </div>
            </aside>
          </div>
        </main>

        {editLine && (
          <DishModal
            product={editLine.product}
            line={editLine}
            onSubmit={saveEdit}
            onClose={() => setEditLine(null)}
            hideTakeaway={!can(user, 'can_takeaway_at_table')}
          />
        )}
        {promptCfg && <InputPromptModal {...promptCfg} onClose={() => setPromptCfg(null)} />}
      </div>
    )
  }

  return (
    <div className="floor">
      {/* Сайдбар локаций */}
      <aside className="ws-side">
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
                  <span className="legend__item" title={t('free')}><span className="legend__swatch legend__swatch--free" /> {cFree}</span>
                  <span className="legend__item" title={t('busy')}><span className="legend__swatch legend__swatch--busy" /> {cBusy}</span>
                  <span className="legend__item" title={t('ready')}><span className="legend__swatch legend__swatch--check" /> {cReady}</span>
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
                    <span className="detail-item__qty">×{formatQty(item.quantity)}</span>
                    <div className="detail-item__body">
                      <span className="detail-item__name">{item.name || item.product_name}{item.takeaway ? <span className="cart-tag">{t('takeaway')}</span> : null}</span>
                      {/* Цена, кто добавил и во сколько (кто/время — если бэкенд их отдаёт) */}
                      <span className="detail-item__sub">
                        {Number(item.total ?? (Number(item.price) * Number(item.quantity))).toLocaleString('ru-RU')} {t('currency')}
                        {(item.waiter_name || item.added_by_name) && <> · {item.waiter_name || item.added_by_name}</>}
                        {item.created_at && <> · {formatTime(item.created_at)}</>}
                      </span>
                    </div>
                    {must(user, 'can_manage_orders') && (
                      <button type="button" className="detail-item__move" onClick={() => requirePin(() => moveItemToTable(selectedTable.order, item))}>
                        <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} />
                        <span>{t('move_item')}</span>
                      </button>
                    )}
                    {must(user, 'can_manage_orders') && (
                      <button type="button" className="detail-item__delete" onClick={() => requirePin(() => removeDishItem(selectedTable.order, item))} title={t('delete_dish')}>
                        <Trash2 size={16} />
                      </button>
                    )}
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
                {must(user, 'can_manage_orders') && (
                  <button className="btn-ghost btn--lg" onClick={() => requirePin(() => reassignTable(selectedTable.order))}>
                    <Shuffle size={18} /> {t('move_table')}
                  </button>
                )}
                {must(user, 'can_manage_orders') && (
                  <button className="btn-danger btn--lg" onClick={() => requirePin(() => cancelWholeOrder(selectedTable.order))}>
                    <Ban size={18} /> {t('cancel_order')}
                  </button>
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
          onClose={() => setEditLine(null)}
          hideTakeaway={!can(user, 'can_takeaway_at_table')}
        />
      )}
      {promptCfg && <InputPromptModal {...promptCfg} onClose={() => setPromptCfg(null)} />}
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
