// Офлайн-режим кассы: локальная SQLite, outbox и синхронизация с облаком.
//
// Правило одно: любые ДЕНЬГИ сначала фиксируются локально и уходят на сервер
// через outbox, а не «в лоб». Онлайн-путь остаётся в рендерере (api.js):
// терминал сначала пробует прямой запрос и попадает сюда только при сетевой
// ошибке. Это даёт быструю работу при живой сети и полную автономность без неё.
const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')

const store = require('./db')
const { request, healthUrl } = require('./http')
const escpos = require('./escpos')

const CHANGE_CACHE_KEYS = new Set(['company', 'branch', 'products', 'categories', 'halls', 'printers'])
const BOOTSTRAP_TTL_MS = 30 * 60 * 1000
const MAX_ATTEMPTS = 8
const PROBE_TTL_MS = 10 * 1000

let deps = null
let config = {
  apiBase: '', token: '', orgToken: '', userId: '', userName: '', branchId: '',
}
let flushing = null
let probing = null
let lastProbeAt = 0
let lastProbeOk = false
let lastSyncError = null
const pinGuard = new Map()

function nowIso() { return new Date().toISOString() }
function nowMs() { return Date.now() }

function cents(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
function dec(valueCents) { return (Number(valueCents) / 100).toFixed(2) }

// Офлайн-вход по PIN выдаёт синтетический токен `offline:<id>` — он годится
// только для локальной сессии. Для сети берём реальный токен: сначала
// сотрудника, иначе терминала (org). Иначе flush уходил бы с мусорным
// Bearer и получал 401 вместо досылки очереди.
function apiToken() {
  const staff = String(config.token || '')
  const usable = staff && !staff.startsWith('offline:')
  return (usable ? staff : '') || config.orgToken || ''
}

function tz() {
  const company = store.kvGet('company')
  return company?.timezone || 'Asia/Tashkent'
}

function localDateKey() {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: tz() }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function cachedList(key) {
  const value = store.kvGet(key)
  return Array.isArray(value) ? value : []
}

function productsById() {
  const map = new Map()
  for (const p of cachedList('products')) map.set(String(p.id), p)
  return map
}

function hallPercentForTable(tableId) {
  if (!tableId) return 0
  for (const hall of cachedList('halls')) {
    for (const table of hall.tables || []) {
      if (String(table.id) === String(tableId)) return Number(hall.percent || 0)
    }
  }
  return 0
}

function staffCache() {
  const value = store.kvGet('staff')
  return Array.isArray(value) ? value : []
}

function findStaff(userId) {
  if (!userId) return null
  return staffCache().find((s) => String(s.id) === String(userId)) || null
}

function toPublicUser(staff) {
  if (!staff) return null
  const roles = Array.isArray(staff.role_slugs) ? staff.role_slugs : []
  return {
    id: staff.id,
    email: null,
    name: staff.name,
    phone: staff.phone,
    is_active: staff.is_active !== false,
    is_superadmin: false,
    company_id: store.kvGet('company')?.id || null,
    branch_id: staff.branch_id || null,
    printer_id: null,
    role_slugs: roles,
    role_slug: roles[0] || null,
    avatar_url: null,
    permissions: staff.permissions || null,
    auth_scope: 'app',
    offline: true,
  }
}

function outboxCounts() {
  const row = store.get().prepare(
    "SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, " +
    "SUM(CASE WHEN status='dead' THEN 1 ELSE 0 END) AS dead FROM outbox"
  ).get()
  return { pending: row?.pending || 0, dead: row?.dead || 0 }
}

function lastSyncAt() {
  const meta = store.kvGet('sync_meta') || {}
  return meta.last_sync_at || null
}

function snapshot() {
  const counts = outboxCounts()
  return {
    ready: true,
    online: lastProbeOk,
    pending: counts.pending,
    dead: counts.dead,
    lastSyncAt: lastSyncAt(),
    lastError: lastSyncError,
    hasBootstrap: !!store.kvGet('bootstrap_at'),
    companyName: store.kvGet('company')?.name || null,
    branchId: config.branchId || store.kvGet('branch')?.id || null,
  }
}

function emit() {
  try {
    const win = deps?.getWindow?.()
    if (win && !win.isDestroyed()) win.webContents.send('offline:state', snapshot())
  } catch { /* окно закрывается */ }
}

function setSyncMeta(patch) {
  store.kvSet('sync_meta', { ...(store.kvGet('sync_meta') || {}), ...patch })
}

// ── Сеть ────────────────────────────────────────────────────────────────────

async function probe(force = false) {
  if (!config.apiBase) return false
  if (!force && nowMs() - lastProbeAt < PROBE_TTL_MS) return lastProbeOk
  if (probing) return probing
  probing = (async () => {
    const url = healthUrl(config.apiBase)
    let ok = false
    if (url) {
      try {
        const rr = await request({ base: url.replace(/\/health$/, ''), path: '/health', timeout: 4000 })
        ok = !!rr
      } catch {
        ok = false
      }
    }
    lastProbeOk = ok
    lastProbeAt = nowMs()
    if (!ok) lastSyncError = 'нет связи с сервером'
    return ok
  })()
  try { return await probing } finally { probing = null }
}

function api(method, path, body, { token, timeout, headers } = {}) {
  return request({
    base: config.apiBase,
    method,
    path,
    body,
    token: token ?? apiToken(),
    timeout,
    headers,
  })
}

// ── Справочники ─────────────────────────────────────────────────────────────

async function syncBootstrap(force = false) {
  if (!config.apiBase) throw new Error('offline: server is not configured')
  const last = Date.parse(store.kvGet('bootstrap_at') || '') || 0
  if (!force && nowMs() - last < BOOTSTRAP_TTL_MS) return { skipped: true }

  const branchId = config.branchId || store.kvGet('branch')?.id
  if (!branchId) throw new Error('offline: branch is unknown')

  const data = await api('GET', `/sync/bootstrap?branch_id=${encodeURIComponent(branchId)}`, undefined, { timeout: 30000 })
  store.kvSet('company', data.company)
  store.kvSet('branch', { id: data.branch_id, name: data.branch_name })
  store.kvSet('categories', data.categories || [])
  store.kvSet('products', data.products || [])
  store.kvSet('halls', data.halls || [])
  store.kvSet('printers', data.printers || [])
  store.kvSet('bootstrap_at', data.server_time || nowIso())
  return { products: (data.products || []).length, halls: (data.halls || []).length }
}

async function syncStaff() {
  if (!config.apiBase) return { skipped: true }
  const branchId = config.branchId || store.kvGet('branch')?.id
  const query = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''
  const path = `/sync/staff${query}`
  // PIN-хэши отдаёт только владелец компании. Терминал держит org-токен
  // моноблока, поэтому сначала пробуем его; сотрудник (официант/кассир) на
  // этом эндпоинте получает 403 — тогда откатываемся к его токену.
  let data
  const ownerToken = config.orgToken && config.orgToken !== config.token ? config.orgToken : ''
  try {
    data = await api('GET', path, undefined, { timeout: 20000, token: ownerToken || apiToken() })
  } catch (err) {
    if (!ownerToken || (err?.status !== 401 && err?.status !== 403)) throw err
    data = await api('GET', path, undefined, { timeout: 20000 })
  }
  store.kvSet('staff', data.staff || [])
  store.kvSet('staff_at', data.server_time || nowIso())
  return { staff: (data.staff || []).length }
}

// Офлайн-метаданные терминала, которых нет в серверном DTO. Без них запись
// после синхронизации теряет client_id и офлайн-номер (поиск, повторная печать).
const LOCAL_META_KEYS = ['client_id', 'client_number', 'created_offline_at', 'service_fee_rate']

function mergeOrderMeta(serverOrder, local) {
  const merged = { ...serverOrder }
  for (const key of LOCAL_META_KEYS) {
    if (merged[key] == null && local?.[key] != null) merged[key] = local[key]
  }
  return merged
}

function upsertRemoteOrder(order) {
  const db = store.get()
  const existing = db.prepare('SELECT * FROM orders_local WHERE server_id = ?').get(String(order.id))
  if (existing) {
    const pending = db.prepare(
      "SELECT 1 FROM outbox WHERE order_local_id = ? AND status = 'pending' LIMIT 1"
    ).get(existing.id)
    if (pending) return // локальные правки ещё не ушли — серверный снимок их не затирает
    let local = null
    try { local = JSON.parse(existing.data) } catch { /* повреждённый снимок */ }
    db.prepare(
      "UPDATE orders_local SET status = ?, data = ?, updated_at = ? WHERE id = ?"
    ).run(order.status, JSON.stringify(mergeOrderMeta(order, local)), nowIso(), existing.id)
    return
  }
  const localId = String(order.id)
  db.prepare(
    'INSERT INTO orders_local (id, server_id, client_id, client_number, branch_id, status, sync_state, data, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    localId, localId, `server:${localId}`, order.client_number || null,
    String(order.branch_id), order.status, 'synced', JSON.stringify(order),
    order.created_at || nowIso(), nowIso(),
  )
}

async function pullChanges({ maxPages = 5 } = {}) {
  if (!config.apiBase) return { orders: 0 }
  const branchId = config.branchId || store.kvGet('branch')?.id
  if (!branchId) return { orders: 0 }
  let since = store.kvGet('changes_cursor') || ''
  let orders = 0
  let pages = 0
  const products = productsById()
  while (pages < maxPages) {
    const query = new URLSearchParams({ branch_id: branchId, limit: '500' })
    if (since) query.set('since', since)
    const data = await api('GET', `/sync/changes?${query.toString()}`, undefined, { timeout: 30000 })
    for (const order of (data.orders || [])) { upsertRemoteOrder(order); orders++ }
    for (const product of (data.products || [])) products.set(String(product.id), product)
    if (Array.isArray(data.shifts)) {
      const merged = new Map()
      for (const shift of cachedList('shifts')) merged.set(String(shift.id), shift)
      for (const shift of data.shifts) merged.set(String(shift.id), shift)
      store.kvSet('shifts', [...merged.values()])
    }
    since = data.server_time || since
    pages++
    if (!data.has_more) break
  }
  store.kvSet('products', [...products.values()])
  store.kvSet('changes_cursor', since)
  setSyncMeta({ last_sync_at: nowIso() })
  return { orders }
}

// ── Офлайн-заказ ────────────────────────────────────────────────────────────

function nextClientNumber(branchId) {
  const tag = store.kvGet('terminal_tag') || (() => {
    const value = `T${1 + Math.floor(Math.random() * 9)}${Math.floor(Math.random() * 9)}`
    store.kvSet('terminal_tag', value)
    return value
  })()
  const day = localDateKey().slice(2).replace(/-/g, '')
  const seqKey = `seq:${branchId}:${day}`
  const seq = (store.kvGet(seqKey, 0) || 0) + 1
  store.kvSet(seqKey, seq)
  return `${tag}-${day}-${String(seq).padStart(3, '0')}`
}

function recalc(order) {
  const active = (order.items || []).filter((i) => i.status !== 'cancelled')
  const subtotal = active.reduce((s, i) => s + cents(i.total), 0)
  const discount = Math.min(Math.max(cents(order.discount_amount), 0), subtotal)
  const after = Math.max(subtotal - discount, 0)
  const vatRate = Number(store.kvGet('company')?.vat_rate || 0) / 100
  const tax = Math.round(after * vatRate)
  const serviceBase = active.filter((i) => !i.takeaway).reduce((s, i) => s + cents(i.total), 0)
  const rate = order.service_fee_rate != null
    ? Number(order.service_fee_rate)
    : hallPercentForTable(order.table_id) / 100
  const service = Math.round(serviceBase * rate)
  order.subtotal = dec(subtotal)
  order.discount_amount = dec(discount)
  order.tax_amount = dec(tax)
  order.service_fee = dec(service)
  order.total_amount = dec(after + tax + service)
  order.updated_at = nowIso()
  return order
}

function buildItem(input, orderId) {
  const product = productsById().get(String(input.product_id))
  if (!product) throw new Error('offline: блюдо отсутствует в локальном меню — обновите меню')
  const modifiers = Array.isArray(input.modifiers) ? input.modifiers : []
  const unitCents = input.unit_price != null ? cents(input.unit_price) : cents(product.price)
  const mods = modifiers.reduce((s, m) => s + (Number(m?.price_delta) || 0), 0)
  const qty = Number(input.quantity || 1)
  const itemDiscount = cents(input.discount)
  const total = Math.max(Math.round((unitCents + Math.round(mods * 100)) * qty) - itemDiscount, 0)
  return {
    id: crypto.randomUUID(),
    order_id: orderId,
    product_id: String(product.id),
    name: product.name,
    price: dec(unitCents),
    quantity: qty,
    discount: dec(itemDiscount),
    total: dec(total),
    status: 'new',
    note: input.note || null,
    modifiers,
    course: input.course || 1,
    takeaway: !!input.takeaway,
    added_by: config.userId || null,
    added_by_name: config.userName || null,
    created_at: nowIso(),
  }
}

function createLocalOrder(payload) {
  const create = payload || {}
  if (!create.branch_id) throw new Error('offline: не выбран филиал')
  const clientId = create.client_id || crypto.randomUUID()

  const dup = store.get().prepare('SELECT * FROM orders_local WHERE client_id = ?').get(clientId)
  if (dup) return orderDto(dup)

  const created = nowIso()
  const order = {
    id: clientId,
    company_id: store.kvGet('company')?.id || null,
    branch_id: String(create.branch_id),
    order_number: nextClientNumber(String(create.branch_id)),
    order_type: create.order_type || 'dine_in',
    status: 'new',
    table_number: create.table_number != null ? String(create.table_number) : null,
    table_id: create.table_id || null,
    persons_count: create.persons_count || 1,
    subtotal: '0.00',
    discount_amount: dec(cents(create.discount_amount)),
    tax_amount: '0.00',
    service_fee: '0.00',
    total_amount: '0.00',
    service_fee_rate: create.service_fee_rate ?? null,
    note: create.note || null,
    source: 'offline',
    customer_phone: create.customer_phone || null,
    customer_address: create.customer_address || null,
    receipt_printed_at: null,
    waiter_id: create.waiter_id || config.userId || null,
    waiter_name: create.waiter_id
      ? (findStaff(create.waiter_id)?.name || null)
      : (config.userName || null),
    receipt_staff: [],
    cancel_comment: null,
    items: [],
    cancelled_at: null,
    cancelled_by_id: null,
    expo_confirmed_at: null,
    expo_confirmed_by_id: null,
    client_id: clientId,
    client_number: null,
    created_offline_at: created,
    synced_at: null,
    created_at: created,
    updated_at: created,
    offline: true,
  }
  order.client_number = order.order_number
  order.items = (create.items || []).map((item) => buildItem(item, order.id))
  order.receipt_staff = order.waiter_name ? [{ label: 'Официант', name: order.waiter_name }] : []
  recalc(order)

  store.get().prepare(
    'INSERT INTO orders_local (id, server_id, client_id, client_number, branch_id, status, sync_state, data, created_at, updated_at) ' +
    'VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(order.id, clientId, order.client_number, order.branch_id, order.status, 'pending',
    JSON.stringify(order), created, created)

  enqueue('order_create', { orderLocalId: order.id, payload: {} })
  store.audit({
    actorId: config.userId, action: 'order.create.offline', entity: 'order',
    entityId: order.id, data: { client_number: order.client_number, total: order.total_amount },
  })
  // Кухня должна получить тикет сразу, как и при онлайне: без сети сервер
  // этого не сделает.
  printKitchenForOrder(order).catch(() => {})
  emit()
  return order
}

function orderDto(row) {
  if (!row) return null
  try {
    const data = JSON.parse(row.data)
    if (row.server_id) data.id = row.server_id
    data.local_id = row.id
    data.sync_state = row.sync_state
    data.offline = row.sync_state !== 'synced' || data.offline === true
    return data
  } catch {
    return null
  }
}

function findOrderRow(id) {
  if (!id) return null
  return store.get().prepare('SELECT * FROM orders_local WHERE id = ? OR server_id = ?').get(String(id), String(id))
}

function hasPendingOps(localId) {
  return !!store.get().prepare(
    "SELECT 1 FROM outbox WHERE order_local_id = ? AND status = 'pending' LIMIT 1"
  ).get(localId)
}

function saveOrder(row, order, { status } = {}) {
  store.get().prepare(
    'UPDATE orders_local SET status = ?, data = ?, updated_at = ? WHERE id = ?'
  ).run(status || order.status, JSON.stringify(order), nowIso(), row.id)
}

function enqueue(op, { orderLocalId = null, payload = {}, idempotencyKey = null, dependsOn = null } = {}) {
  const info = store.get().prepare(
    'INSERT INTO outbox (op, order_local_id, depends_on, payload, idempotency_key, status, attempts, next_attempt_at, created_at, updated_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)"
  ).run(op, orderLocalId, dependsOn, JSON.stringify(payload), idempotencyKey, nowMs(), nowMs())
  return Number(info.lastInsertRowid)
}

function withOrder(id, mutate) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  const changed = mutate(order, row)
  if (changed === false) return order
  recalc(order)
  saveOrder(row, order)
  emit()
  return order
}

