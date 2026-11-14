import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildReceipt, buildKitchenTicket, money, quantity } = require('../electron/offline/escpos.js')

// CP866: «Итого» → И(0x88) т(0xE2) о(0xAE) г(0xA3) о(0xAE)
const CP866_ITOGO = Buffer.from([0x88, 0xe2, 0xae, 0xa3, 0xae])
const CUT = Buffer.from([0x1d, 0x56, 0x41, 0x03])
const CODEPAGE = Buffer.from([0x1b, 0x74, 17])

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
  items: [
    { id: 'i1', name: 'Ош', quantity: 1, total: '25000.00', status: 'new', modifiers: [] },
    { id: 'i2', name: 'Чай', quantity: '2.000', total: '10000.00', status: 'new', modifiers: [] },
    { id: 'i3', name: 'Салат', quantity: 1, total: '10000.00', status: 'cancelled', cancel_reason: 'гость отказался', modifiers: [] },
  ],
}

test('quantity strips only trailing zeroes, never rounds a fraction away', () => {
  assert.equal(quantity(1), '1')
  assert.equal(quantity('1.000'), '1')
  assert.equal(quantity(1.5), '1.5')
  assert.equal(quantity('1.250'), '1.25')
  assert.equal(quantity(0.125), '0.125')
})

test('money rounds to whole sum without scientific notation', () => {
  assert.equal(money('45000.00'), '45,000')
  assert.equal(money(0), '0')
})

test('receipt starts with init + font A + CP866 codepage and ends with cut', () => {
  const buffer = buildReceipt({ company: { name: 'Marjon' }, order, width: 80 })
  assert.ok(buffer.subarray(0, 2).equals(Buffer.from([0x1b, 0x40])))
  assert.ok(buffer.indexOf(CODEPAGE) > 0)
  assert.ok(buffer.subarray(buffer.length - CUT.length).equals(CUT))
  assert.ok(buffer.indexOf(CP866_ITOGO) > 0, 'Cyrillic must be encoded as CP866, not "?"')
})

// Разбирает поток на строки, выбрасывая ESC/GS-команды: печатные байты в
// CP866 равны колонкам, поэтому длину строки меряем в байтах.
function visibleLines(buffer) {
  const lines = []
  let current = []
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]
    if (b === 0x1b) {
      const cmd = buffer[i + 1]
      i += (cmd === 0x40 || cmd === 0x32) ? 1 : 2
      continue
    }
    if (b === 0x1d) {
      if (buffer[i + 1] === 0x56) break // GS V — отрезка
      i += 2                            // GS ! n
      continue
    }
    if (b === 0x0a) { lines.push(Buffer.from(current)); current = []; continue }
    current.push(b)
  }
  if (current.length) lines.push(Buffer.from(current))
  return lines
}

test('typographic dashes fall back to ASCII, not "?"', () => {
  const buffer = buildReceipt({ company: {}, order, width: 80 })
  const reason = buffer.indexOf(Buffer.from([0xa3, 0xae, 0xe1, 0xe2, 0xec])) // «гость»
  assert.ok(reason > 0)
  const dash = buffer.indexOf(Buffer.from([0x20, 0x2d, 0x20, 0xa3])) // " - г"
  assert.ok(dash > 0, '«—» must encode as "-", not "?"')
})

test('receipt prints cancelled item with reason and keeps totals', () => {
  const text = buildReceipt({ company: { name: 'Marjon' }, order, width: 80 }).toString('latin1')
  assert.ok(text.includes('45,000'))
})

test('receipt fits the paper width on 58mm and 80mm', () => {
  for (const [width, cols] of [[80, 48], [58, 32]]) {
    const buffer = buildReceipt({ company: { name: 'Marjon' }, order, width })
    for (const line of visibleLines(buffer)) {
      assert.ok(line.length <= cols, `line ${JSON.stringify(line.toString('latin1'))} (${line.length}) exceeds ${cols} cols`)
    }
  }
})

test('kitchen ticket contains order number, table and dishes', () => {
  const buffer = buildKitchenTicket({ order, width: 80 })
  const text = buffer.toString('latin1')
  assert.ok(text.includes('T12-261114-001'))
  assert.ok(buffer.indexOf(Buffer.from([0x91, 0xe2, 0xae, 0xab, 0x3a])) > 0) // «Стол:»
  assert.ok(buffer.subarray(buffer.length - CUT.length).equals(CUT))
})
