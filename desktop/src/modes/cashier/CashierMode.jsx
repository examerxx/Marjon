import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Plus, Minus, Trash2, Utensils,
  LayoutGrid, Armchair, DoorClosed, Sun, Wine, CalendarClock, ArrowLeft, Users, Clock, Wallet, History, BarChart3, Ban, ShoppingBag, Bike, Boxes, Printer,
} from 'lucide-react'
import { orders, menu, halls as hallsApi, printers as printersApi, customers as customersApi, auth as authApi, finance as financeApi } from '../../shared/api'
import { onPrintJob } from '../../shared/ws'
import DishModal from '../../components/DishModal'
import FinancePanel from '../../components/FinancePanel'
import HistoryPanel from '../../components/HistoryPanel'
import ReportsPanel from '../../components/ReportsPanel'
import StopListPanel from '../../components/StopListPanel'
import AttendancePanel from '../../components/AttendancePanel'
import StaffManagerPanel from '../../components/StaffManagerPanel'
import WarehouseWritePanel from '../../components/WarehouseWritePanel'
import BatchPrintPanel from '../../components/BatchPrintPanel'
import PaymentModal from '../../components/PaymentModal'
import InputPromptModal from '../../components/InputPromptModal'
import HeaderMenu from '../../components/HeaderMenu'
import { t } from '../../shared/i18n'
import { can, must } from '../../shared/permissions'
import { toast } from '../../components/Toast'
import { formatPhone, extractPhoneDigits, fullPhone } from '../../shared/phone'

const ACTIVE = new Set(['new', 'accepted', 'cooking', 'ready', 'pending'])

function zoneIcon(name = '') {
  const n = name.toLowerCase()
  if (n.includes('террас')) return Sun
  if (n.includes('бар')) return Wine
  if (n.includes('кабин')) return DoorClosed
  if (n.includes('бронь')) return CalendarClock
  return Armchair
}
function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }

