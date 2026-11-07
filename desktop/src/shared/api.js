import axios from 'axios'
import { DEFAULT_SERVER_URL, normalizeServerUrl } from './config'
import { submitOrderPayment } from './orderPayments.mjs'
import { resolveOrderCreate } from './orderValidation.mjs'

// Нормализуем на чтении: в localStorage у уже установленных терминалов может
// лежать адрес без /api/v1 (введён вручную до появления нормализации) — без
// этого вход отдавал бы 404 Not Found.
function baseURL() {
  return normalizeServerUrl(localStorage.getItem('marjon_server_url') || DEFAULT_SERVER_URL)
}

export const api = axios.create()

// Печатать на терминале умеет только Electron (preload → IPC → TCP).
// В обычном браузере window.electron нет — тогда печать делает сервер.
function canPrintLocally() {
  return Boolean(typeof window !== 'undefined' && window.electron?.print)
}

api.interceptors.request.use((config) => {
  config.baseURL = baseURL()
  // До входа сотрудника marjon_token отсутствует — используем org-токен терминала как запасной
  const token = localStorage.getItem('marjon_token') || localStorage.getItem('marjon_org_token')
  // Не перекрываем явно заданный заголовок (staffUsers/pin-login шлют org-токен терминала)
  const hasExplicit = !!(config.headers && config.headers.Authorization)
  if (token && !hasExplicit) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Сессия сотрудника: access живёт 15 минут, refresh — долго ───────────────
// SESSION-15M-01: раньше десктоп сохранял только access-токен сотрудника, а на
// первый же 401 сносил его и перезагружал окно → кассира «выкидывало в логин
// каждые 15 минут» посреди смены. Теперь refresh-токен сохраняется при входе,
// и 401 сначала пытается ТИХО обновить сессию, и только если refresh не сработал
// (сотрудника отключили, токен отозван) — выходим на экран входа.
let staffRefreshPromise = null
async function refreshStaffToken() {
  if (staffRefreshPromise) return staffRefreshPromise
  staffRefreshPromise = (async () => {
    const rt = localStorage.getItem('marjon_staff_refresh')
    if (!rt) throw new Error('no staff refresh token')
    const { data } = await axios.post(`${baseURL()}/auth/refresh`, { refresh_token: rt })
    localStorage.setItem('marjon_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('marjon_staff_refresh', data.refresh_token)
    return data.access_token
  })()
  try { return await staffRefreshPromise } finally { staffRefreshPromise = null }
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    // На эндпоинтах авторизации 401 — это неверные креды, а не протухшая сессия.
    // Не сносим токен и не перезагружаем — даём странице показать ошибку.
    const url = err.config?.url || ''
    const skipReload =
      url.includes('/auth/login') ||
      url.includes('/auth/monoblock-login') ||
      url.includes('/auth/pin-login') ||
      url.includes('/auth/staff-users') ||
      url.includes('/auth/refresh')
    const hasStaffSession = !!localStorage.getItem('marjon_token')
    if (err.response?.status === 401 && !skipReload && hasStaffSession) {
      // Первая попытка — тихое обновление сессии и повтор запроса.
      if (!err.config?.__retriedAfterRefresh) {
        try {
          const fresh = await refreshStaffToken()
          const cfg = { ...err.config, __retriedAfterRefresh: true }
          cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${fresh}` }
          return api.request(cfg)
        } catch { /* refresh не сработал — выходим ниже */ }
      }
      localStorage.removeItem('marjon_token')
      localStorage.removeItem('marjon_staff_refresh')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

// Офлайн-кэш: успешные GET кэшируем в localStorage; при ошибке (нет связи) отдаём кэш.
async function cached(key, promise) {
  try {
    const data = await promise
    try { localStorage.setItem('marjon_cache_' + key, JSON.stringify(data)) } catch { /* quota */ }
    return data
  } catch (e) {
    const raw = localStorage.getItem('marjon_cache_' + key)
    if (raw) { try { return JSON.parse(raw) } catch { /* ignore */ } }
    throw e
  }
}

// ── Офлайн-очередь записи ──────────────────────────────────────────────
// Если запрос-запись не прошёл из-за отсутствия связи (сервер не ответил),
// складываем его в localStorage и проигрываем в исходном порядке при
// восстановлении сети (событие online, периодический таймер, ручной flush).
const QUEUE_KEY = 'marjon_write_queue'
function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] } }
function saveQueue(q) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* quota */ } }
function emitQueue(size) {
  try { window.dispatchEvent(new CustomEvent('marjon:queue', { detail: { size } })) } catch { /* no window */ }
}
export function queueSize() { return loadQueue().length }
// Нет объекта ответа → это сетевая ошибка (офлайн), а не 4xx/5xx от сервера.
function isNetworkError(e) { return !e?.response }
function enqueueWrite(method, url, data) {
  const q = loadQueue()
  q.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, method, url, data, ts: Date.now() })
  saveQueue(q)
  emitQueue(q.length)
}

// Выполнить запись; при отсутствии сети — поставить в очередь и вернуть {queued:true}.
async function writeQueued(method, url, data) {
  try {
    const r = await api.request({ method, url, data })
    // Успех — попутно сливаем накопившееся (порядок сохраняем).
    if (loadQueue().length) flushQueue()
    return r.data
  } catch (e) {
    if (isNetworkError(e)) { enqueueWrite(method, url, data); return { queued: true } }
    throw e
  }
}

// Проиграть очередь по порядку. Возвращает число успешно отправленных.
export async function flushQueue() {
  if (flushQueue._busy) return 0
  flushQueue._busy = true
  try {
    let q = loadQueue()
    let sent = 0
    while (q.length) {
      const item = q[0]
      try {
        await api.request({ method: item.method, url: item.url, data: item.data })
        q = loadQueue(); q.shift(); saveQueue(q); sent++
      } catch (e) {
        if (isNetworkError(e)) break              // всё ещё офлайн — ждём следующего раза
        q = loadQueue(); q.shift(); saveQueue(q)  // серверная ошибка — выкидываем «отравленный» элемент
      }
    }
    emitQueue(q.length)
    return sent
  } finally {
    flushQueue._busy = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushQueue())
  setInterval(() => { if (loadQueue().length) flushQueue() }, 15000)
}

// Org-токен терминала — access живёт 15 мин, refresh — 30 дней.
// Обновляем access по refresh, когда он протух (иначе staff-users/pin-login дают 401).
// Singleton in-flight: при параллельных 401 делаем ОДИН refresh, иначе второй
// вызов уходит с уже отозванным refresh-токеном (бэкенд ротирует их) и падает.
let _orgRefreshPromise = null
async function refreshOrgToken() {
  if (_orgRefreshPromise) return _orgRefreshPromise
  _orgRefreshPromise = (async () => {
    const rt = localStorage.getItem('marjon_org_refresh')
    if (!rt) throw new Error('no org refresh token')
    const { data } = await axios.post(`${baseURL()}/auth/refresh`, { refresh_token: rt })
    localStorage.setItem('marjon_org_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('marjon_org_refresh', data.refresh_token)
    return data.access_token
  })()
  try {
    return await _orgRefreshPromise
  } finally {
    _orgRefreshPromise = null
  }
}

// 401 «Invalid PIN» / «PIN temporarily locked» — это ответ на сам код, а не
// протухший токен. Раньше здесь обновлялся org-токен и PIN отправлялся заново:
// неверный код проверялся дважды, и экран «задумывался» на лишний круг.
function isTokenExpiredError(e) {
  const detail = e?.response?.data?.detail
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail || '')
  return /credential|token/i.test(text)
}

// Выполнить запрос с org-токеном; при 401 обновить токен и повторить один раз.
async function withOrgRefresh(callFn) {
  const tok = localStorage.getItem('marjon_org_token')
  try {
    return await callFn(tok)
  } catch (e) {
    if (e?.response?.status === 401 && isTokenExpiredError(e)) {
      const nt = await refreshOrgToken()
      return await callFn(nt)
    }
    throw e
  }
}

// Закрыть серверную сессию сотрудника. Без этого «выход» только чистил
// localStorage, а живой refresh-токен продолжал держать человека в «Персонале»
// до конца суток. Мимо интерсепторов: при выходе silent-refresh не нужен.
export function revokeSession(accessToken, refreshToken) {
  if (!accessToken || !refreshToken) return Promise.resolve()
  return axios
    .post(`${baseURL()}/auth/logout`, { refresh_token: refreshToken }, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    .catch(() => { /* офлайн — токен истечёт сам */ })
}

export function revokeStaffSession() {
  return revokeSession(
    localStorage.getItem('marjon_token'),
    localStorage.getItem('marjon_staff_refresh'),
  )
}

export const auth = {
  // Бэкенд принимает email ИЛИ phone. Определяем по вводу.
  login: (identifier, password) => {
    const id = String(identifier || '').trim()
    const isPhone = !id.includes('@') && /^\+?[\d\s()\-]{5,}$/.test(id)
    const body = isPhone
      ? { phone: id.replace(/[\s()\-]/g, ''), password }
      : { email: id, password }
    return api.post('/auth/login', body).then((r) => r.data)
  },
  // Вход на кассе одним шагом по телефону+паролю аккаунта моноблока
  // (карточка users/monoblock в вебе; у моноблока нет PIN). Ответ несёт
  // токен + сведения о branch/company — привязка сохраняется атомарно.
  loginByMonoblock: (phone, password) =>
    api.post('/auth/monoblock-login', { phone, password }).then((r) => r.data),
  // Список сотрудников (для выбора перед PIN-входом) — под org-токеном с авто-refresh.
  // Моноблок отвязан от филиала: десктоп шлёт branch_id если филиал уже выбран,
  // бэкенд отдаёт персонал компании (фильтр по филиалу — на клиенте при необходимости).
  staffUsers: (branchId) =>
    withOrgRefresh((tok) =>
      api.get('/auth/staff-users', {
        params: branchId ? { branch_id: branchId } : {},
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
  // ID сотрудников с активной сессией (кто «в смене») — под org-токеном с авто-refresh.
  activeStaff: () =>
    withOrgRefresh((tok) =>
      api.get('/auth/active-staff', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
  // PIN-вход сотрудника: company_id берётся из org-токена терминала (с авто-refresh).
  // userId — выбранный на кассе сотрудник: бэкенд сверит PIN только с ним, иначе при
  // одинаковых PIN у двоих токен уходил «первому совпавшему».
  loginByPin: (pin, userId) =>
    withOrgRefresh((tok) =>
      api.post('/auth/pin-login', { pin, ...(userId ? { user_id: userId } : {}) }, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
  // Проверка PIN без смены сессии: логинимся по PIN и под полученным токеном
  // забираем сотрудника через /me (сам токен НЕ сохраняем — сессия официанта
  // остаётся прежней). Нужна для подтверждения опасных действий отдельным PIN.
  // userId — если PIN нужно сверить с КОНКРЕТНЫМ сотрудником (разблокировка экрана).
  // Без него бэкенд отдаёт «первого совпавшего», и при одинаковых PIN у двух
  // сотрудников /me возвращал чужого — проверка ложно падала.
  verifyPin: (pin, userId) =>
    withOrgRefresh((tok) =>
      api.post('/auth/pin-login', { pin, ...(userId ? { user_id: userId } : {}), verify_only: true }, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ).then(({ access_token }) =>
      api.get('/auth/me', { headers: { Authorization: `Bearer ${access_token}` } }).then((r) => r.data)
    ),
  me: () => api.get('/auth/me').then((r) => r.data),
  // /me под ЯВНО переданным токеном: вход по PIN ещё не зафиксирован в
  // localStorage (сначала проверяем смену), поэтому заголовок задаём вручную.
  meWithToken: (token) =>
    api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
  // Управление сотрудниками (панель «Сотрудники» в меню «…»; правка прав —
  // только владелец в веб-админке). Идут под токеном сотрудника (marjon_token) →
  // несут его permissions, которые читает бэкенд-гейт
  // require_permission_or_admin('can_manage_staff'). Онлайн-only:
  // управленческие операции через офлайн-очередь НЕ гоняем.
  users: () => api.get('/auth/users').then((r) => r.data),
  createUser: (payload) => api.post('/auth/users', payload).then((r) => r.data),
  updateUser: (id, payload) => api.patch(`/auth/users/${id}`, payload).then((r) => r.data),
  // PIN отдельным эндпоинтом PATCH /users/{id}/pin (в POST/PATCH /users его нет — extra=forbid → 422).
  setPin: (id, pin) => api.patch(`/auth/users/${id}/pin`, { pin }).then((r) => r.data),
}

export const companies = {
  // Филиалы читаются до входа сотрудника — под org-токеном с авто-refresh
  branches: () =>
    withOrgRefresh((tok) =>
      api.get('/companies/me/branches', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
  // Профиль компании (типы заказа и др.) — под токеном сотрудника.
  profile: () => api.get('/companies/me').then((r) => r.data),
}

// Брендинг организации: кастомный фон десктопа (задаётся в веб-админке)
export const branding = {
  // Активный фон текущей организации; читается под org-токеном (до входа сотрудника)
  activeBackground: () =>
    withOrgRefresh((tok) =>
      api.get('/image-backgrounds/active', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
}

export const printers = {
  list: () => api.get('/printers').then((r) => r.data),
  // Проверка доступности принтера СО СТОРОНЫ СЕРВЕРА (сервер печатает первым).
  ping: (ip, port = 9100) =>
    api.get('/printers/ping', { params: { ip, port } }).then((r) => r.data),
  jobDone: (jobId) => api.post(`/printers/jobs/${jobId}/done`).then((r) => r.data),
  // PRINT-LAT-01: терминал снимает задание с очереди, если печать не удалась
  // (принтер выключен, нет ip). Без этого задание висело pending навсегда.
  jobFail: (jobId, error) =>
    api.post(`/printers/jobs/${jobId}/fail`, { error }).then((r) => r.data),
  // PRINT-LAT-01: страховка на случай, если WebSocket отвалился — терминал сам
  // опрашивает очередь и печатает то, что сервер не смог отправить напрямую.
  pendingJobs: (printerId) =>
    api.get(`/printers/${printerId}/jobs/pending`).then((r) => r.data),
  // local_print: печатать сам терминал может только в Electron (IPC → TCP до
  // принтера). В браузере (демо/LAN-доступ к 5189) печатает сервер — иначе
  // задание падает с «electron print unavailable» и чек не выходит нигде.
  printReceipt: (data) => api.post('/printers/print/receipt', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
  printKitchen: (data) => api.post('/printers/print/kitchen', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
  // Общий чек-сводка (История/Отчёты)
  printSummary: (data) => api.post('/printers/print/summary', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
}

export const orders = {
  list: (params) => cached('orders_' + (params?.branch_id || 'all'), api.get('/pos/orders', { params }).then((r) => r.data)),
  get: (id) => api.get(`/pos/orders/${id}`).then((r) => r.data),
  create: async (data) => {
    const payload = await resolveOrderCreate(data, {
      loadHalls: () => api.get('/halls').then(r => r.data),
      loadBranches: () => companies.branches(),
    })
    return api.post('/pos/orders', payload).then(r => r.data)
  },
  update: (id, data) => api.patch(`/pos/orders/${id}`, data).then((r) => r.data),
  addItem: (orderId, data) => api.post(`/pos/orders/${orderId}/items`, data).then((r) => r.data),
  // Пакетный дозаказ: одна команда — один кухонный тикет на все новые блюда.
  addItems: (orderId, items) => api.post(`/pos/orders/${orderId}/items/bulk`, { items }).then((r) => r.data),
  // reason — причина удаления (журналируется на бэкенде: кто/когда/почему удалил позицию)
  removeItem: (orderId, itemId, reason) => api.delete(`/pos/orders/${orderId}/items/${itemId}`, {
    params: reason ? { reason } : {},
  }).then((r) => r.data),
  moveItem: (orderId, itemId, table) => api.post(`/pos/orders/${orderId}/items/${itemId}/move`, null, { params: { table } }).then((r) => r.data),
  // Плюс/минус на уже внесённой позиции: количество меняется до оплаты,
  // поэтому склад не задет (сток списывается в /payments).
  setItemQuantity: (orderId, itemId, quantity) =>
    api.patch(`/pos/orders/${orderId}/items/${itemId}`, { quantity }).then((r) => r.data),
  // Смена ответственного официанта у ОДНОЙ позиции (кассир исправляет путаницу: доля обслуги идёт по ответственному)
  setItemWaiter: (orderId, itemId, waiterId, reason) =>
    api.patch(`/pos/orders/${orderId}/items/${itemId}/waiter`, {
      waiter_id: waiterId, ...(reason ? { reason } : {}),
    }).then((r) => r.data),
  // extra — дополнительные поля статуса: сейчас это должник при закрытии
  // «в долг» (client_name/client_phone), по ним бэкенд заводит клиента.
  updateStatus: (id, status, extra) =>
    writeQueued('patch', `/pos/orders/${id}/status`, { status, ...(extra || {}) }),
  cancel: (id, password, comment) => api.delete(`/pos/orders/${id}`, {
    params: { ...(password ? { password } : {}), ...(comment ? { comment } : {}) },
  }).then((r) => r.data),
  // Возврат закрытого заказа в работу: гость вернул блюдо/пожаловался — кассир
  // открывает заказ, отменяет позицию с причиной и закрывает снова (со сдачей).
  reopen: (id, reason) => api.post(`/pos/orders/${id}/reopen`, { reason: reason || null }).then((r) => r.data),
}

export const payments = {
  confirmOrder: (order, method, detail) => submitOrderPayment({
    api, storage: localStorage, server: baseURL(), order, method, detail,
  }),
  process: (data, idempotencyKey) =>
    api.post('/payments', data, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }).then((r) => r.data),
  forOrder: (orderId) => api.get(`/payments/order/${orderId}`).then((r) => r.data),
}

export const kitchen = {
  orders: (branchId) =>
    cached('kitchen_orders_' + branchId, api.get('/kitchen/orders', { params: { branch_id: branchId } }).then((r) => r.data)),
  stations: () => api.get('/kitchen/stations').then((r) => r.data),
  // Записи статусов — через офлайн-очередь: при обрыве связи не теряются, синкаются при реконнекте
  itemStatus: (itemId, status) =>
    writeQueued('patch', '/kitchen/orders/items/status', { order_item_id: itemId, status }),
  itemDone: (itemId) =>
    writeQueued('patch', '/kitchen/orders/items/status', { order_item_id: itemId, status: 'ready' }),
  itemStart: (itemId) =>
    writeQueued('patch', '/kitchen/orders/items/status', { order_item_id: itemId, status: 'cooking' }),
  // Весь заказ готов → бэкенд ставит статус ready и рассылает событие (уведомление официанту)
  orderReady: (orderId) =>
    writeQueued('patch', `/kitchen/orders/${orderId}/ready`, undefined),
}

export const menu = {
  products: (params) => cached('products', api.get('/inventory/products', { params }).then((r) => r.data)),
  categories: () => cached('categories', api.get('/inventory/categories').then((r) => r.data)),
  product: (id) => api.get(`/inventory/products/${id}`).then((r) => r.data),
  // Стоп-лист = доступность блюда (is_available). false → в стопе.
  // Узкий эндпоинт /availability доступен кассиру (в отличие от общего PATCH продукта — только админ).
  setAvailable: (id, isAvailable) => api.patch(`/inventory/products/${id}/availability`, { is_available: isAvailable }).then((r) => r.data),
  // D3 «максимум блюда»: дневной лимит порций. null → снять лимит; число ≥1 → задать
  // максимум и обнулить счётчик (блюдо само встанет в стоп при достижении лимита).
  // Тот же гейт, что у стоп-листа (кассир/повар/владелец/админ).
  setLimit: (id, dailyLimit) => api.patch(`/inventory/products/${id}/limit`, { daily_limit: dailyLimit }).then((r) => r.data),
  // Техкарта блюда (ингредиенты)
  recipe: (id) => api.get(`/inventory/products/${id}/recipe`).then((r) => r.data),
}

// Склад: приходы и инвентаризации (для пакетной печати из меню «…»).
// GET-эндпоинты гейтятся только get_current_user — токена сотрудника/терминала
// достаточно. Записи (create*) гейтятся require_permission_or_admin('can_manage_warehouse')
// и идут под токеном сотрудника; онлайн-only, без офлайн-очереди.
export const warehouse = {
  purchases: (params) => api.get('/warehouse/purchases', { params }).then((r) => r.data),
  inventoryChecks: (params) => api.get('/warehouse/inventory-checks', { params }).then((r) => r.data),
  writeOffs: (params) => api.get('/warehouse/write-offs', { params }).then((r) => r.data),
  createPurchase: (payload) => api.post('/warehouse/purchases', payload).then((r) => r.data),
  createWriteOff: (payload) => api.post('/warehouse/write-offs', payload).then((r) => r.data),
  createInventoryCheck: (payload) => api.post('/warehouse/inventory-checks', payload).then((r) => r.data),
}

// Залы (зоны) с вложенными столами: GET /halls?branch_id= → [{id,name,tables:[{id,number,capacity}]}]
export const halls = {
  list: (branchId) => cached('halls_' + branchId, api.get('/halls', { params: { branch_id: branchId } }).then((r) => r.data)),
  // Список залов под токеном сотрудника ДО сохранения сессии: нужен, чтобы
  // определить филиал терминала, когда моноблок привязан только к компании.
  listWithToken: (token) =>
    api.get('/halls', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
  branchTables: (branchId) => api.get(`/halls/branch/${branchId}/tables`).then((r) => r.data),
}
// Обратная совместимость со старым импортом `tables`
export const tables = {
  list: (branchId) => api.get(`/halls/branch/${branchId}/tables`).then((r) => r.data),
  halls: (branchId) => api.get('/halls', { params: { branch_id: branchId } }).then((r) => r.data),
}

// Кассовые смены (бэкенд: /pos/shifts)
export const shifts = {
  current: (branchId) => api.get('/pos/shifts/current', { params: { branch_id: branchId } }).then((r) => r.data),
  // Проверка/открытие смены ДО фиксации сессии сотрудника: токен из PIN-входа
  // передаём явно, чтобы не записывать его в localStorage до открытия смены.
  currentWithToken: (token, branchId) =>
    api.get('/pos/shifts/current', {
      params: { branch_id: branchId },
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.data),
  openWithToken: (token, branchId, opening_cash = 0) =>
    api.post('/pos/shifts/open', { branch_id: branchId, opening_cash }, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.data),
  open: (branchId, opening_cash = 0) => api.post('/pos/shifts/open', { branch_id: branchId, opening_cash }).then((r) => r.data),
  close: (branchId, closing_cash = 0) =>
    api.post('/pos/shifts/close', { branch_id: branchId || undefined, closing_cash }).then((r) => r.data),
  // Сводка для профиля: текущая смена + выработка и продажи сотрудника за день.
  summary: (branchId) => api.get('/pos/shifts/me/summary', {
    params: branchId ? { branch_id: branchId } : {},
  }).then((r) => r.data),
}

// Финансы: приход/расход (бэкенд: /finance/transactions).
// DESK-FIN-01: раньше здесь был /finance/income-expense — такого пути на бэкенде
// нет (404), поэтому панель «Финансы» не могла ни показать операции, ни добавить
// приход/расход. Канонический путь — /finance/transactions (kafe_compat),
// приход/расход различаются полем direction.
export const finance = {
  incomeExpense: (params) => api.get('/finance/transactions', { params }).then((r) => r.data),
  addIncome: (data) => api.post('/finance/transactions', { ...data, direction: 'income' }).then((r) => r.data),
  addExpense: (data) => api.post('/finance/transactions', { ...data, direction: 'expense' }).then((r) => r.data),
  // Способы оплаты из веб-админки (Настройки → «Способ оплаты»): владелец вводит
  // Uzum, Yandex и т.п. руками — интеграции нет, но на кассе их можно выбрать,
  // и в отчётах видно, через что клиент заплатил.
  paymentTypes: () => api.get('/finance/payment-types', { params: { size: 200 } })
    .then((r) => {
      const data = r.data
      const list = Array.isArray(data) ? data : (data?.items || data?.results || [])
      return list.filter((p) => p && p.status !== false && p.is_active !== false && p.name)
    }),
}

// Клиенты (автокомплит по номеру в доставке)
export const customers = {
  search: (q) => api.get('/crm/customers', { params: { q } }).then((r) => r.data),
}

export const reports = {
  sales: (params) => api.get('/reports/orders', { params }).then((r) => r.data),
  products: (params) => api.get('/reports/dishes', { params }).then((r) => r.data),
  staff: (params) => api.get('/reports/waiters', { params }).then((r) => r.data),
  // Z-отчёт за день (как в веб-админке): показатели смены + разбивка по оплатам
  // Z-отчёт: за один день (date) ИЛИ за период (date_from + date_to).
  // Раньше отправляли date и date_from разом «для совместимости» — текущий
  // бэкенд такой запрос отклоняет (422 «либо date, либо date_from и date_to»),
  // и отчёт не открывался вообще. Режим выбираем сами.
  zReport: (from, to) => {
    const period = to && to !== from
    return api.get('/analytics/z-report', {
      params: period ? { date_from: from, date_to: to } : { date: from },
    }).then((r) => r.data)
  },
}

export const stopList = {
  list: (branchId) => api.get('/inventory/stop-list', { params: { branch_id: branchId } }).then((r) => r.data),
  add: (productId, branchId) => api.post('/inventory/stop-list', { product_id: productId, branch_id: branchId }).then((r) => r.data),
  remove: (id) => api.delete(`/inventory/stop-list/${id}`).then((r) => r.data),
}

// 5.5 — вход/уход повара (attendance): кассир видит очередь на подтверждение и одобряет/отклоняет,
// а также сам отмечает приход/уход любого сотрудника (mark) и смотрит журнал за день (log).
export const attendance = {
  pending: () => api.get('/hr/attendance/pending').then((r) => r.data),
  approve: (logId, note) => api.post(`/hr/attendance/${logId}/approve`, { approve: true, note }).then((r) => r.data),
  reject: (logId, note) => api.post(`/hr/attendance/${logId}/approve`, { approve: false, note }).then((r) => r.data),
  // Кассир отмечает сотрудника: action = 'check_in' | 'check_out'. Отметка сразу подтверждается.
  mark: (userId, action) => api.post('/hr/attendance/mark', { user_id: userId, action }).then((r) => r.data),
  // Журнал отметок за день (по умолчанию — сегодня). date — ISO 'YYYY-MM-DD'.
  log: (date) => api.get('/hr/attendance/log', { params: date ? { date } : {} }).then((r) => r.data),
}
