// Локальный ESC/POS для офлайн-печати. Бэкендный formatter (Python) остаётся
// эталоном для онлайна: здесь сознательно упрощённый, но самодостаточный чек —
// без сети сервер сформировать payload не может.
//
// Кодировка: ESC t 17 (CP866). Термопринтеры не понимают UTF-8, а Node не
// умеет cp866 «из коробки» — таблица ниже покрывает ASCII, кириллицу и «№».

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a
const INIT = [ESC, 0x40]
const FONT_A = [ESC, 0x4d, 0x00]
const CODEPAGE_CP866 = [ESC, 0x74, 17]
const LINE_SPACING_DEFAULT = [ESC, 0x32]
const BOLD_ON = [ESC, 0x45, 0x01]
const BOLD_OFF = [ESC, 0x45, 0x00]
const ALIGN_LEFT = [ESC, 0x61, 0x00]
const ALIGN_CENTER = [ESC, 0x61, 0x01]
const DOUBLE_HEIGHT = [GS, 0x21, 0x01]
const NORMAL_SIZE = [GS, 0x21, 0x00]
const CUT = [GS, 0x56, 0x41, 0x03]

const CP866 = (() => {
  const map = new Map()
  const upper = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'
  const lower = 'абвгдежзийклмноп'
  const lower2 = 'рстуфхцчшщъыьэюя'
  for (let i = 0; i < upper.length; i++) map.set(upper[i], 0x80 + i)
  for (let i = 0; i < lower.length; i++) map.set(lower[i], 0xa0 + i)
  for (let i = 0; i < lower2.length; i++) map.set(lower2[i], 0xe0 + i)
  map.set('Ё', 0xf0)
  map.set('ё', 0xf1)
  map.set('№', 0xfc)
  return map
})()

// Типографика, которой нет в CP866. «—» без замены печаталась бы как «?».
const CHAR_FALLBACKS = {
  '—': '-', '–': '-', '«': '"', '»': '"', '“': '"', '”': '"', '‘': "'", '’': "'",
  'ʻ': "'", 'ʼ': "'", '…': '...', '•': '-',
}

function encode(text) {
  const bytes = []
  for (const ch of String(text ?? '')) {
    if (ch === '\n') { bytes.push(LF); continue }
    const mapped = CP866.get(ch)
    if (mapped != null) { bytes.push(mapped); continue }
    // Замена типографики — строка из ASCII («…» → "..."), поэтому её
    // символы кодируем отдельно: просто подставить замену в CP866-таблицу
    // нельзя, ASCII там нет и выходило «?».
    const replacement = CHAR_FALLBACKS[ch] ?? ch
    for (const rc of replacement) {
      const code = rc.codePointAt(0)
      bytes.push(code >= 0x20 && code <= 0x7e ? code : (CP866.get(rc) ?? 0x3f))
    }
  }
  return bytes
}

function money(value) {
  const n = Number(value || 0)
  return Math.round(n).toLocaleString('en-US')
}

function quantity(value) {
  const n = Number(value || 0)
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

const ORDER_TYPE_LABELS = {
  dine_in: 'На стол', takeaway: 'На вынос', delivery: 'Доставка', qr: 'QR',
}
const PAYMENT_LABELS = {
  cash: 'Наличные', card: 'Карта', click: 'Click', payme: 'Payme', uzum: 'Uzum',
  mixed: 'Смешанная оплата', debt: 'В долг',
}

function formatDate(iso, timeZone = 'Asia/Tashkent') {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone, day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso || Date.now()))
  } catch {
    return new Date(iso || Date.now()).toISOString().slice(0, 16).replace('T', ' ')
  }
}

