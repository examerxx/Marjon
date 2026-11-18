// Локальный ESC/POS для офлайн-печати. Бэкендный formatter (Python) остаётся
// эталоном: файл портирует его логику один-в-один — порядок блоков, стили
// (size/align/weight + коды GS !), шаблонные тумблеры, разделители секций,
// сводку, строки оплаты и нижний номер. Чек, напечатанный офлайн, должен
// выглядеть ровно как чек, напечатанный сервером с тем же шаблоном.
//
// Кодировка: ESC t 17 (CP866). Термопринтеры не понимают UTF-8, а Node не
// умеет cp866 «из коробки» — таблица ниже покрывает ASCII, кириллицу и «№».

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a
const INIT = [ESC, 0x40]
const FONT_A = [ESC, 0x4d, 0x00]
const CODEPAGE_CP866 = [ESC, 0x74, 17]
const LINE_SPACING = {
  small: [ESC, 0x33, 20],
  medium: [ESC, 0x32],
  large: [ESC, 0x33, 40],
}
const BOLD_ON = [ESC, 0x45, 0x01]
const BOLD_OFF = [ESC, 0x45, 0x00]
const ALIGN_LEFT = [ESC, 0x61, 0x00]
const ALIGN_CENTER = [ESC, 0x61, 0x01]
const ALIGN_RIGHT = [ESC, 0x61, 0x02]
const ALIGN = { left: ALIGN_LEFT, center: ALIGN_CENTER, right: ALIGN_RIGHT }
const NORMAL_SIZE = [GS, 0x21, 0x00]
const CUT = [GS, 0x56, 0x41, 0x03]
// Как в formatter.py: кухонный отрез с дополнительной подачей (n=0x49).
const KITCHEN_CUT = [GS, 0x56, 0x41, 0x49]

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

// Порт format_quantity: целое → "1", дробь → "1.5"/"1.25" (нули не теряются).
function quantity(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return '0'
  return String(Number(n.toFixed(3)))
}

function ratePercentByFee(fee, base) {
  const f = Number(fee || 0)
  const b = Number(base || 0)
  if (f <= 0 || b <= 0) return null
  return Math.round((f * 10000) / b) / 100
}

function formatRatePercent(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return String(Number(n.toFixed(2)))
}

function formatDate(iso, timeZone = 'Asia/Tashkent') {
  const date = iso ? new Date(iso) : new Date()
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone, day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
    const at = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    return `${at.day}.${at.month}.${at.year} ${at.hour}:${at.minute}`
  } catch {
    const raw = (iso ? date : new Date()).toISOString().slice(0, 16).replace('T', ' ')
    return raw
  }
}

