// ── Счётчик активных заказов для индикатора в шапке ───────────────────────────
// Шапка (TopBar) живёт выше рабочего экрана и не знает о списке заказов.
// Рабочий режим публикует счётчик сюда, шапка читает его через подписку.
// Это единственный канал: без общего состояния пришлось бы поднимать
// загрузку заказов в App.jsx и дублировать polling.

const listeners = new Set()
let activeOrders = 0

/** Текущее число активных заказов. */
export function getActiveOrdersCount() {
  return activeOrders
}

/**
 * Опубликовать новое число активных заказов.
 * @param {number} count
 */
export function setActiveOrdersCount(count) {
  const next = Number(count) || 0
  if (next === activeOrders) return
  activeOrders = next
  for (const fn of listeners) {
    try { fn(next) } catch { /* слушатель упал — остальные работают */ }
  }
}

/**
 * Подписаться на изменения счётчика.
 * @param {(count: number) => void} fn
 * @returns {() => void} отписка
 */
export function subscribeActiveOrders(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
