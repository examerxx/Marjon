import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Plus, Minus, Utensils, Pencil,
  LayoutGrid, Armchair, DoorClosed, Sun, Wine, CalendarClock, ArrowLeft, Users, Clock, Wallet, History, BarChart3, Ban, ShoppingBag, Bike, Boxes, Printer, Receipt,
} from 'lucide-react'
import { orders, payments, menu, halls as hallsApi, printers as printersApi, customers as customersApi, auth as authApi, finance as financeApi, companies as companiesApi } from '../../shared/api'
import { onPrintJob } from '../../shared/ws'
// PRINT-LAT-01: печать + дедупликация + опрос очереди (наш путь доставки).
// printers.js — выбор принтера (сотрудник → филиал) из прод-линии.
import { printJob, startPrintPoller } from '../../shared/printJobs'
import { pickReceiptPrinter } from '../../shared/printers'
import { fmtTime } from '../../shared/time'
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
import { errorMessage } from '../../shared/errorMessage.mjs'
import { formatPhone, extractPhoneDigits, fullPhone } from '../../shared/phone'
import { formatQty } from '../../shared/qty'

const ACTIVE = new Set(['new', 'accepted', 'cooking', 'ready', 'pending'])

function zoneIcon(name = '') {
  const n = name.toLowerCase()
  if (n.includes('террас')) return Sun
  if (n.includes('бар')) return Wine
  if (n.includes('кабин')) return DoorClosed
  if (n.includes('бронь')) return CalendarClock
  return Armchair
}
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
// Роль-слаг сотрудника: по ней решаем, можно ли оформлять долг.
function roleSlugOf(user = {}) {
  return String(user?.role_slug || user?.role_slugs?.[0] || '').toLowerCase()
}

// Позиции существующего заказа → строки правой колонки. Это те блюда, которые
// УЖЕ заказаны: они показываются тем же экраном, что и корзина нового заказа,
// но правятся только по смыслу (отмена с причиной, смена официанта).
function orderToLines(order) {
  return (order?.items || [])
    .filter((it) => it.status !== 'cancelled')
    .map((it) => ({
      lineId: `ord-${it.id}`,
      orderItemId: it.id,
      product: { id: it.product_id, name: it.name, price: Number(it.price) || 0 },
      name: it.name,
      price: Number(it.price) || 0,
      qty: Number(it.quantity) || 0,
      total: Number(it.total) || 0,
      note: it.note || '',
      takeaway: !!it.takeaway,
      modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
      addedByName: it.added_by_name || it.waiter_name || '',
      createdAt: it.created_at || '',
      waiterId: it.added_by || it.waiter_id || '',
      course: it.course,
    }))
}