function wrap(text, width) {
  const source = String(text ?? '').trim()
  if (!source) return []
  if (width <= 0) return [source]
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

const ORDER_TYPE_LABELS = {
  dine_in: 'На стол', takeaway: 'На вынос', delivery: 'Доставка', qr: 'QR',
}
const PAYMENT_LABELS = {
  cash: 'Наличные', card: 'Карта', click: 'Click', payme: 'Payme', uzum: 'Uzum',
  loyalty: 'Бонусы', mixed: 'Смешанная оплата', debt: 'В долг',
}

function formatOrderType(value) {
  const text = String(value ?? '').trim()
  return ORDER_TYPE_LABELS[text] ?? text
}

// Кухня печатает «С собой» вместо «На вынос» — как format_kitchen_order_type.
function formatKitchenOrderType(value) {
  const text = String(value ?? '').trim()
  return ['takeaway', 'На вынос', 'НА ВЫНОС'].includes(text) ? 'С собой' : formatOrderType(text)
}

// ── Шаблон: порядок и тумблеры блоков ───────────────────────────────────────
// Значения — зеркало frontend/src/api/receipt.js и formatter.py.

const CUSTOMER_BLOCKS = [
  'logo', 'restaurantName', 'address', 'phone', 'orderNumber', 'table',
  'waiter', 'dateTime', 'items', 'discount', 'serviceFee', 'vat', 'total',
  'paymentMethod', 'thankYouText', 'bottomOrderNumber',
]
const KITCHEN_BLOCKS = [
  'orderType', 'orderNumber', 'cancelOrderNumber', 'table', 'waiter',
  'date', 'showOrderSum', 'comment',
]

const DEFAULT_BLOCK_STYLES = {
  restaurantName: { size: 'large', align: 'center', weight: 'bold' },
  address: { align: 'center' },
  phone: { align: 'center' },
  orderNumber: { size: 'standard', align: 'center', weight: 'bold' },
  dateTime: { size: 'standard', align: 'center', weight: 'bold' },
  total: { size: 'xlarge', align: 'left', weight: 'standard' },
  thankYouText: { size: 'large', align: 'center', weight: 'bold' },
  bottomOrderNumber: { size: 'large', align: 'center', weight: 'bold' },
}

const CHEF_DEFAULT_STYLES = {
  dishItems: { size: 'standard', weight: 'bold' },
  orderNumber: { size: 'large', align: 'center', weight: 'bold' },
  cancelOrderNumber: { size: 'large', align: 'center', weight: 'bold' },
  orderType: { size: 'standard', weight: 'standard' },
  table: { size: 'standard', weight: 'standard' },
  waiter: { size: 'standard', weight: 'standard' },
  date: { size: 'standard', align: 'left', weight: 'standard' },
  showOrderSum: { size: 'standard', weight: 'standard' },
  comment: { size: 'standard', weight: 'standard' },
}
const CHEF_NO_ALIGN = new Set(['orderType', 'table', 'waiter', 'showOrderSum', 'comment'])

function enabled(template, key, fallback = true) {
  if (!template) return fallback
  const map = template.enabled
  if (!map || typeof map !== 'object' || !(key in map)) return fallback
  return Boolean(map[key])
}

function blockStyle(template, key) {
  const stored = (template?.blockStyles || {})[key] || {}
  const merged = { ...(DEFAULT_BLOCK_STYLES[key] || {}), ...stored }
  // У контактных блоков нет выравнивания в редакторе — всегда по центру.
  if (key === 'address' || key === 'phone') merged.align = 'center'
  return merged
}

function kitchenStyle(template, key) {
  const stored = (template?.blockStyles || {})[key] || {}
  const merged = { ...(CHEF_DEFAULT_STYLES[key] || {}), ...stored }
  if (merged.size === 'medium') merged.size = 'large'
  if (CHEF_NO_ALIGN.has(key)) merged.align = 'left'
  return merged
}

function orderedBlocks(blocks, canonical) {
  const known = new Set(canonical)
  const seen = new Set()
  const result = []
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (known.has(block) && !seen.has(block)) { result.push(block); seen.add(block) }
    }
  }
  for (const block of canonical) {
    if (!seen.has(block)) result.push(block)
  }
  return result
}

function numberAtTop(template) {
  return enabled(template, 'bottomOrderNumber')
    && (template?.blockStyles || {}).bottomOrderNumber?.placement === 'top'
}

function customerBlocks(template) {
  const blocks = orderedBlocks(template?.blocks, CUSTOMER_BLOCKS)
  if (numberAtTop(template)) {
    const index = blocks.indexOf('bottomOrderNumber')
    if (index >= 0) blocks.splice(index, 1)
    const anchor = blocks.indexOf('restaurantName')
    blocks.splice(anchor >= 0 ? anchor + 1 : 0, 0, 'bottomOrderNumber')
  }
  return blocks
}

function kitchenBlocks(template) {
  return ['orderType', ...orderedBlocks(template?.blocks, KITCHEN_BLOCKS).filter((b) => b !== 'orderType')]
}