export default function CashierMode({ user = {}, onBack, courier = false }) {
  const [zones, setZones] = useState([])
  const [orderList, setOrderList] = useState([])
  const [activeZone, setActiveZone] = useState(courier ? 'delivery' : 'all')
  const [loading, setLoading] = useState(true)

  // Курьер стартует на доске своих заказов (доставка). Физических столов у него нет
  const [view, setView] = useState('floor')  // floor | order
  const [orderType, setOrderType] = useState(courier ? 'delivery' : 'dine_in')
  const [selectedTable, setSelectedTable] = useState(null)

  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [orderNote, setOrderNote] = useState('')
  const [deliveryPhone, setDeliveryPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [custId, setCustId] = useState(null)
  const [custMatches, setCustMatches] = useState([])
  const [editLine, setEditLine] = useState(null)
  const [finOpen, setFinOpen] = useState(false)
  const [histOpen, setHistOpen] = useState(false)
  const [repOpen, setRepOpen] = useState(false)
  const [stopOpen, setStopOpen] = useState(false)
  const [attOpen, setAttOpen] = useState(false)
  const [staffOpen, setStaffOpen] = useState(false)   // Сотрудники (меню «…», право can_manage_staff)
  const [whOpen, setWhOpen] = useState(false)         // Складские записи (меню «…», право can_manage_staff)
  const [printOpen, setPrintOpen] = useState(false)   // Пакетная печать (меню «…», всем)
  const [payExisting, setPayExisting] = useState(null)   // существующий заказ на оплату/закрытие
  const [promptCfg, setPromptCfg] = useState(null)        // модалка ввода (пароль отмены / новый стол)
  const [creating, setCreating] = useState(false)         // создание заказа (лоадер кнопки)
  const [staff, setStaff] = useState([])                 // сотрудники (для смены официанта)
  const [printerMap, setPrinterMap] = useState({})
  const [addToOrderId, setAddToOrderId] = useState(null) // id заказа, в который ДОБАВЛЯЕМ блюда (иначе создаём новый)

  // Слот шапки (TopBar в App.jsx): меню разделов рендерим порталом, чтобы кнопка
  // жила в шапке, а состояние осталось здесь. DOM шапки готов к моменту первого
  // эффекта, поэтому ищем узел один раз при монтировании.
  const [hdrActionsSlot, setHdrActionsSlot] = useState(null)
  useEffect(() => {
    setHdrActionsSlot(document.getElementById('topbar-actions-slot'))
  }, [])

  const loadFloor = useCallback(() => {
    hallsApi.list(user.branch_id)
      .then((d) => { const l = Array.isArray(d) ? d : d?.items || []; setZones(l.length ? l : demoZones()) })
      .catch(() => setZones(demoZones()))
    orders.list({ branch_id: user.branch_id })
      .then((d) => { const all = Array.isArray(d) ? d : d?.items || []; setOrderList(all.filter((o) => ACTIVE.has(o.status))) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.branch_id])

  useEffect(() => {
    loadFloor()
    const id = setInterval(loadFloor, 20000)
    return () => clearInterval(id)
  }, [loadFloor])

  useEffect(() => {
    Promise.all([menu.categories().catch(() => []), menu.products().catch(() => []), printersApi.list().catch(() => [])])
      .then(([cats, prods, pl]) => {
        setCategories(cats.items ?? cats ?? [])
        setProducts(prods.items ?? prods ?? [])
        const map = {}; (pl.items ?? pl ?? []).forEach((p) => { map[p.id] = p }); setPrinterMap(map)
      })
    // Сотрудники для смены официанта. Тот же фильтр, что в экране выбора сотрудника
    // (EmployeeSelector) и панели посещаемости: владелец/менеджер/кладовщик столы на
    // кассе не обслуживают — прячем их, чтобы оба селекта в модалке оплаты (официант
    // стола и официант блюда) показывали ровно веб-персонал филиала, кассир первым,
    // а не «кашу» из всех ролей. Иначе список тут расходится с экраном входа.
    authApi.staffUsers(user.branch_id)
      .then((d) => {
        const HIDDEN_ROLES = ['owner', 'manager', 'warehouse']
        const empRole = (u) => String(u.role_slug || u.role_slugs?.[0] || '').toLowerCase()
        const list = (Array.isArray(d) ? d : d?.items || [])
          .filter((u) => u.is_active !== false && !HIDDEN_ROLES.includes(empRole(u)))
          // Кассиры всегда первыми; порядок внутри роли сохраняется.
          .map((u, index) => ({ u, index }))
          .sort((a, b) => Number(empRole(b.u) === 'cashier') - Number(empRole(a.u) === 'cashier') || a.index - b.index)
          .map(({ u }) => u)
        setStaff(list)
      })
      .catch(() => {})
  }, [user.branch_id])

  useEffect(() => {
    return onPrintJob(async (msg) => {
      if (msg.event !== 'print_job') return
      const printer = printerMap[msg.printer_id]
      if (!printer) return
      try {
        await window.electron?.print({ ip: printer.ip_address, port: printer.port ?? 9100, payloadBase64: msg.payload, copies: msg.copies ?? 1 })
        await printersApi.jobDone(msg.job_id)
      } catch (err) { console.error('[print]', err); toast(t('print_failed')) }
    })
  }, [printerMap])

  // ── Столы ──
  const allTables = zones.flatMap((z) => (z.tables || []).map((t) => ({ ...t, zoneId: z.id, zoneName: z.name })))
  const orderFor = (num) => orderList.find((o) => String(o.table_number) === String(num))
  const tableStatus = (num) => {
    const o = orderFor(num)
    if (!o) return 'free'
    if (o.receipt_printed_at) return 'await'   // чек напечатан → ожидает оплату
    return o.status === 'ready' ? 'ready' : 'busy'
  }
  const freeCount = (list) => list.filter((t) => tableStatus(t.number) === 'free').length
  // Заказы доставки и «с собой» — свои доски (карточки заказов, а не столов)
  const deliveryOrders = orderList.filter((o) => o.order_type === 'delivery')
  const takeawayOrders = orderList.filter((o) => o.order_type === 'takeaway')
  const zoneNav = [
    { id: 'all', name: t('all'), count: freeCount(allTables), Icon: LayoutGrid },
    ...zones.map((z) => ({ id: z.id, name: z.name, count: freeCount(z.tables || []), Icon: zoneIcon(z.name) })),
  ]
  // Активна доска заказов (доставка/с собой), а не столов
  const orderBoard = activeZone === 'delivery' || activeZone === 'takeaway'
  const boardOrders = activeZone === 'delivery' ? deliveryOrders : takeawayOrders
  const shownZones = activeZone === 'all' ? zones : zones.filter((z) => z.id === activeZone)
  // Счётчики в шапке — по ПОКАЗАННОЙ зоне (а не по всем столам): иначе «занято N» не совпадало с видимым
  const shownTables = activeZone === 'all' ? allTables : allTables.filter((tb) => tb.zoneId === activeZone)
  const busyCount = shownTables.filter((tb) => tableStatus(tb.number) !== 'free').length

  function openOrder(type, table) {
    setOrderType(type); setSelectedTable(table || null)
    setCart([]); setOrderNote(''); setSearch(''); setActiveCat(null)
    setDeliveryPhone(''); setDeliveryAddress(''); setCustId(null); setCustMatches([])
    setAddToOrderId(null)   // новый заказ (не дозаказ)
    setView('order')
  }
  // Дозаказ: добавляем блюда в уже открытый заказ стола (из модалки оплаты).
  // payExisting НЕ гасим: экран оплаты рендерится только во виде floor, поэтому
  // он просто ждёт «под» меню — и «Назад» возвращает в тот же счёт, а не к столам.
  function addDishesToOrder(order) {
    setOrderType('dine_in'); setSelectedTable({ number: order.table_number })
    setCart([]); setOrderNote(''); setSearch(''); setActiveCat(null)
    setDeliveryPhone(''); setDeliveryAddress(''); setCustId(null); setCustMatches([])
    setAddToOrderId(order.id)
    setView('order')
  }
  // Выход из меню назад: дозаказ → в тот же счёт (payExisting уже открыт),
  // новый заказ → к столам. Корзину и признак дозаказа сбрасываем, иначе
  // выбранные блюда «переехали» бы в следующий заказ.
  function backFromOrder() {
    setCart([]); setOrderNote(''); setEditLine(null); setAddToOrderId(null)
    setView('floor')
  }
  // Автокомплит постоянных клиентов по номеру
  function onDeliveryPhone(raw) {
    const digits = extractPhoneDigits(raw); setDeliveryPhone(digits); setCustId(null)
    const q = fullPhone(digits)
    if (digits.length < 3) { setCustMatches([]); return }
    customersApi.search(q).then((list) => setCustMatches((Array.isArray(list) ? list : []).slice(0, 6))).catch(() => setCustMatches([]))
  }
  function pickCustomer(c) {
    setDeliveryPhone(extractPhoneDigits(c.phone || '')); setCustId(c.id); setCustMatches([])
  }
  // Клик по столу: есть заказ (передан официантом) → оплата/закрытие; пусто → новый заказ
  function tapTable(tbl) {
    const o = orderFor(tbl.number)
    if (o) setPayExisting(o)
    else openOrder('dine_in', tbl)
  }

  // Чековый принтер филиала (привязка по IP — в админке организации)
  function receiptPrinter() {
    return Object.values(printerMap).find((p) => p.printer_type === 'receipt' && p.branch_id === user.branch_id)
  }
  async function printOrderReceipt(order) {
    const pr = receiptPrinter()
    if (!pr) { toast(t('no_receipt_printer')); return }
    try { await printersApi.printReceipt({ order_id: order.id, printer_id: pr.id, copies: 1 }) }
    catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : '')) }
  }
  // Закрыть заказ (оплата подтверждена кассиром). Способ оплаты фиксируется вручную —
  // платёжку интегрируем позже; сейчас просто переводим заказ в completed.
  // Долг (method === 'debt'): фактически полученные наличные пишем приходом в финансы
  // best-effort — без права на финансы или офлайн запись тихо пропускается,
  // заказ при этом всё равно закрывается.
  async function completeExistingOrder(order, method, detail) {
    try {
      await orders.updateStatus(order.id, 'completed')
      if (method === 'debt' && detail && Number(detail.cash) > 0) {
        const fmtSum = (n) => Number(n || 0).toLocaleString('ru-RU')
        const comment = `Долг: заказ #${order.order_number ?? ''}, получено ${fmtSum(detail.cash)}, остаток ${fmtSum(detail.debt)}${detail.client_name ? `, клиент: ${detail.client_name}` : ''}${detail.client_phone ? `, тел: ${detail.client_phone}` : ''}`
        try { await financeApi.addIncome({ amount: Number(detail.cash), comment }) } catch { /* тихо: нет прав или офлайн */ }
      }
      toast(t('order_closed'))
    } catch (e) { toast(t('close_order_error') + (e?.response?.data?.detail ? ': ' + e.response.data.detail : ''), 'error') }
    setPayExisting(null)
    loadFloor()
  }
  // Живой пересчёт итога: пока кассир вводит наличные в модалке оплаты — подтягиваем
  // заказ с сервера (скидки, дозаказы). Ошибка тихая: остаёмся на локальных данных.
  async function refreshPayOrder(order) {
    if (!order?.id) return
    try { const upd = await orders.get(order.id); setPayExisting(upd) } catch { /* тихо */ }
  }
  // Отмена заказа — со спец-паролем (проверяется на бэкенде) + комментарий причины.
  // window.prompt в Electron не работает — спрашиваем пароль в своей модалке.
  function cancelOrder(order) {
    setPromptCfg({
      title: t('cancel_order'),
      hint: t('cancel_password_prompt'),
      type: 'password',
      extra: { label: t('cancel_comment'), placeholder: t('cancel_comment_ph') },
      submitLabel: t('cancel_order'),
      onSubmit: async (pwd, comment) => {
        await orders.cancel(order.id, pwd, comment || undefined)
        setPromptCfg(null); setPayExisting(null); loadFloor()
      },
    })
  }
  // Смена официанта заказа
  async function setOrderWaiter(order, waiterId) {
    try { await orders.update(order.id, { waiter_id: waiterId }); setPayExisting({ ...order, waiter_id: waiterId }); loadFloor() }
    catch (e) { toast(e?.response?.data?.detail || e.message) }
  }
  // Смена ответственного официанта у ОДНОЙ позиции: официант 1 мог случайно
  // внести блюдо в стол официанта 2, а доля обслуги считается по ответственному.
  async function setItemWaiter(order, item, waiterId) {
    if (!waiterId) return
    try { const upd = await orders.setItemWaiter(order.id, item.id, waiterId); setPayExisting(upd); loadFloor() }
    catch (e) { toast(e?.response?.data?.detail || e.message) }
  }
  // Отмена выбранных позиций: одна обязательная причина сохраняется в аудите
  // каждой позиции. API удаляет по одной позиции, поэтому применяем их по порядку.
  function removeSelectedItems(order, itemIds, onDone) {
    setPromptCfg({
      title: t('cancel_selected_dishes'),
      hint: t('delete_reason'),
      placeholder: t('delete_reason_ph'),
      submitLabel: t('cancel_selected_dishes'),
      onSubmit: async (reason) => {
        let updated = order
        for (const itemId of itemIds) {
          updated = await orders.removeItem(order.id, itemId, reason)
          setPayExisting(updated)
        }
        setPromptCfg(null)
        onDone?.()
        loadFloor()
      },
    })
  }
  // Скидка на существующий заказ — применяется в модалке оплаты (сервер пересчитывает итог)
  async function applyOrderDiscount(order, amount) {
    const upd = await orders.update(order.id, { discount_amount: amount })
    setPayExisting(upd); loadFloor()
  }
  // Перенос заказа на другой стол — номер спрашиваем в своей модалке
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
        await orders.update(order.id, { table_number: num, reason: reason || undefined })
        setPromptCfg(null); setPayExisting(null); loadFloor()
      },
    })
  }

  // ── Каталог/корзина ──
  const filtered = products.filter((p) => {
    if (search) { const q = search.toLowerCase(); return p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) }
    return activeCat ? p.category_id === activeCat : true
  })
  // Клик по блюду в меню — сразу в заказ (без модалки). У курьера всё «с собой» по умолчанию.
  function addToCart(product) {
    if (product.is_available === false || product.in_stop_list) return // в стоп-листе
    setCart((prev) => [...prev, { lineId: `${Date.now()}-${Math.random()}`, product, name: product.name, price: Number(product.price) || 0, qty: 1, note: '', takeaway: courier }])
  }
  // Правка позиции В ЗАКАЗЕ (кол-во/цена/комментарий/добавки)
  function saveEdit({ quantity, price, note, takeaway, modifiers }) {
    setCart((prev) => prev.map((i) => i.lineId === editLine.lineId ? { ...i, qty: quantity, price, note, takeaway, modifiers: modifiers || [] } : i))
    setEditLine(null)
  }
  function updateQty(lineId, d) { setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, qty: i.qty + d } : i).filter((i) => i.qty > 0)) }
  function removeLine(lineId) { setCart((prev) => prev.filter((i) => i.lineId !== lineId)) }
  // «С собой» переключается прямо в строке корзины (не заходя в модалку блюда)
  function toggleTakeaway(lineId) { setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, takeaway: !i.takeaway } : i)) }

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const total = subtotal
  const itemCount = cart.reduce((s, i) => s + i.qty, 0)

  // Создание заказа: позиции уходят повару (авто-печать кухонного чека на бэкенде),
  // оплата/закрытие — потом через модалку заказа (тап по столу).
  async function createOrder() {
    if (!cart.length || creating) return
    setCreating(true)
    try {
      if (addToOrderId) {
        // Дозаказ: досылаем позиции в существующий заказ.
        // Бэкенд в add_item сам возвращает заказ в статус «готовится» (service.py),
        // отдельный updateStatus('cooking') не нужен — и ломал дозаказ в уже готовящийся стол
        // (переход cooking→cooking запрещён state-machine → «нельзя добавить»).
        for (const i of cart) {
          await orders.addItem(addToOrderId, { product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: !!i.takeaway, modifiers: i.modifiers || [] })
        }
        // Освежаем снимок заказа: после «Назад»/возврата счёт показывает новые позиции и сумму
        try { const fresh = await orders.get(addToOrderId); if (fresh) setPayExisting(fresh) }
        catch { /* нет связи — останется прежний снимок, состав подтянется при перезаходе */ }
        setAddToOrderId(null)
      } else {
        await orders.create({
          branch_id: user.branch_id,
          order_type: orderType,
          table_number: orderType === 'dine_in' && selectedTable?.number != null ? String(selectedTable.number) : undefined,
          note: orderNote || undefined,
          customer_id: custId || undefined,
          customer_phone: orderType === 'delivery' ? (fullPhone(deliveryPhone) || undefined) : undefined,
          customer_address: orderType === 'delivery' ? (deliveryAddress || undefined) : undefined,
          // Курьер: все позиции всегда «с собой» → бэкенд не начисляет сервисный сбор.
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: courier ? true : !!i.takeaway, modifiers: i.modifiers || [] })),
        })
      }
      // Курьер: экрана успеха нет — уходим на доску доставки, там виден новый заказ.
      // Касса: после доставки/«с собой» — на доску этих заказов (item 4/5), иначе на столы.
      if (courier) setActiveZone('delivery')
      else if (orderType === 'delivery' || orderType === 'takeaway') setActiveZone(orderType)
      setView('floor'); loadFloor()
      toast(t('order_created'))
    } catch (err) {
      toast(t('create_order_error') + ': ' + (err?.response?.data?.detail || err.message), 'error')
    } finally {
      setCreating(false)
    }
  }

  // ═══ Вид: столы (кассир) / доска заказов (курьер) ═══
  if (view === 'floor') {
    return (
      <div className="floor">
        <aside className="ws-side">
          {courier ? (
            <>
              {/* Курьер: только его доска доставки, без физических зон и «с собой» */}
              <div className="ws-side__label">{t('orders')}</div>
              <nav className="ws-side__nav">
                <button className={`zone ${activeZone === 'delivery' ? 'zone--active' : ''}`} onClick={() => setActiveZone('delivery')}>
                  <Bike size={20} /><span className="zone__name">{t('delivery')}</span><span className="zone__count">{deliveryOrders.length}</span>
                </button>
              </nav>
            </>
          ) : (
            <>
              <div className="ws-side__label">{t('locations')}</div>
              <nav className="ws-side__nav">
                {zoneNav.map(({ id, name, count, Icon }) => (
                  <button key={id} className={`zone ${activeZone === id ? 'zone--active' : ''}`} onClick={() => setActiveZone(id)}>
                    <Icon size={20} /><span className="zone__name">{name}</span><span className="zone__count">{count}</span>
                  </button>
                ))}
              </nav>
            </>
          )}
        </aside>

        <main className="ws__main">
          <div className="board__head">
            <div className="board__title">
              <h2>{orderBoard ? t(activeZone) : t('tables')}</h2>
              <span className="board__subtitle">
                {orderBoard
                  ? `${boardOrders.length} ${t('orders_low')}`
                  : `${shownTables.length} ${t('tables_low')} · ${busyCount} ${t('busy_low')}`}
              </span>
            </div>
            <div className="board__head-right">
              {orderBoard && !courier && <button className="btn btn--outline btn--sm" onClick={() => setActiveZone('all')}><ArrowLeft size={18} /> {t('to_tables')}</button>}
              {orderBoard && <button className="btn btn--primary btn--sm" onClick={() => openOrder(activeZone, null)}><Plus size={18} /> {t('new_order')}</button>}
              {!courier && can(user, 'can_change_order_type') && <button className="btn btn--outline btn--sm" onClick={() => setActiveZone('takeaway')}><ShoppingBag size={18} /> {t('takeaway')}</button>}
              {!courier && can(user, 'can_change_order_type') && <button className="btn btn--outline btn--sm" onClick={() => setActiveZone('delivery')}><Bike size={18} /> {t('delivery')}</button>}
            </div>
          </div>
          <div className="board__scroll">
            {orderBoard ? (
              boardOrders.length === 0 ? <p className="empty-text">{t('no_orders')}</p> : (
                <div className="tgrid">
                  {boardOrders.map((o) => {
                    const variant = o.status === 'ready' ? 'check' : o.receipt_printed_at ? 'pay' : 'busy'
                    return (
                      <button key={o.id} className={`tcard tcard--${variant}`} onClick={() => { if (!courier) setPayExisting(o) }}>
                        <div className="tcard__top">
                          <span className="tcard__num">#{o.order_number ?? ''}</span>
                          <span className="tcard__seats">{activeZone === 'delivery' ? <Bike /> : <ShoppingBag />}</span>
                        </div>
                        {o.customer_phone && <span className="tcard__client">{formatPhone(extractPhoneDigits(o.customer_phone)) || o.customer_phone}</span>}
                        {activeZone === 'delivery' && o.customer_address && <span className="tcard__client">{o.customer_address}</span>}
                        <span className="tcard__meta"><Clock /> {fmtTime(o.created_at)}
                          {o.total_amount != null && <span className="tcard__amount">{Number(o.total_amount).toLocaleString('ru-RU')} {t('currency')}</span>}
                        </span>
                        <span className="tcard__status">{t.status(o.status)}</span>
                      </button>
                    )
                  })}
                </div>
              )
            ) : loading ? <p className="empty-text">{t('loading')}</p> : shownZones.map((z) => (
              <section className="tgroup" key={z.id}>
                <div className="tgroup__title">{z.name} <span>{(z.tables || []).length} {t('tables_low')}</span></div>
                <div className="tgrid">
                  {(z.tables || []).map((tb) => {
                    const o = orderFor(tb.number); const st = tableStatus(tb.number)
                    const variant = st === 'free' ? 'free' : st === 'ready' ? 'check' : st === 'await' ? 'pay' : 'busy'
                    return (
                      <button key={tb.id ?? tb.number} className={`tcard tcard--${variant}`} onClick={() => tapTable(tb)}>
                        <div className="tcard__top">
                          <span className="tcard__num">{tb.number}</span>
                          <span className="tcard__seats"><Users /> {tb.capacity || 4}</span>
                        </div>
                        {o ? (
                          <><span className="tcard__client">{t('order_no')} #{o.order_number ?? ''}</span>
                            <span className="tcard__meta"><Clock /> {fmtTime(o.created_at)}
                              {o.total_amount != null && <span className="tcard__amount">{Number(o.total_amount).toLocaleString('ru-RU')} {t('currency')}</span>}
                            </span></>
                        ) : <div className="tcard__spacer" />}
                        <span className="tcard__status">{t(st)}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </main>
        {/* Меню разделов — иконка-кнопка в шапке рядом с блокировкой и настройками */}
        {hdrActionsSlot && !courier && createPortal(
          <HeaderMenu
            title={t('menu_more')}
            items={[
              ...(can(user, 'can_view_stop_list') ? [{ id: 'stop', label: t('stoplist'), Icon: Ban, onClick: () => setStopOpen(true) }] : []),
              ...(must(user, 'can_view_finance') ? [{ id: 'fin', label: t('finance'), Icon: Wallet, onClick: () => setFinOpen(true) }] : []),
              ...(must(user, 'can_approve_attendance') ? [{ id: 'att', label: t('attendance_page'), Icon: Clock, onClick: () => setAttOpen(true) }] : []),
              ...(can(user, 'can_view_closed_orders') ? [{ id: 'hist', label: t('history'), Icon: History, onClick: () => setHistOpen(true) }] : []),
              { id: 'rep', label: t('reports'), Icon: BarChart3, onClick: () => setRepOpen(true) },
              ...(must(user, 'can_manage_staff') ? [{ id: 'staff', label: t('dev_staff'), Icon: Users, onClick: () => setStaffOpen(true) }] : []),
              ...(must(user, 'can_manage_staff') ? [{ id: 'wh', label: t('dev_warehouse'), Icon: Boxes, onClick: () => setWhOpen(true) }] : []),
              { id: 'print', label: t('print'), Icon: Printer, onClick: () => setPrintOpen(true) },
            ]}
          />,
          hdrActionsSlot,
        )}
        {finOpen && <FinancePanel branch={{ id: user.branch_id }} user={user} onClose={() => setFinOpen(false)} />}
        {histOpen && <HistoryPanel branch={{ id: user.branch_id }} onClose={() => setHistOpen(false)} />}
        {repOpen && <ReportsPanel branch={{ id: user.branch_id }} user={user} onClose={() => setRepOpen(false)} />}
        {stopOpen && <StopListPanel user={user} onClose={() => setStopOpen(false)} />}
        {attOpen && <AttendancePanel user={user} onClose={() => setAttOpen(false)} />}
        {staffOpen && <StaffManagerPanel onClose={() => setStaffOpen(false)} />}
        {whOpen && <WarehouseWritePanel onClose={() => setWhOpen(false)} />}
        {printOpen && <BatchPrintPanel branch={{ id: user.branch_id }} onClose={() => setPrintOpen(false)} />}
        {payExisting && (
          <PaymentModal
            order={payExisting}
            fullscreen
            onPrint={printOrderReceipt}
            onComplete={completeExistingOrder}
            onCancel={cancelOrder}
            onReassign={reassignTable}
            onAddItems={addDishesToOrder}
            staff={staff}
            onSetWaiter={setOrderWaiter}
            onSetItemWaiter={setItemWaiter}
            onRemoveItems={must(user, 'can_manage_orders') ? removeSelectedItems : undefined}
            onApplyDiscount={applyOrderDiscount}
            onRefreshOrder={refreshPayOrder}
            canClose={can(user, 'can_close_bill')}
            onClose={() => setPayExisting(null)}
          />
        )}
        {promptCfg && <InputPromptModal {...promptCfg} onClose={() => setPromptCfg(null)} />}
      </div>
    )
  }

  // ═══ Вид: заказ (меню + корзина) ═══
  return (
    <div className="floor">
      <aside className="ws-side">
        <button className="zone zone--exit" onClick={backFromOrder}>
          <ArrowLeft size={20} />
          {/* Дозаказ возвращает в счёт, а не к столам — подпись должна совпадать с действием */}
          <span className="zone__name">{courier || addToOrderId ? t('back') : t('to_tables')}</span>
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
            <h2>
              {orderType === 'dine_in' ? (selectedTable ? `${t('table')} ${selectedTable.number}` : t('dine_in')) : t(orderType)}
            </h2>
            <span className="board__subtitle">{itemCount} {t('items_low')} · {total.toLocaleString('ru-RU')} {t('currency')}</span>
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
              {filtered.length === 0 ? <p className="empty-text">{t('no_dishes')}</p> : filtered.map((p) => {
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
                    <span className="cart-item__name">{item.name}</span>
                    {item.note && <span className="cart-row__note">{item.note}</span>}
                    <span className="cart-item__price">{(item.price * item.qty).toLocaleString('ru-RU')} {t('currency')}</span>
                  </button>
                  {/* «С собой» — тумблер рядом с названием и ценой; за столом по праву
                      can_takeaway_at_table, для доставки/навынос доступно всегда */}
                  {!courier && (orderType !== 'dine_in' || can(user, 'can_takeaway_at_table')) && (
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
            {orderType === 'delivery' && (
              <div className="cashier-delivery">
                <div className="cashier-delivery__phone">
                  <input className="cashier-cart__note" type="tel" inputMode="numeric" placeholder="+998 90 123-45-67" value={formatPhone(deliveryPhone)} onChange={(e) => onDeliveryPhone(e.target.value)} />
                  {custMatches.length > 0 && (
                    <div className="cashier-delivery__suggest">
                      {custMatches.map((c) => (
                        <button key={c.id} type="button" onClick={() => pickCustomer(c)}>
                          {c.phone}{c.name ? ` · ${c.name}` : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input className="cashier-cart__note" placeholder={t('address')} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
              </div>
            )}
            {cart.length > 0 && (
              <input className="cashier-cart__note" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder={t('comment')} />
            )}
            <div className="cashier-cart__total">
              <div className="total-row total-row--final"><span>{t('total')}</span><span>{total.toLocaleString('ru-RU')} {t('currency')}</span></div>
            </div>
            <div className="cashier-cart__actions">
              <button className="cart-btn cart-btn--pay" disabled={cart.length === 0 || creating} onClick={createOrder}>
                {creating ? <span className="btn-spinner" aria-hidden="true" /> : <Plus size={20} />} {addToOrderId ? t('add_dishes') : t('create_order')}
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
          hideTakeaway={courier || (orderType === 'dine_in' && !can(user, 'can_takeaway_at_table'))}
        />
      )}
    </div>
  )
}

function demoZones() {
  const mk = (num, cap) => ({ id: `d${num}`, number: num, capacity: cap })
  return [
    { id: 'z-hall', name: 'Зал', tables: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, 4)) },
    { id: 'z-terrace', name: 'Терраса', tables: [9, 10, 11, 12].map((n) => mk(n, 4)) },
  ]
}
