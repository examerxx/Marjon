// Сквозная проверка офлайн-цикла: реальный движок main-процесса, временная
// SQLite терминала, живой бэкенд на 8001 (изолированная copy dev.db).
//
// Сценарий: bootstrap при живой сети → «обрыв» (apiBase на мёртвый порт) →
// заказ + наличная оплата + печать чека локально → «сеть вернулась» → flush.
// Проверяем: ровно один заказ и одна оплата на сервере, итоги совпадают,
// повторный flush ничего не дублирует.
//
// Запуск: npm run test:offline:e2e (Node-режим Electron: ABI better-sqlite3,
// инструкция по изолированному бэкенду — OFFLINE_PLAN.md §13).
// ENV: MARJON_E2E_API, MARJON_E2E_EMAIL, MARJON_E2E_PASSWORD, MARJON_E2E_DB
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const engine = require('../electron/offline/index.js')
const localStore = require('../electron/offline/db.js')
const Database = require('better-sqlite3')

const API = process.env.MARJON_E2E_API || 'http://127.0.0.1:8001/api/v1'
const EMAIL = process.env.MARJON_E2E_EMAIL || 'admin@marjon.uz'
const PASSWORD = process.env.MARJON_E2E_PASSWORD || 'Admin1234'
const SERVER_DB = process.env.MARJON_E2E_DB
  || path.resolve(process.cwd(), '..', 'backend', 'dev-offline-e2e.db')
const DEAD_API = 'http://127.0.0.1:9/api/v1'

const handlers = new Map()
const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }

async function call(channel, ...args) {
  const fn = handlers.get(channel)
  assert.ok(fn, `IPC ${channel} не зарегистрирован`)
  const res = await fn(null, ...args)
  if (!res?.ok) {
    const err = new Error(res?.error || `IPC ${channel} failed`)
    err.status = res?.status
    err.network = res?.network
    throw err
  }
  return res.data
}

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const text = await res.text()
  assert.equal(res.status, 200, `login: ${res.status} ${text}`)
  return JSON.parse(text).access_token
}

async function getJson(token, pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  assert.equal(res.status, 200, `${pathname}: ${res.status} ${text}`)
  return JSON.parse(text)
}

// ── Локальный «принтер»: TCP-приёмник, собирает ESC/POS байты ────────────────
function fakePrinter() {
  const bytes = []
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => bytes.push(chunk))
    socket.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, bytes, close: () => server.close() })
    })
  })
}

function printRaw(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: ip, port }, () => {
      socket.end(buffer, () => resolve())
    })
    socket.on('error', reject)
    socket.setTimeout(5000, () => socket.destroy(new Error('print timeout')))
  })
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function outboxErrors() {
  try {
    const db = new Database(path.join(userData, 'offline', 'marjon-offline.db'), { readonly: true })
    try {
      return db.prepare("SELECT id, op, status, attempts, last_error FROM outbox WHERE status != 'done'").all()
        .map((r) => `#${r.id} ${r.op} [${r.status}] ${r.last_error}`).join('\n')
    } finally { db.close() }
  } catch (err) {
    return `outbox недоступен: ${err.message}`
  }
}

