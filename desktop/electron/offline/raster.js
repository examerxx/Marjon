// Растровый чек для офлайн-печати — порт
// backend/app/modules/printers/receipt_raster.py.
//
// Онлайн-касса печатает чек ГОТОВОЙ КАРТИНКОЙ (GS v 0), которую сервер
// рисует из того же ReceiptData/шаблона: на физическом XPrinter текстовый
// ESC/POS давал узкие вытянутые буквы, поэтому сервер перешёл на растр.
// Офлайн-ядро не может спросить сервер, поэтому раскладку повторяет этот
// файл: те же блоки/строки/размеры, а пиксели собирает скрытое окно Chromium
// (canvas), 1-битный растр упаковывается в тот же GS v 0.
//
// Шрифт: Arial (как _FONT_CANDIDATES на Windows-хосте сервера). В Docker
// сервер берёт DejaVuSans; метрики чуть другие, но раскладка и содержание
// совпадают — это тот же дизайн чека, а не текстовый режим.

let BrowserWindow = null
try {
  // eslint-disable-next-line global-require
  ;({ BrowserWindow } = require('electron'))
} catch {
  BrowserWindow = null
}

const escpos = require('./escpos')

const WIDTH_BY_MM = { 80: 576, 58: 384 }
const DEFAULT_WIDTH = 576
const MARGIN = 16
const SIZE_PT = { standard: 24, large: 32, xlarge: 38 }
const RESTAURANT_SIZES = { standard: 32, large: 48, xlarge: 80 }
const BOTTOM_NUMBER_SIZES = { standard: 48, large: 96, xlarge: 180, xxlarge: 220 }
const FONT_FAMILY = 'Arial'

const ESC = 0x1b
const GS = 0x1d
const INIT = [ESC, 0x40]
const KITCHEN_CUT = [GS, 0x56, 0x41, 0x49]
const CUSTOMER_CUT = [0x0a, GS, 0x56, 0x41, 0x03]

function spacingMultiplier(template, fallback) {
  const value = String(template?.lineSpacing || fallback).toLowerCase()
  return { small: 0.7, medium: 1.0, large: 1.3 }[value] ?? { small: 0.7, medium: 1.0, large: 1.3 }[fallback]
}

// Размер/вес/выравнивание блока — точно как _font_for() в receipt_raster.py:
// у ресторанного имени и нижнего номера свои шкалы размеров.
function styleFor(template, key, sizes) {
  const style = escpos.blockStyle(template, key)
  const scale = sizes || SIZE_PT
  const size = scale[style.size || 'standard'] ?? scale.standard
  return {
    size,
    weight: style.weight === 'bold' ? 'bold' : 'regular',
    align: style.align || 'left',
  }
}

function kitchenStyleFor(template, key) {
  const style = escpos.kitchenStyle(template, key)
  return {
    size: SIZE_PT[style.size || 'standard'] ?? SIZE_PT.standard,
    weight: style.weight === 'bold' ? 'bold' : 'regular',
    align: style.align || 'left',
  }
}

function separatorOf(template) {
  const value = template?.separator
  const source = value && typeof value === 'object' ? value : {}
  return {
    pattern: ['dashed', 'solid', 'stars'].includes(source.pattern) ? source.pattern : 'dashed',
    weight: ['thin', 'medium', 'bold'].includes(source.weight) ? source.weight : 'thin',
  }
}

// ── Сцена чека гостю ────────────────────────────────────────────────────────