function separatorStyle(template) {
  const value = template?.separator
  const source = value && typeof value === 'object' ? value : {}
  const pattern = ['dashed', 'solid', 'stars'].includes(source.pattern) ? source.pattern : 'dashed'
  const weight = ['thin', 'medium', 'bold'].includes(source.weight) ? source.weight : 'thin'
  return { char: { dashed: '-', solid: '_', stars: '*' }[pattern], repeat: { thin: 1, medium: 2, bold: 3 }[weight] }
}

// ── Стили ESC/POS ───────────────────────────────────────────────────────────

const SIZE_CODES = { standard: 0x00, large: 0x01, xlarge: 0x01, xxlarge: 0x11 }
const RESTAURANT_NAME_SIZE_CODES = { standard: 0x00, large: 0x11, xlarge: 0x22 }
const BOTTOM_NUMBER_SIZE_CODES = { standard: 0x11, large: 0x22, xlarge: 0x55, xxlarge: 0x66 }

function styleBytes(style = {}, sizeCode = null) {
  const align = style.align || 'left'
  const bold = (style.weight || 'standard') === 'bold'
  if (sizeCode == null) sizeCode = SIZE_CODES[style.size || 'standard'] ?? 0x00
  const div = (sizeCode >> 4) + 1
  const prefix = [...FONT_A, ...(ALIGN[align] || ALIGN_LEFT)]
  if (sizeCode) prefix.push(GS, 0x21, sizeCode)
  if (bold) prefix.push(...BOLD_ON)
  const suffix = []
  if (bold) suffix.push(...BOLD_OFF)
  if (sizeCode) suffix.push(...NORMAL_SIZE)
  suffix.push(...FONT_A, ...ALIGN_LEFT)
  return { prefix, suffix, div }
}

// ── Примитивы построчной печати ─────────────────────────────────────────────

function line(text = '') {
  return [...encode(text), LF]
}

// ESC/POS bold — переключатель, поэтому закрываем его до LF (как _bold_line
// сервера), иначе BOLD_OFF уезжает в начало следующей строки.
function boldLine(text = '') {
  return [...BOLD_ON, ...encode(text), ...BOLD_OFF, LF]
}

// formatter.py сбрасывает стиль строки ПЕРЕД её финальным LF, а не после —
// иначе ESC-сброс уезжает в начало следующей строки.
function styledRow(prefix, body, suffix) {
  if (body.length && body[body.length - 1] === LF) {
    return [...prefix, ...body.slice(0, -1), ...suffix, LF]
  }
  return [...prefix, ...body, ...suffix]
}

function wprint(out, text, width) {
  for (const row of wrap(text, width) || ['']) out.push(...line(row))
  return out
}

function divider(template, cols) {
  const separator = separatorStyle(template)
  // Вес «medium/bold» — это несколько ПОЛНЫХ строк-разделителей (как
  // _divider() в formatter.py), а не повтор символа в одной строке.
  const rows = []
  for (let i = 0; i < separator.repeat; i++) rows.push(...line(separator.char.repeat(cols)))
  return rows
}

function twoCol(left, right, cols) {
  const pad = Math.max(cols - String(left).length - String(right).length, 1)
  return line(String(left) + ' '.repeat(pad) + String(right))
}

// Python str.center: лишний пробел при нечётном поле уходит вправо.
function centerText(text, width) {
  const value = String(text)
  const pad = Math.max(width - value.length, 0)
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + value + ' '.repeat(pad - left)
}

const ITEM_QTY_W = 6
const ITEM_TOTAL_W = 10
const KITCHEN_QTY_W_PLAIN = 8

function threeCol(name, qty, total, cols) {
  const nameW = Math.max(cols - ITEM_QTY_W - ITEM_TOTAL_W, 1)
  return line(String(name).slice(0, nameW).padEnd(nameW) + String(qty).padStart(ITEM_QTY_W) + String(total).padStart(ITEM_TOTAL_W))
}