function addItemsLocal(id, items) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  if (['completed', 'cancelled'].includes(order.status)) return order
  const prepared = (items || []).map((item) => buildItem(item, order.id))
  order.items = [...(order.items || []), ...prepared]
  recalc(order)
  saveOrder(row, order)
  if (row.server_id) {
    enqueue('order_add_items', {
      orderLocalId: row.id,
      payload: {
        items: prepared.map((i) => ({
          product_id: i.product_id, quantity: i.quantity, note: i.note,
          takeaway: i.takeaway, modifiers: i.modifiers, course: i.course,
        })),
      },
    })
  }
  printKitchenForOrder(order, new Set(prepared.map((i) => i.id))).catch(() => {})
  emit()
  return order
}

function setItemQuantityLocal(id, itemId, quantity) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  const item = (order.items || []).find((i) => String(i.id) === String(itemId))
  if (!item) return order
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) return order
  const unitCents = cents(item.price)
  const mods = (item.modifiers || []).reduce((s, m) => s + Math.round((Number(m?.price_delta) || 0) * 100), 0)
  const itemDiscount = cents(item.discount)
  item.quantity = qty
  item.total = dec(Math.max(Math.round((unitCents + mods) * qty) - itemDiscount, 0))
  recalc(order)
  saveOrder(row, order)
  if (row.server_id) {
    enqueue('order_set_qty', { orderLocalId: row.id, payload: { item_id: item.id, quantity: qty } })
  }
  emit()
  return order
}