function receiptScene({
  company = {}, order, payment = null, width = 80, timeZone = 'Asia/Tashkent',
  template = null, printedAt = null,
} = {}) {
  const tpl = template || {}
  const data = escpos.receiptData(order, company, payment)
  const widthPx = WIDTH_BY_MM[width] || DEFAULT_WIDTH
  const mult = spacingMultiplier(tpl, 'large')
  const gap = (base) => Math.max(2, Math.trunc(base * mult))

  const ops = []
  let lastSection = null
  const boundary = (section) => {
    if (lastSection !== null && lastSection !== section && lastSection !== 'header') {
      ops.push({ op: 'divider', gapBefore: 0, gapAfter: gap(10) })
    }
    lastSection = section
  }

  const line = (text, style, lineGap, wrapWidth) => {
    ops.push({ op: 'line', text: String(text ?? ''), size: style.size, weight: style.weight, align: style.align, gap: lineGap, wrapWidth })
  }
  const row = (label, value, style, lineGap) => {
    ops.push({ op: 'row', label: String(label ?? ''), value: String(value ?? ''), size: style.size, weight: style.weight, gap: lineGap })
  }

  const renderSummary = () => {
    const style = styleFor(tpl, 'items')
    if (data.subtotal > 0) {
      boundary('financial')
      row('Сумма блюд', escpos.money(data.subtotal), style, gap(8))
    }
    if (escpos.enabled(tpl, 'discount') && data.discount > 0) {
      boundary('financial')
      row('Скидка', `-${escpos.money(data.discount)}`, style, gap(8))
    }
    if (escpos.enabled(tpl, 'serviceFee') && data.serviceFee > 0) {
      boundary('financial')
      const rate = escpos.formatRatePercent(data.serviceFeeRate)
      row(rate ? `Обслуга ${rate}%` : 'Обслуга', escpos.money(data.serviceFee), style, gap(8))
    }
    if (escpos.enabled(tpl, 'vat') && data.tax > 0) {
      boundary('financial')
      row('Налог', escpos.money(data.tax), style, gap(8))
    }
  }

  const contacts = escpos.deliveryContacts(data)
  const contactStyle = { size: SIZE_PT.standard, weight: 'regular', align: 'center' }
  if (!escpos.enabled(tpl, 'restaurantName')) {
    for (const contact of contacts) {
      boundary('header')
      line(contact, contactStyle, gap(8), widthPx - 2 * MARGIN)
    }
  }

  let summaryDone = false
  const numberAtTop = escpos.numberAtTop(tpl)
  for (const block of escpos.customerBlocks(tpl)) {
    if (block === 'discount' || block === 'serviceFee' || block === 'vat') continue
    if (block === 'total') {
      renderSummary()
      summaryDone = true
      if (escpos.enabled(tpl, 'total')) {
        boundary('financial')
        row('Итого:', escpos.money(data.total), styleFor(tpl, 'total'), gap(16))
      }
      continue
    }
    if (!escpos.enabled(tpl, block)) continue

    if (block === 'logo') {
      // В офлайн-снимке нет байтов логотипа (bootstrap их не отдаёт), а сервер
      // без загруженного лого тоже ничего не печатает.
      continue
    }
    if (block === 'restaurantName') {
      boundary('header')
      const style = styleFor(tpl, 'restaurantName', RESTAURANT_SIZES)
      line(tpl.restaurantName || data.companyName, style, gap(14), widthPx - 2 * MARGIN)
      for (const contact of contacts) {
        line(contact, contactStyle, gap(8), widthPx - 2 * MARGIN)
      }
    } else if (block === 'orderNumber') {
      boundary('info')
      const style = styleFor(tpl, 'orderNumber')
      if (!numberAtTop) row('Номер заказа:', data.orderNumber, style, gap(8))
      row('Тип заказа:', escpos.formatOrderType(data.orderType), style, gap(8))
    } else if (block === 'table' && data.tableNumber) {
      boundary('info')
      row('Номер стола:', data.tableNumber, styleFor(tpl, 'table'), gap(8))
    } else if (block === 'waiter' && data.staff.length) {
      boundary('info')
      const style = styleFor(tpl, 'waiter')
      for (const person of data.staff) row(`${person.label}:`, person.name, style, gap(8))
    } else if (block === 'dateTime') {
      boundary('info')
      row('Дата:', escpos.formatDate(printedAt || Date.now(), timeZone), styleFor(tpl, 'dateTime'), gap(8))
    } else if (block === 'items') {
      boundary('items')
      const style = styleFor(tpl, 'items')
      ops.push({
        op: 'items',
        size: style.size,
        weight: style.weight,
        gapRow: gap(6),
        gapMod: gap(4),
        gapDivider: gap(8),
        rows: data.items.map((item) => ({
          name: item.name,
          qty: escpos.quantity(item.qty),
          total: escpos.money(item.total),
          mods: item.modifiers,
          note: item.note,
        })),
        cancelled: data.cancelled,
      })
    } else if (block === 'paymentMethod' && data.paymentMethod) {
      boundary('financial')
      const style = styleFor(tpl, 'paymentMethod')
      const label = escpos.PAYMENT_LABELS[data.paymentMethod] || data.paymentMethod
      row(`${label}:`, escpos.money(data.total), style, gap(8))
      if (data.cashReceived != null) {
        row('Получено:', escpos.money(data.cashReceived), style, gap(8))
        row('Сдача:', escpos.money(data.changeGiven || 0), style, gap(8))
      }
    } else if (block === 'thankYouText') {
      boundary('footer')
      const style = styleFor(tpl, 'thankYouText')
      const text = tpl.thankYouText || 'XARIDINGIZ\nUCHUN RAXMAT!'
      for (const para of String(text).split('\n')) line(para, style, gap(4), widthPx - 2 * MARGIN)
    } else if (block === 'bottomOrderNumber') {
      boundary(numberAtTop ? 'header' : 'footer')
      const style = styleFor(tpl, 'bottomOrderNumber', BOTTOM_NUMBER_SIZES)
      line('НОМЕР ЗАКАЗА', { size: 22, weight: 'regular', align: style.align }, gap(4), widthPx - 2 * MARGIN)
      line(data.orderNumber, style, gap(10), widthPx - 2 * MARGIN)
    } else if (block === 'address') {
      if (tpl.address) {
        boundary('footer')
        line(String(tpl.address), styleFor(tpl, 'address'), gap(8), widthPx - 2 * MARGIN)
      }
    } else if (block === 'phone') {
      if (tpl.phone) {
        boundary('footer')
        line(String(tpl.phone), styleFor(tpl, 'phone'), gap(8), widthPx - 2 * MARGIN)
      }
    }
  }

  if (!summaryDone) renderSummary()

  return {
    width: widthPx,
    margin: MARGIN,
    fontFamily: FONT_FAMILY,
    separator: separatorOf(tpl),
    trim: false,
    ops,
  }
}

