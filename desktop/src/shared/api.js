import axios from 'axios'
import { DEFAULT_SERVER_URL, normalizeServerUrl } from './config'
import { submitOrderPayment, clearPaymentAttempt } from './orderPayments.mjs'
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

// ── Офлайн-мост ─────────────────────────────────────────────────────────────
// Electron держит локальную SQLite и очередь записи. Рендерер пробует сеть
// первым; мост включается только когда запрос не дошёл до сервера. В браузере
// (демо/LAN) моста нет — поведение остаётся прежним.
function offlineBridge() {
  return (typeof window !== 'undefined' && window.electron?.offline) || null
}

// Конфиг моста (адрес сервера, токены, сотрудник, филиал) передаём по IPC
// только при изменении — иначе каждый запрос стоил бы лишнего перехода.
let bridgeCfgKey = ''
function bridgeUserId() {
  const token = localStorage.getItem('marjon_token') || ''
  if (token.startsWith('offline:')) return token.slice('offline:'.length)
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''))
    return payload.sub || ''
  } catch { return '' }
}
function bridgeBranchId() {
  const staff = localStorage.getItem('marjon_staff_branch')
  if (staff) return staff
  try { return JSON.parse(localStorage.getItem('marjon_branch') || 'null')?.id || '' } catch { return '' }
}
function syncBridgeConfig() {
  const bridge = offlineBridge()
  if (!bridge) return
  let user = null
  try { user = JSON.parse(localStorage.getItem('marjon_user') || 'null') } catch { /* ignore */ }
  const cfg = {
    apiBase: baseURL(),
    token: localStorage.getItem('marjon_token') || '',
    orgToken: localStorage.getItem('marjon_org_token') || '',
    userId: user?.id || bridgeUserId(),
    userName: user?.name || '',
    branchId: bridgeBranchId(),
  }
  const key = [cfg.apiBase, cfg.token, cfg.orgToken, cfg.userId, cfg.userName, cfg.branchId].join('|')
  if (key === bridgeCfgKey) return
  bridgeCfgKey = key
  Promise.resolve(bridge.configure(cfg)).catch(() => { /* мост не критичен */ })
}
if (typeof window !== 'undefined') {
  syncBridgeConfig()
  window.addEventListener('online', () => { syncBridgeConfig(); offlineBridge()?.flush?.().catch?.(() => {}) })
  window.addEventListener('marjon:offline-sync', () => offlineBridge()?.syncNow?.().catch?.(() => {}))
}

api.interceptors.request.use((config) => {
  config.baseURL = baseURL()
  syncBridgeConfig()
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

// Офлайн-кэш: успешные GET кэшируем в localStorage; при ошибке (нет связи)
// отдаём SQLite-кэш терминала, затем localStorage. bridgeKey — какое имя
// сохранить в локальной базе, offline — как из неё прочитать.
async function cached(key, promise, { bridgeKey = null, offline = null } = {}) {
  try {
    const data = await promise
    try { localStorage.setItem('marjon_cache_' + key, JSON.stringify(data)) } catch { /* quota */ }
    const bridge = offlineBridge()
    if (bridge && bridgeKey) Promise.resolve(bridge.cache(bridgeKey, data)).catch(() => {})
    return data
  } catch (e) {
    const bridge = offlineBridge()
    if (bridge && offline && !e?.response) {
      try {
        const local = await offline(bridge)
        if (local != null) return local
      } catch { /* локального снимка нет — идём дальше */ }
    }
    const raw = localStorage.getItem('marjon_cache_' + key)
    if (raw) { try { return JSON.parse(raw) } catch { /* ignore */ } }
    throw e
  }
}

// Объединение списков заказов: локальная база + прошлый успешный ответ.
// Один и тот же заказ встречается в обоих — побеждает локальная версия
// (в ней есть офлайн-правки, которых сервер ещё не видел).
function mergeById(local, cachedList) {
  const map = new Map()
  for (const item of (Array.isArray(cachedList) ? cachedList : [])) map.set(String(item?.id), item)
  for (const item of (Array.isArray(local) ? local : [])) map.set(String(item?.id), item)
  return [...map.values()]
}

// Локальная копия заказа из SQLite терминала (или null).
async function localOrder(id) {
  const bridge = offlineBridge()
  if (!bridge) return null
  try { return await bridge.getOrder(id) } catch { return null }
}

// Запись по заказу. Заказ, созданный офлайн (сервер его ещё не видел),
// обслуживается мостом СРАЗУ — его локальный id не существует на сервере,
// и сетевой запрос вернул бы 404. Синхронизированный заказ идёт в сеть,
// а мост подхватывает только при сетевой ошибке.
async function orderMutation(orderId, request, run) {
  const bridge = offlineBridge()
  const local = await localOrder(orderId)
  const pending = local && local.sync_state !== 'synced'
  if (bridge && pending) return run(bridge)
  try {
    return await request()
  } catch (e) {
    if (e?.response || !bridge || !local) throw e
    return run(bridge)
  }
}

function uuid() {
  return globalThis.crypto?.randomUUID?.()
    || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16)
    })
}