function removeItemLocal(id, itemId, reason) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  if (['completed', 'cancelled'].includes(order.status)) return order
  const item = (order.items || []).find((i) => String(i.id) === String(itemId))
  if (!item) return order
  item.status = 'cancelled'
  item.cancel_reason = reason || null
  item.cancelled_at = nowIso()
  item.total = '0.00'
  recalc(order)
  saveOrder(row, order)
  if (row.server_id) {
    enqueue('order_remove_item', { orderLocalId: row.id, payload: { item_id: item.id, reason: reason || null } })
  }
  emit()
  return order
}

// Правки заказа, которые касса делает и в офлайне: официант, скидка, стол,
// примечание, гости. Для уже синхронизированного заказа ставим операцию в
// очередь; для локального — правка просто живёт в снапшоте и уходит вместе с
// order_create.
const ORDER_PATCH_KEYS = ['waiter_id', 'note', 'persons_count', 'table_id', 'table_number', 'discount_amount', 'service_fee_rate']

function updateOrderLocal(id, patch, options = {}) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  if (['completed', 'cancelled'].includes(order.status)) return order
  const input = patch || {}
  const allowed = {}
  for (const key of ORDER_PATCH_KEYS) {
    if (input[key] !== undefined) allowed[key] = input[key]
  }
  if (allowed.waiter_id !== undefined) {
    order.waiter_id = allowed.waiter_id || null
    order.waiter_name = allowed.waiter_id
      ? (findStaff(allowed.waiter_id)?.name || order.waiter_name || null)
      : null
    order.receipt_staff = order.waiter_name ? [{ label: 'Официант', name: order.waiter_name }] : []
  }
  if (allowed.note !== undefined) order.note = allowed.note || null
  if (allowed.persons_count !== undefined) order.persons_count = Number(allowed.persons_count) || 1
  if (allowed.table_id !== undefined) order.table_id = allowed.table_id || null
  if (allowed.table_number !== undefined) {
    order.table_number = allowed.table_number != null ? String(allowed.table_number) : null
  }
  if (allowed.discount_amount !== undefined) order.discount_amount = dec(cents(allowed.discount_amount))
  if (allowed.service_fee_rate !== undefined) order.service_fee_rate = allowed.service_fee_rate ?? null
  recalc(order)
  saveOrder(row, order)
  if (row.server_id) {
    const backend = { ...allowed }
    if (options.reason) backend.reason = options.reason
    if (options.action_pin) backend.action_pin = options.action_pin
    enqueue('order_update', { orderLocalId: row.id, payload: { patch: backend } })
  }
  emit()
  return order
}