// ── Сцена кухонного тикета ──────────────────────────────────────────────────

function kitchenScene({
  order, items = null, width = 80, timeZone = 'Asia/Tashkent',
  template = null, printedAt = null, kind = 'new',
} = {}) {
  const tpl = template || {}
  const widthPx = WIDTH_BY_MM[width] || DEFAULT_WIDTH
  const mult = spacingMultiplier(tpl, 'medium')
  const gap = (base) => Math.max(2, Math.trunc(base * mult))

  const source = escpos.groupItems((items || order.items || [])
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

  const cancelled = order.status === 'cancelled'
  const isItemCancel = kind === 'item_cancel'
  const showCancel = cancelled && escpos.enabled(tpl, 'cancelOrderNumber', true)
  const showNormalNumber = !showCancel && escpos.enabled(tpl, 'orderNumber', true)
  const itemCommentOn = escpos.enabled(tpl, 'comment', escpos.enabled(tpl, 'itemComments', true))
  const orderCommentOn = escpos.enabled(tpl, 'comment', escpos.enabled(tpl, 'orderNote', true))
  const showMoney = escpos.enabled(tpl, 'showOrderSum', false)
  const staffLabel = Array.isArray(order.receipt_staff) && order.receipt_staff[0]?.label
    ? order.receipt_staff[0].label
    : 'Официант'
  const printed = printedAt || order.created_offline_at || order.created_at || Date.now()
  const orderNumber = String(order.order_number ?? order.client_number ?? '')

  const ops = []
  let anyInfo = false
  const line = (text, style, lineGap, wrapWidth) => {
    ops.push({ op: 'line', text: String(text ?? ''), size: style.size, weight: style.weight, align: style.align, gap: lineGap, wrapWidth })
  }
  const infoRow = (label, value, style, lineGap) => {
    ops.push({ op: 'row', label: String(label ?? ''), value: String(value ?? ''), size: style.size, weight: style.weight, gap: lineGap })
  }

  for (const block of escpos.kitchenBlocks(tpl)) {
    if (block === 'orderNumber' || block === 'cancelOrderNumber') {
      if (block === 'cancelOrderNumber' && showCancel) {
        const style = kitchenStyleFor(tpl, 'cancelOrderNumber')
        line(`#${orderNumber}`, style, gap(10), widthPx - 2 * MARGIN)
        line('ОТМЕНА', { size: style.size, weight: 'bold', align: 'center' }, gap(10), widthPx - 2 * MARGIN)
        anyInfo = true
      } else if (block === 'orderNumber' && showNormalNumber) {
        const style = kitchenStyleFor(tpl, 'orderNumber')
        line(`#${orderNumber}`, style, gap(10), widthPx - 2 * MARGIN)
        anyInfo = true
      }
    } else if (block === 'orderType' && (isItemCancel || escpos.enabled(tpl, 'orderType', true))) {
      const label = isItemCancel ? 'ОТМЕНА БЛЮДА' : escpos.formatKitchenOrderType(order.order_type)
      if (label) {
        const style = {
          ...kitchenStyleFor(tpl, 'orderType'),
          align: kitchenStyleFor(tpl, 'orderNumber').align,
        }
        if (isItemCancel) style.weight = 'bold'
        line(label, style, gap(6), widthPx - 2 * MARGIN)
        anyInfo = true
      }
    } else if (block === 'table' && escpos.enabled(tpl, 'table', true)) {
      if (order.table_number) {
        infoRow('Стол:', order.table_number, kitchenStyleFor(tpl, 'table'), gap(6))
        anyInfo = true
      }
    } else if (block === 'waiter' && escpos.enabled(tpl, 'waiter', true)) {
      if (order.waiter_name) {
        infoRow(`${staffLabel}:`, order.waiter_name, kitchenStyleFor(tpl, 'waiter'), gap(6))
        anyInfo = true
      }
    } else if (block === 'date' && escpos.enabled(tpl, 'date', escpos.enabled(tpl, 'createdAt', true))) {
      infoRow('Время:', escpos.formatDate(printed, timeZone), kitchenStyleFor(tpl, 'date'), gap(6))
      anyInfo = true
    }
  }

  if (anyInfo) ops.push({ op: 'divider', gapBefore: 0, gapAfter: gap(10) })

  const dishStyle = kitchenStyleFor(tpl, 'dishItems')
  ops.push({
    op: 'kitchenItems',
    size: dishStyle.size,
    weight: dishStyle.weight,
    gapRow: gap(4),
    gapHeader: gap(6),
    gapStack: gap(2),
    gapCourse: gap(6),
    gapMod: gap(2),
    gapDivider: gap(8),
    showMoney,
    rows: source.map((item) => ({
      name: item.name,
      qty: escpos.quantity(item.qty),
      total: item.total != null ? escpos.money(item.total) : '',
      course: item.course || 1,
      mods: item.modifiers,
      note: itemCommentOn ? item.note : null,
    })),
  })

  if (orderCommentOn && order.note) {
    const style = kitchenStyleFor(tpl, 'comment')
    ops.push({ op: 'divider', gapBefore: 0, gapAfter: gap(8) })
    line('Комментарий:', style, gap(4), widthPx - 2 * MARGIN)
    line(`- ${order.note}`, style, gap(4), widthPx - 2 * MARGIN)
  }

  ops.push({ op: 'divider', gapBefore: 0, gapAfter: 0 })

  return {
    width: widthPx,
    margin: MARGIN,
    fontFamily: FONT_FAMILY,
    separator: separatorOf(tpl),
    trim: true,
    ops,
  }
}

// ── Страница отрисовки (canvas в скрытом окне) ───────────────────────────────
// Правила совпадают с _RasterCanvas/*_row в receipt_raster.py: высота строки
// font.size + 6, label слева / value по правому краю, звездочный разделитель
// считается по ширине "* ", штриховой — шаг 18px/длина 10px, 1-битный растр
// получается дизерингом Флойда–Стейнберга (PIL convert("1") по умолчанию).

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="scene"></canvas>
<script>
(function () {
  var W = 576, M = 16, FAMILY = 'Arial', SEP = { pattern: 'dashed', weight: 'thin' }

  function fontSpec(size, weight) { return (weight === 'bold' ? 'bold ' : '') + size + 'px ' + FAMILY }
  function text(ctx, value, x, y) {
    ctx.fillStyle = '#000'
    ctx.fillText(value, x, y)
  }
  function measure(ctx, text, size, weight) { ctx.font = fontSpec(size, weight); return ctx.measureText(String(text == null ? '' : text)).width }
  function ascent(ctx, size, weight) {
    ctx.font = fontSpec(size, weight)
    var m = ctx.measureText('H')
    return m.fontBoundingBoxAscent || size * 0.8
  }
  function wrap(ctx, text, size, weight, maxW) {
    text = String(text == null ? '' : text).trim()
    if (!text) return []
    var words = text.split(/\\s+/)
    var lines = []
    var cur = ''
    for (var i = 0; i < words.length; i++) {
      var word = words[i]
      var guard = 0
      while (measure(ctx, word, size, weight) > maxW && word.length > 1 && guard++ < 1000) {
        var lo = 1, hi = word.length
        while (lo < hi) {
          var mid = (lo + hi + 1) >> 1
          if (measure(ctx, word.slice(0, mid), size, weight) <= maxW) lo = mid
          else hi = mid - 1
        }
        if (cur) { lines.push(cur); cur = '' }
        lines.push(word.slice(0, lo))
        word = word.slice(lo)
      }
      var candidate = (cur ? cur + ' ' + word : word).trim()
      if (measure(ctx, candidate, size, weight) <= maxW) cur = candidate
      else { if (cur) lines.push(cur); cur = word }
    }
    if (cur) lines.push(cur)
    return lines
  }

  function drawTextLine(ctx, op, y) {
    var size = op.size, weight = op.weight || 'regular'
    var maxW = op.wrapWidth || (W - 2 * M)
    var top = ascent(ctx, size, weight)
    var chunks = wrap(ctx, op.text, size, weight, maxW)
    var yy = y
    for (var i = 0; i < chunks.length; i++) {
      var tw = measure(ctx, chunks[i], size, weight)
      var x = M
      if (op.align === 'center') x = (W - tw) / 2
      else if (op.align === 'right') x = W - M - tw
      text(ctx, chunks[i], x, yy + top)
      yy += size + 6
    }
    if (!chunks.length) return y + size + (op.gap || 0)
    return yy - 6 + (op.gap || 0)
  }

  function drawRow(ctx, op, y) {
    var size = op.size, weight = op.weight || 'regular'
    var label = String(op.label || '')
    var value = String(op.value || '')
    var top = ascent(ctx, size, weight)
    if (!value) {
      text(ctx, label, M, y + top)
      return y + size + (op.gap || 0)
    }
    var avail = W - 2 * M
    var lw = measure(ctx, label, size, weight)
    var vw = measure(ctx, value, size, weight)
    if (lw + 12 + vw <= avail) {
      text(ctx, label, M, y + top)
      text(ctx, value, W - M - vw, y + top)
      return y + size + (op.gap || 0)
    }
    text(ctx, label, M, y + top)
    var yy = y + size + 6
    text(ctx, value, W - M - vw, yy + top)
    return yy + size + (op.gap || 0)
  }

  function drawDivider(ctx, op, y) {
    var pattern = SEP.pattern, weight = SEP.weight
    var thickness = { thin: 1, medium: 2, bold: 3 }[weight] || 1
    var yy = y + (op.gapBefore || 0)
    if (pattern === 'stars') {
      var size = 24, w = weight === 'thin' ? 'regular' : 'bold'
      ctx.font = fontSpec(size, w)
      var unit = measure(ctx, '* ', size, w)
      var count = Math.max(1, Math.floor((W - 2 * M) / Math.max(1, unit)))
      var starsText = new Array(count + 1).join('* ')
      var top = ascent(ctx, size, w)
      text(ctx, starsText, M, yy + top)
      if (weight === 'bold') { ctx.lineWidth = 1; ctx.strokeText(text, M, yy + top) }
      return yy + size + (op.gapAfter || 0)
    }
    if (pattern === 'solid') {
      ctx.fillRect(M, yy, W - 2 * M, thickness)
      return yy + thickness + (op.gapAfter || 0)
    }
    for (var x = M; x < W - M; x += 18) {
      var wpx = Math.min(x + 10, W - M) - x
      if (wpx > 0) ctx.fillRect(x, yy, wpx, thickness)
    }
    return yy + thickness + (op.gapAfter || 0)
  }

  function drawItemRow(ctx, name, qty, total, size, weight, qtyW, totalW, y, gap) {
    var nameW = W - 2 * M - qtyW - totalW - 16
    var top = ascent(ctx, size, weight)
    var lines = wrap(ctx, name, size, weight, nameW)
    if (!lines.length) lines.push('')
    text(ctx, lines[0], M, y + top)
    var qtyX = W - M - totalW - qtyW
    var qw = measure(ctx, qty, size, weight)
    if (qty) text(ctx, qty, qtyX + (qtyW - qw) / 2, y + top)
    if (total) {
      var tw = measure(ctx, total, size, weight)
      text(ctx, total, W - M - tw, y + top)
    }
    var yy = y + size + 6
    for (var i = 1; i < lines.length; i++) {
      text(ctx, lines[i], M, yy + top)
      yy += size + 6
    }
    return yy - 6 + (gap || 0)
  }

  function drawItems(ctx, op, y) {
    var size = op.size, weight = op.weight || 'regular'
    var qtyW = measure(ctx, 'Кол-во', size, 'bold') + 14
    var totalW = 0
    for (var i = 0; i < op.rows.length; i++) totalW = Math.max(totalW, measure(ctx, op.rows[i].total, size, weight))
    totalW = Math.max(totalW, measure(ctx, 'Сумма', size, 'bold')) + 14
    y = drawItemRow(ctx, 'Блюдо', 'Кол-во', 'Сумма', size, 'bold', qtyW, totalW, y, op.gapRow)
    y = drawDivider(ctx, { gapBefore: 0, gapAfter: op.gapDivider }, y)
    for (var r = 0; r < op.rows.length; r++) {
      var row = op.rows[r]
      y = drawItemRow(ctx, row.name, row.qty, row.total, size, weight, qtyW, totalW, y, op.gapRow)
      for (var m = 0; m < row.mods.length; m++) {
        y = drawTextLine(ctx, { text: '  + ' + row.mods[m], size: size, weight: weight, align: 'left', gap: op.gapMod }, y)
      }
      if (row.note) y = drawTextLine(ctx, { text: '  * ' + row.note, size: size, weight: weight, align: 'left', gap: op.gapMod }, y)
    }
    for (var c = 0; c < op.cancelled.length; c++) {
      var item = op.cancelled[c]
      var text = '  x ' + item.name + (item.reason ? ' — ' + item.reason : '')
      y = drawTextLine(ctx, { text: text, size: size, weight: weight, align: 'left', gap: op.gapMod }, y)
    }
    return y
  }

  function drawKitchenItems(ctx, op, y) {
    var size = op.size, weight = op.weight || 'regular'
    var headerSize = 24, headerWeight = 'bold'
    var qtyW = measure(ctx, 'Кол-во', headerSize, headerWeight)
    for (var i = 0; i < op.rows.length; i++) qtyW = Math.max(qtyW, measure(ctx, op.rows[i].qty, size, weight))
    qtyW += 14
    var totalW = 0
    if (op.showMoney) {
      for (var j = 0; j < op.rows.length; j++) totalW = Math.max(totalW, measure(ctx, op.rows[j].total, size, weight))
      totalW = Math.max(totalW, measure(ctx, 'Сумма', headerSize, headerWeight)) + 14
    }
    var nameW = W - 2 * M - qtyW - totalW - 16
    var stacked = nameW < Math.max(measure(ctx, 'Блюдо', headerSize, headerWeight), size * 4)
    if (stacked) {
      y = drawTextLine(ctx, { text: 'Блюдо', size: headerSize, weight: headerWeight, align: 'left', gap: op.gapStack }, y)
    }
    y = drawItemRow(ctx, stacked ? '' : 'Блюдо', 'Кол-во', op.showMoney ? 'Сумма' : '', headerSize, headerWeight, qtyW, totalW, y, op.gapHeader)
    y = drawDivider(ctx, { gapBefore: 0, gapAfter: op.gapDivider }, y)

    var courses = {}
    var order = []
    for (var k = 0; k < op.rows.length; k++) {
      var key = op.rows[k].course || 1
      if (!courses[key]) { courses[key] = []; order.push(key) }
      courses[key].push(op.rows[k])
    }
    order.sort(function (a, b) { return a - b })
    for (var oi = 0; oi < order.length; oi++) {
      var course = order[oi]
      if (order.length > 1) {
        y = drawTextLine(ctx, { text: '--- Подача ' + course + ' ---', size: size, weight: 'bold', align: 'left', gap: op.gapCourse }, y)
      }
      var list = courses[course]
      for (var li = 0; li < list.length; li++) {
        var item = list[li]
        var total = op.showMoney ? item.total : ''
        if (stacked) y = drawTextLine(ctx, { text: item.name, size: size, weight: weight, align: 'left', gap: op.gapStack }, y)
        y = drawItemRow(ctx, stacked ? '' : item.name, item.qty, total, size, weight, qtyW, totalW, y, op.gapRow)
        for (var mi = 0; mi < item.mods.length; mi++) {
          y = drawTextLine(ctx, { text: '  + ' + item.mods[mi], size: 24, weight: 'regular', align: 'left', gap: op.gapMod }, y)
        }
        if (item.note) y = drawTextLine(ctx, { text: '  ! ' + item.note, size: 24, weight: 'regular', align: 'left', gap: op.gapMod }, y)
      }
    }
    return y
  }

  function renderOp(ctx, op, y) {
    if (op.op === 'line') return drawTextLine(ctx, op, y)
    if (op.op === 'row') return drawRow(ctx, op, y)
    if (op.op === 'divider') return drawDivider(ctx, op, y)
    if (op.op === 'items') return drawItems(ctx, op, y)
    if (op.op === 'kitchenItems') return drawKitchenItems(ctx, op, y)
    return y
  }

  function b64(bytes) {
    var binary = ''
    for (var i = 0; i < bytes.length; i += 0x8000) {
      var end = Math.min(i + 0x8000, bytes.length)
      var chunk = ''
      for (var j = i; j < end; j++) chunk += String.fromCharCode(bytes[j])
      binary += chunk
    }
    return btoa(binary)
  }

  window.renderScene = function (scene) {
    W = scene.width
    M = scene.margin
    FAMILY = scene.fontFamily || 'Arial'
    SEP = scene.separator || SEP

    var probe = document.createElement('canvas')
    probe.width = 10; probe.height = 10
    var pctx = probe.getContext('2d')
    pctx.fillStyle = '#fff'; pctx.fillRect(0, 0, 10, 10)
    pctx.fillStyle = '#000'; pctx.textBaseline = 'alphabetic'
    var y = M
    for (var i = 0; i < scene.ops.length; i++) y = renderOp(pctx, scene.ops[i], y)
    var height = Math.max(Math.ceil(y + M), 2 * M)

    var canvas = document.getElementById('scene')
    canvas.width = W
    canvas.height = height
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, height)
    ctx.fillStyle = '#000'; ctx.textBaseline = 'alphabetic'
    y = M
    for (var k = 0; k < scene.ops.length; k++) y = renderOp(ctx, scene.ops[k], y)

    var data = ctx.getImageData(0, 0, W, height).data
    var gray = new Float32Array(W * height)
    for (var p = 0; p < W * height; p++) gray[p] = data[p * 4]

    // Флойд–Стейнберг, как PIL convert("1"): <=128 — чёрный.
    var black = new Uint8Array(W * height)
    for (var row = 0; row < height; row++) {
      for (var col = 0; col < W; col++) {
        var idx = row * W + col
        var value = gray[idx]
        var isBlack = value <= 128
        black[idx] = isBlack ? 1 : 0
        var err = isBlack ? value : value - 255
        if (col + 1 < W) gray[idx + 1] += err * 7 / 16
        if (row + 1 < height) {
          if (col > 0) gray[idx + W - 1] += err * 3 / 16
          gray[idx + W] += err * 5 / 16
          if (col + 1 < W) gray[idx + W + 1] += err * 1 / 16
        }
      }
    }

    var top = 0, bottom = height
    if (scene.trim) {
      var first = -1, last = -1
      for (var rr = 0; rr < height; rr++) {
        var any = false
        for (var cc = 0; cc < W; cc++) if (black[rr * W + cc]) { any = true; break }
        if (any) { if (first < 0) first = rr; last = rr }
      }
      if (first >= 0) { top = first; bottom = Math.min(height, last + 4) }
    }

    var outH = bottom - top
    var widthBytes = (W + 7) >> 3
    var packed = new Uint8Array(widthBytes * outH)
    for (var ry = 0; ry < outH; ry++) {
      var base = (top + ry) * W
      var offset = ry * widthBytes
      for (var rx = 0; rx < W; rx++) {
        if (black[base + rx]) packed[offset + (rx >> 3)] |= 0x80 >> (rx & 7)
      }
    }
    return { width: W, height: outH, bits: b64(packed) }
  }
})()
</script></body></html>`

// ── Отрисовка через скрытое окно ────────────────────────────────────────────

let sceneWindow = null
let sceneReady = null
let sceneQueue = Promise.resolve()

async function ensureSceneWindow() {
  if (!BrowserWindow) throw new Error('electron BrowserWindow недоступен')
  if (sceneWindow && !sceneWindow.isDestroyed() && sceneReady) return sceneReady
  sceneWindow = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 640,
    height: 480,
    webPreferences: {
      offscreen: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  sceneWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const target = sceneWindow
  sceneReady = target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE_HTML)}`)
    .then(() => target.webContents.executeJavaScript('typeof window.renderScene === "function"'))
    .then((ok) => { if (!ok) throw new Error('raster page не инициализировалась') })
    .catch((err) => {
      sceneReady = null
      if (!target.isDestroyed()) target.destroy()
      sceneWindow = null
      throw err
    })
  return sceneReady
}