async function waitFor(what, check, timeoutMs = 30000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`не дождались: ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'marjon-offline-e2e-'))
const printer = await fakePrinter()

engine.initOffline({
  app: { getPath: () => userData },
  ipcMain,
  printRaw,
  enqueuePrint: (fn) => fn(),
})

let failures = 0
async function step(name, fn) {
  try {
    const value = await fn()
    console.log(`✔ ${name}`)
    return value
  } catch (err) {
    failures++
    console.log(`✖ ${name}\n  ${err.message}`)
    return undefined
  }
}

try {
  const token = await login()
  const me = await getJson(token, '/auth/me').catch(() => null)
  const branches = await getJson(token, '/companies/me/branches')
  assert.ok(branches.length, 'у компании нет филиалов')
  const branchId = branches[0].id
  const configured = {
    apiBase: API, token, orgToken: token,
    userId: me?.id || null, userName: me?.name || 'E2E', branchId,
  }

  await step('bootstrap заполняет локальные справочники', async () => {
    await call('offline:configure', configured)
    const boot = await call('offline:bootstrap')
    assert.ok(boot.bootstrap.products > 0, 'меню пустое после bootstrap')
    assert.ok(boot.staff.staff > 0, 'персонал пуст после bootstrap')
    const products = await call('offline:cache-get', 'products')
    assert.ok(products.some((p) => Number(p.price) > 0), 'нет блюд с ценой')
  })

  const products = await call('offline:cache-get', 'products')
  const dishA = products.find((p) => Number(p.price) > 0)
  const dishB = products.find((p) => Number(p.price) > 0 && p.id !== dishA.id)
  assert.ok(dishA && dishB, 'нужно минимум два блюда с ценой')
  const staff = await call('offline:staff-users', branchId)
  const waiter = staff.find((s) => s.is_active !== false) || staff[0]
  assert.ok(waiter, 'персонал пуст после bootstrap')

  await call('offline:cache', 'printers', [{
    id: 'e2e-receipt', name: 'E2E чек', printer_type: 'receipt',
    ip_address: '127.0.0.1', port: printer.port, paper_width: 80,
  }])

  // ── «Сеть пропала» ────────────────────────────────────────────────────────
  await call('offline:configure', { apiBase: DEAD_API })

  const order = await step('заказ создаётся без сети', async () => {
    const created = await call('offline:order-create', {
      branch_id: branchId,
      order_type: 'dine_in',
      note: 'E2E офлайн',
      items: [
        { product_id: dishA.id, quantity: 2 },
        { product_id: dishB.id, quantity: 1, takeaway: true },
      ],
    })
    const localId = created.local_id || created.id
    assert.ok(localId, 'нет локального id')
    const dto = await call('offline:order-get', localId)
    assert.equal(dto.sync_state, 'pending')
    const expected = Math.round(Number(dishA.price) * 2 * 100) + Math.round(Number(dishB.price) * 100)
    assert.equal(Math.round(Number(dto.total_amount) * 100), expected, 'итог не совпал с ценами меню')
    assert.match(String(dto.order_number), /^T\d{2}-\d{6}-\d{3}$/, 'номер офлайн-заказа')
    return dto
  })

  if (!order) throw new Error('заказ не создан — дальше проверять нечего')

  await step('правки заказа (скидка, стол, официант) применяются без сети', async () => {
    const before = Number(order.total_amount)
    const updated = await call('offline:order-update', order.local_id, {
      discount_amount: '5.00',
      note: 'E2E офлайн (правка)',
      table_number: '7',
      waiter_id: waiter.id,
    })
    assert.equal(Number(updated.discount_amount), 5)
    assert.equal(updated.note, 'E2E офлайн (правка)')
    assert.equal(String(updated.table_number), '7')
    assert.equal(String(updated.waiter_id), String(waiter.id))
    assert.equal(
      Math.round(Number(updated.total_amount) * 100),
      Math.round((before - 5) * 100),
      'скидка 5.00 не уменьшила итог ровно на 5.00',
    )
  })

  await step('наличная оплата фиксируется локально', async () => {
    const current = await call('offline:order-get', order.local_id)
    const total = Number(current.total_amount)
    const entry = await call('offline:order-pay', order.local_id, {
      method: 'cash', amount: current.total_amount,
      cash_received: (total + 10000).toFixed(2), change_given: '10000.00',
    })
    assert.equal(entry.status, 'completed')
    const local = await call('offline:order-get', order.local_id)
    assert.equal(local.status, 'completed')
    assert.equal(local.sync_state, 'pending', 'оплаченный заказ обязан ждать отправки')
  })

  await step('чек печатается локально через ESC/POS', async () => {
    await call('offline:print-receipt', { orderId: order.local_id })
    await waitFor('данные на «принтер»', () => printer.bytes.length > 0, 5000)
    const payload = Buffer.concat(printer.bytes)
    assert.ok(payload.length > 200, 'слишком короткий чек')
    assert.equal(payload[0], 0x1b, 'чек должен начинаться с ESC @')
    assert.ok(payload.includes(Buffer.from([0x1d, 0x56, 0x41])), 'в чеке нет команды отрезки')
  })

  await step('очередь показывает неотправленные операции', async () => {
    const status = await call('offline:status')
    assert.equal(status.online, false, 'мёртвый apiBase не должен считаться онлайн')
    assert.ok(status.pending >= 2, `в очереди ${status.pending}, ждали create+pay`)
    assert.equal(status.dead, 0)
  })

  // ── «Сеть вернулась» ──────────────────────────────────────────────────────
  await step('flush отправляет заказ, оплату и не дублирует их', async () => {
    await call('offline:configure', { apiBase: API })
    await waitFor('пустую очередь', async () => (await call('offline:status')).pending === 0)
    const status = await call('offline:status')
    assert.equal(status.dead, 0, `есть мёртвые операции: ${status.lastError || ''}\n${outboxErrors()}`)

    const synced = await call('offline:order-get', order.local_id)
    assert.equal(synced.sync_state, 'synced')
    assert.ok(synced.id && synced.id !== order.local_id, 'не пришёл серверный id')

    // Повторный flush не должен создать второй заказ/оплату.
    await call('offline:flush')

    const db = new Database(SERVER_DB, { readonly: true })
    try {
      const clientId = order.client_id
      assert.ok(clientId, 'локальный заказ потерял client_id')
      const rows = db.prepare('SELECT id, client_id, total_amount, status FROM orders WHERE client_id = ?').all(clientId)
      assert.equal(rows.length, 1, `на сервере ${rows.length} заказов с client_id ${clientId} (synced.client_id=${synced.client_id})`)
      // SQLite хранит UUID без дефисов, API отдаёт с ними.
      assert.equal(String(rows[0].id).replace(/-/g, ''), String(synced.id).replace(/-/g, ''))
      assert.equal(Number(rows[0].total_amount), Number(synced.total_amount), 'итог на сервере другой')
      assert.equal(rows[0].status, 'completed')
      const pays = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE replace(order_id, '-', '') = ?")
        .get(String(rows[0].id).replace(/-/g, ''))
      assert.equal(pays.n, 1, `на сервере ${pays.n} оплат`)
    } finally {
      db.close()
    }
  })

  await step('серверный заказ подтягивается обратно в локальную базу', async () => {
    const list = await call('offline:orders-list', { branch_id: branchId, limit: 50 })
    const found = list.find((o) => o.client_id === order.client_id)
    assert.ok(found, 'заказ не вернулся из /sync/changes')
    assert.equal(found.sync_state, 'synced')
  })

  await step('отчёт видит ровно одну продажу с итогом офлайн-заказа', async () => {
    const synced = await call('offline:order-get', order.local_id)
    const rows = await getJson(token, `/reports/orders?date_from=${today()}&date_to=${today()}`)
    const mine = rows.filter((r) => String(r.order_id).replace(/-/g, '') === String(synced.id).replace(/-/g, ''))
    assert.equal(mine.length, 1, `в отчёте ${mine.length} строк на заказ ${synced.id}`)
    assert.equal(Number(mine[0].total_amount), Number(synced.total_amount))
    assert.deepEqual(mine[0].payment_methods, ['cash'])
  })

  const syncedOrder = await call('offline:order-get', order.local_id)
  await step('локальная запись после синхронизации помнит client_id и офлайн-номер', async () => {
    assert.equal(syncedOrder.client_id, order.client_id)
    assert.equal(syncedOrder.client_number, order.order_number)
  })

  await step('правки заказа доехали до сервера', async () => {
    assert.equal(syncedOrder.note, 'E2E офлайн (правка)')
    assert.equal(Number(syncedOrder.discount_amount), 5)
    assert.equal(String(syncedOrder.waiter_id), String(waiter.id), 'официант не сохранился на сервере')
  })

  // ── Отмена: локальная и серверная ─────────────────────────────────────────
  await step('заказ, не ушедший на сервер, отменяется без сети', async () => {
    await call('offline:configure', { apiBase: DEAD_API })
    const temp = await call('offline:order-create', {
      branch_id: branchId,
      order_type: 'dine_in',
      items: [{ product_id: dishA.id, quantity: 1 }],
    })
    const localId = temp.local_id || temp.id
    const cancelled = await call('offline:order-cancel', localId, { comment: 'E2E отмена' })
    assert.equal(cancelled.status, 'cancelled')
    const dto = await call('offline:order-get', localId)
    assert.equal(dto.status, 'cancelled')
    assert.equal(dto.sync_state, 'local', 'отменённый локальный заказ не должен ждать отправки')
    const status = await call('offline:status')
    assert.equal(status.pending, 0, 'отмена обязана снять исходящие операции заказа')

    // После возврата связи отменённый заказ не должен появиться на сервере.
    await call('offline:configure', { apiBase: API })
    await call('offline:flush')
    const db = new Database(SERVER_DB, { readonly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE client_id = ?').get(temp.client_id)
      assert.equal(row.n, 0, 'отменённый локальный заказ всё-таки ушёл на сервер')
    } finally {
      db.close()
    }
  })

  await step('заказ на сервере без связи не отменяется — понятная ошибка', async () => {
    await call('offline:configure', { apiBase: DEAD_API })
    try {
      await assert.rejects(
        () => call('offline:order-cancel', syncedOrder.local_id, { comment: 'E2E' }),
        /без связи/i,
      )
    } finally {
      await call('offline:configure', { apiBase: API })
    }
    const still = await call('offline:order-get', syncedOrder.local_id)
    assert.equal(still.status, 'completed', 'отказ в отмене не должен менять статус заказа')
  })
} finally {
  printer.close()
  localStore.close()
  try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* WAL ещё держит файл */ }
}

if (failures) {
  console.error(`\n${failures} проверок упало`)
  process.exit(1)
}
console.log('\nвсе проверки офлайн-цикла прошли')