// Оплата наличными без сети: мост ядра принимает только «полную» оплату.
function offlineCashPayment(order, detail) {
  const total = Math.round(Number(order?.total_amount || 0) * 100)
  const received = detail?.cash != null ? Math.round(Number(detail.cash) * 100) : total
  return {
    method: 'cash',
    amount: (total / 100).toFixed(2),
    cash_received: (Math.max(received, total) / 100).toFixed(2),
    change_given: (Math.max(received - total, 0) / 100).toFixed(2),
  }
}

function tokenUserId(token) {
  const value = String(token || '')
  if (value.startsWith('offline:')) return value.slice('offline:'.length)
  try {
    return JSON.parse(atob(value.split('.')[1] || '')).sub || ''
  } catch { return '' }
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
    ).catch((e) => {
      // Офлайн: карточки сотрудников для рейла берём из локального снимка
      // персонала (он же используется для PIN-входа без сети).
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.staffUsers(branchId || bridgeBranchId())
    }),
  // Коллеги филиала для обычного входа сотрудника: /auth/staff-users
  // намеренно закрыт для всех, кроме владельца и терминала, поэтому
  // панель посещаемости берёт ростер отсюда (филиал — всегда свой).
  branchColleagues: () =>
    api.get('/auth/branch-colleagues').then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      return bridge ? bridge.staffUsers(bridgeBranchId()) : Promise.reject(e)
    }),
  // ID сотрудников с активной сессией (кто «в смене») — под org-токеном с авто-refresh.
  activeStaff: () =>
    withOrgRefresh((tok) =>
      api.get('/auth/active-staff', {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ).catch(async (e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      // Офлайн «в смене» = у кого открыта смена в локальном снимке.
      const shifts = await bridge.cacheGet('shifts')
      return [...new Set((Array.isArray(shifts) ? shifts : [])
        .filter((s) => s.status === 'open')
        .map((s) => s.cashier_id))]
    }),
  // PIN-вход сотрудника: company_id берётся из org-токена терминала (с авто-refresh).
  // userId — выбранный на кассе сотрудник: бэкенд сверит PIN только с ним, иначе при
  // одинаковых PIN у двоих токен уходил «первому совпавшему».
  loginByPin: (pin, userId) =>
    withOrgRefresh((tok) =>
      api.post('/auth/pin-login', { pin, ...(userId ? { user_id: userId } : {}) }, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      }).then((r) => r.data)
    ).catch(async (e) => {
      // OFFLINE-PIN: сервер недоступен — сверяем PIN с bcrypt-хэшем из
      // локального снимка персонала. Пароль сюда не попадает: в кэше только хэш.
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      const user = await bridge.verifyPin(pin, userId)
      if (!user?.id) throw new Error('Invalid PIN')
      return {
        access_token: `offline:${user.id}`,
        refresh_token: `offline:${user.id}`,
        token_type: 'bearer',
        offline: true,
        user,
      }
    }),
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
    ).catch(async (e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.verifyPin(pin, userId)
    }),
  me: () => cached('me', api.get('/auth/me'), {
    offline: async (bridge) => {
      const token = localStorage.getItem('marjon_token') || ''
      return token.startsWith('offline:') ? bridge.userByToken(token) : null
    },
  }),
  // /me под ЯВНО переданным токеном: вход по PIN ещё не зафиксирован в
  // localStorage (сначала проверяем смену), поэтому заголовок задаём вручную.
  meWithToken: (token) => {
    const value = String(token || '')
    if (value.startsWith('offline:')) {
      const bridge = offlineBridge()
      return bridge ? bridge.userByToken(value) : Promise.reject(new Error('offline bridge unavailable'))
    }
    return api.get('/auth/me', { headers: { Authorization: `Bearer ${value}` } }).then((r) => r.data)
  },
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
    ).catch(async (e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      const [branch, company] = await Promise.all([bridge.cacheGet('branch'), bridge.cacheGet('company')])
      return branch?.id
        ? [{ id: branch.id, name: branch.name, company_id: company?.id || null, is_active: true }]
        : []
    }),
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
  // r.data обязателен: cached() кладёт в кэш ровно то, что вернул вызов.
  // С «сырым» axios-ответом список принтеров приходил обёрткой, и настройки
  // (а также выбор чек-принтера в Истории/Отчётах) видели пустой массив.
  list: () => cached('printers', api.get('/printers').then((r) => r.data), {
    bridgeKey: 'printers',
    offline: (bridge) => bridge.cacheGet('printers'),
  }),
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
  // Без сети сервер печатать не может — тогда ESC/POS собирает само ядро
  // терминала из локального снимка заказа и печатает напрямую в принтер.
  printReceipt: (data) =>
    orderMutation(
      data?.order_id,
      () => api.post('/printers/print/receipt', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
      (bridge) => bridge.printReceipt({ orderId: data.order_id, printerId: data.printer_id, copies: data.copies }),
    ),
  printKitchen: (data) =>
    orderMutation(
      data?.order_id,
      () => api.post('/printers/print/kitchen', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
      (bridge) => bridge.printKitchen({ orderId: data.order_id, itemIds: data.item_ids }),
    ),
  // Общий чек-сводка (История/Отчёты)
  printSummary: (data) => api.post('/printers/print/summary', { local_print: canPrintLocally(), ...data }).then((r) => r.data),
}

export const orders = {
  // Локальная база сливается с ответом сервера: заказ, созданный без сети,
  // виден на доске сразу и не исчезает из неё после реконнекта (дубли
  // схлопываются по id — у синхронизированного заказа локальный id заменён
  // серверным).
  list: (params) => {
    const key = 'orders_' + (params?.branch_id || 'all')
    const withLocal = (remote) => {
      const bridge = offlineBridge()
      if (!bridge) return remote
      return bridge.listOrders(params || {})
        .then((local) => mergeById(local, remote))
        .catch(() => remote)
    }
    return cached(key, api.get('/pos/orders', { params }).then((r) => withLocal(r.data)), {
      offline: async (bridge) => {
        let previous = []
        try { previous = JSON.parse(localStorage.getItem('marjon_cache_' + key) || '[]') } catch { /* ignore */ }
        return mergeById(await bridge.listOrders(params || {}), previous)
      },
    })
  },
  get: async (id) => {
    const local = await localOrder(id)
    if (local && local.sync_state !== 'synced') return local
    try {
      return await api.get(`/pos/orders/${id}`).then((r) => r.data)
    } catch (e) {
      if (local) return local
      throw e
    }
  },
  create: async (data) => {
    const payload = await resolveOrderCreate(data, {
      loadHalls: () => cached('halls_all', api.get('/halls').then(r => r.data), {
        bridgeKey: 'halls',
        offline: (bridge) => bridge.cacheGet('halls'),
      }),
      loadBranches: () => companies.branches(),
    })
    // client_id генерирует терминал ДО отправки: повтор POST после обрыва —
    // это тот же заказ, а не второй (бэкенд отдаёт существующий).
    const clientId = payload.client_id || uuid()
    try {
      return await api.post('/pos/orders', { ...payload, client_id: clientId }).then((r) => r.data)
    } catch (e) {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.createOrder({ ...payload, client_id: clientId })
    }
  },
  update: (id, data) =>
    orderMutation(
      id,
      () => api.patch(`/pos/orders/${id}`, data).then((r) => r.data),
      (bridge) => bridge.updateOrder(id, data, {
        reason: data?.reason, action_pin: data?.action_pin,
      }),
    ),
  addItem: (orderId, data) =>
    orderMutation(
      orderId,
      () => api.post(`/pos/orders/${orderId}/items`, data).then((r) => r.data),
      (bridge) => bridge.addItems(orderId, [data]),
    ),
  // Пакетный дозаказ: одна команда — один кухонный тикет на все новые блюда.
  addItems: (orderId, items) =>
    orderMutation(
      orderId,
      () => api.post(`/pos/orders/${orderId}/items/bulk`, { items }).then((r) => r.data),
      (bridge) => bridge.addItems(orderId, items),
    ),
  // reason — причина удаления (журналируется на бэкенде: кто/когда/почему удалил позицию)
  removeItem: (orderId, itemId, reason) =>
    orderMutation(
      orderId,
      () => api.delete(`/pos/orders/${orderId}/items/${itemId}`, {
        params: reason ? { reason } : {},
      }).then((r) => r.data),
      (bridge) => bridge.removeItem(orderId, itemId, reason),
    ),
  moveItem: (orderId, itemId, table) => api.post(`/pos/orders/${orderId}/items/${itemId}/move`, null, { params: { table } }).then((r) => r.data),
  // Плюс/минус на уже внесённой позиции: количество меняется до оплаты,
  // поэтому склад не задет (сток списывается в /payments).
  setItemQuantity: (orderId, itemId, quantity) =>
    orderMutation(
      orderId,
      () => api.patch(`/pos/orders/${orderId}/items/${itemId}`, { quantity }).then((r) => r.data),
      (bridge) => bridge.setItemQty(orderId, itemId, quantity),
    ),
  // Смена ответственного официанта у ОДНОЙ позиции (кассир исправляет путаницу: доля обслуги идёт по ответственному)
  setItemWaiter: (orderId, itemId, waiterId, reason) =>
    api.patch(`/pos/orders/${orderId}/items/${itemId}/waiter`, {
      waiter_id: waiterId, ...(reason ? { reason } : {}),
    }).then((r) => r.data),
  // extra — дополнительные поля статуса: сейчас это должник при закрытии
  // «в долг» (client_name/client_phone), по ним бэкенд заводит клиента.
  // Локальный/офлайн-заказ идёт в очередь ядра (с depends_on от создания);
  // серверный, но ещё не попавший в локальную базу — в старую очередь.
  updateStatus: async (id, status, extra) => {
    const local = await localOrder(id)
    if (local) {
      const bridge = offlineBridge()
      if (local.sync_state !== 'synced') return bridge.updateStatus(id, status, extra)
      try {
        return await api.patch(`/pos/orders/${id}/status`, { status, ...(extra || {}) }).then((r) => r.data)
      } catch (e) {
        if (e?.response) throw e
        return bridge.updateStatus(id, status, extra)
      }
    }
    return writeQueued('patch', `/pos/orders/${id}/status`, { status, ...(extra || {}) })
  },
  // Отмена заказа. Заказ, которого сервер ещё не видел, отменяется локально
  // сразу; серверный — только через сервер (там проверяется пароль отмены).
  // Без связи серверный заказ отменить нельзя — ядро вернёт понятную ошибку.
  cancel: async (id, password, comment) => {
    const bridge = offlineBridge()
    const local = bridge ? await localOrder(id) : null
    if (bridge && local && local.sync_state !== 'synced') {
      return bridge.cancelOrder(id, { password, comment })
    }
    try {
      return await api.delete(`/pos/orders/${id}`, {
        params: { ...(password ? { password } : {}), ...(comment ? { comment } : {}) },
      }).then((r) => r.data)
    } catch (e) {
      if (e?.response || !bridge || !local) throw e
      return bridge.cancelOrder(id, { password, comment })
    }
  },
  // Возврат закрытого заказа в работу: гость вернул блюдо/пожаловался — кассир
  // открывает заказ, отменяет позицию с причиной и закрывает снова (со сдачей).
  reopen: (id, reason) => api.post(`/pos/orders/${id}/reopen`, { reason: reason || null }).then((r) => r.data),
}

export const payments = {
  confirmOrder: async (order, method, detail) => {
    const bridge = offlineBridge()
    const local = await localOrder(order?.id)
    // Заказ, которого сервер ещё не видел, платим только наличными локально —
    // проводка уйдёт вместе с заказом при восстановлении связи.
    if (bridge && local && local.sync_state !== 'synced') {
      return bridge.payOrder(order.id, offlineCashPayment(order, detail))
    }
    try {
      return await submitOrderPayment({
        api, storage: localStorage, server: baseURL(), order, method, detail,
      })
    } catch (e) {
      // Связь оборвалась посреди оплаты: серверная попытка не подтверждена.
      // Снимаем её ключ (иначе повтор создал бы дубль) и фиксируем оплату
      // в локальной базе — ядро досылает её с Idempotency-Key.
      if (e?.response || !bridge || !local || method !== 'cash') throw e
      clearPaymentAttempt({ storage: localStorage, server: baseURL(), orderId: order.id })
      return bridge.payOrder(order.id, offlineCashPayment(order, detail))
    }
  },
  process: (data, idempotencyKey) =>
    api.post('/payments', data, {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    }).then((r) => r.data),
  forOrder: async (orderId) => {
    const bridge = offlineBridge()
    const local = await localOrder(orderId)
    if (bridge && local && local.sync_state !== 'synced') return bridge.paymentsForOrder(orderId)
    try {
      return await api.get(`/payments/order/${orderId}`).then((r) => r.data)
    } catch (e) {
      if (e?.response || !bridge) throw e
      const localPayments = await bridge.paymentsForOrder(orderId)
      return Array.isArray(localPayments) ? localPayments : []
    }
  },
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
  products: (params) => cached('products', api.get('/inventory/products', { params }).then((r) => r.data), {
    bridgeKey: 'products',
    offline: (bridge) => bridge.cacheGet('products'),
  }),
  categories: () => cached('categories', api.get('/inventory/categories').then((r) => r.data), {
    bridgeKey: 'categories',
    offline: (bridge) => bridge.cacheGet('categories'),
  }),
  product: (id) =>
    api.get(`/inventory/products/${id}`).then((r) => r.data).catch(async (e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      const list = await bridge.cacheGet('products')
      const found = (Array.isArray(list) ? list : []).find((p) => String(p.id) === String(id))
      if (found) return found
      throw e
    }),
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
  list: (branchId) => cached('halls_' + branchId, api.get('/halls', { params: { branch_id: branchId } }).then((r) => r.data), {
    bridgeKey: 'halls',
    offline: (bridge) => bridge.cacheGet('halls'),
  }),
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
  current: (branchId) =>
    api.get('/pos/shifts/current', { params: { branch_id: branchId } }).then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.shiftCurrent(branchId, bridgeUserId())
    }),
  // Проверка/открытие смены ДО фиксации сессии сотрудника: токен из PIN-входа
  // передаём явно, чтобы не записывать его в localStorage до открытия смены.
  currentWithToken: (token, branchId) =>
    api.get('/pos/shifts/current', {
      params: { branch_id: branchId },
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.shiftCurrent(branchId, tokenUserId(token))
    }),
  openWithToken: (token, branchId, opening_cash = 0) =>
    api.post('/pos/shifts/open', { branch_id: branchId, opening_cash }, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.shiftOpen(branchId, opening_cash, tokenUserId(token))
    }),
  open: (branchId, opening_cash = 0) =>
    api.post('/pos/shifts/open', { branch_id: branchId, opening_cash }).then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.shiftOpen(branchId, opening_cash, bridgeUserId())
    }),
  close: (branchId, closing_cash = 0) =>
    api.post('/pos/shifts/close', { branch_id: branchId || undefined, closing_cash }).then((r) => r.data).catch((e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      return bridge.shiftClose(branchId || bridgeBranchId(), closing_cash, bridgeUserId())
    }),
  // Сводка для профиля: текущая смена + выработка и продажи сотрудника за день.
  // Офлайн считаем из локальной базы: смена, её длительность и закрытые заказы.
  summary: (branchId) =>
    api.get('/pos/shifts/me/summary', {
      params: branchId ? { branch_id: branchId } : {},
    }).then((r) => r.data).catch(async (e) => {
      if (e?.response) throw e
      const bridge = offlineBridge()
      if (!bridge) throw e
      const bId = branchId || bridgeBranchId()
      const shift = await bridge.shiftCurrent(bId, bridgeUserId())
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const list = await bridge.listOrders({ branch_id: bId, date: today, limit: 500 })
      const done = list.filter((o) => o.status === 'completed')
      const sales = done.reduce((s, o) => s + Number(o.total_amount || 0), 0)
      const seconds = shift?.opened_at
        ? Math.max(0, Math.floor((Date.now() - Date.parse(shift.opened_at)) / 1000))
        : 0
      return {
        shift,
        worked_seconds: seconds,
        shift_seconds: seconds,
        sales_total: sales.toFixed(2),
        orders_count: done.length,
        offline: true,
      }
    }),
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

// Экран очереди для гостей (ТВ или второй монитор). Флаг живёт на филиале:
// выключенный экран не получает номера заказов, даже если касса работает.
export const guestDisplay = {
  get: (branchId) =>
    api.get('/kitchen/display/settings', { params: { branch_id: branchId } }).then((r) => r.data),
  setEnabled: (branchId, enabled) =>
    api.patch('/kitchen/display/settings', { branch_id: branchId, enabled }).then((r) => r.data),
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
