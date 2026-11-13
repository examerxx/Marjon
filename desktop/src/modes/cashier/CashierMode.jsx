import WaiterPicker from '../../components/WaiterPicker'
import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, Plus, Utensils, Pencil, Coffee, CupSoda,
  LayoutGrid, Armchair, DoorClosed, Sun, Wine, CalendarClock, ArrowLeft, Users, User, Clock, Wallet, BarChart3, ShoppingBag, Bike, Boxes, Printer, Receipt,
  Bell, ClipboardList, Settings, RefreshCw, List, MoreHorizontal, Eye, X, Minus, Save, Ban,
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
import PinPad from '../../pages/PinPad'
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
// Иконка строки заказа: напитки — чашка/стакан, блюда — вилка с ножом.
function itemIcon(name = '') {
  const n = String(name).toLowerCase()
  if (/компот|сок|лимонад|кола|морс/.test(n)) return CupSoda
  if (/чай|кофе|капучино|латте|эспрессо/.test(n)) return Coffee
  return Utensils
}
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
      discount: Number(it.discount) || 0,
      note: it.note || '',
      takeaway: !!it.takeaway,
      modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
      addedByName: it.added_by_name || it.waiter_name || '',
      createdAt: it.created_at || '',
      waiterId: it.added_by || it.waiter_id || '',
      course: it.course,
    }))
}