function cancelOrderLocal(id, options = {}) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  if (row.server_id) {
    // Отмена на сервере проверяет пароль/причину и пишет аудит. Пароль отмены
    // компании на терминале не хранится (plaintext-секретов локально нет),
    // поэтому уже принятый сервером заказ без связи отменить нельзя.
    throw new Error('Отмена без связи недоступна: заказ уже на сервере. Восстановите соединение и повторите.')
  }
  if (['completed', 'cancelled'].includes(order.status)) return order
  const db = store.get()
  // Заказ никогда не покидал терминал — его исходящие операции больше не нужны.
  db.prepare('DELETE FROM outbox WHERE order_local_id = ?').run(row.id)
  order.status = 'cancelled'
  order.cancelled_at = nowIso()
  order.cancelled_by_id = config.userId || null
  order.cancel_comment = options.comment || null
  db.prepare(
    "UPDATE orders_local SET status = 'cancelled', sync_state = 'local', data = ?, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(order), nowIso(), row.id)
  store.audit({
    actorId: config.userId, action: 'order.cancel.offline', entity: 'order',
    entityId: order.id, data: { client_number: order.client_number, comment: options.comment || null },
  })
  emit()
  return order
}

function updateStatusLocal(id, status, extra) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  order.status = status
  if (status === 'cancelled') order.cancelled_at = nowIso()
  recalc(order)
  saveOrder(row, order, { status })
  const dependsOn = row.server_id ? null : lastCreateOpId(row.id)
  enqueue('order_status', { orderLocalId: row.id, payload: { status, extra: extra || {} }, dependsOn })
  emit()
  return order
}