function itemRow(name, qty, total, cols) {
  if (cols < ITEM_QTY_W + ITEM_TOTAL_W + 4) {
    const out = []
    wprint(out, name, cols)
    out.push(...twoCol(`x${qty}`, total, cols))
    return out
  }
  const nameW = cols - ITEM_QTY_W - ITEM_TOTAL_W
  const rows = wrap(name, nameW)
  if (!rows.length) rows.push('')
  const out = [...line(rows[0].padEnd(nameW) + String(qty).padStart(ITEM_QTY_W) + String(total).padStart(ITEM_TOTAL_W))]
  for (const cont of rows.slice(1)) {
    out.push(...line(cont.padEnd(nameW) + ' '.repeat(ITEM_QTY_W + ITEM_TOTAL_W)))
  }
  return out
}

function kitchenItemRow(name, qty, total, qtyW, totalW, cols) {
  const used = qtyW + (total != null ? totalW : 0)
  const tail = centerText(qty, qtyW) + (total != null ? String(total).padStart(totalW) : '')
  if (cols < used + 4) {
    const out = []
    wprint(out, name, cols)
    out.push(...line(tail))
    return out
  }
  const nameW = cols - used
  const rows = wrap(name, nameW)
  if (!rows.length) rows.push('')
  const out = [...line(rows[0].padEnd(nameW) + tail)]
  for (const cont of rows.slice(1)) out.push(...line(cont.padEnd(nameW) + ' '.repeat(used)))
  return out
}

// ── Данные чека из локального заказа ────────────────────────────────────────

function groupItems(items) {
  const result = []
  const indices = new Map()
  for (const item of items) {
    const qty = Number(item.qty || 0)
    const amount = item.total == null ? null : Number(item.total)
    const unit = amount != null && qty > 0 ? Math.round((amount / qty) * 1e6) / 1e6 : null
    const key = JSON.stringify([
      item.product_id ?? null, item.name, item.price ?? null, unit, amount == null,
      item.modifiers || [], item.note || '', item.course || 1, Boolean(item.takeaway),
    ])
    if (!(qty > 0) || !indices.has(key)) {
      if (qty > 0) indices.set(key, result.length)
      result.push({ ...item, modifiers: [...(item.modifiers || [])] })
      continue
    }
    const previous = result[indices.get(key)]
    previous.qty = Number(previous.qty || 0) + qty
    if (amount != null) previous.total = (Number(previous.total) || 0) + amount
  }
  return result
}

function receiptData(order, company, payment) {
  const active = (order.items || []).filter((i) => i.status !== 'cancelled')
  const cancelled = (order.items || []).filter((i) => i.status === 'cancelled')
  const lines = groupItems(active.map((item) => ({
    product_id: item.product_id != null ? String(item.product_id) : null,
    name: item.name,
    qty: Number(item.quantity || 0),
    price: item.price != null ? Number(item.price) : null,
    total: item.total != null ? Number(item.total) : null,
    modifiers: (item.modifiers || []).map((m) => (typeof m === 'string' ? m : m?.name || '')).filter(Boolean),
    note: item.note || null,
    course: item.course || 1,
    takeaway: Boolean(item.takeaway),
  })))
  const serviceBase = active
    .filter((i) => !i.takeaway)
    .reduce((sum, i) => sum + Number(i.total || 0), 0)
  const staff = Array.isArray(order.receipt_staff) && order.receipt_staff.length
    ? order.receipt_staff
    : (order.waiter_name ? [{ label: 'Официант', name: order.waiter_name }] : [])
  return {
    companyName: company?.name || '—',
    orderNumber: String(order.order_number ?? order.client_number ?? ''),
    orderType: order.order_type,
    tableNumber: order.table_number != null ? String(order.table_number) : null,
    staff,
    subtotal: Number(order.subtotal || 0),
    discount: Number(order.discount_amount || 0),
    tax: Number(order.tax_amount || 0),
    total: Number(order.total_amount || 0),
    serviceFee: Number(order.service_fee || 0),
    serviceFeeRate: order.service_fee_rate != null
      ? Number(order.service_fee_rate)
      : ratePercentByFee(order.service_fee, serviceBase),
    paymentMethod: payment?.method || null,
    cashReceived: payment?.cash_received != null ? Number(payment.cash_received) : null,
    changeGiven: payment?.change_given != null ? Number(payment.change_given) : null,
    customerPhone: order.customer_phone || null,
    customerAddress: order.customer_address || null,
    items: lines,
    cancelled: cancelled.map((item) => ({
      name: item.name,
      reason: item.cancel_reason || null,
    })),
  }
}