export default function CashierMode({ user = {}, onBack, onSettings, courier = false }) {
  const [zones, setZones] = useState([])
  const [orderList, setOrderList] = useState([])
  const [activeZone, setActiveZone] = useState(courier ? 'delivery' : 'all')
  const [loading, setLoading] = useState(true)
  const [hallsError, setHallsError] = useState('')
  const orderSubmitLock = useRef(false)
  const cartItemsRef = useRef(null)
  // Доска заказов: число колонок читаем из самой сетки, чтобы «+ Добавить заказ»
  // заполняли ровно 4 ряда при любом размере экрана.
  const boardScrollRef = useRef(null)
  const [hallCols, setHallCols] = useState(6)
  const [hallRows, setHallRows] = useState(4)
  useLayoutEffect(() => {
    const el = boardScrollRef.current
    if (!el) return undefined
    const measure = () => {
      const grid = el.querySelector('.hgrid')
      if (!grid) return
      const n = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      if (n > 0) setHallCols((c) => (c === n ? c : n))
      // Размер карточки фиксирован (220 px + зазор 10): на высоком экране ряды
      // добавляются снизу, но не меньше четырёх.
      const rows = Math.max(4, Math.floor((el.clientHeight - 6 + 10) / (220 + 10)))
      setHallRows((r) => (r === rows ? r : rows))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  })

  // Курьер стартует на доске своих заказов (доставка). Физических столов у него нет
  const [view, setView] = useState('floor')  // floor | order
  // Нижний док: «Все столы» (залы) и «По официантам» (заказы сгруппированы
  // по ответственным). По официантам — стартовая доска.
  const [hallMode, setHallMode] = useState('waiters')   // tables | waiters
  const [waiterFilter, setWaiterFilter] = useState(null)   // id официанта или null
  const [orderType, setOrderType] = useState(courier ? 'delivery' : 'dine_in')
  const [selectedTable, setSelectedTable] = useState(null)

  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])                 // НОВЫЕ строки (ещё не отправлены)
  const [orderLines, setOrderLines] = useState([])     // строки уже оформленного заказа
  // Плюс/минус на уже внесённых блюдах: { orderItemId: новое количество }.
  // Правки копятся локально и уходят на сервер кнопкой «Сохранить».
  const [qtyDraft, setQtyDraft] = useState({})
  const [orderNote, setOrderNote] = useState('')
  const [deliveryPhone, setDeliveryPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [custId, setCustId] = useState(null)
  const [custMatches, setCustMatches] = useState([])
  const [editLine, setEditLine] = useState(null)
  const [cartEditOpen, setCartEditOpen] = useState(false)
  // Выбранный в карточке заказа официант: применяется по «Сохранить» (null — не менялся)
  const [cartEditWaiter, setCartEditWaiter] = useState(null)
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
  // Чужой заказ официант открывает после PIN его владельца; без кода — только
  // просмотр (кнопка «Назад» на пин-паде).
  const [orderReadOnly, setOrderReadOnly] = useState(false)
  const [pinGate, setPinGate] = useState(null)            // { ownerId, employee, title, onSuccess, onCancel }
  const [tablePick, setTablePick] = useState(null)         // { actingFor, zoneId } — «где сидит гость?»
  const [creating, setCreating] = useState(false)         // создание заказа (лоадер кнопки)
  const [staff, setStaff] = useState([])                 // сотрудники (для смены официанта)
  // Кто сегодня вошёл по PIN / открыл смену. Сайдбар «По официантам» показывает
  // только их, а не весь штат филиала.
  const [activeStaffIds, setActiveStaffIds] = useState([])
  const [printerMap, setPrinterMap] = useState({})
  const [addToOrderId, setAddToOrderId] = useState(null) // id заказа, в который ДОБАВЛЯЕМ блюда (иначе создаём новый)
  const [existingOrder, setExistingOrder] = useState(null) // снимок заказа, который редактируем
  const [paidBefore, setPaidBefore] = useState(0)         // сколько оплачено до возврата в закрытый заказ
  // Ячейки «Добавить заказ» на доске «По официантам»: заказ, созданный с
  // нажатой ячейки, остаётся на ней и сразу показывает блюда. Привязка живёт
  // в localStorage — после перезагрузки терминала карточка остаётся на месте.
  const slotStorageKey = `marjon_hall_slots:${user.branch_id || localStorage.getItem('marjon_staff_branch') || 'default'}`
  const [slotBindings, setSlotBindings] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(slotStorageKey) || '{}')
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    } catch { return {} }
  })
  // Снимок только что созданного заказа: карточка видна ещё до ответа loadFloor.
  const [slotOrderCache, setSlotOrderCache] = useState({})
  const slotIntentRef = useRef(null)        // ячейка, с которой открыли заказ
  const slotReturnFilterRef = useRef(null)  // фильтр официантов для возврата
  const slotWaiterRef = useRef(null)        // на кого создаём (чужой PIN подтверждён)
  const slotBoundAt = useRef({})            // id → время привязки (защита от гонки с polling)
  // Перенос карточки заказа на соседнюю ячейку профиля: тянем влево/вправо.
  const [dragSlot, setDragSlot] = useState(null)   // { orderId, from, over }
  const dragStartRef = useRef(null)                // { x, y, from, orderId }
  const suppressClickRef = useRef(false)           // после переноса клик не открывает заказ
  useEffect(() => {
    try { localStorage.setItem(slotStorageKey, JSON.stringify(slotBindings)) } catch { /* quota */ }
  }, [slotStorageKey, slotBindings])
  // Снятая привязка (заказ закрыт/отменён) убирает и снимок из кэша.
  useEffect(() => {
    const ids = new Set(Object.values(slotBindings).map(String))
    setSlotOrderCache((prev) => {
      const keys = Object.keys(prev)
      if (keys.every((k) => ids.has(k))) return prev
      const next = {}
      for (const k of keys) if (ids.has(k)) next[k] = prev[k]
      return next
    })
  }, [slotBindings])
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

  // Слоты шапки (TopBar в App.jsx): поиск и «назад» рендерим порталом, чтобы
  // элементы жили в шапке, а состояние осталось здесь.
  const [searchSlot, setSearchSlot] = useState(null)
  const [backSlot, setBackSlot] = useState(null)
  const [dockSlot, setDockSlot] = useState(null)
  useEffect(() => {
    setSearchSlot(document.getElementById('topbar-center-slot'))
    setBackSlot(document.getElementById('topbar-back-slot'))
    setDockSlot(document.getElementById('bottombar-nav-slot'))
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
      .then((d) => {
        const all = Array.isArray(d) ? d : d?.items || []
        const active = all.filter((o) => ACTIVE.has(o.status))
        setOrderList(active)
        // Закрытый/отменённый заказ освобождает ячейку. Свежую привязку не
        // срезаем: ответ polling мог уйти на сервер раньше создания заказа.
        setSlotBindings((prev) => {
          const ids = new Set(active.map((o) => String(o.id)))
          const now = Date.now()
          let changed = false
          const next = {}
          for (const [slot, id] of Object.entries(prev)) {
            if (ids.has(String(id)) || now - (slotBoundAt.current[String(id)] || 0) < 15000) next[slot] = id
            else { changed = true; delete slotBoundAt.current[String(id)] }
          }
          return changed ? next : prev
        })
      })
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

  // «В смене»: у кого сейчас открыта смена. Раз в 15 с — чтобы закрытая
  // смена сразу убирала имя из рейла, а не висела до конца дня.
  const refreshActiveStaff = useCallback(() => {
    authApi.activeStaff()
      .then((ids) => setActiveStaffIds((Array.isArray(ids) ? ids : []).map(String)))
      .catch(() => { /* офлайн — показываем прежний список/весь штат */ })
  }, [])

  useEffect(() => {
    refreshActiveStaff()
    const id = setInterval(refreshActiveStaff, 15000)
    return () => clearInterval(id)
  }, [refreshActiveStaff])

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

  // ── Один экран заказа: и новый стол, и редактирование существующего ──
  function resetOrderDraft() {
    setCart([]); setOrderNote(''); setSearch(''); setActiveCat(null)
    setDeliveryPhone(''); setDeliveryAddress(''); setCustId(null); setCustMatches([])
    setEditLine(null)
    setCartEditOpen(false)
  }
  // Ячейка «Добавить заказ» → созданный заказ остаётся на этой ячейке.
  // Ключ привязки — «сотрудник:ячейка»: у каждого профиля своя раскладка,
  // иначе заказ одного официанта переносил карточку в чужом профиле.
  function bindSlot(index, order, ownerId) {
    if (index == null || !order?.id) return
    const id = String(order.id)
    const owner = String(ownerId || order.waiter_id || user.id)
    slotBoundAt.current[id] = Date.now()
    setSlotOrderCache((prev) => ({ ...prev, [id]: order }))
    setSlotBindings((prev) => ({ ...prev, [`${owner}:${index}`]: id }))
  }
  function clearSlotIntent() {
    slotIntentRef.current = null
    slotReturnFilterRef.current = null
    slotWaiterRef.current = null
  }
  // «Добавить заказ» (+) сначала спрашивает, где сидит гость: зал и стол из
  // конструктора зала. Заказ без стола больше не открывается — иначе на доске
  // появлялась карточка, которую некуда посадить в зале.
  function openTablePicker(actingFor) {
    const current = zones.find((z) => z.id === activeZone)
    const firstFreeZone = zones.find((z) => freeCount(z.tables || []) > 0)
    setTablePick({
      actingFor: actingFor || null,
      zoneId: current?.id || firstFreeZone?.id || zones[0]?.id || null,
    })
  }
  function chooseTable(tb) {
    const actingFor = tablePick?.actingFor || null
    const pickedZoneId = tablePick?.zoneId || null
    const pickedReturn = tablePick?.returnLine || null
    setTablePick(null)
    if (tablePick?.moveOrder) {
      confirmTableMove(tablePick.moveOrder, tb, pickedZoneId, pickedReturn)
      return
    }
    // Ячейку «+», с которой открыли заказ, не забываем: карточка вернётся
    // на неё же, а не отдельной группой сверху (иначе все плюсы съезжают).
    slotWaiterRef.current = actingFor
    openOrder('dine_in', { id: tb.id, number: tb.number })
  }
  // Отмена выбора стола: ячейка «+» больше не цель — заказ с неё не начинали.
  function closeTablePicker() {
    const backLine = tablePick?.returnLine || null
    setTablePick(null)
    clearSlotIntent()
    if (backLine) setEditLine(backLine)
  }
  function openOrder(type, table) {
    // Быстрый чек/доставка сбрасывают намерение ячейки — заказ не её.
    if (type !== 'dine_in') clearSlotIntent()
    resetOrderDraft()
    setOrderType(type); setSelectedTable(table || null)
    setAddToOrderId(null)   // новый заказ
    setExistingOrder(null); setOrderLines([]); setPaidBefore(0)
    setOrderReadOnly(false)
    setView('order')
  }
  // Владелец заказа: waiter_id, иначе ищем сотрудника по имени (старые заказы).
  function orderOwnerId(order) {
    if (order?.waiter_id) return String(order.waiter_id)
    if (!order?.waiter_name) return null
    const match = [...hallWaiters, ...staff].find((w) => w.name && w.name === order.waiter_name)
    return match ? String(match.id) : null
  }
  // Чужой заказ официант открывает только для просмотра: PIN владельца
  // спрашиваем позже — по кнопке «Добавить заказ» (см. unlockForeignOrder).
  async function openExistingOrder(order, paid = 0) {
    if (!order?.id) return
    const ownerId = orderOwnerId(order)
    const foreign = roleSlugOf(user) === 'waiter' && Boolean(ownerId) && ownerId !== String(user.id)
    clearSlotIntent()   // открыли готовый заказ — ячейка больше не создаётся
    setOrderReadOnly(foreign)
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
  // «Добавить заказ» в чужом заказе: PIN владельца подтверждает дозаказ,
  // сессия остаётся своей. Отмена на пин-паде оставляет режим просмотра.
  function unlockForeignOrder() {
    const ownerId = orderOwnerId(existingOrder)
    const owner = [...boardWaiters, ...staff].find((w) => String(w.id) === ownerId)
      || { id: ownerId, name: existingOrder?.waiter_name || '' }
    setPinGate({
      ownerId,
      employee: owner,
      onSuccess: () => setOrderReadOnly(false),
    })
  }
  // Выход из меню назад: возвращаемся к столам. Черновик сбрасываем, иначе
  // выбранные блюда «переехали» бы в следующий заказ.
  function backFromOrder() {
    clearSlotIntent()
    setCart([]); setOrderNote(''); setEditLine(null); setAddToOrderId(null)
    setExistingOrder(null); setOrderLines([]); setPaidBefore(0)
    setOrderReadOnly(false)
    setView('floor')
  }
  // «Назад» в TopBar (App.jsx): сначала закрываем верхний слой
  // (модалка ввода → блюдо → экран оплаты → панели), затем выходим из меню
  // к столам. Если закрывать нечего — не помечаем handled, и App уводит
  // к выбору сотрудника. Так «Назад» никогда не разлогинивает случайно.
  useEffect(() => {
    function onNavBack(e) {
      const mark = () => { e.detail.handled = true }
      if (pinGate) {
        const cancel = pinGate.onCancel
        setPinGate(null)
        cancel?.()
        mark()
        return
      }
      if (promptCfg) { setPromptCfg(null); mark(); return }
      if (tablePick) { closeTablePicker(); mark(); return }
      if (editLine) { setEditLine(null); mark(); return }
      if (cartEditOpen) { setCartEditOpen(false); mark(); return }
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
  }, [pinGate, promptCfg, tablePick, editLine, cartEditOpen, payExisting, finOpen, histOpen, repOpen, stopOpen, attOpen, staffOpen, whOpen, printOpen, view])
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
  // Заводить заказ на другого сотрудника, править и печатать его чек может
  // только касса/администрация. Официант работает строго под своим именем,
  // а чужие заказы открывает для просмотра.
  const canActForOthers = ['owner', 'manager', 'admin', 'cashier'].includes(roleSlug)
  const canCloseBill = can(user, 'can_close_bill') && !isWaiter
  const canDebt = canCloseBill && roleSlug !== 'courier'

  // Full payment is recorded atomically by /payments (including stock deduction).
  // Долг (method === 'debt'): фактически полученные наличные пишем приходом в финансы
  // best-effort — без права на финансы или офлайн запись тихо пропускается.
  async function completeExistingOrder(order, method, detail) {
    if (closingOrders.current.has(order.id)) return
    closingOrders.current.add(order.id)
    const refund = order.reopened_at ? Math.max(0, Number(paidBefore || 0) - Number(order?.total_amount || 0)) : 0
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
        const payment = await payments.confirmOrder(order, method, detail)
        if (detail?.partialAmount !== undefined) {
          const remaining = Number(payment.remaining_amount)
          if (remaining > 0) {
            setPaidBefore(Math.round((Number(order.total_amount) - remaining) * 100) / 100)
            return { partial: true, payment }
          }
        }
      }
      if (method === 'debt' && detail && Number(detail.cash) > 0) {
        const comment = `Долг: заказ #${order.order_number ?? ''}, получено ${fmt(detail.cash)}, остаток ${fmt(detail.debt)}${detail.client_name ? `, клиент: ${detail.client_name}` : ''}${detail.client_phone ? `, тел: ${detail.client_phone}` : ''}`
        try { await financeApi.addIncome({ amount: Number(detail.cash), comment }) } catch { /* тихо: нет прав или офлайн */ }
      }
      // Денежный ящик открываем ПОСЛЕ возврата на зал и без await: принтер,
      // который не отвечает, держит сокет до 5 с (printRaw timeout) — именно
      // эта пауза и читалась как «закрытие заказа думает 5–6 секунд».
      const pr = receiptPrinter()
      if (pr?.ip_address && method !== 'VIP') {
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
      throw e
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
      compact: true,
      hint: t('cancel_password_prompt'),
      type: 'password',
      extra: { label: t('cancel_comment'), placeholder: t('cancel_comment_ph') },
      submitLabel: t('cancel_order'),
      onSubmit: async (pwd, comment) => {
        await orders.cancel(order.id, pwd, comment || undefined)
        setPromptCfg(null); setPayExisting(null); setCartEditOpen(false)
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
    const backLine = line
    setPromptCfg({
      title: t('cancel_dish'),
      compact: true,
      type: 'password',
      hint: t('cancel_dish_password'),
      allowEmpty: true,                    // пароль нужен, только если задан в настройках
      extra: { label: t('cancel_dish_reason_label'), placeholder: '' },
      submitLabel: t('cancel_dish'),
      onBack: () => setEditLine(backLine),
      onSubmit: async (pin, reason) => {
        const text = String(reason || '').trim()
        // Через общий «adjust»: проверяет пароль и печатает на кухне «ОТМЕНА БЛЮДА»
        const upd = await orders.adjustItems(addToOrderId, [{ itemId: line.orderItemId, quantity: 0 }], { pin, reason: text || undefined })
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
  // returnLine — карточка блюда, из которой открыли выбор стола: «×»/«Отмена» возвращают к ней.
  function reassignTable(order, returnLine = null) {
    const zone = zones.find((entry) => entry.tables?.some((table) => String(table.id) === String(order.table_id)))
    setTablePick({ moveOrder: order, zoneId: zone?.id || zones[0]?.id || null, returnLine })
  }

  function confirmTableMove(order, target, zoneId, returnLine = null) {
    const fromCard = cartEditOpen
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(String(target.id || ''))
    setPromptCfg({
      title: t('move_table'),
      // «Отмена»/крестик возвращают к выбору стола, а не закрывают всё
      onBack: () => setTablePick({ moveOrder: order, zoneId: zoneId || null, returnLine }),
      hint: `${target.zoneName ? target.zoneName + ' · ' : ''}${t('table')} ${target.number}`,
      placeholder: t('move_reason_ph'),
      compact: true,
      allowEmpty: true,
      submitLabel: t('save'),
      onSubmit: async (reason) => {
        const payload = isUuid
          ? { table_id: target.id, reason: reason || undefined }
          : { table_number: String(target.number), reason: reason || undefined }
        const upd = await orders.update(order.id, payload)
        setPromptCfg(null); setPayExisting(null)
        // Перенос из карточки заказа: остаёмся на заказе, карточка остаётся открытой
        // с новым столом в заголовке.
        if (fromCard) {
          setExistingOrder(upd)
          setSelectedTable(upd?.table_number != null ? { id: upd.table_id || undefined, number: upd.table_number } : null)
          loadFloor()
          return
        }
        setCartEditOpen(false)
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

  // ── Плюс/минус на внесённых блюдах (только кассир, пока заказ не оплачен) ──
  // Дробные порции (1.3): складываем с округлением до 3 знаков, иначе 0.3+1 ≠ 1.3
  const r3 = (n) => Math.round(Number(n) * 1000) / 1000
  const canAdjustQty = !orderReadOnly && !isWaiter && Boolean(addToOrderId)
  const shownQty = (item) => (item.orderItemId && qtyDraft[item.orderItemId] != null ? qtyDraft[item.orderItemId] : item.qty)
  // Сумма строки при изменённом количестве: цена за порцию × кол-во (скидка и
  // добавки уже заложены в item.total, поэтому масштабируем его).
  const shownLineTotal = (item) => {
    const base = Number(item.total ?? item.price * item.qty)
    const qty = shownQty(item)
    return r3(qty) === r3(item.qty) || !item.qty ? base : (base / item.qty) * qty
  }
  const qtyChanges = orderLines
    .filter((line) => qtyDraft[line.orderItemId] != null && r3(qtyDraft[line.orderItemId]) !== r3(line.qty))
    .map((line) => ({ line, from: line.qty, to: qtyDraft[line.orderItemId] }))
  function stepLineQty(line, direction) {
    setQtyDraft((prev) => {
      const current = prev[line.orderItemId] != null ? prev[line.orderItemId] : line.qty
      const next = r3(current + direction)
      if (next < 0) return prev           // 0 = отменить блюдо целиком (при «Сохранить» — пароль)
      if (next === r3(line.qty)) {
        const { [line.orderItemId]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [line.orderItemId]: next }
    })
  }

  // Новые блюда существующего заказа (ещё не отправлены на кухню): «−/+» меняют
  // корзину сразу; на нуле строка пропадает — отправлять нечего.
  const canStepCart = !orderReadOnly   // и при создании нового заказа, и при дозаказе
  function stepCartQty(item, direction) {
    setCart((prev) => prev.flatMap((line) => {
      if (line.lineId !== item.lineId) return [line]
      const next = r3(line.qty + direction)
      return next > 0 ? [{ ...line, qty: next }] : []
    }))
  }

  const orderLinesSum = orderLines.reduce((s, i) => s + shownLineTotal(i), 0)
  const cartSum = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const total = orderLinesSum + cartSum
  const linesCount = orderLines.length + cart.length

  function catalogProduct(item) {
    return products.find((product) => String(product.id) === String(item.product?.id)) || item.product
  }

  async function changeDishWaiter(line, waiterId) {
    async function save(actionPin) {
      const updated = await orders.setItemWaiter(addToOrderId, line.orderItemId, waiterId, undefined, actionPin)
      const lines = orderToLines(updated)
      setExistingOrder(updated)
      setOrderLines(lines)
      setEditLine(lines.find(item => item.orderItemId === line.orderItemId) || null)
      loadFloor()
    }

    try {
      await save()
    } catch (error) {
      if (error?.response?.data?.detail !== 'Неверный пароль подтверждения операции') throw error
      setPromptCfg({
        title: t('change_waiter'), compact: true, type: 'password',
        hint: t('cancel_password_prompt'),
        onSubmit: async (pin) => { await save(pin); setPromptCfg(null) },
      })
    }
  }

  function renderCartLines() {
    if (linesCount === 0) return <p className="cart-empty">{t('tap_dish_hint')}</p>

    return [...orderLines, ...cart].map((item) => {
      const rowStatus = item.orderItemId ? ' cart-item--sent' : ' cart-item--draft'
      const details = [item.createdAt && fmtTime(item.createdAt), item.addedByName, item.note].filter(Boolean).join(' · ')
      // Внесённое блюдо кассира: «− N +» по сторонам количества. До создания
      // заказа и у новых строк корзины остаётся обычное число.
      const isSaved = Boolean(item.orderItemId)
      const stepper = isSaved ? canAdjustQty : canStepCart
      const qty = isSaved ? shownQty(item) : item.qty
      const changed = stepper && isSaved && r3(qty) !== r3(item.qty)
      const removed = stepper && isSaved && qty === 0
      const body = (
        <>
          <span className="cart-item__info">
            <span className="cart-item__name">{item.name}</span>
          </span>
          {stepper ? (
            <span className={`cart-item__stepper${changed ? (qty < item.qty ? ' is-changed is-down' : ' is-changed is-up') : ''}`} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="cart-item__step" aria-label={t('qty_decrease')}
                disabled={qty <= 0 || creating}
                onClick={() => (isSaved ? stepLineQty(item, -1) : stepCartQty(item, -1))}>
                <Minus size={16} />
              </button>
              <span className="cart-item__step-value">{formatQty(qty)}</span>
              <button type="button" className="cart-item__step" aria-label={t('qty_increase')}
                disabled={creating} onClick={() => (isSaved ? stepLineQty(item, 1) : stepCartQty(item, 1))}>
                <Plus size={16} />
              </button>
            </span>
          ) : (
            <span className="cart-item__qty-badge">
              {formatQty(item.qty)}
            </span>
          )}
          <span className="cart-item__side">
            {details && <span className="cart-item__meta" title={details}>{details}</span>}
            <span className="cart-item__price">{fmt(item.orderItemId ? shownLineTotal(item) : (item.total ?? item.price * item.qty))}</span>
          </span>
        </>
      )
      // Со степпером строка — div: кнопки − и + внутри <button> недопустимы.
      return stepper ? (
        <div key={item.lineId} role="button" tabIndex={0}
          className={`cart-item cart-item--view cart-item--summary cart-item--stepper${rowStatus}${removed ? ' cart-item--removed' : ''}`}
          onClick={() => setEditLine(item)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditLine(item) }}>
          {body}
        </div>
      ) : (
        <button key={item.lineId} className={`cart-item cart-item--view cart-item--summary${rowStatus}`}
          type="button" onClick={() => setEditLine(item)}>
          {body}
        </button>
      )
    })
  }


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

  const appendInFlight = useRef(null)

  // Досылаем новые строки в существующий заказ и возвращаем свежий снимок.
  // Одна пакетная команда: повар получает один тикет со всеми новыми блюдами.
  async function pushCartToOrder() {
    if (!addToOrderId || !cart.length) return existingOrder
    if (appendInFlight.current) return appendInFlight.current
    const request = orders.appendDraftItems(addToOrderId, cart).then(({ order: fresh, sentIds }) => {
      const sent = new Set(sentIds)
      setCart(prev => prev.filter(line => !sent.has(line.lineId)))
      setExistingOrder(fresh)
      setOrderLines(orderToLines(fresh))
      loadFloor()
      return fresh
    }).finally(() => { appendInFlight.current = null })
    appendInFlight.current = request
    return request
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
        const created = await orders.create({
          branch_id: user.branch_id,
          // Ячейка на доске выбранного официанта: заказ оформляем на него
          // (PIN уже подтверждён), иначе — на текущего пользователя.
          waiter_id: slotWaiterRef.current || undefined,
          order_type: orderType,
          table_id: orderType === 'dine_in' ? (selectedTable?.id || undefined) : undefined,
          table_number: orderType === 'dine_in' && selectedTable?.number != null ? String(selectedTable.number) : undefined,
          note: orderNote || undefined,
          customer_id: custId || undefined,
          customer_phone: orderType === 'delivery' ? (fullPhone(deliveryPhone) || undefined) : undefined,
          customer_address: orderType === 'delivery' ? (deliveryAddress || undefined) : undefined,
          items: cart.map((i) => ({ product_id: i.product.id, quantity: i.qty, note: i.note || null, takeaway: courier ? true : !!i.takeaway, modifiers: i.modifiers || [] })),
        })
        // Заказ, начатый с ячейки «Добавить заказ», возвращается на неё же:
        // кассир/официант сразу видит блюда на нажатой карточке.
        if (created?.id && slotIntentRef.current != null && orderType === 'dine_in') {
          bindSlot(slotIntentRef.current, created, slotReturnFilterRef.current || created.waiter_id)
          setHallMode('waiters')
          setWaiterFilter(slotReturnFilterRef.current)
        }
        clearSlotIntent()
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
        const list = await payments.forOrder(order.id)
        paid = (Array.isArray(list) ? list : [])
          .filter((p) => p.status === 'completed')
          .reduce((s, p) => s + Number(p.amount || 0), 0)
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
      toast(t('dishes_sent'))
      setView('floor')
      loadFloor()
    } catch (e) {
      toast(errorMessage(e, t('create_order_error')), 'error')
    } finally {
      setCreating(false)
    }
  }

  // Кассир: дослать блюда и остаться в заказе — следом он жмёт «К оплате».
  async function addDishesAndStay() {
    if (!addToOrderId || !cart.length || creating) return
    setCreating(true)
    try {
      await pushCartToOrder()
      toast(t('dishes_sent'))
    } catch (e) {
      toast(errorMessage(e, t('create_order_error')), 'error')
    } finally {
      setCreating(false)
    }
  }

  // Правки плюс/минус не переживают выход из заказа или смену заказа.
  useEffect(() => { setQtyDraft({}) }, [addToOrderId, view])

  // «Сохранить»: правки количества внесённых блюд (+ новые блюда из корзины,
  // если они есть). Любое уменьшение — это отмена части блюда: сначала окно
  // «Отменить блюдо» с паролем и необязательной причиной. Одни только плюсы и
  // новые блюда идут без пароля. Чеки на кухню печатает бэкенд.
  async function saveOrderChanges() {
    if (!addToOrderId || creating || (!qtyChanges.length && !cart.length)) return
    const payload = qtyChanges.map(({ line, to }) => ({ itemId: line.orderItemId, quantity: to }))
    const hasDecrease = qtyChanges.some(({ from, to }) => to < from)

    async function run(pin, reason) {
      setCreating(true)
      try {
        if (payload.length) {
          let fresh
          try {
            fresh = await orders.adjustItems(addToOrderId, payload, { pin, reason })
          } catch (e) {
            // Бэкенд без /items/adjust: честно говорим, а не показываем «Not Found».
            if ([404, 405].includes(e?.response?.status)) throw new Error(t('adjust_backend_missing'))
            throw e
          }
          setExistingOrder(fresh)
          setOrderLines(orderToLines(fresh))
          setQtyDraft({})
        }
        if (cart.length) await pushCartToOrder()
        toast(t('order_saved'))
        loadFloor()
      } finally {
        setCreating(false)
      }
    }

    if (hasDecrease) {
      setPromptCfg({
        title: t('cancel_dish'),
        compact: true,
        type: 'password',
        hint: t('cancel_dish_password'),
        // Пароль нужен, только если он задан у компании: пустой уходит как есть,
        // а бэкенд сам скажет «Неверный пароль», если его требуют.
        allowEmpty: true,
        // Список изменённых блюд: что было и что станет.
        changes: qtyChanges.map(({ line, from, to }) => ({ name: line.name, from, to })),
        extra: { label: t('cancel_dish_reason_optional'), placeholder: '' },
        submitLabel: t('save'),
        onSubmit: async (pin, reason) => {
          await run(pin || undefined, reason || undefined)
          setPromptCfg(null)
        },
      })
      return
    }
    try {
      await run()
    } catch (e) {
      toast(errorMessage(e, t('create_order_error')), 'error')
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
      onResetPayments={async (order, paymentIds) => {
        await payments.resetPartial(order.id, paymentIds)
        setPaidBefore(0)
      }}
      onCancel={cancelOrder}
      onReassign={reassignTable}
      staff={staff}
      onSetWaiter={setOrderWaiter}
      onApplyDiscount={applyOrderDiscount}
      onRefreshOrder={refreshPayOrder}
      canClose={canCloseBill}
      canDebt={canDebt}
      paidBefore={paidBefore}
      onClose={() => { setPayExisting(null); setPaidBefore(0) }}
    />
  ) : null

  // Пин-пад общий для доски зала и экрана заказа: подтверждает действие
  // на чужом заказе, не меняя текущую сессию терминала. Заголовок не нужен,
  // а имя сотрудника в карточке показывает, чей код вводят.
  const pinGateOverlay = pinGate ? (
    <div className="pin-gate">
      <PinPad
        employee={pinGate.employee}
        onSubmit={async (pin) => {
          await authApi.verifyPin(pin, pinGate.ownerId)
          const run = pinGate.onSuccess
          setPinGate(null)
          run?.()
        }}
        onBack={() => {
          const cancel = pinGate.onCancel
          setPinGate(null)
          cancel?.()
        }}
      />
    </div>
  ) : null

  // «Добавить заказ» (+) сначала спрашивает зал и стол: стол выбирается из
  // конструктора зала. Занятые столы видны, но выбрать их нельзя — заказ
  // откроется только за свободным столом.
  const tablePickerZone = tablePick
    ? (zones.find((z) => z.id === tablePick.zoneId) || zones[0] || null)
    : null
  const tablePickOverlay = tablePick ? (
    <div
      className={tablePick.moveOrder ? `table-pick table-pick--move${cartEditOpen ? ' table-pick--top' : ''}` : "table-pick"}
      role="dialog"
      aria-modal="true"
      aria-label={t(tablePick.moveOrder ? 'move_table' : 'pick_table_title')}
      onClick={closeTablePicker}
    >
      <div className="table-pick__panel" onClick={(e) => e.stopPropagation()}>
        <header className="table-pick__head">
          <p className="table-pick__hint">
            {t(tablePick.moveOrder ? 'move_table' : 'pick_table_hint')}
            {tablePick.moveOrder && (() => {
              const o = tablePick.moveOrder
              const z = zones.find((zn) => zn.tables?.some((tb) => String(tb.id) === String(o.table_id)))
              const num = o.table_number ?? z?.tables?.find((tb) => String(tb.id) === String(o.table_id))?.number
              if (!z && num == null) return null
              return (
                <strong className="table-pick__current">
                  {[z?.name, num != null ? `${t('table')} ${num}` : null].filter(Boolean).join(' · ')}
                </strong>
              )
            })()}
          </p>
          <button
            type="button"
            className="table-pick__close"
            onClick={closeTablePicker}
            aria-label={t('close')}
          >
            <X size={22} />
          </button>
        </header>
        {zones.length === 0 ? (
          <p className="table-pick__empty">{t('no_halls')}</p>
        ) : (
          <>
            <div className="table-pick__zones" role="group" aria-label={t('hall')}>
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  aria-pressed={z.id === tablePickerZone?.id}
                  className={`table-pick__zone ${z.id === tablePickerZone?.id ? 'is-active' : ''}`}
                  onClick={() => setTablePick((prev) => ({ ...prev, zoneId: z.id }))}
                >
                  {z.name}
                  <span className="table-pick__zone-count">{freeCount(z.tables || [])}</span>
                </button>
              ))}
            </div>
            <div className="table-pick__grid">
              {(tablePickerZone?.tables || []).length === 0 ? (
                <p className="table-pick__empty">{t('pick_table_no_tables')}</p>
              ) : tablePickerZone.tables.map((tb) => {
                const status = tableStatus(tb)
                return (
                  <button
                    key={tb.id ?? tb.number}
                    type="button"
                    className={`table-pick__table ${status === 'free' ? 'table-pick__table--free' : 'table-pick__table--busy'}`}
                    disabled={status !== 'free'}
                    onClick={() => chooseTable(tb)}
                  >
                    <span className="table-pick__table-cap">{t('table')}</span>
                    <span className="table-pick__table-no">{tb.number}</span>
                    <span className="table-pick__table-status">
                      <span className={`table-pick__dot ${status === 'free' ? 'table-pick__dot--free' : status === 'ready' ? 'table-pick__dot--ready' : status === 'await' ? 'table-pick__dot--await' : 'table-pick__dot--busy'}`} />
                      {t(status)}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  ) : null

  // ── По официантам: сотрудники и их заказы ──
  // Рейл показывает официантов и кассиров, которые сегодня вошли по PIN /
  // открыли смену. Уволенные/отключённые не показываются вовсе:
  // /auth/staff-users отдаёт их для раздела «Сотрудники», а не для кассы.
  const activeStaffList = staff.filter((u) => u.is_active !== false)
  const hallRoles = activeStaffList.filter((u) => ['waiter', 'cashier'].includes(roleSlugOf(u)))
  const waitersAll = hallRoles.length > 0 ? hallRoles : activeStaffList
  const belongsToWaiter = (o, w) => {
    if (!o || !w) return false
    if (o.waiter_id && String(o.waiter_id) === String(w.id)) return true
    return Boolean(o.waiter_name && w.name && o.waiter_name === w.name)
  }
  const ordersOfWaiter = (w) => orderList.filter((o) => o.order_type === 'dine_in' && belongsToWaiter(o, w))
  // Сайдбар показывает только тех, у кого открыта смена (activeStaffIds).
  // Смена закрыта — имени в рейле нет. Сотрудник за этим терминалом остаётся
  // всегда.
  const activeSet = new Set(activeStaffIds)
  const worksToday = (w) => activeSet.has(String(w.id)) || String(w.id) === String(user.id)
  const waitersToday = waitersAll.filter(worksToday)
  // Сотрудник, который ввёл свой PIN, стоит первым: его заказы видны сразу,
  // остальные пользователи остаются в списке следом.
  const selfIndex = waitersToday.findIndex((w) => String(w.id) === String(user.id))
  const hallWaiters = selfIndex > 0
    ? [waitersToday[selfIndex], ...waitersToday.filter((_, i) => i !== selfIndex)]
    : waitersToday
  // Доска не теряет заказы сотрудника, который уже закрыл смену: его имя
  // уходит из рейла, но открытые столы должны оставаться видимыми.
  const boardWaiters = (() => {
    const list = [...hallWaiters]
    const known = new Set(list.map((w) => String(w.id)))
    for (const o of orderList) {
      if (o.order_type !== 'dine_in' || (!o.waiter_id && !o.waiter_name)) continue
      const owner = o.waiter_id
        ? staff.find((w) => String(w.id) === String(o.waiter_id))
        : staff.find((w) => w.name && w.name === o.waiter_name)
      if (owner && !known.has(String(owner.id))) { known.add(String(owner.id)); list.push(owner) }
    }
    return list
  })()
  // Без фильтра доска показывает все группы: иначе при одном выбранном
  // сотруднике правая часть доски оставалась пустой. Фильтр включается
  // кликом по имени и снимается пунктом «Все».
  useEffect(() => {
    if (!waiterFilter) return
    // Свой профиль существует всегда: не сбрасываем его, пока штат грузится.
    if (String(waiterFilter) === String(user.id)) return
    if (hallWaiters.some((w) => String(w.id) === String(waiterFilter))) return
    if (staff.length === 0) return
    setWaiterFilter(null)
  }, [staff, activeStaffIds])

  // Официант входит на доску «Персонал» сразу в своём профиле: в окне только
  // его столы. «Все» остаётся доступным, чтобы посмотреть чужие.
  useEffect(() => {
    if (isWaiter) setWaiterFilter(String(user.id))
  }, [isWaiter, user.id])

  // Карточка занятого стола/заказа: зелёная шапка, состав заказа, итог.
  const orderCard = (o, { icon: HeadIcon = Utensils } = {}) => {
    const items = (o.items || []).filter((it) => it.status !== 'cancelled')
    const shown = items.slice(0, 4)
    const label = o.table_number != null
      ? `${t('table')} ${o.table_number}`
      : `#${o.order_number ?? ''}`
    const variant = o.receipt_printed_at ? 'pay' : o.status === 'ready' ? 'check' : 'busy'
    return (
      <button
        key={o.id}
        type="button"
        className={`hcard hcard--${variant}`}
        onClick={() => {
          if (suppressClickRef.current) return   // карточку только что перетащили
          if (!courier) openExistingOrder(o)
        }}
      >
        <span className="hcard__head">
          <span className="hcard__title"><HeadIcon size={18} /> {label}</span>
          <span className="hcard__time">
            <Clock size={13} /> {fmtTime(o.created_at)}
          </span>
        </span>
        <span className="hcard__body">
          {orderBoard && o.customer_phone && (
            <span className="hcard__client">{formatPhone(extractPhoneDigits(o.customer_phone)) || o.customer_phone}</span>
          )}
          {orderBoard && o.customer_address && <span className="hcard__client">{o.customer_address}</span>}
          <span className="hcard__items">
            {shown.map((it) => {
              const ItemIcon = itemIcon(it.name)
              return (
                <span className="hcard__item" key={it.id}>
                  <ItemIcon size={14} /> {formatQty(it.quantity)} × {it.name}
                </span>
              )
            })}
            {items.length > shown.length && <span className="hcard__more">+{items.length - shown.length}</span>}
            {items.length === 0 && <span className="hcard__item hcard__item--muted">{t.status(o.status)}</span>}
          </span>
        </span>
        <span className="hcard__foot">{fmt(o.total_amount)} {t('currency')}</span>
      </button>
    )
  }

  // Свободный стол — крупный «+» как на схеме зала. В «Все столы» подпись —
  // номер стола (у каждой ячейки свой), в «По официантам» — «Добавить заказ»:
  // оттуда клик ведёт на доску столов, где официант выбирает конкретный стол
  // и уже после выбора попадает в меню.
  const freeTableCard = (tb, { showNumber = false, pickTable = false } = {}) => (
    <button
      key={tb.id ?? tb.number}
      type="button"
      className="hcard hcard--free"
      onClick={() => (pickTable ? goHall('tables') : tapTable(tb))}
    >
      <span className="hcard__plus"><Plus size={26} /></span>
      <span className="hcard__free-title">
        {showNumber && tb.number != null ? `${t('table')} ${tb.number}` : t('add_order')}
      </span>
    </button>
  )

  // Тип заказа живёт в шапке: над сеткой столов больше нет строки, поэтому
  // карточки начинаются от самого верха доски.
  // Число активных заказов каждого типа — кружок на правом верхнем углу вкладки.
  const typeCount = (type) => orderList.filter((o) => o.order_type === type).length
  const typeBadge = (count) => (count > 0
    ? <span className="hall-type__badge" aria-label={`${count} ${t('orders')}`}>{count > 99 ? '99+' : count}</span>
    : null)
  const typeTabs = searchSlot && view === 'floor' && showTypeTabs && createPortal(
    <div className="hall-types hall-types--top" role="group" aria-label={t('receipt_order_type')}>
      <button
        type="button"
        className={`hall-type ${orderBoard ? '' : 'is-active'}`}
        onClick={() => setActiveZone('all')}
        aria-pressed={!orderBoard}
      >
        <LayoutGrid size={16} /> {t('tables')}
        {typeBadge(typeCount('dine_in'))}
      </button>
      {showTakeawayTab && (
        <button
          type="button"
          className={`hall-type ${activeZone === 'takeaway' ? 'is-active' : ''}`}
          onClick={() => setActiveZone('takeaway')}
          aria-pressed={activeZone === 'takeaway'}
        >
          <ShoppingBag size={16} /> {t('takeaway')}
          {typeBadge(typeCount('takeaway'))}
        </button>
      )}
      {showDeliveryTab && (
        <button
          type="button"
          className={`hall-type ${activeZone === 'delivery' ? 'is-active' : ''}`}
          onClick={() => setActiveZone('delivery')}
          aria-pressed={activeZone === 'delivery'}
        >
          <Bike size={16} /> {t('delivery')}
          {typeBadge(typeCount('delivery'))}
        </button>
      )}
    </div>,
    searchSlot,
  )

  const goHall = (mode) => {
    clearSlotIntent()
    setView('floor')
    setHallMode(mode)
    setActiveZone('all')
    // Доска «Персонал» открывается в профиле официанта. Касса видит «Все».
    setWaiterFilter(mode === 'waiters' && isWaiter ? String(user.id) : null)
  }

  // Верхние разделы живут в доке «Ещё»: шапка оставляет только бренд,
  // переключатель типа заказа и профиль справа.
  const moreItems = [
    { id: 'refresh', label: t('refresh'), Icon: RefreshCw, onClick: () => window.location.reload() },
    { id: 'events', label: t('nav_events'), Icon: Bell, onClick: () => setAttOpen(true) },
    { id: 'orders', label: t('orders'), Icon: ClipboardList, onClick: () => setHistOpen(true) },
    { id: 'stop', label: t('menu_more'), Icon: LayoutGrid, onClick: () => setStopOpen(true) },
    ...(must(user, 'can_view_finance') ? [{ id: 'fin', label: t('finance'), Icon: Wallet, onClick: () => setFinOpen(true) }] : []),
    { id: 'rep', label: t('reports'), Icon: BarChart3, onClick: () => setRepOpen(true) },
    ...(must(user, 'can_manage_staff') ? [{ id: 'staff', label: t('dev_staff'), Icon: Users, onClick: () => setStaffOpen(true) }] : []),
    ...(must(user, 'can_manage_staff') ? [{ id: 'wh', label: t('dev_warehouse'), Icon: Boxes, onClick: () => setWhOpen(true) }] : []),
    { id: 'print', label: t('print'), Icon: Printer, onClick: () => setPrintOpen(true) },
  ]

  // Нижний док: рабочие доски и быстрый чек.
  const dock = dockSlot && createPortal(
    <>
      {onSettings && (
        <button className="dock__item" onClick={onSettings}>
          <Settings size={26} /><span>{t('settings')}</span>
        </button>
      )}
      {!courier && (
        <>
          <button className={`dock__item ${view === 'floor' && hallMode === 'tables' ? 'is-active' : ''}`} onClick={() => goHall('tables')}>
            <List size={26} /><span>{t('all_tables')}</span>
          </button>
          <button className={`dock__item dock__item--sep ${view === 'floor' && hallMode === 'waiters' ? 'is-active' : ''}`} onClick={() => goHall('waiters')}>
            <Users size={26} /><span>{t('users')}</span>
          </button>
        </>
      )}
      <button className="dock__item dock__item--sep" onClick={() => openOrder(courier ? 'delivery' : 'takeaway', null)}>
        <Receipt size={26} /><span>{t('quick_check')}</span>
      </button>
      <HeaderMenu
        title={t('more')}
        label={t('more')}
        Icon={MoreHorizontal}
        variant="dock"
        items={moreItems}
      />
    </>,
    dockSlot,
  )

  // ═══ Вид: столы (кассир) / доска заказов (курьер) ═══
  if (view === 'floor') {
    const visibleZones = shownZones
      .map((zone) => ({ zone, tables: zone.tables || [] }))
      .filter(({ tables }) => tables.length > 0)
    // Заказы, привязанные к ячейкам «Добавить заказ», не дублируем в группах.
    const boundSlotIds = new Set(Object.values(slotBindings).map(String))
    // «Все» — общий зал: столы всех официантов вместе, без групп по людям
    // и только занятые. Свободные столы остаются на доске «Все столы».
    // В «Все» показываем все занятые столы, включая заказы с ячеек профилей:
    // иначе такой заказ пропадал бы из общего зала.
    const staffZones = visibleZones
      .map(({ zone, tables }) => ({
        zone,
        tables: tables.filter((tb) => Boolean(orderFor(tb))),
      }))
      .filter(({ tables }) => tables.length > 0)
    // В «По официантам» под группами всегда ровно 12 ячеек «Добавить заказ»:
    // одинаковый набор у каждого сотрудника, каждая ведёт на выбор стола.
    // Ячеек «+» столько, чтобы вместе с заказами получилось ровно 4 ряда на этом экране.
    const ADD_SLOTS = Math.max(1, hallCols) * Math.max(4, hallRows)

    // Профиль сотрудника из рейла «Персонал»: в окне только его столы по
    // схеме зала. Чужие и свободные столы не показываем — иначе профиль
    // Анвара снова превращался бы в общий зал. Заказы, привязанные к ячейкам,
    // остаются на своих ячейках и здесь не дублируются.
    const filterId = waiterFilter ? String(waiterFilter) : null
    const profileTables = filterId
      ? allTables.filter((tb) => {
          const o = orderFor(tb)
          return Boolean(o) && orderOwnerId(o) === filterId
        })
      : []
    const profileIds = new Set(profileTables.map((tb) => String(tb.id)))
    const profileZones = filterId
      ? zones
          .map((zone) => ({
            zone,
            tables: (zone.tables || []).filter((tb) => profileIds.has(String(tb.id))),
          }))
          .filter(({ tables }) => tables.length > 0)
      : []
    // Заказ без стола (открыт с «+») не привязан ни к одной ячейке зала —
    // без этой группы счётчик в рейле показывал заказ, а профиль пустовал.
    const isNoTable = (o) => o.order_type === 'dine_in'
      && !o.table_id && o.table_number == null
    const profileNoTable = filterId
      ? orderList.filter((o) => isNoTable(o) && orderOwnerId(o) === filterId)
      : []
    const staffNoTable = orderList.filter(isNoTable)
    // Заказы профиля (без привязанных к ячейкам) — идут в общую сетку.
    // Все столовые заказы сотрудника — ровно столько, сколько в счётчике рейла.
    // Раньше брались только заказы, однозначно привязанные к столу зала: заказ с
    // номером стола, который есть в нескольких залах (или без id стола), пропадал.
    const profileOrders = filterId
      ? orderList.filter((o) => o.order_type === 'dine_in' && orderOwnerId(o) === filterId)
      : []
    // Счётчик «Все» = ровно столько карточек, сколько на общей доске:
    // это сумма заказов всех сотрудников, а не число людей в рейле.
    // «Все» в «Персонал» — все активные заказы: столы, «С собой» и «Доставка».
    const allOrdersCount = new Set(orderList.map((o) => String(o.id))).size
    // «Все» — доска по сотрудникам, а не по залам: касса сразу видит,
    // кто ведёт какие столы, сколько их и на какую сумму. Порядок групп
    // повторяет рейл (свой профиль первым).
    const buildStaffGroups = (list) => {
      const groups = []
      const groupFor = (ownerId, name) => {
        let group = groups.find((g) => (ownerId ? g.ownerId === ownerId : g.name === name))
        if (!group) {
          const person = ownerId
            ? boardWaiters.find((w) => String(w.id) === ownerId)
            : boardWaiters.find((w) => w.name && w.name === name)
          group = {
            key: ownerId || `name:${name || 'none'}`,
            ownerId,
            name: person?.name || name || t('no_waiter'),
            orders: [],
          }
          groups.push(group)
        }
        return group
      }
      for (const o of list) groupFor(orderOwnerId(o), o.waiter_name).orders.push(o)
      const railIndex = (group) => {
        const i = group.ownerId
          ? boardWaiters.findIndex((w) => String(w.id) === group.ownerId)
          : -1
        return i === -1 ? boardWaiters.length : i
      }
      return groups.sort((a, b) => railIndex(a) - railIndex(b))
    }
    const staffGroups = buildStaffGroups(orderList)

    // Профиль сотрудника — одна сетка карточек: сначала его заказы, затем
    // «+». Заказ, созданный с ячейки, остаётся ровно на ней (slotBindings),
    // поэтому плюсы не съезжают вниз отдельной секцией. Карточку можно
    // перетащить на соседнюю ячейку — раскладка запоминается.
    const slotOrder = (id) => (id
      ? (orderList.find((o) => String(o.id) === String(id)) || slotOrderCache[String(id)] || null)
      : null)
    // Привязка ячейки: новый формат «сотрудник:ячейка»; старые записи
    // «ячейка» без владельца учитываем только для своего профиля.
    const boundOrderAt = (i) => {
      const keyed = slotOrder(slotBindings[`${filterId}:${i}`])
      if (keyed) return keyed
      const legacy = slotOrder(slotBindings[String(i)])
      return legacy && orderOwnerId(legacy) === filterId ? legacy : null
    }
    // Текущая раскладка профиля: что стоит в каждой ячейке.
    const profileCellOrders = () => {
      // Сначала заказы, закреплённые за своими ячейками; остальные заказы
      // сотрудника (в т.ч. с устаревшей привязкой) заполняют свободные.
      const placedIds = new Set()
      for (let i = 0; i < ADD_SLOTS; i += 1) {
        const bound = boundOrderAt(i)
        if (bound) placedIds.add(String(bound.id))
      }
      const queue = profileOrders.filter((o) => !placedIds.has(String(o.id)))
      const list = []
      for (let i = 0; i < ADD_SLOTS; i += 1) {
        list.push(boundOrderAt(i) || (queue.length > 0 ? queue.shift() : null))
      }
      list.push(...queue)
      return list
    }
    // Поменять местами ячейки from/to и запомнить раскладку целиком:
    // остальные карточки остаются на своих местах.
    function moveProfileOrder(from, to) {
      if (!filterId || from === to || from < 0 || to < 0) return
      const list = profileCellOrders()
      if (from >= list.length || to >= list.length) return
      const next = [...list]
      const tmp = next[from]
      next[from] = next[to]
      next[to] = tmp
      const now = Date.now()
      setSlotBindings((prev) => {
        const out = { ...prev }
        for (const key of Object.keys(out)) {
          if (key.startsWith(`${filterId}:`)) delete out[key]
          else if (/^\d+$/.test(key) && next.some((o) => String(o?.id) === String(out[key]))) delete out[key]
        }
        next.forEach((o, i) => {
          if (!o?.id) return
          slotBoundAt.current[String(o.id)] = now
          if (i < ADD_SLOTS) out[`${filterId}:${i}`] = String(o.id)
        })
        return out
      })
    }
    // Тянем карточку по горизонтали: мышь и палец, вертикальный скролл доски
    // продолжает работать.
    function startCellDrag(e, from, order) {
      if (!order || (e.button != null && e.button > 0)) return
      dragStartRef.current = { x: e.clientX, y: e.clientY, from, orderId: String(order.id) }
    }
    function moveCellDrag(e) {
      const start = dragStartRef.current
      if (!start) return
      if (!dragSlot) {
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) < 18 || Math.abs(dx) < Math.abs(dy)) return
        try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* указатель уже отпущен */ }
        setDragSlot({ orderId: start.orderId, from: start.from, over: start.from })
        return
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-slot]')
      const raw = el ? Number(el.getAttribute('data-slot')) : null
      const over = Number.isFinite(raw) && raw >= 0 && raw < ADD_SLOTS ? raw : dragSlot.over
      if (over !== dragSlot.over) setDragSlot((prev) => (prev ? { ...prev, over } : prev))
    }
    function endCellDrag() {
      const drag = dragSlot
      dragStartRef.current = null
      setDragSlot(null)
      if (!drag) return
      // Перенос — не клик: заказ не должен открываться после броска.
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 0)
      if (drag.over != null && drag.over !== drag.from) moveProfileOrder(drag.from, drag.over)
    }
    const dragCellClass = (i) => [
      dragSlot?.from === i ? 'hcell--drag' : '',
      dragSlot && dragSlot.from !== i && dragSlot.over === i ? 'hcell--over' : '',
    ].filter(Boolean).join(' ')
    // «+» есть и в чужом профиле: официант заводит заказ на коллегу только
    // после его PIN; касса/администрация — сразу.
    const addSlotButton = (i) => (
      <button
        key={`add-slot-${i}`}
        type="button"
        className="hcard hcard--free"
        onClick={() => {
          // Запоминаем, на кого оформляем (чужой профиль — после PIN коллеги),
          // и спрашиваем зал/стол из конструктора.
          const target = waiterFilter
            ? (hallWaiters.find((w) => String(w.id) === String(waiterFilter))
              || staff.find((w) => String(w.id) === String(waiterFilter)))
            : null
          const actingFor = target && String(target.id) !== String(user.id)
            ? String(target.id)
            : null
          const begin = () => {
            // Запоминаем ячейку: созданный заказ вернётся на неё,
            // остальные «+» останутся на своих местах.
            slotIntentRef.current = i
            slotReturnFilterRef.current = waiterFilter
            openTablePicker(actingFor)
          }
          // Официант на чужое имя — только после PIN коллеги.
          if (actingFor && isWaiter && !canActForOthers) {
            setPinGate({ ownerId: actingFor, employee: target, onSuccess: begin })
          } else {
            begin()
          }
        }}
      >
        <span className="hcard__plus"><Plus size={26} /></span>
        <span className="hcard__free-title">{t('add_order')}</span>
      </button>
    )
    const cellWrap = (i, order) => (
      <div
        key={order?.id || `cell-${i}`}
        className={`hcell ${dragCellClass(i)}`}
        data-slot={i}
        onPointerDown={(e) => startCellDrag(e, i, order)}
        onPointerMove={moveCellDrag}
        onPointerUp={endCellDrag}
        onPointerCancel={endCellDrag}
      >
        {order ? orderCard(order) : addSlotButton(i)}
      </div>
    )
    const profileCells = (() => {
      if (!filterId) return []
      const cells = []
      const list = profileCellOrders()
      for (let i = 0; i < ADD_SLOTS; i += 1) {
        const order = list[i] || null
        if (order) cells.push(cellWrap(i, order))
        else if (shownTables.length > 0) cells.push(cellWrap(i, null))
      }
      // Заказов больше, чем ячеек: остальные показываем следом.
      for (let i = ADD_SLOTS; i < list.length; i += 1) {
        const order = list[i]
        if (!order) continue
        cells.push(
          <div
            key={order.id}
            className="hcell"
            data-slot={i}
            onPointerDown={(e) => startCellDrag(e, i, order)}
            onPointerMove={moveCellDrag}
            onPointerUp={endCellDrag}
            onPointerCancel={endCellDrag}
          >
            {orderCard(order)}
          </div>,
        )
      }
      return cells
    })()

    return (
      <div className="floor">
        <aside className="ws-side hall-side">
          {courier ? (
            <>
              <div className="hall-side__head"><Bike size={18} /><span>{t('orders')}</span></div>
              <nav className="hall-side__nav">
                <button className="hall-item hall-item--active" onClick={() => setActiveZone('delivery')}>
                  <span className="hall-item__badge"><Bike size={18} /></span>
                  <span className="hall-item__name">{t('delivery')}</span>
                  <span className="hall-item__count">{deliveryOrders.length}</span>
                </button>
              </nav>
            </>
          ) : hallMode === 'tables' ? (
            <>
              <nav className="hall-side__nav hall-side__nav--flush">
                {zoneNav.map(({ id, name, count, Icon }) => (
                  <button
                    key={id}
                    className={`hall-item ${activeZone === id ? 'hall-item--active' : ''}`}
                    onClick={() => { setActiveZone(id); setWaiterFilter(null) }}
                  >
                    <span className="hall-item__badge"><Icon size={18} /></span>
                    <span className="hall-item__name">{name}</span>
                    <span className="hall-item__count">{count}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <>
              <div className="hall-side__head">
                <Users size={20} /><span>{t('users')}</span>
              </div>
              <nav className="hall-side__nav">
                <button
                  className={`hall-item hall-item--plain ${!waiterFilter ? 'hall-item--active' : ''}`}
                  onClick={() => setWaiterFilter(null)}
                >
                  <span className="hall-item__name">{t('all')}</span>
                  <span className="hall-item__count"><User size={14} /> {allOrdersCount}</span>
                </button>
                {hallWaiters.map((w) => (
                  <button
                    key={w.id}
                    className={`hall-item hall-item--plain ${String(waiterFilter) === String(w.id) ? 'hall-item--active' : ''}`}
                    onClick={() => setWaiterFilter(w.id)}
                  >
                    <span className="hall-item__name">{w.name}</span>
                    <span className="hall-item__count"><User size={14} /> {ordersOfWaiter(w).length}</span>
                  </button>
                ))}
              </nav>
            </>
          )}
        </aside>

        <main className="ws__main ws__main--board">
          <div className="board__scroll" ref={boardScrollRef}>
            {orderBoard ? (() => {
              const kindIcon = activeZone === 'delivery' ? Bike : ShoppingBag
              const addBoardOrder = (key) => (
                <button
                  key={key}
                  type="button"
                  className="hcard hcard--free"
                  onClick={() => openOrder(activeZone === 'delivery' ? 'delivery' : 'takeaway', null)}
                >
                  <span className="hcard__plus"><Plus size={26} /></span>
                  <span className="hcard__free-title">{t('add_order')}</span>
                </button>
              )
              // «Персонал → Все»: без «+», только заказы, разложенные по сотрудникам.
              if (hallMode === 'waiters' && !waiterFilter) {
                const groups = buildStaffGroups(boardOrders)
                return groups.length === 0
                  ? <p className="empty-text empty-text--board">{t('no_orders')}</p>
                  : groups.map((group) => (
                    <section className="hgroup" key={group.key}>
                      <div className="hgroup__title">{group.name}</div>
                      <div className="hgrid">{group.orders.map((o) => orderCard(o, { icon: kindIcon }))}</div>
                    </section>
                  ))
              }
              // Профиль сотрудника: его заказы + «+» до 4 рядов по ширине экрана.
              const mine = filterId ? boardOrders.filter((o) => orderOwnerId(o) === filterId) : boardOrders
              return (
                <section className="hgroup hgroup--fill">
                  <div className="hgrid">
                    {mine.map((o) => orderCard(o, { icon: kindIcon }))}
                    {Array.from({ length: Math.max(1, ADD_SLOTS - mine.length) }, (_, i) => addBoardOrder(`add-board-order-${i}`))}
                  </div>
                </section>
              )
            })(
            ) : loading ? <p className="empty-text empty-text--board">{t('loading')}</p> : shownZones.length === 0 ? (
              <div className="empty-text empty-text--board" role={hallsError ? 'alert' : 'status'}>
                <p>{hallsError || t('no_halls')}</p>
                <button className="btn btn--primary btn--sm" onClick={loadFloor}>{t('retry')}</button>
              </div>
            ) : hallMode === 'waiters' ? (
              waiterFilter ? (
                profileCells.length === 0
                  ? <p className="empty-text empty-text--board">{t('no_orders')}</p>
                  : (
                    <section className="hgroup hgroup--fill">
                      <div className="hgrid">{profileCells}</div>
                    </section>
                  )
              ) : staffGroups.length === 0
                ? <p className="empty-text empty-text--board">{t('no_orders')}</p>
                : staffGroups.map((group) => (
                  <section className="hgroup" key={group.key}>
                    <div className="hgroup__title">{group.name}</div>
                    <div className="hgrid">{group.orders.map((o) => orderCard(o, { icon: o.order_type === 'delivery' ? Bike : o.order_type === 'takeaway' ? ShoppingBag : Utensils }))}</div>
                  </section>
                ))
            ) : visibleZones.length === 0 ? (
              <p className="empty-text empty-text--board">{t('no_orders')}</p>
            ) : visibleZones.map(({ zone, tables }) => (
              <section className="hgroup" key={zone.id}>
                <div className="hgroup__title">
                  {zone.name} <span>{tables.length} {t.count(tables.length, 'tables')}</span>
                </div>
                <div className="hgrid">
                  {tables.map((tb) => {
                    const o = orderFor(tb)
                    return o ? orderCard(o) : freeTableCard(tb, { showNumber: true })
                  })}
                </div>
              </section>
            ))}
          </div>
        </main>
        {finOpen && <FinancePanel branch={{ id: user.branch_id }} user={user} onClose={() => setFinOpen(false)} />}
        {histOpen && <HistoryPanel branch={{ id: user.branch_id }} printerId={user.printer_id} onReopen={canCloseBill ? reopenOrder : undefined} onClose={() => setHistOpen(false)} />}
        {repOpen && <ReportsPanel branch={{ id: user.branch_id }} user={user} onClose={() => setRepOpen(false)} />}
        {stopOpen && <StopListPanel user={user} onClose={() => setStopOpen(false)} />}
        {attOpen && <AttendancePanel user={user} onClose={() => setAttOpen(false)} />}
        {staffOpen && <StaffManagerPanel onClose={() => setStaffOpen(false)} />}
        {whOpen && <WarehouseWritePanel onClose={() => setWhOpen(false)} />}
        {printOpen && <BatchPrintPanel branch={{ id: user.branch_id }} printerId={user.printer_id} onClose={() => setPrintOpen(false)} />}
        {paymentOverlay}
        {promptCfg && <InputPromptModal {...promptCfg} onClose={() => { const back = promptCfg.onBack; setPromptCfg(null); back?.() }} />}
        {pinGateOverlay}
        {tablePickOverlay}
        {typeTabs}
        {dock}
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
      {!orderReadOnly && (
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
      )}

      <main className="ws__main">
        <div className={`cashier-work ${orderReadOnly ? 'cashier-work--readonly' : ''}`}>
          {orderReadOnly ? (
            <div className="cashier-products cashier-readonly">
              <Eye size={34} />
              <p className="cashier-readonly__title">{t('read_only_order')}</p>
              <p className="cashier-readonly__hint">
                {existingOrder?.waiter_name ? `${existingOrder.waiter_name} · ` : ''}
                {t('read_only_order_hint')}
              </p>
            </div>
          ) : (
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
          )}

          <aside className="cashier-cart">
            <div className="cashier-cart__header">
              <span className="cashier-cart__head-title">{orderTitle}</span>
              {!orderReadOnly && existingOrder && (
                <button type="button" className="cart-edit-trigger" aria-label={t('cart_edit_title')}
                  title={t('cart_edit_title')} onClick={() => { setCartEditWaiter(null); setCartEditOpen(true) }}>
                  <Pencil size={15} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="cashier-cart__items" ref={cartItemsRef}>
              {renderCartLines()}
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
              {/* Существующий заказ. И официант, и кассир могут дослать
                  блюда — они сразу уходят на кухню отдельным тикетом.
                  Кассир дополнительно закрывает счёт кнопкой «К оплате»
                  (новые строки досылаются и внутри openPayment). */}
              {orderReadOnly ? (
                <button className="cart-btn cart-btn--pay" onClick={unlockForeignOrder}>
                  <Plus size={20} /> {t('add_order')}
                </button>
              ) : editingExisting ? (
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
                  <>
                    {/* Пока в корзине нет новых блюд, досылать нечего — не
                        показываем неактивную кнопку, оставляем только оплату. */}
                    {qtyChanges.length > 0 ? (
                      <button className="cart-btn cart-btn--outline" disabled={creating} onClick={saveOrderChanges}>
                        {creating ? <span className="btn-spinner" aria-hidden="true" /> : <Save size={20} />} {t('save')}
                      </button>
                    ) : cart.length > 0 && (
                      <button className="cart-btn cart-btn--outline" disabled={creating} onClick={addDishesAndStay}>
                        {creating ? <span className="btn-spinner" aria-hidden="true" /> : <Plus size={20} />} {t('add_dishes')}
                      </button>
                    )}
                    {/* Несохранённые «−/+» оплату не меняют — сначала «Сохранить». */}
                    <button className="cart-btn cart-btn--pay" disabled={creating || qtyChanges.length > 0} onClick={openPayment}>
                      <Receipt size={20} /> {t('to_payment')}
                    </button>
                  </>
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

      {cartEditOpen && !orderReadOnly && existingOrder && (() => {
        const currentWaiter = String(existingOrder.waiter_id || '')
        const pendingWaiter = cartEditWaiter === null ? currentWaiter : String(cartEditWaiter)
        const waiterChanged = pendingWaiter !== currentWaiter
        const closeEdit = () => { setCartEditOpen(false); setCartEditWaiter(null) }
        return (
          <div className={`modal-overlay dish-overlay${tablePick?.moveOrder ? ' dish-overlay--below' : ''}`} onClick={() => { if (!tablePick && !promptCfg) closeEdit() }}>
            <section className="modal dish-modal dish-modal--compact dish-modal--sent" role="dialog" aria-modal={!editLine}
              aria-label={t('cart_edit_title')} onClick={(event) => event.stopPropagation()}>
              <header className="modal__header dish-modal__head">
                <div className="dish-sent-heading"><h3>{orderTitle}</h3></div>
                <button type="button" className="icon-btn" aria-label={t('close')} onClick={closeEdit}>
                  <X size={24} />
                </button>
              </header>
              <div className="dish-modal__body">
                <div className="dish-sent-actions">
                  <WaiterPicker staff={staff} value={pendingWaiter} label={t('change_waiter')} hideLabel
                    onChange={(id) => setCartEditWaiter(id || '')} />
                  <button type="button" className="btn btn--outline" disabled={orderType !== 'dine_in'}
                    onClick={() => reassignTable(existingOrder)}>
                    {t('move_table')}
                  </button>
                  <button type="button" className="btn btn--outline"
                    onClick={() => cancelOrder(existingOrder)}>
                    <Ban size={18} /> {t('cancel_order')}
                  </button>
                </div>
              </div>
              <div className="dish-modal__actions">
                <button type="button" className="cart-btn cart-btn--pay"
                  onClick={async () => {
                    if (waiterChanged) await setOrderWaiter(existingOrder, pendingWaiter || null)
                    closeEdit()
                  }}>
                  {t(waiterChanged ? 'save' : 'close')}
                </button>
              </div>
            </section>
          </div>
        )
      })()}
      {editLine && (
        <DishModal
          product={catalogProduct(editLine)}
          line={editLine}
          readOnly={Boolean(editLine.orderItemId)}
          meta={{ addedByName: editLine.addedByName, createdAt: editLine.createdAt }}
          onCancelDish={!orderReadOnly && !isWaiter && editLine.orderItemId ? () => cancelOrderItem(editLine) : undefined}
          onChangeWaiter={!orderReadOnly && !isWaiter && editLine.orderItemId ? (id) => changeDishWaiter(editLine, id) : undefined}
          waiterOptions={waitersAll}
          onSubmit={saveEdit}
          onMoveTable={!orderReadOnly && editLine.orderItemId && existingOrder && orderType === 'dine_in' ? () => {
            const backLine = editLine
            setEditLine(null)
            reassignTable(existingOrder, backLine)
          } : undefined}
          onSaveSent={!orderReadOnly && editLine.orderItemId && !isWaiter ? async (quantity, price) => {
            const updated = await orders.setItemQuantity(addToOrderId, editLine.orderItemId, quantity, price)
            setExistingOrder(updated)
            setOrderLines(orderToLines(updated))
            loadFloor()
          } : undefined}
          onClose={() => setEditLine(null)}
          hideTakeaway={courier || (orderType === 'dine_in' && !can(user, 'can_takeaway_at_table'))}
        />
      )}
      {paymentOverlay}
      {tablePickOverlay}
      {promptCfg && <InputPromptModal {...promptCfg} onClose={() => { const back = promptCfg.onBack; setPromptCfg(null); back?.() }} />}
      {pinGateOverlay}
      {typeTabs}
      {dock}
    </div>
  )
}