function lastCreateOpId(localId) {
  const op = store.get().prepare(
    "SELECT id FROM outbox WHERE order_local_id = ? AND op = 'order_create' ORDER BY id DESC LIMIT 1"
  ).get(localId)
  return op?.id || null
}

function paymentsForOrder(id) {
  return store.kvGet(`payments:${id}`, [])
}

function payOrderLocal(id, payment) {
  const row = findOrderRow(id)
  if (!row) return null
  const order = orderDto(row)
  if (!order) return null
  if (['completed', 'cancelled'].includes(order.status)) return order
  const method = String(payment?.method || 'cash')
  if (method !== 'cash') throw new Error('offline: оплата без сети доступна только наличными')

  const amount = cents(payment?.amount ?? order.total_amount)
  const entry = {
    id: crypto.randomUUID(),
    order_id: order.id,
    amount: dec(amount),
    method,
    status: 'completed',
    cash_received: payment?.cash_received != null ? dec(cents(payment.cash_received)) : null,
    change_given: payment?.change_given != null ? dec(cents(payment.change_given)) : null,
    cashier_id: config.userId || null,
    created_at: nowIso(),
    offline: true,
  }
  store.kvSet(`payments:${order.id}`, [...paymentsForOrder(order.id), entry])

  order.status = 'completed'
  recalc(order)
  saveOrder(row, order, { status: 'completed' })
  const dependsOn = row.server_id ? null : lastCreateOpId(row.id)
  enqueue('order_pay', {
    orderLocalId: row.id,
    dependsOn,
    idempotencyKey: `desktop-payment:${crypto.randomUUID()}`,
    // cash_amount/card_amount не отправляем: пара обязательна и должна
    // сходиться с amount, а офлайн принимает только наличные целиком.
    payload: {
      amount: dec(amount),
      method,
      cash_received: entry.cash_received,
      offline_import: true,
      client_created_at: order.created_offline_at || order.created_at,
    },
  })
  store.audit({
    actorId: config.userId, action: 'payment.create.offline', entity: 'order',
    entityId: order.id, data: { amount: entry.amount, method },
  })
  emit()
  return entry
}

function listOrders({ branch_id, status, active_only, date, limit = 200 } = {}) {
  const db = store.get()
  const rows = branch_id
    ? db.prepare('SELECT * FROM orders_local WHERE branch_id = ? ORDER BY created_at DESC LIMIT ?').all(String(branch_id), Number(limit))
    : db.prepare('SELECT * FROM orders_local ORDER BY created_at DESC LIMIT ?').all(Number(limit))
  const list = []
  for (const row of rows) {
    const order = orderDto(row)
    if (!order) continue
    if (status && order.status !== status) continue
    if (active_only && !['new', 'accepted', 'cooking', 'ready'].includes(order.status)) continue
    if (date) {
      const key = String(order.created_at || '').slice(0, 10)
      if (key !== String(date)) continue
    }
    list.push(order)
  }
  return list
}

// ── Outbox: отправка ────────────────────────────────────────────────────────

function markDone(opId) {
  store.get().prepare("UPDATE outbox SET status = 'done', updated_at = ? WHERE id = ?").run(nowMs(), opId)
}

function markRetry(op, error) {
  const attempts = Number(op.attempts || 0) + 1
  if (attempts >= MAX_ATTEMPTS) {
    store.get().prepare(
      "UPDATE outbox SET status = 'dead', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?"
    ).run(attempts, String(error?.message || error), nowMs(), op.id)
    if (op.order_local_id) markOrderDead(op.order_local_id, error)
    return
  }
  const delay = Math.min(5 * 60 * 1000, 2000 * Math.pow(2, attempts))
  store.get().prepare(
    'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?'
  ).run(attempts, nowMs() + delay, String(error?.message || error), nowMs(), op.id)
}

function markDead(op, error) {
  store.get().prepare(
    "UPDATE outbox SET status = 'dead', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?"
  ).run(String(error?.message || error), nowMs(), op.id)
  if (op.order_local_id) markOrderDead(op.order_local_id, error)
  lastSyncError = String(error?.message || error)
}

function markOrderDead(localId, error) {
  const row = findOrderRow(localId)
  if (!row) return
  store.get().prepare("UPDATE orders_local SET sync_state = 'dead', updated_at = ? WHERE id = ?").run(nowIso(), row.id)
  store.get().prepare(
    "UPDATE outbox SET status = 'dead', last_error = ?, updated_at = ? WHERE order_local_id = ? AND status = 'pending'"
  ).run(String(error?.message || error), nowMs(), row.id)
  store.audit({
    actorId: config.userId, action: 'order.sync_failed', entity: 'order',
    entityId: row.id, data: { error: String(error?.message || error) },
  })
}

function applyServerOrder(row, serverOrder) {
  const local = orderDto(row) || {}
  const merged = mergeOrderMeta(serverOrder, local)
  store.get().prepare(
    "UPDATE orders_local SET server_id = ?, status = ?, sync_state = 'synced', data = ?, updated_at = ? WHERE id = ?"
  ).run(String(serverOrder.id), serverOrder.status, JSON.stringify(merged), nowIso(), row.id)
  emit()
}