function deliveryContacts(data) {
  if (data.orderType !== 'delivery') return []
  return [data.customerAddress, data.customerPhone].filter((v) => v && String(v).trim())
}

// ── Чек гостю ───────────────────────────────────────────────────────────────

function buildReceipt({
  company = {}, order, payment = null, width = 80, timeZone = 'Asia/Tashkent',
  template = null, printedAt = null,
} = {}) {
  const cols = Number(width) >= 80 ? 48 : 32
  const data = receiptData(order, company, payment)
  const out = []
  out.push(...INIT, ...FONT_A, ...CODEPAGE_CP866)
  // Чек гостю без шаблона сервер печатает с "large" (ESC 3 40), кухня — с
  // "medium" (ESC 2): разные умолчания у двух форматов (formatter.py).
  out.push(...(LINE_SPACING[String(template?.lineSpacing || 'large').toLowerCase()] || LINE_SPACING.large))

  const runs = []
  const push = (section, chunk) => {
    if (!chunk || !chunk.length) return
    if (runs.length && runs[runs.length - 1].section === section) runs[runs.length - 1].chunks.push(chunk)
    else runs.push({ section, chunks: [chunk] })
  }

  const styledLine = (key, text) => {
    const style = blockStyle(template, key)
    const sizeCode = key === 'restaurantName'
      ? RESTAURANT_NAME_SIZE_CODES[style.size || 'large']
      : null
    const { prefix, suffix, div } = styleBytes(style, sizeCode)
    const body = []
    const textWidth = Math.floor(cols / div)
    for (const paragraph of String(text).split('\n')) wprint(body, paragraph, textWidth)
    return [...prefix, ...body, ...suffix]
  }

  const infoRow = (key, label, value) => {
    const style = blockStyle(template, key)
    const { prefix, suffix, div } = styleBytes(style)
    const rowWidth = Math.floor(cols / div)
    const body = []
    if (String(label).length + 1 + String(value).length <= rowWidth) {
      body.push(...twoCol(label, value, rowWidth))
    } else {
      body.push(...line(label))
      for (const row of wrap(value, rowWidth) || ['']) body.push(...twoCol('', row, rowWidth))
    }
    return [...prefix, ...body, ...suffix]
  }

  const renderSummary = () => {
    const buf = []
    if (data.subtotal > 0) buf.push(...twoCol('Сумма блюд', money(data.subtotal), cols))
    if (enabled(template, 'discount') && data.discount > 0) {
      buf.push(...twoCol('Скидка', `-${money(data.discount)}`, cols))
    }
    if (enabled(template, 'serviceFee') && data.serviceFee > 0) {
      const rate = formatRatePercent(data.serviceFeeRate)
      buf.push(...twoCol(rate ? `Обслуга ${rate}%` : 'Обслуга', money(data.serviceFee), cols))
    }
    if (enabled(template, 'vat') && data.tax > 0) {
      buf.push(...twoCol('Налог', money(data.tax), cols))
    }
    return buf
  }

  if (!enabled(template, 'restaurantName')) {
    for (const contact of deliveryContacts(data)) {
      push('header', [...ALIGN_CENTER, ...wprint([], contact, cols), ...ALIGN_LEFT])
    }
  }

  let summaryDone = false
  for (const block of customerBlocks(template)) {
    if (block === 'discount' || block === 'serviceFee' || block === 'vat') continue
    if (block === 'total') {
      push('financial', renderSummary())
      summaryDone = true
      if (enabled(template, 'total')) {
        const { prefix, suffix, div } = styleBytes(blockStyle(template, 'total'))
        push('financial', [
          ...prefix,
          ...twoCol('Итого:', money(data.total), Math.floor(cols / div)),
          ...suffix,
        ])
      }
      continue
    }
    if (!enabled(template, block)) continue

    if (block === 'logo') {
      // Офлайн-снимок не содержит байтов логотипа. Сервер тоже ничего не
      // печатает, если лого не загружено, — но если оно есть, онлайн-чек
      // покажет картинку, а офлайн — нет.
      continue
    }
    if (block === 'restaurantName') {
      const name = template?.restaurantName || data.companyName
      push('header', styledLine('restaurantName', name))
      for (const contact of deliveryContacts(data)) {
        push('header', [...ALIGN_CENTER, ...wprint([], contact, cols), ...ALIGN_LEFT])
      }
    } else if (block === 'orderNumber') {
      if (!numberAtTop(template)) {
        push('info', infoRow('orderNumber', 'Номер заказа:', data.orderNumber))
      }
      push('info', infoRow('orderNumber', 'Тип заказа:', formatOrderType(data.orderType)))
    } else if (block === 'table' && data.tableNumber) {
      push('info', infoRow('table', 'Номер стола:', data.tableNumber))
    } else if (block === 'waiter' && data.staff.length) {
      for (const person of data.staff) {
        push('info', infoRow('waiter', `${person.label}:`, person.name))
      }
    } else if (block === 'dateTime') {
      push('info', infoRow('dateTime', 'Дата:', formatDate(printedAt || Date.now(), timeZone)))
    } else if (block === 'items') {
      const style = blockStyle(template, 'items')
      const { prefix, suffix, div } = styleBytes(style)
      const blockCols = Math.floor(cols / div)
      const blockBold = style.weight === 'bold'
      const chunk = [...prefix, ...BOLD_ON, ...threeCol('Блюдо', 'Кол-во', 'Сумма', blockCols)]
      if (!blockBold) chunk.push(...BOLD_OFF)
      chunk.push(...divider(template, blockCols))
      for (const item of data.items) {
        chunk.push(...itemRow(item.name, quantity(item.qty), money(item.total), blockCols))
        for (const mod of item.modifiers) chunk.push(...(wprint([], `  + ${mod}`, blockCols)))
        if (item.note) chunk.push(...wprint([], `  * ${item.note}`, blockCols))
      }
      for (const item of data.cancelled) {
        const reason = item.reason ? ` — ${item.reason}` : ''
        chunk.push(...wprint([], `  x ${item.name}${reason}`, blockCols))
      }
      if (blockBold) chunk.push(...BOLD_OFF)
      chunk.push(...suffix)
      push('items', chunk)
    } else if (block === 'paymentMethod' && data.paymentMethod) {
      const label = PAYMENT_LABELS[data.paymentMethod] || data.paymentMethod
      const { prefix, suffix, div } = styleBytes(blockStyle(template, 'paymentMethod'))
      const payCols = Math.floor(cols / div)
      const chunk = [...prefix, ...twoCol(`${label}:`, money(data.total), payCols)]
      if (data.cashReceived != null) {
        chunk.push(...twoCol('Получено:', money(data.cashReceived), payCols))
        chunk.push(...twoCol('Сдача:', money(data.changeGiven || 0), payCols))
      }
      chunk.push(...suffix)
      push('financial', chunk)
    } else if (block === 'thankYouText') {
      push('footer', styledLine('thankYouText', template?.thankYouText || 'XARIDINGIZ\nUCHUN RAXMAT!'))
    } else if (block === 'bottomOrderNumber') {
      const style = blockStyle(template, 'bottomOrderNumber')
      const sizeCode = BOTTOM_NUMBER_SIZE_CODES[style.size || 'large']
      const { prefix, suffix, div } = styleBytes(style, sizeCode)
      const chunk = [...line(''), ...prefix, ...wprint([], data.orderNumber, Math.floor(cols / div)), ...suffix, ...line('')]
      push(numberAtTop(template) ? 'header' : 'footer', chunk)
    } else if (block === 'address') {
      if (template?.address) {
        push('footer', [...ALIGN_CENTER, ...wprint([], String(template.address), cols), ...ALIGN_LEFT])
      }
    } else if (block === 'phone') {
      if (template?.phone) {
        push('footer', [...ALIGN_CENTER, ...wprint([], String(template.phone), cols), ...ALIGN_LEFT])
      }
    }
  }

  if (!summaryDone) push('financial', renderSummary())

  let lastSection = null
  for (const run of runs) {
    if (lastSection != null && lastSection !== 'header') out.push(...divider(template, cols))
    for (const chunk of run.chunks) out.push(...chunk)
    lastSection = run.section
  }

  out.push(LF, LF, LF, ...CUT)
  return Buffer.from(out)
}

