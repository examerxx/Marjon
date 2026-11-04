// Backend (FastAPI + SQLite) отдаёт datetime БЕЗ зоны: SQLite хранит UTC и
// теряет tzinfo. `new Date("2026-11-04T11:32:00")` читал такую строку как
// местное время, поэтому касса показывала 11:32 вместо 14:32 — на три часа
// позже реального. Считаем строки без зоны UTC, а с зоной (`Z`, `+05:00`)
// оставляем как есть: Postgres в проде отдаёт их уже с offset.

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function parseApiDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const raw = String(value).trim()
  const iso = raw.includes(' ') ? raw.replace(' ', 'T') : raw
  const normalized = DATE_ONLY.test(raw) ? `${raw}T00:00:00` : HAS_ZONE.test(iso) ? iso : `${iso}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function fmtTime(value) {
  const date = parseApiDate(value)
  return date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''
}

export function fmtDateTime(value) {
  const date = parseApiDate(value)
  return date
    ? date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
}

// Локальная «сегодняшняя» дата (YYYY-MM-DD). toISOString() даёт UTC и после
// полуночи по Ташкенту всё ещё показывает вчерашний день.
export function todayISO() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