export default function CashierMode({ user = {}, onBack, courier = false }) {
  const [zones, setZones] = useState([])
  const [orderList, setOrderList] = useState([])
  const [activeZone, setActiveZone] = useState(courier ? 'delivery' : 'all')
  const [loading, setLoading] = useState(true)
  const [hallsError, setHallsError] = useState('')
  const orderSubmitLock = useRef(false)
  const cartItemsRef = useRef(null)

  // Курьер стартует на доске своих заказов (доставка). Физических столов у него нет
  const [view, setView] = useState('floor')  // floor | order
  const [orderType, setOrderType] = useState(courier ? 'delivery' : 'dine_in')
  const [selectedTable, setSelectedTable] = useState(null)

  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])                 // НОВЫЕ строки (ещё не отправлены)
  const [orderLines, setOrderLines] = useState([])     // строки уже оформленного заказа
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
  const [existingOrder, setExistingOrder] = useState(null) // снимок заказа, который редактируем
  const [paidBefore, setPaidBefore] = useState(0)         // сколько оплачено до возврата в закрытый заказ
  const [paymentMethods, setPaymentMethods] = useState([]) // способы оплаты из веб-админки (Uzum, Yandex…)
  // Типы заказа из профиля компании («Другие настройки» веба). null = ещё не
  // загружено или ошибка — считаем всё включённым (как раньше).
  const [orderTypes, setOrderTypes] = useState(null)
  const typeOn = (key) => !orderTypes || orderTypes[key] !== false
  // Если текущий тип/доску выключили — откатываемся на первый включённый.
  useEffect(() => {
    if (!orderTypes) return
    const first = ['dine_in', 'takeaway', 'delivery'].find((k) => orderTypes[k] !== false)
    if (!first) return
    if (orderType !== first && !typeOn(orderType)) setOrderType(first)
    if ((activeZone === 'takeaway' || activeZone === 'delivery') && !typeOn(activeZone)) setActiveZone('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderTypes])

  // Слот шапки (TopBar в App.jsx): меню разделов рендерим порталом, чтобы кнопка
  // жила в шапке, а состояние осталось здесь.
  const [hdrActionsSlot, setHdrActionsSlot] = useState(null)
  const [searchSlot, setSearchSlot] = useState(null)
  const [backSlot, setBackSlot] = useState(null)
  const [tabsSlot, setTabsSlot] = useState(null)
  const [boardSlot, setBoardSlot] = useState(null)
  useEffect(() => {
    setHdrActionsSlot(document.getElementById('topbar-actions-slot'))
    setSearchSlot(document.getElementById('topbar-center-slot'))
    setBackSlot(document.getElementById('topbar-back-slot'))
    setTabsSlot(document.getElementById('topbar-tabs-slot'))
    setBoardSlot(document.getElementById('topbar-board-slot'))
  }, [])

  // Liquid Glass: блик на кнопках категорий идёт за пальцем/курсором.
  // Пишем --mx/--my (проценты внутри кнопки) — их читает .zone::after в CSS.
  useEffect(() => {
    let frame = 0
    let zone = null
    let px = 0
    let py = 0
    const paint = () => {
      frame = 0
      if (!zone) return
      const r = zone.getBoundingClientRect()
      if (!r.width || !r.height) return
      zone.style.setProperty('--mx', `${((px - r.left) / r.width) * 100}%`)
      zone.style.setProperty('--my', `${((py - r.top) / r.height) * 100}%`)
    }
    const onPointer = (e) => {
      zone = e.target instanceof Element ? e.target.closest('.zone') : null
      if (!zone) return
      px = e.clientX
      py = e.clientY
      if (!frame) frame = requestAnimationFrame(paint)
    }
    document.addEventListener('pointermove', onPointer, { passive: true })
    document.addEventListener('pointerdown', onPointer, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onPointer)
      document.removeEventListener('pointerdown', onPointer)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  const loadFloor = useCallback(() => {
    hallsApi.list(user.branch_id)
      .then((d) => { const l = Array.isArray(d) ? d : d?.items || []; setZones(l); setHallsError('') })
      .catch((error) => setHallsError(errorMessage(error, t('load_halls_error'))))
    orders.list({ branch_id: user.branch_id })
      .then((d) => { const all = Array.isArray(d) ? d : d?.items || []; setOrderList(all.filter((o) => ACTIVE.has(o.status))) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.branch_id])

  useEffect(() => {
    loadFloor()
    // MOBILE-ORDER-SYNC: заказ, принятый официантом в мобилке, должен появляться
    // на кассе сразу. Раньше доска обновлялась раз в 20 с — кассир успевал
    // решить, что заказ «не пришёл» (и заводил дубль).
    const id = setInterval(loadFloor, 5000)
    // Возврат к терминалу (переключили окно, сняли блокировку) — сразу свежие данные.
    const onFocus = () => loadFloor()
    const onVisible = () => { if (!document.hidden) loadFloor() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadFloor])

  useEffect(() => {
    Promise.all([menu.categories().catch(() => []), menu.products().catch(() => []), printersApi.list().catch(() => [])])
      .then(([cats, prods, pl]) => {
        const allCats = cats.items ?? cats ?? []
        const allProds = prods.items ?? prods ?? []
        // CATALOG-SCOPE-01: в списке категорий кассы были и складские
        // («Овощи», «Мясо», «Мука»…) — кассир видел пустые полки, которых в
        // продаже нет. Оставляем только то, что реально продаётся: категории
        // с флагом «в меню» ИЛИ те, где есть хотя бы одно блюдо/товар
        // (в старых компаниях флаг не выставлен, но блюда в категории есть).
        const sellableTypes = new Set(['dish', 'sale'])
        const sellableCats = new Set(
          allProds
            .filter((p) => sellableTypes.has(String(p.product_type || 'dish')))
            .map((p) => String(p.category_id || ''))
            .filter(Boolean)
        )
        setCategories(allCats.filter((c) => c.show_in_menu === true || sellableCats.has(String(c.id))))
        setProducts(allProds.filter((p) => sellableTypes.has(String(p.product_type || 'dish'))))
        const map = {}; (pl.items ?? pl ?? []).forEach((p) => { map[p.id] = p }); setPrinterMap(map)
      })
    companiesApi.profile().then((p) => {
      setOrderTypes(p?.order_types || null)
    }).catch(() => {})
    // Способы оплаты из веб-админки (Настройки → «Способ оплаты»). Владелец вводит
    // Uzum, Yandex и т.п. руками — интеграции нет, но на кассе их можно выбрать,
    // а в отчётах видно, через что клиент заплатил. Наличные и карта — свои кнопки.
    financeApi.paymentTypes()
      .then((list) => {
        const BUILTIN = new Set(['наличные', 'карта', 'cash', 'card', 'смешанный', 'mixed'])
        setPaymentMethods((list || []).filter((p) => !BUILTIN.has(String(p.name || '').trim().toLowerCase())))
      })
      .catch(() => setPaymentMethods([]))
    // Сотрудники для смены официанта. Тот же фильтр, что в экране выбора сотрудника
    // (EmployeeSelector) и панели посещаемости: владелец/менеджер/кладовщик столы на
    // кассе не обслуживают — прячем их, чтобы оба селекта в модалке оплаты (официант
    // стола и официант блюда) показывали ровно веб-персонал филиала, кассир первым.
    authApi.staffUsers(user.branch_id)
      .then((d) => {
        const HIDDEN_ROLES = ['owner', 'manager', 'warehouse', 'monoblock']
        const empRole = (u) => String(u.role_slug || u.role_slugs?.[0] || '').toLowerCase()
        const list = (Array.isArray(d) ? d : d?.items || [])
          .filter((u) => u.is_active !== false && !HIDDEN_ROLES.includes(empRole(u)))
          .map((u, index) => ({ u, index }))
          .sort((a, b) => Number(empRole(b.u) === 'cashier') - Number(empRole(a.u) === 'cashier') || a.index - b.index)
          .map(({ u }) => u)
        setStaff(list)
      })
      .catch(() => {})
  }, [user.branch_id])

  useEffect(() => {
    return onPrintJob(async (msg) => {
      console.log('[cashier-ws] print_job', msg.job_id, msg.job_type)
      if (msg.event !== 'print_job') return
      try {
        await printJob(msg, printerMap[msg.printer_id])
      } catch (err) { console.error('[print]', err); toast(t('print_failed')) }
    })
  }, [printerMap])

  // PRINT-LAT-01: страховка, если WebSocket в переподключении — терминал сам
  // забирает очередь печати.
  useEffect(() => startPrintPoller(() => printerMap), [printerMap])

  // ── Столы ──
  const allTables = zones.flatMap((z) => (z.tables || []).map((t) => ({ ...t, zoneId: z.id, zoneName: z.name })))
  // TABLE-MATCH-01: номер стола уникален ТОЛЬКО внутри зала — «стол 1» есть и в
  // «Зале», и в «Балконе». Сначала совпадение по table_id, и только для старых
  // заказов без table_id — по номеру, и лишь если такой номер в филиале один.
  const orderFor = (tbl) => {
    if (tbl == null) return undefined
    const id = typeof tbl === 'object' ? tbl.id : null
    const num = typeof tbl === 'object' ? tbl.number : tbl
    if (id) {
      const byId = orderList.find((o) => o.table_id && String(o.table_id) === String(id))
      if (byId) return byId
    }
    const sameNumber = allTables.filter((t) => String(t.number) === String(num))
    if (sameNumber.length > 1) return undefined
    return orderList.find((o) => !o.table_id && String(o.table_number) === String(num))
  }
  const tableStatus = (tbl) => {
    const o = orderFor(tbl)
    if (!o) return 'free'
    if (o.receipt_printed_at) return 'await'   // чек напечатан → ожидает оплату
    return o.status === 'ready' ? 'ready' : 'busy'
  }
  const freeCount = (list) => list.filter((t) => tableStatus(t) === 'free').length
  // Заказы доставки и «с собой» — свои доски (карточки заказов, а не столов)
  const deliveryOrders = orderList.filter((o) => o.order_type === 'delivery')
  const takeawayOrders = orderList.filter((o) => o.order_type === 'takeaway')
  const zoneNav = [
    { id: 'all', name: t('all'), count: freeCount(allTables), Icon: LayoutGrid },
    ...zones.map((z) => ({ id: z.id, name: z.name, count: freeCount(z.tables || []), Icon: zoneIcon(z.name) })),
  ]
  // Активна доска заказов (доставка/с собой), а не столов
  const orderBoard = activeZone === 'delivery' || activeZone === 'takeaway'
  // Переключатель «Столы / С собой / Доставка» живёт в шапке (портал ниже):
  // в шапке доски он занимал строку и переносился, из-за чего сетка столов
  // начиналась ниже. Здесь только вычисляем, что показывать.
  const canSwitchTypes = can(user, 'can_change_order_type')
  const showTakeawayTab = !courier && canSwitchTypes && typeOn('takeaway')
  const showDeliveryTab = !courier && canSwitchTypes && typeOn('delivery')
  const showTypeTabs = showTakeawayTab || showDeliveryTab
  const boardOrders = activeZone === 'delivery' ? deliveryOrders : takeawayOrders
  const shownZones = activeZone === 'all' ? zones : zones.filter((z) => z.id === activeZone)
  const shownTables = activeZone === 'all' ? allTables : allTables.filter((tb) => tb.zoneId === activeZone)
  const busyCount = shownTables.filter((tb) => tableStatus(tb) !== 'free').length

  // ── Один экран заказа: и новый стол, и редактирование существующего ──
  function resetOrderDraft() {
    setCart([]); setOrderNote(''); setSearch(''); setActiveCat(null)
    setDeliveryPhone(''); setDeliveryAddress(''); setCustId(null); setCustMatches([])
    setEditLine(null)
  }
  function openOrder(type, table) {
    resetOrderDraft()
    setOrderType(type); setSelectedTable(table || null)
    setAddToOrderId(null)   // новый заказ
    setExistingOrder(null); setOrderLines([]); setPaidBefore(0)
    setView('order')
  }
  // Снимок заказа → экран. Это ТОТ ЖЕ экран, что и при заказе блюда в пустом
  // столе: слева меню, справа уже заказанные блюда и новые.
  async function openExistingOrder(order, paid = 0) {
    if (!order?.id) return
    const fresh = await orders.get(order.id).catch(() => order)
    resetOrderDraft()
    setOrderType(fresh?.order_type === 'delivery' || fresh?.order_type === 'takeaway' ? fresh.order_type : 'dine_in')
    setSelectedTable(fresh?.table_number != null ? { id: fresh.table_id || undefined, number: fresh.table_number } : null)
    setAddToOrderId(fresh.id)
    setExistingOrder(fresh)
    setOrderLines(orderToLines(fresh))
    setPaidBefore(Number(paid) || 0)
    setPayExisting(null)
    setView('order')
  }
  // Выход из меню назад: возвращаемся к столам. Черновик сбрасываем, иначе
  // выбранные блюда «переехали» бы в следующий заказ.
  function backFromOrder() {
    setCart([]); setOrderNote(''); setEditLine(null); setAddToOrderId(null)
    setExistingOrder(null); setOrderLines([]); setPaidBefore(0)
    setView('floor')
  }
  // «Назад» в TopBar (App.jsx): сначала закрываем верхний слой
  // (модалка ввода → блюдо → экран оплаты → панели), затем выходим из меню
  // к столам. Если закрывать нечего — не помечаем handled, и App уводит
  // к выбору сотрудника. Так «Назад» никогда не разлогинивает случайно.
  useEffect(() => {
    function onNavBack(e) {
      const mark = () => { e.detail.handled = true }
      if (promptCfg) { setPromptCfg(null); mark(); return }
      if (editLine) { setEditLine(null); mark(); return }
      if (payExisting) { setPayExisting(null); mark(); return }
      if (finOpen) { setFinOpen(false); mark(); return }
      if (histOpen) { setHistOpen(false); mark(); return }
      if (repOpen) { setRepOpen(false); mark(); return }
      if (stopOpen) { setStopOpen(false); mark(); return }
      if (attOpen) { setAttOpen(false); mark(); return }
      if (staffOpen) { setStaffOpen(false); mark(); return }
      if (whOpen) { setWhOpen(false); mark(); return }
      if (printOpen) { setPrintOpen(false); mark(); return }
      if (view === 'order') { backFromOrder(); mark(); return }
    }
    window.addEventListener('marjon:back', onNavBack)
    return () => window.removeEventListener('marjon:back', onNavBack)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptCfg, editLine, payExisting, finOpen, histOpen, repOpen, stopOpen, attOpen, staffOpen, whOpen, printOpen, view])
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
  // Клик по столу: есть заказ → тот же экран заказа с уже заказанными блюдами;
  // пусто → новый заказ.
  function tapTable(tbl) {
    const o = orderFor(tbl)
    if (o) openExistingOrder(o)
    else openOrder('dine_in', tbl)
  }

  // Чековый принтер: сначала закреплённый за сотрудником, иначе — чековый принтер филиала
  function receiptPrinter() {
    return pickReceiptPrinter(Object.values(printerMap), { printerId: user.printer_id })
  }
  async function printOrderReceipt(order) {
    const pr = receiptPrinter()
    if (!pr) { toast(t('no_receipt_printer')); return }
    try { await printersApi.printReceipt({ order_id: order.id, printer_id: pr.id, copies: 1 }) }
    catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : '')) }
  }
  const closingOrders = useRef(new Set())
  // Долг: только кассир и только при явном праве закрывать счёт.
  // Официанту в долг не даём НИКОГДА — на бэкенде это тоже запрещено.
  const roleSlug = roleSlugOf(user)
  // Официант только добавляет блюда и печатает чек: счёт закрывает кассир.
  // Это правило роли, а не тумблера, — иначе легаси-права «разрешают всё».
  const isWaiter = roleSlug === 'waiter'
  const canCloseBill = can(user, 'can_close_bill') && !isWaiter
  const canDebt = canCloseBill && roleSlug !== 'courier'

  // Full payment is recorded atomically by /payments (including stock deduction).
  // Долг (method === 'debt'): фактически полученные наличные пишем приходом в финансы
  // best-effort — без права на финансы или офлайн запись тихо пропускается.
  async function completeExistingOrder(order, method, detail) {
    if (closingOrders.current.has(order.id)) return
    closingOrders.current.add(order.id)
    const refund = Math.max(0, Number(paidBefore || 0) - Number(order?.total_amount || 0))
    try {
      if (method === 'debt') {
        // Existing debt flow is NOT a fully paid receipt and stays out of paid analytics.
        // DEBT-CLIENT-01: имя/телефон должника уходят на сервер — он заводит
        // клиента в справочнике (дашборд → Настройки → Клиенты) и в отчёте
        // по долгам. Раньше эти поля терялись.
        await orders.updateStatus(order.id, 'completed', {
          ...(detail?.client_name ? { client_name: detail.client_name } : {}),
          ...(detail?.client_phone ? { client_phone: detail.client_phone } : {}),
        })
      } else {
        await payments.confirmOrder(order, method, detail)
      }
      if (method === 'debt' && detail && Number(detail.cash) > 0) {
        const comment = `Долг: заказ #${order.order_number ?? ''}, получено ${fmt(detail.cash)}, остаток ${fmt(detail.debt)}${detail.client_name ? `, клиент: ${detail.client_name}` : ''}${detail.client_phone ? `, тел: ${detail.client_phone}` : ''}`
        try { await financeApi.addIncome({ amount: Number(detail.cash), comment }) } catch { /* тихо: нет прав или офлайн */ }
      }
      // Денежный ящик открываем ПОСЛЕ возврата на зал и без await: принтер,
      // который не отвечает, держит сокет до 5 с (printRaw timeout) — именно
      // эта пауза и читалась как «закрытие заказа думает 5–6 секунд».
      const pr = receiptPrinter()
      if (pr?.ip_address) {
        Promise.resolve()
          .then(() => window.electron?.openDrawer?.({ ip: pr.ip_address, port: pr.port }))
          .catch(() => { /* ящик может не быть подключён */ })
      }
      // Возврат в закрытый заказ: итог уменьшился — сдачу отдаём клиенту.
      toast(refund > 0 ? `${t('refund_done')}: ${fmt(refund)} ${t('currency')}` : t('order_closed'))
      setPayExisting(null)
      setOrderLines([]); setAddToOrderId(null); setExistingOrder(null); setPaidBefore(0)
      setView('floor')
      loadFloor()
    } catch (e) {
      const reason = e?.paymentErrorKey ? t(e.paymentErrorKey) : e?.response?.data?.detail
      toast(t('close_order_error') + (reason ? ': ' + (typeof reason === 'string' ? reason : t('payment_invalid_amount')) : ''), 'error')
      if ([400, 422].includes(e?.response?.status)) await refreshPayOrder(order)
    } finally { closingOrders.current.delete(order.id) }
  }
  // Живой пересчёт итога: пока кассир вводит наличные в модалке оплаты — подтягиваем
  // заказ с сервера (скидки, дозаказы). Ошибка тихая: остаёмся на локальных данных.
  async function refreshPayOrder(order) {
    if (!order?.id) return
    try { const upd = await orders.get(order.id); setPayExisting(upd) } catch { /* тихо */ }
  }
  // Отмена заказа — со спец-паролем (проверяется на бэкенде) + комментарий причины.
  function cancelOrder(order) {
    setPromptCfg({
      title: t('cancel_order'),
      hint: t('cancel_password_prompt'),
      type: 'password',
      extra: { label: t('cancel_comment'), placeholder: t('cancel_comment_ph') },
      submitLabel: t('cancel_order'),
      onSubmit: async (pwd, comment) => {
        await orders.cancel(order.id, pwd, comment || undefined)
        setPromptCfg(null); setPayExisting(null)
        setOrderLines([]); setAddToOrderId(null); setExistingOrder(null); setView('floor')
        loadFloor()
      },
    })
  }
  // Смена официанта заказа
  async function setOrderWaiter(order, waiterId) {
    try {
      const upd = await orders.update(order.id, { waiter_id: waiterId })
      setPayExisting((cur) => (cur ? { ...cur, waiter_id: waiterId } : cur))
      setExistingOrder(upd)
      loadFloor()
    } catch (e) { toast(e?.response?.data?.detail || e.message) }
  }
  // ОТМЕНА БЛЮДА — обязательная причина. Комментарий уходит в аудит позиции и
  // печатается в чеке (бэкенд хранит его в позиции заказа).
  function cancelOrderItem(line) {
    if (!line?.orderItemId || !addToOrderId) return
    setPromptCfg({
      title: t('cancel_dish'),
      hint: t('cancel_dish_reason'),
      placeholder: t('cancel_dish_reason_ph'),
      submitLabel: t('cancel_dish'),
      onSubmit: async (reason) => {
        const text = String(reason || '').trim()
        if (!text) throw new Error(t('cancel_dish_reason_required'))
        const upd = await orders.removeItem(addToOrderId, line.orderItemId, text)
        setPromptCfg(null); setEditLine(null)
        setExistingOrder(upd)
        setOrderLines(orderToLines(upd))
        loadFloor()
      },
    })
  }
  // Возврат закрытого заказа в работу: гость вернул блюдо — открываем заказ,
  // отменяем позицию с причиной, закрываем снова (со сдачей).
  function reopenOrder(order) {
    setPromptCfg({
      title: t('reopen_order'),
      hint: t('reopen_order_hint'),
      placeholder: t('reopen_reason_ph'),
      allowEmpty: true,
      submitLabel: t('reopen_order'),
      onSubmit: async (reason) => {
        let upd
        try { upd = await orders.reopen(order.id, reason || null) }
        catch (e) { throw new Error(e?.response?.data?.detail || t('reopen_error')) }
        setPromptCfg(null); setHistOpen(false)
        let paid = 0
        try {
          const list = await payments.forOrder(upd.id)
          paid = (Array.isArray(list) ? list : [])
            .filter((p) => p.status === 'completed')
            .reduce((s, p) => s + Number(p.amount || 0), 0)
        } catch { /* нет связи — сдача посчитается при оплате от серверного итога */ }
        await openExistingOrder(upd, paid)
        toast(t('reopened_toast'))
      },
    })
  }
  // Скидка на существующий заказ — применяется в модалке оплаты (сервер пересчитывает итог)
  async function applyOrderDiscount(order, amount) {
    const upd = await orders.update(order.id, { discount_amount: amount })
    setPayExisting(upd)
    if (existingOrder) setExistingOrder(upd)
    loadFloor()
  }
  // Перенос заказа на другой стол — цель выбирается по id стола и подписывается залом.
  function reassignTable(order) {
    const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(String(v || ''))
    setPromptCfg({
      title: t('move_table'),
      hint: t('move_to_table'),
      options: allTables.map((table) => ({
        value: isUuid(table.id) ? String(table.id) : String(table.number),
        label: `${table.zoneName ? table.zoneName + ' · ' : ''}${t('table')} ${table.number}`,
      })),
      initial: order.table_id ? String(order.table_id) : (order.table_number || ''),
      extra: { label: t('move_reason'), placeholder: t('move_reason_ph') },
      submitLabel: t('save'),
      onSubmit: async (value, reason) => {
        const target = allTables.find((t) => String(t.id) === String(value) || String(t.number) === String(value))
        const payload = isUuid(target?.id)
          ? { table_id: target.id, reason: reason || undefined }
          : { table_number: String(target?.number ?? value), reason: reason || undefined }
        await orders.update(order.id, payload)
        setPromptCfg(null); setPayExisting(null)
        setOrderLines([]); setAddToOrderId(null); setExistingOrder(null); setView('floor')
        loadFloor()
      },
    })
  }

  // ── Каталог/корзина ──
  const filtered = products.filter((p) => {
    if (search) { const q = search.toLowerCase(); return p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) }
    return activeCat ? p.category_id === activeCat : true
  })
  // Клик по блюду в меню — сразу в заказ (без модалки). У курьера всё «с собой».
  function addToCart(product) {
    if (product.is_available === false || product.in_stop_list) return // в стоп-листе
    setCart((prev) => {
      const same = prev.find((i) => i.product?.id === product.id
        && !i.note && !(i.modifiers?.length) && Boolean(i.takeaway) === Boolean(courier))
      if (same) return prev.map((i) => i.lineId === same.lineId ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { lineId: `${Date.now()}-${Math.random()}`, product, name: product.name, price: Number(product.price) || 0, qty: 1, note: '', takeaway: courier }]
    })
  }
  // Правка НОВОЙ позиции (кол-во/цена/комментарий/добавки)
  function saveEdit({ quantity, price, note, takeaway, modifiers }) {
    setCart((prev) => prev.map((i) => i.lineId === editLine.lineId ? { ...i, qty: quantity, price, note, takeaway, modifiers: modifiers || [] } : i))
    setEditLine(null)
  }
  function updateQty(lineId, d) { setCart((prev) => prev.map((i) => i.lineId === lineId ? { ...i, qty: i.qty + d } : i).filter((i) => i.qty > 0)) }
  // Плюс/минус на УЖЕ заказанной позиции. Количество меняет бэкенд (позиция
  // уже на кухне), поэтому локально подменяем снимок заказа — строка и итог
  // пересчитываются из ответа сервера, без «оптимистичных» расхождений.
  // qtyBusy гасит двойной клик: два быстрых нажатия иначе отправят одно и то же
  // абсолютное количество, и вместо 3 порций получится 2.
  const qtyBusy = useRef(new Set())
  async function changeSavedQty(item, delta) {
    if (!addToOrderId || !item?.orderItemId || qtyBusy.current.has(item.lineId)) return
    const next = Number(item.qty) + delta
    if (next < 1) return
    qtyBusy.current.add(item.lineId)
    try {
      const upd = await orders.setItemQuantity(addToOrderId, item.orderItemId, next)
      setExistingOrder(upd)
      setOrderLines(orderToLines(upd))
      loadFloor()
    } catch (e) {
      toast(e?.response?.data?.detail || e.message, 'error')
    } finally {
      qtyBusy.current.delete(item.lineId)
    }
  }
  // «С собой» переключается в карточке блюда (карандаш): отдельный тумблер
  // в строке корзины ломал общую сетку — кнопки количества уезжали влево.

  const orderLinesSum = orderLines.reduce((s, i) => s + Number(i.total ?? (i.price * i.qty)), 0)
  const cartSum = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const total = orderLinesSum + cartSum
  const itemCount = orderLines.reduce((s, i) => s + i.qty, 0) + cart.reduce((s, i) => s + i.qty, 0)
  const linesCount = orderLines.length + cart.length

  // Панель заказа заполняется — прокручиваем её вниз, чтобы последняя
  // добавленная позиция всегда была на виду.
  useEffect(() => {
    const el = cartItemsRef.current
    if (!el) return
    // Без requestAnimationFrame: в свёрнутом/перекрытом окне кадры не
    // приходят и прокрутка не выполнялась вовсе. DOM уже обновлён к моменту
    // useEffect, поэтому присваивания достаточно.
    el.scrollTop = el.scrollHeight
  }, [linesCount, view])

  // Досылаем новые строки в существующий заказ и возвращаем свежий снимок.
  async function pushCartToOrder() {
    if (!addToOrderId || !cart.length) return existingOrder
    for (const i of cart) {
      await orders.addItem(addToOrderId, { product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: !!i.takeaway, modifiers: i.modifiers || [] })
      setCart(prev => prev.filter(line => line.lineId !== i.lineId))
    }
    const fresh = await orders.get(addToOrderId)
    setCart([])
    setExistingOrder(fresh)
    setOrderLines(orderToLines(fresh))
    loadFloor()
    return fresh
  }

  // Создание заказа / дозаказ. Позиции уходят повару (авто-печать кухонного
  // чека на бэкенде), оплата/закрытие — отдельным шагом.
  async function createOrder() {
    if (!cart.length || creating || orderSubmitLock.current) return
    orderSubmitLock.current = true
    setCreating(true)
    try {
      if (addToOrderId) {
        // Дозаказ: бэкенд в add_item сам возвращает заказ в «готовится».
        await pushCartToOrder()
        toast(t('order_created'))
      } else {
        await orders.create({
          branch_id: user.branch_id,
          order_type: orderType,
          table_id: orderType === 'dine_in' ? (selectedTable?.id || undefined) : undefined,
          table_number: orderType === 'dine_in' && selectedTable?.number != null ? String(selectedTable.number) : undefined,
          note: orderNote || undefined,
          customer_id: custId || undefined,
          customer_phone: orderType === 'delivery' ? (fullPhone(deliveryPhone) || undefined) : undefined,
          customer_address: orderType === 'delivery' ? (deliveryAddress || undefined) : undefined,
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: courier ? true : !!i.takeaway, modifiers: i.modifiers || [] })),
        })
        if (courier) setActiveZone('delivery')
        else if (orderType === 'delivery' || orderType === 'takeaway') setActiveZone(orderType)
        setView('floor'); loadFloor()
        toast(t('order_created'))
      }
    } catch (err) {
      toast(errorMessage(err, t('create_order_error')), 'error')
    } finally {
      orderSubmitLock.current = false
      setCreating(false)
    }
  }

  // «К оплате»: сначала досылаем новые строки (если есть), потом открываем оплату.
  async function openPayment() {
    if (!addToOrderId) return
    try {
      const fresh = await pushCartToOrder()
      const order = fresh || await orders.get(addToOrderId)
      let paid = paidBefore
      if (!paid) {
        try {
          const list = await payments.forOrder(order.id)
          paid = (Array.isArray(list) ? list : [])
            .filter((p) => p.status === 'completed')
            .reduce((s, p) => s + Number(p.amount || 0), 0)
        } catch { /* тихо */ }
      }
      setPaidBefore(paid)
      setPayExisting(order)
    } catch (e) {
      toast(t('create_order_error') + ': ' + (e?.response?.data?.detail || e.message), 'error')
    }
  }

  // Официант: дослать новые блюда в заказ и вернуться к столам.
  // Оплату не открываем — счёт закрывает кассир.
  async function addDishesToOrder() {
    if (!addToOrderId || !cart.length || creating) return
    setCreating(true)
    try {
      await pushCartToOrder()
      toast(t('order_created'))
      setView('floor')
      loadFloor()
    } catch (e) {
      toast(errorMessage(e, t('create_order_error')), 'error')
    } finally {
      setCreating(false)
    }
  }

  // Экран оплаты — общий для обоих видов. Раньше он рендерился только в виде
  // «столы», поэтому кнопка «К оплате» из корзины ставила состояние и молчала:
  // модалки в этом дереве просто не было.
  const paymentOverlay = payExisting ? (
    <PaymentModal
      order={payExisting}
      onPrint={printOrderReceipt}
      onComplete={completeExistingOrder}
      onCancel={cancelOrder}
      onReassign={reassignTable}
      staff={staff}
      onSetWaiter={setOrderWaiter}
      onApplyDiscount={applyOrderDiscount}
      onRefreshOrder={refreshPayOrder}
      canClose={canCloseBill}
      canDebt={canDebt}
      paidBefore={paidBefore}
      paymentMethods={paymentMethods}
      onClose={() => { setPayExisting(null); setPaidBefore(0) }}
    />
  ) : null

  // ═══ Вид: столы (кассир) / доска заказов (курьер) ═══
  if (view === 'floor') {
    return (
      <div className="floor">
        <aside className="ws-side">
          {courier ? (
            <>
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

        <main className="ws__main ws__main--board">
          <div className="board__scroll">
            {orderBoard ? (
              boardOrders.length === 0 ? <p className="empty-text">{t('no_orders')}</p> : (
                <div className="tgrid">
                  {boardOrders.map((o) => {
                    const variant = o.status === 'ready' ? 'check' : o.receipt_printed_at ? 'pay' : 'busy'
                    return (
                      <button key={o.id} className={`tcard tcard--${variant}`} onClick={() => { if (!courier) openExistingOrder(o) }}>
                        <div className="tcard__top">
                          <span className="tcard__num">#{o.order_number ?? ''}</span>
                          <span className="tcard__seats">{activeZone === 'delivery' ? <Bike /> : <ShoppingBag />}</span>
                        </div>
                        {o.customer_phone && <span className="tcard__client">{formatPhone(extractPhoneDigits(o.customer_phone)) || o.customer_phone}</span>}
                        {activeZone === 'delivery' && o.customer_address && <span className="tcard__client">{o.customer_address}</span>}
                        <span className="tcard__meta"><Clock /> {fmtTime(o.created_at)}
                          {o.total_amount != null && <span className="tcard__amount">{fmt(o.total_amount)} {t('currency')}</span>}
                        </span>
                        <span className="tcard__status">{t.status(o.status)}</span>
                      </button>
                    )
                  })}
                </div>
              )
            ) : loading ? <p className="empty-text">{t('loading')}</p> : shownZones.length === 0 ? (
              <div className="empty-text" role={hallsError ? 'alert' : 'status'}>
                <p>{hallsError || t('no_halls')}</p>
                <button className="btn btn--primary btn--sm" onClick={loadFloor}>{t('retry')}</button>
              </div>
            ) : shownZones.map((z) => (
              <section className="tgroup" key={z.id}>
                <div className="tgroup__title">{z.name} <span>{(z.tables || []).length} {t('tables_low')}</span></div>
                <div className="tgrid">
                  {(z.tables || []).map((tb) => {
                    const o = orderFor(tb); const st = tableStatus(tb)
                    const variant = st === 'free' ? 'free' : st === 'ready' ? 'check' : st === 'await' ? 'pay' : 'busy'
                    return (
                      <button key={tb.id ?? tb.number} className={`tcard tcard--${variant}`} onClick={() => tapTable(tb)}>
                        <div className="tcard__top">
                          <span className="tcard__num">{tb.number}</span>
                          <span className="tcard__seats"><Users /> {tb.capacity || 4}</span>
                        </div>
                        {o ? (
                          <>
                            <div className="tcard__order">
                              <span className="tcard__client">{t('order_no')} #{o.order_number ?? ''}</span>
                              <span className="tcard__time"><Clock /> {fmtTime(o.created_at)}</span>
                            </div>
                            {o.total_amount != null && <span className="tcard__amount">{fmt(o.total_amount)} {t('currency')}</span>}
                          </>
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
        {/* «Столы / С собой / Доставка» — одна лента по центру шапки:
            раньше «Столы» стояли у бренда, а остальные — у меню «…», и
            переключатель читался как два разных контрола. */}
        {showTypeTabs && tabsSlot && createPortal(
          <div className="topbar-order-types" role="group" aria-label={t('receipt_order_type')}>
            <button
              type="button"
              className={`topbar-type ${orderBoard ? '' : 'is-active'}`}
              onClick={() => setActiveZone('all')}
              aria-pressed={!orderBoard}
            >
              <LayoutGrid size={18} /> {t('tables')}
            </button>
            {showTakeawayTab && (
              <button
                type="button"
                className={`topbar-type ${activeZone === 'takeaway' ? 'is-active' : ''}`}
                onClick={() => setActiveZone('takeaway')}
                aria-pressed={activeZone === 'takeaway'}
              >
                <ShoppingBag size={18} /> {t('takeaway')}
              </button>
            )}
            {showDeliveryTab && (
              <button
                type="button"
                className={`topbar-type ${activeZone === 'delivery' ? 'is-active' : ''}`}
                onClick={() => setActiveZone('delivery')}
                aria-pressed={activeZone === 'delivery'}
              >
                <Bike size={18} /> {t('delivery')}
              </button>
            )}
          </div>,
          tabsSlot,
        )}
        {/* Сводка доски — в шапке, рядом с кнопкой «Столы». Отдельная строка
            заголовка над сеткой съедала место: теперь карточки начинаются
            сразу от верха экрана. */}
        {boardSlot && createPortal(
          <div className="topbar-board">
            <span className="topbar-board__meta">
              {orderBoard
                ? `${boardOrders.length} ${t('orders_low')}`
                : `${shownTables.length} ${t('tables_low')} · ${busyCount} ${t('busy_low')}`}
            </span>
            {orderBoard && (
              <button className="btn btn--primary btn--sm" onClick={() => openOrder(activeZone, null)}><Plus size={18} /> {t('new_order')}</button>
            )}
          </div>,
          boardSlot,
        )}
        {/* Меню разделов — иконка-кнопка в шапке рядом с блокировкой и настройками.
            Официанту оно не нужно: его работа — блюда и печать чека. */}
        {hdrActionsSlot && !courier && !isWaiter && createPortal(
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
        {histOpen && <HistoryPanel branch={{ id: user.branch_id }} printerId={user.printer_id} onReopen={canCloseBill ? reopenOrder : undefined} onClose={() => setHistOpen(false)} />}
        {repOpen && <ReportsPanel branch={{ id: user.branch_id }} user={user} onClose={() => setRepOpen(false)} />}
        {stopOpen && <StopListPanel user={user} onClose={() => setStopOpen(false)} />}
        {attOpen && <AttendancePanel user={user} onClose={() => setAttOpen(false)} />}
        {staffOpen && <StaffManagerPanel onClose={() => setStaffOpen(false)} />}
        {whOpen && <WarehouseWritePanel onClose={() => setWhOpen(false)} />}
        {printOpen && <BatchPrintPanel branch={{ id: user.branch_id }} printerId={user.printer_id} onClose={() => setPrintOpen(false)} />}
        {paymentOverlay}
        {promptCfg && <InputPromptModal {...promptCfg} onClose={() => setPromptCfg(null)} />}
      </div>
    )
  }

  // ═══ Вид: заказ (меню + корзина) ═══
  // Один и тот же экран для нового стола и для правки существующего заказа:
  // справа сначала уже заказанные блюда, под ними — новые.
  const editingExisting = Boolean(addToOrderId)
  const tableLabel = selectedTable?.number != null ? `${t('table')} ${selectedTable.number}` : t(orderType)
  const orderTitle = editingExisting
    ? `${t('order_no')} #${existingOrder?.order_number ?? ''}${selectedTable?.number != null ? ` · ${tableLabel}` : ''}`
    : (orderType === 'dine_in' ? tableLabel : t(orderType))
  return (
    <div className="floor">
      <aside className="ws-side">
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
                    <span className="product-card__price">{fmt(p.price)} {t('currency')}</span>
                    {stopped && <span className="product-card__stop">STOP</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <aside className="cashier-cart">
            <div className="cashier-cart__header">
              <ShoppingBag size={18} />
              <div className="cashier-cart__head-text">
                <span className="cashier-cart__head-title">{orderTitle}</span>
                <span className="cashier-cart__head-sub">{itemCount} {t('items_low')} · {fmt(total)} {t('currency')}</span>
              </div>
              <span className="cart-count">{itemCount}</span>
            </div>
            <div className="cashier-cart__items" ref={cartItemsRef}>
              {linesCount === 0 ? <p className="cart-empty">{t('tap_dish_hint')}</p> : (
                <>
                  {/* Уже заказанные блюда: плюс/минус меняют количество (блюдо
                      уже на кухне, поэтому считает сервер), карандаш открывает
                      карточку позиции — там видно, кто добавил, можно сменить
                      официанта и отменить блюдо. */}
                  {orderLines.map((item) => (
                    <div key={item.lineId} className="cart-item cart-item--saved">
                      <button type="button" className="cart-item__info" onClick={() => setEditLine(item)} title={t('edit')}>
                        <span className="cart-item__name">{item.name}</span>
                        {(item.addedByName || item.createdAt) && (
                          <span className="cart-item__meta">
                            {item.createdAt ? fmtTime(item.createdAt) : ''}
                            {item.addedByName ? `${item.createdAt ? ' · ' : ''}${item.addedByName}` : ''}
                          </span>
                        )}
                        {item.note && <span className="cart-row__note">{item.note}</span>}
                        <span className="cart-item__price">{fmt(item.total ?? item.price * item.qty)} {t('currency')}</span>
                      </button>
                      <div className="cart-item__controls">
                        {/* Официант не правит уже отправленные блюда — только добавляет новые. */}
                        {!isWaiter && <button className="qty-btn" onClick={() => changeSavedQty(item, -1)} title={t('qty_less')}><Minus size={16} /></button>}
                        <span className="qty-value">{formatQty(item.qty)}</span>
                        {!isWaiter && <button className="qty-btn" onClick={() => changeSavedQty(item, 1)} title={t('qty_more')}><Plus size={16} /></button>}
                        <button className="qty-btn qty-btn--edit" onClick={() => setEditLine(item)} title={t('qty_edit')}><Pencil size={15} /></button>
                      </div>
                    </div>
                  ))}
                  {/* Новые блюда — ещё не ушли на кухню, показываем их отдельной группой */}
                  {cart.map((item) => (
                    <div key={item.lineId} className="cart-item cart-item--new">
                      <button type="button" className="cart-item__info" onClick={() => setEditLine(item)} title={t('edit')}>
                        <span className="cart-item__name">{item.name}</span>
                        {item.note && <span className="cart-row__note">{item.note}</span>}
                        <span className="cart-item__price">{fmt(item.price * item.qty)} {t('currency')}</span>
                      </button>
                      <div className="cart-item__controls">
                        <button className="qty-btn" onClick={() => updateQty(item.lineId, -1)} title={t('qty_less')}><Minus size={16} /></button>
                        <span className="qty-value">{formatQty(item.qty)}</span>
                        <button className="qty-btn" onClick={() => updateQty(item.lineId, 1)} title={t('qty_more')}><Plus size={16} /></button>
                        <button className="qty-btn qty-btn--edit" onClick={() => setEditLine(item)} title={t('qty_edit')}><Pencil size={15} /></button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            {orderType === 'delivery' && !editingExisting && (
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
            {cart.length > 0 && !editingExisting && (
              <input className="cashier-cart__note" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} placeholder={t('comment')} />
            )}
            <div className="cashier-cart__total">
              <div className="total-row total-row--final"><span>{t('total')}</span><span>{fmt(total)} {t('currency')}</span></div>
            </div>
            <div className="cashier-cart__actions">
              {/* Существующий заказ. Кассир закрывает счёт кнопкой «К оплате»
                  (новые строки досылаются внутри openPayment). Официант счёт
                  не закрывает: он только досылает блюда и печатает чек. */}
              {editingExisting ? (
                isWaiter ? (
                  <>
                    <button className="cart-btn cart-btn--outline" disabled={!existingOrder} onClick={() => printOrderReceipt(existingOrder)}>
                      <Printer size={18} /> {t('print_receipt')}
                    </button>
                    <button className="cart-btn cart-btn--pay" disabled={creating || cart.length === 0} onClick={addDishesToOrder}>
                      {creating ? <span className="btn-spinner" aria-hidden="true" /> : <Plus size={20} />} {t('add_dishes')}
                    </button>
                  </>
                ) : (
                  <button className="cart-btn cart-btn--pay" disabled={creating} onClick={openPayment}>
                    <Receipt size={20} /> {t('to_payment')}
                  </button>
                )
              ) : (
                <button className="cart-btn cart-btn--pay" disabled={cart.length === 0 || creating} onClick={createOrder}>
                  {creating ? <span className="btn-spinner" aria-hidden="true" /> : <Plus size={20} />} {t('create_order')}
                </button>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* «Назад» — в шапке справа от текста логотипа (место в сайдбаре
          освободилось под категории). Показываем только на экране заказа. */}
      {backSlot && createPortal(
        <button
          className="icon-btn topbar__back"
          onClick={backFromOrder}
          title={courier || editingExisting ? t('back') : t('to_tables')}
          aria-label={courier || editingExisting ? t('back') : t('to_tables')}
        >
          <ArrowLeft size={22} />
        </button>,
        backSlot,
      )}

      {/* Поиск блюда — рядом с брендом в шапке: так он не отнимает высоту
          у панели заказа, и она начинается сразу под топбаром. */}
      {searchSlot && createPortal(
        <div className="topbar-search">
          <Search size={18} className="search-icon" />
          <input
            className="search-input"
            placeholder={t('search_dish')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>,
        searchSlot,
      )}

      {editLine && (
        <DishModal
          product={editLine.product}
          line={editLine}
          readOnly={Boolean(editLine.orderItemId)}
          meta={{ addedByName: editLine.addedByName, createdAt: editLine.createdAt }}
          onCancelDish={!isWaiter && editLine.orderItemId ? () => cancelOrderItem(editLine) : undefined}
          onSubmit={saveEdit}
          onClose={() => setEditLine(null)}
          hideTakeaway={courier || (orderType === 'dine_in' && !can(user, 'can_takeaway_at_table'))}
        />
      )}
      {paymentOverlay}
      {promptCfg && <InputPromptModal {...promptCfg} onClose={() => setPromptCfg(null)} />}
    </div>
  )
}