// ── Кухонный тикет ──────────────────────────────────────────────────────────

function buildKitchenTicket({
  order, items = null, width = 80, timeZone = 'Asia/Tashkent',
  template = null, printedAt = null, kind = 'new',
} = {}) {
  const cols = Number(width) >= 80 ? 48 : 32
  const source = groupItems((items || order.items || [])
    .filter((i) => i.status !== 'cancelled' && i.status !== 'served')
    .map((item) => ({
      product_id: item.product_id != null ? String(item.product_id) : null,
      name: item.name,
      qty: Number(item.quantity || 0),
      price: item.price != null ? Number(item.price) : null,
      total: item.total != null ? Number(item.total) : null,
      modifiers: (item.modifiers || []).map((m) => (typeof m === 'string' ? m : m?.name || '')).filter(Boolean),
      note: item.note || null,
      course: item.course || 1,
      takeaway: Boolean(item.takeaway),
    })))

  const out = []
  out.push(...INIT, ...FONT_A, ...CODEPAGE_CP866)
  out.push(...(LINE_SPACING[String(template?.lineSpacing || 'medium').toLowerCase()] || LINE_SPACING.medium))

  const cancelled = order.status === 'cancelled'
  const isItemCancel = kind === 'item_cancel'
  const showCancel = cancelled && enabled(template, 'cancelOrderNumber', true)
  const showNormalNumber = !showCancel && enabled(template, 'orderNumber', true)
  const itemCommentOn = enabled(template, 'comment', enabled(template, 'itemComments', true))
  const orderCommentOn = enabled(template, 'comment', enabled(template, 'orderNote', true))
  const showMoney = enabled(template, 'showOrderSum', false)
  const staffLabel = Array.isArray(order.receipt_staff) && order.receipt_staff[0]?.label
    ? order.receipt_staff[0].label
    : 'Официант'
  const printed = printedAt || order.created_offline_at || order.created_at || Date.now()

  const renderNumber = () => {
    const style = kitchenStyle(template, showCancel ? 'cancelOrderNumber' : 'orderNumber')
    const { prefix, suffix, div } = styleBytes(style)
    out.push(...prefix, ...wprint([], `#${order.order_number ?? order.client_number ?? ''}`, Math.floor(cols / div)), ...suffix)
    if (showCancel) out.push(...ALIGN_CENTER, ...BOLD_ON, ...line('ОТМЕНА'), ...BOLD_OFF, ...ALIGN_LEFT)
  }

  const renderRow = (block, label, value) => {
    if (!value) return false
    const { prefix, suffix, div } = styleBytes(kitchenStyle(template, block))
    out.push(...prefix, ...wprint([], `${label} ${value}`, Math.floor(cols / div)), ...suffix)
    return true
  }

  let anyInfo = false
  for (const block of kitchenBlocks(template)) {
    if (block === 'orderNumber' || block === 'cancelOrderNumber') {
      if (block === 'cancelOrderNumber' && showCancel) { renderNumber(); anyInfo = true }
      else if (block === 'orderNumber' && showNormalNumber) { renderNumber(); anyInfo = true }
    } else if (block === 'orderType' && (isItemCancel || enabled(template, 'orderType', true))) {
      const label = isItemCancel ? 'ОТМЕНА БЛЮДА' : formatKitchenOrderType(order.order_type)
      if (label) {
        const style = { ...kitchenStyle(template, 'orderType'), align: kitchenStyle(template, 'orderNumber').align }
        if (isItemCancel) style.weight = 'bold'
        const { prefix, suffix, div } = styleBytes(style)
        out.push(...prefix, ...wprint([], label, Math.floor(cols / div)), ...suffix)
        anyInfo = true
      }
    } else if (block === 'table' && enabled(template, 'table', true)) {
      anyInfo = renderRow('table', 'Стол:', order.table_number) || anyInfo
    } else if (block === 'waiter' && enabled(template, 'waiter', true)) {
      anyInfo = renderRow('waiter', `${staffLabel}:`, order.waiter_name) || anyInfo
    } else if (block === 'date' && enabled(template, 'date', enabled(template, 'createdAt', true))) {
      anyInfo = renderRow('date', 'Время:', formatDate(printed, timeZone)) || anyInfo
    }
  }

  if (anyInfo) out.push(...divider(template, cols))

  const qtyW = showMoney ? ITEM_QTY_W : KITCHEN_QTY_W_PLAIN
  const totalW = ITEM_TOTAL_W
  const nameW = cols - qtyW - (showMoney ? totalW : 0)
  const head = styleBytes({ size: 'standard', weight: 'bold', align: 'left' })
  out.push(...head.prefix)
  out.push(...line(
    showMoney
      ? 'Блюдо'.padEnd(nameW) + centerText('Кол-во', qtyW) + 'Сумма'.padStart(totalW)
      : 'Блюдо'.padEnd(nameW) + centerText('Кол-во', qtyW),
  ))
  out.push(...head.suffix)

  const courses = new Map()
  for (const item of source) {
    const course = item.course || 1
    if (!courses.has(course)) courses.set(course, [])
    courses.get(course).push(item)
  }
  for (const course of [...courses.keys()].sort((a, b) => a - b)) {
    if (courses.size > 1) {
      out.push(...boldLine(`--- Подача ${course} ---`))
    }
    for (const item of courses.get(course)) {
      const total = showMoney && item.total != null ? money(item.total) : null
      const style = kitchenStyle(template, 'dishItems')
      const { prefix, suffix } = styleBytes(style)
      out.push(...styledRow(prefix, kitchenItemRow(item.name, quantity(item.qty), total, qtyW, totalW, cols), suffix))
      for (const mod of item.modifiers) out.push(...wprint([], `  + ${mod}`, cols))
      if (itemCommentOn && item.note) out.push(...wprint([], `  ! ${item.note}`, cols))
    }
  }

  if (orderCommentOn && order.note) {
    out.push(...divider(template, cols))
    const { prefix, suffix, div } = styleBytes(kitchenStyle(template, 'comment'))
    out.push(...prefix, ...wprint([], `КОММЕНТАРИЙ: ${order.note}`, Math.floor(cols / div)), ...suffix)
  }

  out.push(...divider(template, cols), ...KITCHEN_CUT)
  return Buffer.from(out)
}

module.exports = {
  buildReceipt,
  buildKitchenTicket,
  encode,
  money,
  quantity,
  ORDER_TYPE_LABELS,
  PAYMENT_LABELS,
  // Общие помощники шаблона — их переиспользует растровый рендерер
  // (raster.js), чтобы порядок блоков/тумблеры/стили не разъезжались с
  // текстовым чеком.
  formatOrderType,
  formatKitchenOrderType,
  formatRatePercent,
  formatDate,
  groupItems,
  receiptData,
  deliveryContacts,
  enabled,
  blockStyle,
  kitchenStyle,
  kitchenBlocks,
  customerBlocks,
  numberAtTop,
  separatorStyle,
}