function renderScene(scene) {
  const run = async () => {
    await ensureSceneWindow()
    const target = sceneWindow
    if (!target || target.isDestroyed()) throw new Error('raster окно закрыто')
    const result = await Promise.race([
      target.webContents.executeJavaScript(`window.renderScene(${JSON.stringify(scene)})`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('raster render timeout')), 8000)),
    ])
    if (!result || typeof result.bits !== 'string') throw new Error('raster render: пустой результат')
    return result
  }
  const task = sceneQueue.then(run, run)
  sceneQueue = task.catch(() => {})
  return task
}

function gsV0({ width, height, bits }) {
  const widthBytes = (width + 7) >> 3
  const header = Buffer.from([
    GS, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ])
  return Buffer.concat([header, Buffer.from(bits, 'base64')])
}

async function renderCustomerReceipt(options) {
  const scene = receiptScene(options)
  const raster = await renderScene(scene)
  return Buffer.concat([Buffer.from(INIT), gsV0(raster), Buffer.from(CUSTOMER_CUT)])
}

async function renderKitchenTicket(options) {
  const scene = kitchenScene(options)
  const raster = await renderScene(scene)
  return Buffer.concat([Buffer.from(INIT), gsV0(raster), Buffer.from(KITCHEN_CUT)])
}

function dispose() {
  if (sceneWindow && !sceneWindow.isDestroyed()) sceneWindow.destroy()
  sceneWindow = null
  sceneReady = null
}

module.exports = {
  receiptScene,
  kitchenScene,
  renderCustomerReceipt,
  renderKitchenTicket,
  dispose,
}
