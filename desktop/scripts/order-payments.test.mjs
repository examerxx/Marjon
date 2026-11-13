import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOrderPayment, submitOrderPayment } from '../src/shared/orderPayments.mjs'

const order = { id: 'test-order', total_amount: '46000.00' }
const storage = () => {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data }
}
function harness(post) {
  const calls = []
  const store = storage()
  let key = 0
  const options = { order, method: 'cash', storage: store, server: `test-${Math.random()}`, newKey: () => String(++key),
    api: { post: (...args) => { calls.push(args); return post ? post(...args) : Promise.resolve({ data: { id: 'payment', order_id: order.id, status: 'completed', amount: order.total_amount } }) } } }
  return { options, calls, store }
}

test('cash: empty input pays exactly the server order total', () => {
  assert.deepEqual(buildOrderPayment(order, 'cash'), { order_id: order.id, amount: '46000.00', method: 'cash', cash_received: '46000.00', cash_amount: '46000.00', card_amount: '0.00' })
})
test('card: full total and no invented cash received', () => {
  assert.deepEqual(buildOrderPayment(order, 'card'), { order_id: order.id, amount: '46000.00', method: 'card', cash_received: null, cash_amount: '0.00', card_amount: '46000.00' })
})
test('mixed: cash is net of change; card and received cash preserved', () => {
  const payload = buildOrderPayment(order, 'mixed', { cash: 30000, card: 20000 })
  assert.equal(payload.cash_amount, '26000.00')
  assert.equal(payload.card_amount, '20000.00')
  assert.equal(payload.cash_received, '30000.00')
  assert.equal(payload.amount, '46000.00')
})
test('cash overpayment is not added to income', () => {
  const payload = buildOrderPayment(order, 'cash', { cash: 50000 })
  assert.equal(payload.amount, '46000.00')
  assert.equal(payload.cash_received, '50000.00')
})
test('underpayment, card overpayment, negative/NaN and debt never become a full payment', () => {
  for (const [method, detail] of [['cash', { cash: 45000 }], ['card', { card: 50000 }], ['cash', { cash: -1 }], ['cash', { cash: 'bad' }], ['debt', { cash: 10000 }]]) {
    assert.throws(() => buildOrderPayment(order, method, detail), error => Boolean(error.paymentErrorKey))
  }
})
test('posts to /payments with idempotency, not to the status PATCH/offline queue', async () => {
  const h = harness()
  await submitOrderPayment(h.options)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][0], '/payments')
  assert.equal(h.calls[0][2].headers['Idempotency-Key'], 'desktop-payment:1')
  assert.equal(h.store.data.size, 0)
})
test('double-click shares one pending request', async () => {
  let resolve
  const h = harness(() => new Promise(done => { resolve = done }))
  const first = submitOrderPayment(h.options)
  const second = submitOrderPayment(h.options)
  assert.equal(first, second)
  await Promise.resolve()
  resolve({ data: { order_id: order.id, status: 'completed', amount: 46000 } })
  await Promise.all([first, second])
  assert.equal(h.calls.length, 1)
})
test('timeout never becomes offline success and retry reuses durable key', async () => {
  let attempt = 0
  const h = harness(() => ++attempt === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve({ data: { order_id: order.id, status: 'completed', amount: 46000 } }))
  await assert.rejects(submitOrderPayment(h.options), /timeout/)
  assert.equal(h.store.data.size, 1)
  await submitOrderPayment(h.options)
  assert.equal(h.calls[0][2].headers['Idempotency-Key'], h.calls[1][2].headers['Idempotency-Key'])
})
test('ambiguous attempt cannot silently switch from cash to card', async () => {
  const h = harness(() => Promise.reject(new Error('timeout')))
  await assert.rejects(submitOrderPayment(h.options))
  assert.throws(() => submitOrderPayment({ ...h.options, method: 'card' }), error => error.paymentErrorKey === 'payment_pending_changed')
  assert.equal(h.calls.length, 1)
})
test('definitive rejection allows correction but never reports success', async () => {
  const h = harness(() => Promise.reject(Object.assign(new Error('total changed'), { response: { status: 422 } })))
  await assert.rejects(submitOrderPayment(h.options))
  assert.equal(h.store.data.size, 0)
})
test('unconfirmed response is not accepted or removed from retry storage', async () => {
  const h = harness(() => Promise.resolve({ data: { order_id: order.id, status: 'pending', amount: 46000 } }))
  await assert.rejects(submitOrderPayment(h.options), error => error.paymentErrorKey === 'payment_not_confirmed')
  assert.equal(h.store.data.size, 1)
})
test('storage failure prevents sending an unprotected payment', () => {
  const h = harness()
  h.options.storage.setItem = () => { throw new Error('full') }
  assert.throws(() => submitOrderPayment(h.options), error => error.paymentErrorKey === 'payment_attempt_storage')
  assert.equal(h.calls.length, 0)
})

// Свои способы оплаты из веб-админки (Uzum, Yandex): интеграции нет — фиксируем
// только «через что заплатили», одной суммой, без разбивки нал/карта.
test('custom payment method pays the full total and keeps its own name', () => {
  assert.deepEqual(buildOrderPayment(order, 'Uzum'), {
    order_id: order.id, amount: '46000.00', method: 'Uzum',
  })
})
test('custom payment method name is capped to the 30-char payments.method column', () => {
  const payload = buildOrderPayment(order, 'X'.repeat(40))
  assert.equal(payload.method.length, 30)
  assert.equal(payload.amount, '46000.00')
})
test('debt is never submitted as a full payment', () => {
  assert.throws(() => buildOrderPayment(order, 'debt', { cash: 46000 }), error => Boolean(error.paymentErrorKey))
})

test('VIP closes a complimentary order with no money received', async () => {
  const h = harness(async () => ({
    data: { id: 'vip', order_id: order.id, status: 'complimentary', amount: '0.00' },
  }))
  const result = await submitOrderPayment({ ...h.options, method: 'VIP' })
  assert.equal(result.status, 'complimentary')
  assert.deepEqual(h.calls[0][1], { order_id: order.id, method: 'VIP', amount: '46000.00' })
  assert.equal(h.store.data.size, 0)
})

test('partial card payment sends only the entered amount and confirms the server balance', async () => {
  const h = harness(async () => ({
    data: { id: 'part', order_id: order.id, status: 'completed', amount: '20000.00', remaining_amount: '26000.00' },
  }))
  const result = await submitOrderPayment({
    ...h.options, method: 'card', detail: { partialAmount: 20000 },
  })
  assert.equal(result.remaining_amount, '26000.00')
  assert.deepEqual(h.calls[0][1], {
    order_id: order.id, method: 'card', amount: '20000.00', partial: true,
    cash_received: null, cash_amount: '0.00', card_amount: '20000.00',
  })
})
