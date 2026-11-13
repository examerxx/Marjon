// Full payment only. No status-only PATCH and no offline success/queue.
const inFlight = new Map()

function fail(key) {
  const error = new Error(key)
  error.paymentErrorKey = key
  throw error
}

function cents(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) fail('payment_invalid_amount')
  return Math.round((number + Number.EPSILON) * 100)
}
const money = value => (value / 100).toFixed(2)

export function buildOrderPayment(order, method, detail) {
  if (!order?.id) fail('payment_invalid_amount')
  const total = cents(order.total_amount)
  if (total <= 0) fail('payment_invalid_amount')
  const name = String(method ?? '').trim()
  if (!name) fail('payment_invalid_amount')
  // «В долг» — это НЕ полная оплата и никогда не проводится через /payments.
  if (name === 'debt') fail('payment_invalid_amount')
  // Способы оплаты, добавленные в веб-админке (Uzum, Yandex и др.), приходят
  // своим названием: интеграции нет, фиксируем только «через что заплатили» —
  // ровно этим значением отчёт и покажет способ оплаты. Разбивки нал/карта
  // у такого способа нет, оплата идёт одной суммой.
  if (detail?.partialAmount !== undefined) {
    const amount = cents(detail.partialAmount)
    if (!['cash', 'card'].includes(name) || amount <= 0 || amount > total) fail('payment_invalid_amount')
    const received = name === 'cash' ? cents(detail.cash ?? detail.partialAmount) : null
    if (received !== null && received < amount) fail('payment_not_full')
    return {
      order_id: order.id,
      amount: money(amount),
      method: name,
      partial: true,
      cash_received: received === null ? null : money(received),
      cash_amount: money(name === 'cash' ? amount : 0),
      card_amount: money(name === 'card' ? amount : 0),
    }
  }
  if (!['cash', 'card', 'mixed'].includes(name)) {
    return {
      order_id: order.id,
      amount: money(total),
      method: name.slice(0, 30),
    }
  }
  const entered = detail && (detail.cash !== undefined || detail.card !== undefined)
  const receivedCash = entered ? cents(detail.cash ?? 0) : name === 'cash' ? total : 0
  const card = entered ? cents(detail.card ?? 0) : name === 'card' ? total : 0
  if (card > total || (card === total && receivedCash > 0)) fail('payment_card_over_total')
  if (receivedCash + card < total) fail('payment_not_full')
  const cash = total - card
  return {
    order_id: order.id,
    amount: money(total),
    method: cash > 0 && card > 0 ? 'mixed' : cash > 0 ? 'cash' : 'card',
    cash_received: cash > 0 ? money(receivedCash) : null,
    cash_amount: money(cash),
    card_amount: money(card),
  }
}

export function submitOrderPayment({ api, storage, server, order, method, detail, newKey = () => crypto.randomUUID() }) {
  const payload = buildOrderPayment(order, method, detail)
  const slot = `marjon_payment_attempt:${encodeURIComponent(server)}:${order.id}`
  const current = inFlight.get(slot)
  if (current) {
    if (current.body !== JSON.stringify(payload)) fail('payment_pending_changed')
    return current.promise
  }
  let attempt
  try {
    const raw = storage.getItem(slot)
    attempt = raw ? JSON.parse(raw) : null
  } catch { fail('payment_attempt_storage') }
  if (attempt && (!attempt.key || JSON.stringify(attempt.payload) !== JSON.stringify(payload))) fail('payment_pending_changed')
  if (!attempt) {
    attempt = { key: `desktop-payment:${newKey()}`, payload }
    try { storage.setItem(slot, JSON.stringify(attempt)) } catch { fail('payment_attempt_storage') }
  }
  const promise = Promise.resolve().then(async () => {
    try {
      const { data } = await api.post('/payments', attempt.payload, { headers: { 'Idempotency-Key': attempt.key } })
      const vip = payload.method.toLowerCase() === 'vip'
      const expectedStatus = vip ? 'complimentary' : 'completed'
      const expectedAmount = vip ? 0 : cents(payload.amount)
      if (data?.status !== expectedStatus || data?.order_id !== order.id || cents(data.amount) !== expectedAmount) fail('payment_not_confirmed')
      if (payload.partial && (data.remaining_amount == null || !Number.isFinite(Number(data.remaining_amount)) || Number(data.remaining_amount) < 0)) {
        fail('payment_not_confirmed')
      }
      try { storage.removeItem(slot) } catch { /* A retained key safely replays the same confirmed payment. */ }
      return data
    } catch (error) {
      // Definitively rejected requests did not commit; corrections may use a new key.
      if ([400, 401, 403, 404, 422].includes(error?.response?.status)) {
        try { storage.removeItem(slot) } catch { /* Keep safe replay state if storage is unavailable. */ }
      }
      // Network timeout/5xx/409 is ambiguous: keep the same key + payload for retry.
      throw error
    } finally { inFlight.delete(slot) }
  })
  inFlight.set(slot, { body: JSON.stringify(payload), promise })
  return promise
}
