// Локальная база терминала (better-sqlite3). Живёт в userData, переживает
// перезапуск и переустановку поверх: касса не должна терять офлайн-заказы.
//
// Разделение простое:
//   kv           — снимки справочников (меню, залы, принтеры, персонал) и курсоры;
//   orders_local — заказы, созданные/изменённые на терминале + кэш серверных;
//   outbox       — очередь записи на сервер (только она меняет облако);
//   print_jobs_local, audit_local — локальная печать и журнал действий.
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders_local (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  client_id TEXT NOT NULL UNIQUE,
  client_number TEXT,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  sync_state TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_local_server ON orders_local(server_id);
CREATE INDEX IF NOT EXISTS idx_orders_local_branch ON orders_local(branch_id, created_at);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  order_local_id TEXT,
  depends_on INTEGER,
  payload TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, id);
CREATE INDEX IF NOT EXISTS idx_outbox_order ON outbox(order_local_id, status);
CREATE TABLE IF NOT EXISTS print_jobs_local (
  id TEXT PRIMARY KEY,
  printer_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  printed_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS audit_local (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  data TEXT
);
`

let db = null

function open(userDataPath) {
  if (db) return db
  const dir = path.join(userDataPath, 'offline')
  fs.mkdirSync(dir, { recursive: true })
  db = new Database(path.join(dir, 'marjon-offline.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA)
  return db
}

function get() {
  if (!db) throw new Error('offline db is not open')
  return db
}

function close() {
  try { db?.close() } catch { /* уже закрыта */ }
  db = null
}

function kvGet(key, fallback = null) {
  const row = get().prepare('SELECT data FROM kv WHERE key = ?').get(key)
  if (!row) return fallback
  try { return JSON.parse(row.data) } catch { return fallback }
}

function kvSet(key, value) {
  get().prepare(
    'INSERT INTO kv (key, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ).run(key, JSON.stringify(value), new Date().toISOString())
}

function kvDelete(key) {
  get().prepare('DELETE FROM kv WHERE key = ?').run(key)
}

function audit({ actorId, action, entity, entityId, data }) {
  try {
    get().prepare(
      'INSERT INTO audit_local (ts, actor_id, action, entity, entity_id, data) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(new Date().toISOString(), actorId || null, action, entity || null, entityId || null,
      data ? JSON.stringify(data) : null)
  } catch { /* журнал не должен ронять продажу */ }
}

module.exports = { open, close, get, kvGet, kvSet, kvDelete, audit }