function wrap(text, width) {
  const source = String(text ?? '').trim()
  if (!source) return []
  const words = source.split(/\s+/)
  const lines = []
  let current = ''
  for (let word of words) {
    while (word.length > width) {
      if (current) { lines.push(current); current = '' }
      lines.push(word.slice(0, width))
      word = word.slice(width)
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= width) current = candidate
    else { if (current) lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

class Ticket {
  constructor({ width = 80 } = {}) {
    this.cols = Number(width) >= 80 ? 48 : 32
    this.out = []
  }

  raw(bytes) { this.out.push(...bytes); return this }
  line(text = '') { this.raw(encode(text)); this.out.push(LF); return this }
  boldLine(text = '') { this.raw(BOLD_ON); this.line(text); this.raw(BOLD_OFF); return this }
  center(text = '') { this.raw(ALIGN_CENTER); this.line(text); this.raw(ALIGN_LEFT); return this }
  boldCenter(text = '') {
    this.raw(ALIGN_CENTER); this.raw(BOLD_ON); this.line(text)
    this.raw(BOLD_OFF); this.raw(ALIGN_LEFT); return this
  }
  bigCenter(text = '') {
    this.raw(ALIGN_CENTER); this.raw(BOLD_ON); this.raw(DOUBLE_HEIGHT)
    this.line(text)
    this.raw(NORMAL_SIZE); this.raw(BOLD_OFF); this.raw(ALIGN_LEFT); return this
  }
  wrapped(text, width = this.cols) {
    for (const line of wrap(text, width)) this.line(line)
    return this
  }
  divider(char = '-') { return this.line(char.repeat(this.cols)) }
  twoCol(left, right, cols = this.cols) {
    const pad = Math.max(cols - String(left).length - String(right).length, 1)
    return this.line(String(left) + ' '.repeat(pad) + String(right))
  }
  itemRow(name, qty, total) {
    const qtyW = 6
    const totalW = 10
    const nameW = Math.max(this.cols - qtyW - totalW, 4)
    const lines = wrap(name, nameW).length ? wrap(name, nameW) : ['']
    this.line(lines[0].padEnd(nameW) + String(qty).padStart(qtyW) + String(total).padStart(totalW))
    for (const cont of lines.slice(1)) this.line(cont.padEnd(nameW) + ' '.repeat(qtyW + totalW))
    return this
  }
  finish() {
    this.line(); this.line(); this.line()
    this.raw(CUT)
    return Buffer.from(this.out)
  }
}

function header(ticket) {
  ticket.raw(INIT)
  ticket.raw(FONT_A)
  ticket.raw(CODEPAGE_CP866)
  ticket.raw(LINE_SPACING_DEFAULT)
}

function staffLabel(order) {
  return order.waiter_name || order.cashier_name || ''
}

/**
 * Чек гостю. form — { company, branch, order, payment, copies }.
 * payment: { method, cash_received, change_given } | null.
 */
function buildReceipt({ company, branch, order, payment, width = 80, timeZone = 'Asia/Tashkent' }) {
  const t = new Ticket({ width })
  header(t)
  t.bigCenter(company?.name || company?.company_name || 'Marjon')
  if (branch?.name) t.center(branch.name)
  t.line()
  t.twoCol('Номер заказа:', String(order.order_number ?? order.client_number ?? ''))
  t.twoCol('Тип заказа:', ORDER_TYPE_LABELS[order.order_type] || order.order_type || '')
  if (order.table_number) t.twoCol('Номер стола:', String(order.table_number))
  const who = staffLabel(order)
  if (who) t.twoCol('Официант:', who)
  t.twoCol('Дата:', formatDate(order.created_offline_at || order.created_at, timeZone))
  t.divider()
  t.raw(BOLD_ON)
  t.itemRow('Блюдо', 'Кол-во', 'Сумма')
  t.raw(BOLD_OFF)
  t.divider()
  for (const item of (order.items || [])) {
    if (item.status === 'cancelled') continue
    t.itemRow(item.name, quantity(item.quantity), money(item.total))
    for (const mod of (item.modifiers || [])) {
      const label = typeof mod === 'string' ? mod : (mod.name || '')
      if (label) t.wrapped(`  + ${label}`)
    }
    if (item.note) t.wrapped(`  * ${item.note}`)
  }
  for (const item of (order.items || [])) {
    if (item.status !== 'cancelled') continue
    const reason = item.cancel_reason ? ` — ${item.cancel_reason}` : ''
    t.wrapped(`  x ${item.name}${reason}`)
  }
  t.divider()
  t.twoCol('Сумма блюд', money(order.subtotal))
  if (Number(order.discount_amount) > 0) t.twoCol('Скидка', `-${money(order.discount_amount)}`)
  if (Number(order.service_fee) > 0) {
    // Ставка выводится из застывших цифр заказа (сбор ÷ база «в зале»).
    let label = 'Обслуга'
    const base = (order.items || [])
      .filter((i) => i.status !== 'cancelled' && !i.takeaway)
      .reduce((s, i) => s + Number(i.total || 0), 0)
    if (base > 0) {
      const rate = Math.round((Number(order.service_fee) * 100 / base) * 100) / 100
      label = `Обслуга ${String(rate).replace(/\.0+$/, '')}%`
    }
    t.twoCol(label, money(order.service_fee))
  }
  if (Number(order.tax_amount) > 0) t.twoCol('Налог', money(order.tax_amount))
  t.raw(BOLD_ON)
  t.twoCol('Итого:', money(order.total_amount))
  t.raw(BOLD_OFF)
  if (payment?.method) {
    t.twoCol(`${PAYMENT_LABELS[payment.method] || payment.method}:`, money(payment.amount ?? order.total_amount))
    if (payment.cash_received != null) t.twoCol('Получено:', money(payment.cash_received))
    if (payment.change_given != null) t.twoCol('Сдача:', money(payment.change_given))
  }
  t.line()
  t.center('XARIDINGIZ')
  t.center('UCHUN RAXMAT!')
  t.line()
  t.boldCenter(String(order.order_number ?? ''))
  return t.finish()
}

/** Кухонный тикет. items — только новые позиции (дозаказ). */
function buildKitchenTicket({ order, items, width = 80, timeZone = 'Asia/Tashkent' }) {
  const t = new Ticket({ width })
  header(t)
  t.center(ORDER_TYPE_LABELS[order.order_type] || order.order_type || '')
  t.bigCenter(`#${order.order_number ?? order.client_number ?? ''}`)
  if (order.table_number) t.boldLine(`Стол: ${order.table_number}`)
  const who = staffLabel(order)
  if (who) t.line(`Официант: ${who}`)
  t.line(`Время: ${formatDate(order.created_offline_at || order.created_at, timeZone)}`)
  t.divider('=')
  t.raw(BOLD_ON)
  t.line('Блюдо'.padEnd(Math.max(t.cols - 8, 4)) + 'Кол-во'.padStart(8))
  t.raw(BOLD_OFF)
  for (const item of (items || order.items || [])) {
    if (item.status === 'cancelled') continue
    t.boldLine(item.name.padEnd(Math.max(t.cols - 8, 4)) + quantity(item.quantity).padStart(8))
    for (const mod of (item.modifiers || [])) {
      const label = typeof mod === 'string' ? mod : (mod.name || '')
      if (label) t.wrapped(`  + ${label}`)
    }
    if (item.note) t.wrapped(`  ! ${item.note}`)
  }
  if (order.note) {
    t.divider()
    t.boldLine(`КОММЕНТАРИЙ: ${order.note}`)
  }
  t.divider('=')
  return t.finish()
}

module.exports = { buildReceipt, buildKitchenTicket, money, quantity, ORDER_TYPE_LABELS, PAYMENT_LABELS }