async function runOp(op) {
  const payload = JSON.parse(op.payload || '{}')
  const row = op.order_local_id ? findOrderRow(op.order_local_id) : null
  if (op.order_local_id && !row) throw Object.assign(new Error('локальный заказ не найден'), { permanent: true })

  switch (op.op) {
    case 'order_create': {
      if (row.server_id) return
      const order = orderDto(row)
      const items = (order.items || [])
        .filter((i) => i.status !== 'cancelled')
        .map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          note: i.note || null,
          takeaway: !!i.takeaway,
          modifiers: i.modifiers || [],
          course: i.course || 1,
          ...(cents(i.discount) ? { discount: i.discount } : {}),
          unit_price: i.price,
        }))
      const body = {
        branch_id: order.branch_id,
        order_type: order.order_type,
        table_id: order.table_id || undefined,
        table_number: order.table_number || undefined,
        persons_count: order.persons_count || 1,
        note: order.note || undefined,
        customer_phone: order.customer_phone || undefined,
        customer_address: order.customer_address || undefined,
        waiter_id: order.waiter_id || undefined,
        discount_amount: cents(order.discount_amount) ? order.discount_amount : undefined,
        service_fee_rate: order.service_fee_rate != null ? Number(order.service_fee_rate) : undefined,
        items,
        client_id: row.client_id,
        client_number: row.client_number,
        created_offline_at: order.created_offline_at,
        price_snapshot: true,
        offline_totals: {
          subtotal: order.subtotal,
          discount_amount: order.discount_amount,
          tax_amount: order.tax_amount,
          service_fee: order.service_fee,
          total_amount: order.total_amount,
        },
      }
      const created = await api('POST', '/pos/orders', body)
      applyServerOrder(row, created)
      return
    }
    case 'order_add_items': {
      if (!row.server_id) return
      const updated = await api('POST', `/pos/orders/${row.server_id}/items/bulk`, { items: payload.items })
      applyServerOrder(row, updated)
      return
    }
    case 'order_set_qty': {
      if (!row.server_id) return
      const updated = await api('PATCH', `/pos/orders/${row.server_id}/items/${payload.item_id}`, { quantity: payload.quantity })
      applyServerOrder(row, updated)
      return
    }
    case 'order_remove_item': {
      if (!row.server_id) return
      const query = payload.reason ? `?reason=${encodeURIComponent(payload.reason)}` : ''
      const updated = await api('DELETE', `/pos/orders/${row.server_id}/items/${payload.item_id}${query}`)
      applyServerOrder(row, updated)
      return
    }
    case 'order_update': {
      if (!row.server_id) return
      const updated = await api('PATCH', `/pos/orders/${row.server_id}`, payload.patch || {})
      applyServerOrder(row, updated)
      return
    }
    case 'order_status': {
      if (!row.server_id) return
      const updated = await api('PATCH', `/pos/orders/${row.server_id}/status`, {
        status: payload.status, ...(payload.extra || {}),
      })
      applyServerOrder(row, updated)
      return
    }
    case 'order_pay': {
      if (!row.server_id) return
      const payment = await api('POST', '/payments', {
        order_id: row.server_id,
        ...payload,
      }, { headers: op.idempotency_key ? { 'Idempotency-Key': op.idempotency_key } : {} })
      const order = orderDto(row) || {}
      order.status = 'completed'
      order.synced_at = nowIso()
      saveOrder(row, order, { status: 'completed' })
      store.kvSet(`payments:${row.id}`, [payment])
      return
    }
    case 'shift_open': {
      const shift = await api('POST', '/pos/shifts/open', {
        branch_id: payload.branch_id, opening_cash: payload.opening_cash || '0',
      }).catch((err) => {
        // Смена уже открыта (например, открыли на другом терминале) — цель
        // достигнута, повторять нечего.
        if (err?.status === 400 || err?.status === 409) return null
        throw err
      })
      if (shift) {
        const merged = new Map()
        for (const s of cachedList('shifts')) merged.set(String(s.id), s)
        merged.set(String(shift.id), shift)
        store.kvSet('shifts', [...merged.values()])
      }
      return
    }
    case 'shift_close': {
      const shift = await api('POST', '/pos/shifts/close', {
        branch_id: payload.branch_id || undefined,
        closing_cash: payload.closing_cash || '0',
      })
      const merged = cachedList('shifts').map((s) => String(s.id) === String(shift.id) ? shift : s)
      store.kvSet('shifts', merged)
      return
    }
    default:
      throw Object.assign(new Error(`неизвестная операция ${op.op}`), { permanent: true })
  }
}

async function flush() {
  if (flushing) return flushing
  flushing = (async () => {
    if (!config.apiBase || !apiToken()) return snapshot()
    const onlineNow = await probe(true)
    if (!onlineNow) {
      emit()
      return snapshot()
    }
    const db = store.get()
    let processed = 0
    for (let guard = 0; guard < 200; guard++) {
      const ops = db.prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY id LIMIT 50").all()
      if (!ops.length) break
      let progressed = false
      let networkDown = false
      for (const op of ops) {
        if (Number(op.next_attempt_at || 0) > nowMs()) continue
        const row = op.order_local_id ? findOrderRow(op.order_local_id) : null
        if (op.order_local_id && op.op !== 'order_create' && !row?.server_id) continue // ждём create
        try {
          await runOp(op)
          markDone(op.id)
          processed++
          progressed = true
          lastSyncError = null
        } catch (err) {
          if (err?.network) {
            networkDown = true
            lastProbeOk = false
            lastSyncError = 'нет связи с сервером'
            break
          }
          const status = Number(err?.status || 0)
          const permanent = err?.permanent || (status >= 400 && status < 500 && status !== 409 && status !== 429)
          if (permanent) {
            markDead(op, err)
          } else {
            markRetry(op, err)
          }
          lastSyncError = String(err?.message || err)
          progressed = true
        }
      }
      if (networkDown || !progressed) break
    }
    // Дельта и справочники — после очереди: уже отправленные заказы придут
    // обратно с серверными id и обновят доску.
    try { await pullChanges() } catch (err) { lastSyncError = String(err?.message || err) }
    try { await maybeBootstrap() } catch (err) { lastSyncError = String(err?.message || err) }
    setSyncMeta({ last_sync_at: nowIso(), last_error: lastSyncError })
    emit()
    return { ...snapshot(), processed }
  })()
  try { return await flushing } finally { flushing = null }
}

