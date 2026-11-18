import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { receiptScene, kitchenScene } = require('../electron/offline/raster.js')

// Сцены строятся без окна Chromium — здесь проверяем раскладку (блоки, размеры,
// бумагу), которую офлайн обязан повторить за серверным receipt_raster.py.

const order = {
  id: 'local-1',
  order_number: 'T12-261114-001',
  order_type: 'dine_in',
  table_number: '5',
  waiter_name: 'Азиз',
  subtotal: '45000.00',
  discount_amount: '0.00',
  service_fee: '0.00',
  tax_amount: '0.00',
  total_amount: '45000.00',
  created_at: '2026-11-14T09:15:00+05:00',
  note: 'без лука',
  items: [
    { id: 'i1', name: 'Ош', quantity: 1, total: '25000.00', status: 'new', modifiers: [{ name: 'без лука' }], course: 1 },
    { id: 'i2', name: 'Чай', quantity: '2.000', total: '10000.00', status: 'new', modifiers: [], course: 1 },
    { id: 'i3', name: 'Салат', quantity: 1, total: '10000.00', status: 'cancelled', cancel_reason: 'гость отказался', modifiers: [] },
  ],
}

const payment = { method: 'cash', cash_received: '50000.00', change_given: '5000.00' }
const printedAt = '2026-11-14T09:16:00+05:00'

const opsOf = (scene, op) => scene.ops.filter((entry) => entry.op === op)
const texts = (scene) => scene.ops.flatMap((entry) => [entry.text, entry.label, entry.value].filter(Boolean))

test('receipt scene keeps the server paper widths', () => {
  assert.equal(receiptScene({ order, width: 80 }).width, 576)
  assert.equal(receiptScene({ order, width: 58 }).width, 384)
  assert.equal(receiptScene({ order }).margin, 16)
})

test('receipt scene mirrors the default block layout and sizes', () => {
  const scene = receiptScene({ company: { name: 'Marjon' }, order, payment, printedAt, width: 80 })
  const all = texts(scene)
  for (const label of [
    'Marjon', 'Номер заказа:', 'Тип заказа:', 'Номер стола:', 'Официант:',
    'Дата:', 'Сумма блюд', 'Итого:', 'Наличные:', 'Получено:', 'Сдача:',
    'XARIDINGIZ', 'UCHUN RAXMAT!', 'НОМЕР ЗАКАЗА', '45,000',
  ]) {
    assert.ok(all.includes(label), `missing "${label}"`)
  }
  // restaurantName large = 48px bold по центру, total xlarge = 38px.
  const restaurant = opsOf(scene, 'line').find((entry) => entry.text === 'Marjon')
  assert.deepEqual(
    { size: restaurant.size, weight: restaurant.weight, align: restaurant.align },
    { size: 48, weight: 'bold', align: 'center' },
  )
  const total = opsOf(scene, 'row').find((entry) => entry.label === 'Итого:')
  assert.equal(total.size, 38)
  assert.equal(total.value, '45,000')
  // Стол печатается отдельным блоком, отменённое блюдо уходит в cancelled.
  const items = opsOf(scene, 'items')[0]
  assert.deepEqual(items.rows.map((row) => row.name), ['Ош', 'Чай'])
  assert.deepEqual(items.cancelled.map((row) => row.name), ['Салат'])
})

test('receipt scene honors spacing and disabled blocks from the template', () => {
  const template = {
    blocks: ['restaurantName', 'orderNumber', 'items', 'total', 'bottomOrderNumber'],
    enabled: { waiter: false, table: false, dateTime: false, paymentMethod: false, thankYouText: false },
    lineSpacing: 'small',
  }
  const scene = receiptScene({ company: { name: 'Marjon' }, order, payment, printedAt, template })
  const all = texts(scene)
  assert.ok(!all.includes('Официант:'), 'waiter row is disabled')
  assert.ok(!all.includes('Дата:'), 'dateTime row is disabled')
  assert.ok(!all.includes('XARIDINGIZ'), 'thank you block is disabled')
  // small = 0.7: gap(8) → 5, gap(6) → 4.
  assert.equal(opsOf(scene, 'items')[0].gapRow, 4)
  const number = opsOf(scene, 'row').find((entry) => entry.label === 'Номер заказа:')
  assert.equal(number.gap, 5)
})

test('kitchen scene uses 58mm paper, trims and groups dishes', () => {
  const scene = kitchenScene({ order, width: 58, template: null })
  assert.equal(scene.width, 384)
  assert.equal(scene.trim, true)
  const all = texts(scene)
  assert.ok(all.includes('#T12-261114-001'))
  assert.ok(all.includes('Стол:'))
  assert.ok(all.includes('Время:'))
  const dishes = opsOf(scene, 'kitchenItems')[0]
  assert.deepEqual(dishes.rows.map((row) => row.name), ['Ош', 'Чай'])
  assert.equal(dishes.rows[0].mods[0], 'без лука')
  assert.equal(dishes.rows[1].qty, '2')
  assert.equal(dishes.showMoney, false)
  // medium = 1.0: заголовки курсов и строки остаются базовыми.
  assert.equal(dishes.gapRow, 4)
  assert.equal(dishes.gapCourse, 6)
})

test('kitchen scene prints the order note only when the template allows it', () => {
  const withNote = kitchenScene({ order, width: 80 })
  assert.ok(texts(withNote).includes('- без лука'))
  const muted = kitchenScene({
    order,
    width: 80,
    template: { enabled: { comment: false, orderNote: false } },
  })
  assert.ok(!texts(muted).includes('- без лука'))
})

test('offline renderers refuse to run without the Electron window', async () => {
  const { renderCustomerReceipt, renderKitchenTicket } = require('../electron/offline/raster.js')
  await assert.rejects(renderCustomerReceipt({ order, width: 80 }), /BrowserWindow/)
  await assert.rejects(renderKitchenTicket({ order, width: 80 }), /BrowserWindow/)
})
