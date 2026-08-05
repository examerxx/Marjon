import axios from 'axios'

function baseURL() {
  return localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1'
}

export const api = axios.create()

api.interceptors.request.use((config) => {
  config.baseURL = baseURL()
  // До входа сотрудника marjon_token отсутствует — используем org-токен терминала как запасной
  const token = localStorage.getItem('marjon_token') || localStorage.getItem('marjon_org_token')
  // Не перекрываем явно заданный заголовок (staffUsers/pin-login шлют org-токен терминала)
  const hasExplicit = !!(config.headers && config.headers.Authorization)
  if (token && !hasExplicit) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // На эндпоинтах авторизации 401 — это неверные креды, а не протухшая сессия.
    // Не сносим токен и не перезагружаем — даём странице показать ошибку.
    const url = err.config?.url || ''
    // Не перезагружаем на эндпоинтах входа и подбора сотрудников (у них свои фолбэки),
    // и только если реально есть сессия сотрудника (marjon_token) — иначе на экране
    // выбора сотрудника 401 сбрасывал бы экран (баг «окно закрывается»).
    const skipReload =
      url.includes('/auth/login') ||
      url.includes('/auth/pin-login') ||
      url.includes('/auth/staff-users')
    const hasStaffSession = !!localStorage.getItem('marjon_token')
    if (err.response?.status === 401 && !skipReload && hasStaffSession) {
      localStorage.removeItem('marjon_token')
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

// Выполнить запрос с org-токеном; при 401 обновить токен и повторить один раз.
async function withOrgRefresh(callFn) {
  const tok = localStorage.getItem('marjon_org_token')
  try {
    return await callFn(tok)
  } catch (e) {
    if (e?.response?.status === 401) {
      const nt = await refreshOrgToken()
      return await callFn(nt)
    }
    throw e
  }
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
  // Список сотрудников филиала (для выбора перед PIN-входом) — под org-токеном с авто-refresh.
  staffUsers: (branchId) =>
    withOrgRefresh((tok) =>
      api.get('/auth/staff-users', {
        params: { branch_id: branchId },
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
  loginByPin: (pin) =>
    withOrgRefresh((tok) =>
      api.post('/auth/pin-login', { pin }, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
  me: () => api.get('/auth/me').then((r) => r.data),
}

export const companies = {
  // Филиалы читаются до входа сотрудника — под org-токеном с авто-refresh
  branches: () =>
    withOrgRefresh((tok) =>
      api.get('/companies/me/branches', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ),
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
  printReceipt: (data) => api.post('/printers/print/receipt', data).then((r) => r.data),
  printKitchen: (data) => api.post('/printers/print/kitchen', data).then((r) => r.data),
}

export const orders = {
  list: (params) => cached('orders_' + (params?.branch_id || 'all'), api.get('/pos/orders', { params }).then((r) => r.data)),
  get: (id) => api.get(`/pos/orders/${id}`).then((r) => r.data),
  create: (data) => api.post('/pos/orders', data).then((r) => r.data),
  update: (id, data) => api.patch(`/pos/orders/${id}`, data).then((r) => r.data),
  addItem: (orderId, data) => api.post(`/pos/orders/${orderId}/items`, data).then((r) => r.data),
  removeItem: (orderId, itemId) => api.delete(`/pos/orders/${orderId}/items/${itemId}`).then((r) => r.data),
  moveItem: (orderId, itemId, table) => api.post(`/pos/orders/${orderId}/items/${itemId}/move`, null, { params: { table } }).then((r) => r.data),
  updateStatus: (id, status) => writeQueued('patch', `/pos/orders/${id}/status`, { status }),
  cancel: (id, password) => api.delete(`/pos/orders/${id}`, { params: password ? { password } : {} }).then((r) => r.data),
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
  setAvailable: (id, isAvailable) => api.patch(`/inventory/products/${id}`, { is_available: isAvailable }).then((r) => r.data),
  // Техкарта блюда (ингредиенты)
  recipe: (id) => api.get(`/inventory/products/${id}/recipe`).then((r) => r.data),
}

// Залы (зоны) с вложенными столами: GET /halls?branch_id= → [{id,name,tables:[{id,number,capacity}]}]
export const halls = {
  list: (branchId) => cached('halls_' + branchId, api.get('/halls', { params: { branch_id: branchId } }).then((r) => r.data)),
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
  open: (branchId, opening_cash = 0) => api.post('/pos/shifts/open', { branch_id: branchId, opening_cash }).then((r) => r.data),
  close: (closing_cash = 0) => api.post('/pos/shifts/close', { closing_cash }).then((r) => r.data),
}

// Финансы: приход/расход (бэкенд: /finance/income-expense)
export const finance = {
  incomeExpense: (params) => api.get('/finance/income-expense', { params }).then((r) => r.data),
  addIncome: (data) => api.post('/finance/income-expense', { ...data, direction: 'income' }).then((r) => r.data),
  addExpense: (data) => api.post('/finance/income-expense', { ...data, direction: 'expense' }).then((r) => r.data),
}

// Клиенты (автокомплит по номеру в доставке)
export const customers = {
  search: (q) => api.get('/crm/customers', { params: { q } }).then((r) => r.data),
}

export const reports = {
  sales: (params) => api.get('/reports/orders', { params }).then((r) => r.data),
  products: (params) => api.get('/reports/dishes', { params }).then((r) => r.data),
  staff: (params) => api.get('/reports/waiters', { params }).then((r) => r.data),
}

export const stopList = {
  list: (branchId) => api.get('/inventory/stop-list', { params: { branch_id: branchId } }).then((r) => r.data),
  add: (productId, branchId) => api.post('/inventory/stop-list', { product_id: productId, branch_id: branchId }).then((r) => r.data),
  remove: (id) => api.delete(`/inventory/stop-list/${id}`).then((r) => r.data),
}