async function maybeBootstrap() {
  const last = Date.parse(store.kvGet('bootstrap_at') || '') || 0
  if (nowMs() - last >= BOOTSTRAP_TTL_MS) await syncBootstrap(true)
  const staffAt = Date.parse(store.kvGet('staff_at') || '') || 0
  if (!staffAt || nowMs() - staffAt >= BOOTSTRAP_TTL_MS) await syncStaff()
}

// ── Печать ──────────────────────────────────────────────────────────────────

function printerList() { return cachedList('printers') }

function receiptPrinter(printerId) {
  const list = printerList().filter((p) => p.ip_address)
  if (printerId) return list.find((p) => String(p.id) === String(printerId)) || null
  return list.find((p) => p.printer_type === 'receipt')
    || list.find((p) => p.printer_type !== 'kitchen')
    || null
}

function kitchenPrinters() {
  const list = printerList().filter((p) => p.ip_address)
  const kitchen = list.filter((p) => p.printer_type === 'kitchen')
  return kitchen.length ? kitchen : []
}

function printBuffer(printer, buffer) {
  if (!printer?.ip_address) return Promise.reject(new Error('принтер не настроен'))
  if (!deps?.printRaw || !deps?.enqueuePrint) return Promise.reject(new Error('electron print unavailable'))
  return deps.enqueuePrint(() => deps.printRaw(printer.ip_address, printer.port || 9100, buffer))
}

function recordPrint(printer, buffer, error) {
  const id = crypto.randomUUID()
  store.get().prepare(
    'INSERT INTO print_jobs_local (id, printer_id, payload, status, created_at, printed_at, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, printer?.id || null, buffer.toString('base64'), error ? 'failed' : 'printed',
    nowIso(), error ? null : nowIso(), error ? String(error.message || error) : null)
}

async function printReceiptLocal({ orderId, printerId, copies = 1, payment = null } = {}) {
  const row = findOrderRow(orderId)
  const order = row ? orderDto(row) : null
  if (!order) throw new Error('заказ не найден локально')
  const printer = receiptPrinter(printerId)
  if (!printer) throw new Error('чек-принтер не настроен')
  const buffer = escpos.buildReceipt({
    company: store.kvGet('company') || {},
    branch: store.kvGet('branch') || {},
    order,
    payment,
    width: printer.paper_width || 80,
    timeZone: tz(),
  })
  try {
    for (let i = 0; i < Number(copies || 1); i++) await printBuffer(printer, buffer)
    recordPrint(printer, buffer, null)
    if (row) {
      order.receipt_printed_at = nowIso()
      saveOrder(row, order)
    }
    return { printed: true, printer: printer.name || printer.id }
  } catch (err) {
    recordPrint(printer, buffer, err)
    throw err
  }
}

async function printKitchenForOrder(order, onlyItemIds = null) {
  const printers = kitchenPrinters()
  if (!printers.length) return { printed: false }
  const items = onlyItemIds
    ? (order.items || []).filter((i) => onlyItemIds.has(i.id))
    : order.items
  if (!items?.length) return { printed: false }
  const buffer = escpos.buildKitchenTicket({
    order,
    items,
    width: printers[0].paper_width || 80,
    timeZone: tz(),
  })
  const results = []
  for (const printer of printers) {
    try {
      await printBuffer(printer, buffer)
      recordPrint(printer, buffer, null)
      results.push(printer.id)
    } catch (err) {
      recordPrint(printer, buffer, err)
      results.push(null)
    }
  }
  return { printed: results.some(Boolean), printers: results }
}

async function printKitchenLocal({ orderId, itemIds = null } = {}) {
  const row = findOrderRow(orderId)
  const order = row ? orderDto(row) : null
  if (!order) throw new Error('заказ не найден локально')
  return printKitchenForOrder(order, itemIds ? new Set(itemIds) : null)
}

// ── Смены ───────────────────────────────────────────────────────────────────

function shiftRows() { return cachedList('shifts') }

function currentShift(branchId, userId) {
  const shift = shiftRows().find((s) =>
    s.status === 'open'
    && String(s.branch_id) === String(branchId)
    && (!userId || String(s.cashier_id) === String(userId)))
  return shift || null
}

function openShiftLocal({ branchId, userId, openingCash = 0 }) {
  const existing = currentShift(branchId, userId)
  if (existing) return existing
  const shift = {
    id: `local-${crypto.randomUUID()}`,
    company_id: store.kvGet('company')?.id || null,
    branch_id: String(branchId),
    cashier_id: userId || config.userId || null,
    opened_at: nowIso(),
    closed_at: null,
    opening_cash: dec(cents(openingCash)),
    closing_cash: null,
    status: 'open',
    offline: true,
  }
  store.kvSet('shifts', [...shiftRows(), shift])
  enqueue('shift_open', { payload: { branch_id: branchId, opening_cash: dec(cents(openingCash)) } })
  emit()
  return shift
}

function closeShiftLocal({ branchId, userId, closingCash = 0 }) {
  const shift = currentShift(branchId, userId)
  if (!shift) return null
  const closed = {
    ...shift, status: 'closed', closed_at: nowIso(), closing_cash: dec(cents(closingCash)),
  }
  store.kvSet('shifts', shiftRows().map((s) => String(s.id) === String(shift.id) ? closed : s))
  enqueue('shift_close', { payload: { branch_id: branchId, closing_cash: dec(cents(closingCash)) } })
  emit()
  return closed
}

// ── Персонал и PIN ──────────────────────────────────────────────────────────

function staffUsers(branchId) {
  return staffCache()
    .filter((s) => s.is_active !== false)
    .filter((s) => !branchId || !s.branch_id || String(s.branch_id) === String(branchId))
    .map(toPublicUser)
    .filter(Boolean)
}

function verifyPin(pin, userId) {
  const key = String(userId || '*')
  const guard = pinGuard.get(key) || { count: 0, until: 0 }
  if (guard.until > nowMs()) {
    throw new Error('PIN temporarily locked')
  }
  const candidates = userId
    ? staffCache().filter((s) => String(s.id) === String(userId))
    : staffCache().filter((s) => s.is_active !== false)
  let matched = null
  for (const staff of candidates) {
    if (!staff.pin_hash) continue
    try {
      if (bcrypt.compareSync(String(pin), String(staff.pin_hash))) { matched = staff; break }
    } catch { /* битый хэш пропускаем */ }
  }
  if (!matched) {
    guard.count += 1
    // 5 неверных попыток → минута блокировки. PIN — 4–8 цифр, без паузы
    // перебор чужого кода занимает секунды.
    if (guard.count >= 5) { guard.until = nowMs() + 60 * 1000; guard.count = 0 }
    pinGuard.set(key, guard)
    throw new Error('Invalid PIN')
  }
  pinGuard.delete(key)
  return toPublicUser(matched)
}

function userFromToken(token) {
  const value = String(token || '')
  if (!value.startsWith('offline:')) return null
  return toPublicUser(findStaff(value.slice('offline:'.length)))
}

// ── IPC ─────────────────────────────────────────────────────────────────────

function registerIpc(ipcMain) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) }
      } catch (err) {
        return { ok: false, error: String(err?.message || err), status: err?.status || null, network: !!err?.network }
      }
    })
  }

  handle('offline:configure', (cfg) => {
    const next = { ...config, ...(cfg || {}) }
    const changed = ['apiBase', 'token', 'orgToken', 'userId', 'branchId']
      .some((key) => String(next[key] || '') !== String(config[key] || ''))
    config = next
    if (config.branchId) {
      const branch = store.kvGet('branch')
      if (!branch || String(branch.id) !== String(config.branchId)) {
        store.kvSet('branch', { ...(branch || {}), id: config.branchId })
      }
    }
    if (changed && config.apiBase && apiToken()) {
      setTimeout(() => { flush().catch(() => {}) }, 50)
    }
    return snapshot()
  })

  handle('offline:status', async () => {
    if (!lastProbeAt) probe().catch(() => {})
    return snapshot()
  })

  handle('offline:sync-now', async () => {
    await syncBootstrap(true)
    try { await syncStaff() } catch { /* список персонала не критичен */ }
    await flush()
    return snapshot()
  })

  handle('offline:bootstrap', async () => ({ bootstrap: await syncBootstrap(true), staff: await syncStaff() }))
  handle('offline:changes', () => pullChanges())
  handle('offline:flush', () => flush())

  handle('offline:cache', (key, data) => {
    if (!CHANGE_CACHE_KEYS.has(String(key))) throw new Error(`cache key ${key} is not allowed`)
    const value = Array.isArray(data) ? data : (data || null)
    if (key === 'products' && Array.isArray(value)) {
      const merged = new Map(productsById())
      for (const p of value) merged.set(String(p.id), p)
      store.kvSet('products', [...merged.values()])
    } else {
      store.kvSet(key, value)
    }
    if (key === 'company' || key === 'branch') emit()
    return true
  })
  handle('offline:cache-get', (key) => store.kvGet(key))

  handle('offline:staff-users', (branchId) => staffUsers(branchId))
  handle('offline:verify-pin', (pin, userId) => verifyPin(pin, userId))
  handle('offline:user-by-token', (token) => userFromToken(token))

  handle('offline:shift-current', (branchId, userId) => currentShift(branchId, userId))
  handle('offline:shift-open', (branchId, openingCash, userId) =>
    openShiftLocal({ branchId, userId, openingCash }))
  handle('offline:shift-close', (branchId, closingCash, userId) =>
    closeShiftLocal({ branchId, userId, closingCash }))

  handle('offline:orders-list', (params) => listOrders(params || {}))
  handle('offline:order-get', (id) => orderDto(findOrderRow(id)))
  handle('offline:has-order', (id) => !!findOrderRow(id))
  handle('offline:order-create', (payload) => createLocalOrder(payload))
  handle('offline:order-add-items', (id, items) => addItemsLocal(id, items))
  handle('offline:order-set-qty', (id, itemId, quantity) => setItemQuantityLocal(id, itemId, quantity))
  handle('offline:order-remove-item', (id, itemId, reason) => removeItemLocal(id, itemId, reason))
  handle('offline:order-update', (id, patch, options) => updateOrderLocal(id, patch, options))
  handle('offline:order-cancel', (id, options) => cancelOrderLocal(id, options))
  handle('offline:order-status', (id, status, extra) => updateStatusLocal(id, status, extra))
  handle('offline:order-pay', (id, payment) => payOrderLocal(id, payment))
  handle('offline:payments-for-order', (id) => paymentsForOrder(id))

  handle('offline:print-receipt', (args) => printReceiptLocal(args || {}))
  handle('offline:print-kitchen', (args) => printKitchenLocal(args || {}))
}

function initOffline(options) {
  deps = options || {}
  store.open(deps.app.getPath('userData'))
  registerIpc(deps.ipcMain)
  // Периодическая досылка: сеть могла вернуться без события online в рендерере
  // (спящий ноутбук, смена Wi-Fi). Тик дешёвый — без сети probe выходит сразу.
  const timer = setInterval(() => {
    if (!config.apiBase || !apiToken()) return
    if (outboxCounts().pending > 0) flush().catch(() => {})
  }, 20000)
  timer.unref?.()
  return { snapshot }
}

module.exports = { initOffline, snapshot }
