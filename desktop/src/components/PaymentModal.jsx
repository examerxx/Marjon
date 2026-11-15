import { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, Printer, Banknote, CreditCard, CheckCircle, Crown, Delete, X,
  Phone, MapPin, Wallet, Undo2,
} from 'lucide-react'
import { t } from '../shared/i18n'
import { formatPhone, extractPhoneDigits, fullPhone } from '../shared/phone'
import { formatQty } from '../shared/qty'
import { sanitizeDecimal, parseNum } from '../shared/numeric'
import { parseApiDate } from '../shared/time'
import { finance as financeApi, payments } from '../shared/api'
import { toast } from './Toast'
import WaiterPicker from './WaiterPicker'
import logoUrl from '../assets/logo-mark.png'

/**
 * PaymentScreen — экран оплаты и закрытие заказа (полноэкранный, без оверлея).
 *
 * Способы оплаты спрашиваются в момент закрытия заказа: на «Закрыть заказ»
 * открывается выбор (наличные, карта, способы из веб-админки, долг) — отдельного
 * селектора в правой колонке нет. До выбора способа поле суммы нейтрально.
 *
 * Сумма к получению — ОДНО поле на любой способ. Пустое = ровно к оплате
 * (можно закрывать сразу). Ввели больше — показываем сдачу, меньше — «не хватает»
 * и закрытие блокируется.
 *
 * props:
 *   order — заказ ({ order_number, table_number, items[], total_amount, waiter_id, created_at })
 *   staff — сотрудники (для «кто добавил» и смены официанта стола)
 *   paidBefore — сколько уже оплачено до повторного закрытия
 *   canDebt — можно ли закрывать в долг
 *   onPrint(order) — печать чека
 *   onComplete(order, method, detail) — подтвердить оплату и закрыть заказ
 *   onApplyDiscount(order, amount) — применить скидку
 *   onSetWaiter(order, waiterId) — сменить ответственного официанта
 *   onRefreshOrder(order) — живой пересчёт заказа
 *   onClose() — назад к залу/заказу
 */
function formatAmountInput(value) {
  const [integer, fraction] = value.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return fraction === undefined ? grouped : `${grouped},${fraction}`
}

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
// Формат печатного чека: 26.10.26 15:36.
function fmtReceiptDateTime(iso) {
  const date = parseApiDate(iso)
  if (!date) return ''
  const two = (n) => String(n).padStart(2, '0')
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Шапка экрана оплаты: тот же бренд, что в TopBar, и «Назад» справа от
 *  текста логотипа. Слоты TopBar не переиспользуем — их id уже заняты
 *  кассой под оверлеем, порталы нашли бы чужую цель. */
function PayHead({ title, onBack }) {
  return (
    <header className="pay-screen__head">
      <div className="topbar__brand pay-screen__brand">
        <span className="topbar__logo-mark">
          <img className="topbar__logo" src={logoUrl} alt="" aria-hidden="true" />
        </span>
        <span className="topbar__brand-text">
          <span className="topbar__brand-name">MARJON</span>
          <span className="topbar__brand-tagline">Restaurant OS</span>
        </span>
        <button className="icon-btn topbar__back pay-screen__back" onClick={onBack} title={t('back')} aria-label={t('back')}>
          <ArrowLeft size={22} />
        </button>
      </div>
      <h3>{title}</h3>
    </header>
  )
}

export default function PaymentScreen({
  order, onPrint, onComplete, onResetPayments, onCancel, onReassign, onClose, canClose = true, staff = [],
  onSetWaiter, onApplyDiscount, onRefreshOrder,
  paidBefore = 0, canDebt = false,
}) {
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [act, setAct] = useState('')
  const [printed, setPrinted] = useState(false)
  const [discPct, setDiscPct] = useState('')
  const [debtStep, setDebtStep] = useState('none')
  const [debtorName, setDebtorName] = useState('')
  const [debtorPhone, setDebtorPhone] = useState('')
  // Выбор способа оплаты — шаг внутри «Закрыть заказ», а не поле в колонке.
  const [askPay, setAskPay] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState([])
  const [methodsStatus, setMethodsStatus] = useState('loading')
  const [recordedPayments, setRecordedPayments] = useState([])
  const [confirmation, setConfirmation] = useState(null)
  const [resetOpen, setResetOpen] = useState(false)
  // Способ, отмеченный на экране. Пока он не выбран, «Закрыть заказ» недоступна.
  const [selected, setSelected] = useState(null)
  // Куда идут цифры с панели: в сумму оплаты или в скидку (после нажатия на поле скидки).
  const [padTarget, setPadTarget] = useState('amount')
  const prefilledAmount = useRef(false)
  const amountOpened = useRef(false)
  const methodListRef = useRef(null)
  // Сумма, которую дал гость. Строкой: пустое поле ≠ 0, это «ровно к оплате».
  const [amount, setAmount] = useState('')
  const [editingAmount, setEditingAmount] = useState(false)
  const amountInputRef = useRef(null)
  const amountTriggerRef = useRef(null)

  const total = Number(order?.total_amount || 0)
  const items = (order?.items || []).filter((item) => item.status !== 'cancelled')
  const subtotal = items.reduce((s, it) => s + Number(it.total ?? (Number(it.price) * Number(it.quantity))), 0)
  // Кто участвовал в заказе — те же строки, что печатаются на чеке.
  const receiptStaff = (order?.receipt_staff || []).filter((row) => row && row.name)
  const servicePct = subtotal > 0 ? Math.round(Number(order?.service_fee || 0) / subtotal * 100) : 0

  // Кастомные способы (Uzum, Yandex…).
  const reopening = Boolean(order?.reopened_at)
  const refundDue = reopening ? Math.max(0, Number(paidBefore || 0) - total) : 0
  const dueNow = Math.max(0, Math.round((total - Number(paidBefore || 0)) * 100) / 100)
  const debtAllowed = canDebt && !reopening

  // ── Введённая сумма ──────────────────────────────────────────────────
  const entered = parseNum(amount)
  // Пустое поле = оплата ровно на остаток (так «Закрыть заказ» работает сразу).
  const paid = entered > 0 ? entered : dueNow
  const change = Math.max(0, paid - dueNow)
  const short = Math.max(0, dueNow - paid)
  const canComplete = canClose && !busy

  // Живой пересчёт итога
  const refreshTimer = useRef(null)
  useEffect(() => {
    if (!onRefreshOrder || !order?.id) return
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { onRefreshOrder(order) }, 1200)
    return () => clearTimeout(refreshTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.total_amount, order?.discount_amount])

  useEffect(() => {
    const request = new AbortController()
    Promise.all([financeApi.paymentTypes(request.signal), payments.forOrder(order.id)])
      .then(([rows, recorded]) => {
        if (request.signal.aborted) return
        setPaymentMethods(rows)
        setRecordedPayments(recorded.filter((payment) => payment.status === 'completed'))
        setMethodsStatus('ready')
      })
      .catch(() => {
        if (!request.signal.aborted) setMethodsStatus('error')
      })
    return () => request.abort()
  }, [order?.id])

  // Модалки выбора способа и долга закрываются по Escape и тапом по подложке.
  useEffect(() => {
    if (!askPay && debtStep !== 'form' && !confirmation && !resetOpen) return
    function onKey(e) {
      if (e.key !== 'Escape' || busy) return
      if (resetOpen) { setResetOpen(false); return }
      if (confirmation) { setConfirmation(null); setAskPay(true); return }
      if (editingAmount && askPay) {
        setEditingAmount(false)
        setAmount('')
        amountTriggerRef.current?.focus()
        return
      }
      setAskPay(false)
      if (debtStep === 'form') setDebtStep('none')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [askPay, busy, debtStep, editingAmount, confirmation, resetOpen])

  /**
   * Тап по сумме к оплате подставляет полную сумму в поле «Получено».
   *
   * Работает на любом способе, кроме долга и возвращённого заказа (там поля
   * нет вовсе). Сумма берётся с учётом типа: карта не может «переплатить»,
   * поэтому подставляется ровно остаток к оплате; наличные — тот же остаток
   * как стартовая цифра, которую кассир правит под купюру.
   */
  function fillDue() {
    if (busy || method === 'debt' || reopening || dueNow <= 0) return
    setAmount(String(Number(dueNow.toFixed(2))))
  }

  async function run(name, fn) {
    if (act || busy) return
    setAct(name)
    try { await fn() } finally { setAct('') }
  }

  async function doPrint() {
    await run('print', async () => {
      setPrinted(true)
      try { await onPrint(order) } finally { setTimeout(() => setPrinted(false), 1600) }
    })
  }

  async function applyDiscount() {
    if (!onApplyDiscount) return
    const p = Math.min(100, Math.max(0, Number(discPct) || 0))
    if (!p) return
    const sum = Math.round(subtotal * p / 100)
    // После частичной оплаты скидка не должна опустить итог ниже уже принятого.
    if (paidBefore > 0 && !reopening && sum * (1 + servicePct / 100) > dueNow) {
      toast(t('discount_exceeds_due'), 'error')
      return
    }
    await run('discount', async () => {
      try {
        await onApplyDiscount(order, sum)
        setDiscPct('')
        setPadTarget('amount')
      } catch { toast(t('create_order_error')) }
    })
  }

  function openPay() {
    if (!canComplete) return
    amountOpened.current = false
    setPaymentMethods([])
    setMethodsStatus('loading')
    setAskPay(true)
  }

  function closePaymentMethods() {
    if (busy) return
    if (editingAmount) setAmount('')
    setEditingAmount(false)
    setAskPay(false)
  }

  function updateAmountInput(value, caret) {
    const next = sanitizeDecimal(value, 2)
    const rawCaret = sanitizeDecimal(value.slice(0, caret), 2).length
    setAmount(next)
    requestAnimationFrame(() => {
      const field = amountInputRef.current
      if (!field || document.activeElement !== field) return
      let offset = 0
      let digits = 0
      for (const char of field.value) {
        if (digits === rawCaret) break
        offset++
        if (char !== ' ') digits++
      }
      field.setSelectionRange(offset, offset)
    })
  }

  function pressAmountKey(key) {
    const field = amountInputRef.current
    if (!field || busy) return
    const start = sanitizeDecimal(field.value.slice(0, field.selectionStart), 2).length
    const end = sanitizeDecimal(field.value.slice(0, field.selectionEnd), 2).length
    const remove = key === 'delete'
    const from = remove && start === end ? Math.max(0, start - 1) : start
    const replace = prefilledAmount.current && !remove
    prefilledAmount.current = false
    const before = (replace ? '' : amount.slice(0, from)) + (remove ? '' : key)
    updateAmountInput(before + (replace ? '' : amount.slice(end)), before.length)
  }

  // Цифра с панели: в скидку (целые проценты, до 100) или в сумму оплаты.
  function pressPadKey(key) {
    if (padTarget !== 'discount') { pressAmountKey(key); return }
    if (act === 'discount') return
    if (key === 'delete') { setDiscPct((v) => v.slice(0, -1)); return }
    if (!/^[0-9]$/.test(key)) return
    setDiscPct((v) => {
      const next = (v + key).replace(/^0+(?=\d)/, '').slice(0, 3)
      return Number(next) > 100 ? '100' : next
    })
  }

  async function completeWithMethod(nextMethod) {
    if (busy) return
    if (nextMethod === 'debt') {
      if (!debtAllowed || dueNow <= 0) return
      closePaymentMethods()
      setDebtStep('form')
      return
    }
    // Карта не может «переплатить»: терминал списывает ровно сумму чека.
    if (nextMethod === 'card' && entered > dueNow) {
      toast(t('payment_card_over_total'), 'error')
      return
    }
    const moneyMethod = nextMethod === 'cash' || nextMethod === 'card'
    const paymentAmount = moneyMethod ? Math.min(entered || dueNow, dueNow) : dueNow
    const partial = !reopening && moneyMethod && (paidBefore > 0 || paymentAmount < dueNow)
    if (paidBefore > 0 && !reopening && !moneyMethod && nextMethod !== 'VIP') return
    if (partial && paymentAmount <= 0) return
    if (!reopening && paidBefore > 0 && paymentAmount >= dueNow) {
      setConfirmation({ method: nextMethod, amount: paymentAmount,
        detail: partial ? { partialAmount: paymentAmount, [nextMethod]: entered || paymentAmount }
          : entered > 0 && moneyMethod ? { [nextMethod]: entered } : undefined })
      return
    }
    if (partial && paymentAmount < dueNow) animateAmount(nextMethod, paymentAmount)
    setMethod(nextMethod)
    setBusy(true)
    const detail = partial
      ? { partialAmount: paymentAmount, [nextMethod]: entered || paymentAmount }
      : entered > 0 && moneyMethod ? { [nextMethod]: entered } : undefined
    try {
      const result = await onComplete(order, nextMethod, detail)
      if (result?.partial) {
        setRecordedPayments((rows) => [...rows, result.payment])
        prefilledAmount.current = false
        setAmount('')
        setSelected(null)
      }
    } catch { /* The checkout owner displays the server error. */ }
    finally { setBusy(false) }
  }

  async function doDebtComplete() {
    if (busy) return
    const detail = { debt: dueNow, client_name: debtorName.trim() || undefined,
      client_phone: fullPhone(debtorPhone) || undefined }
    if (paidBefore > 0) {
      setConfirmation({ method: 'debt', amount: dueNow, detail })
      setDebtStep('none')
      return
    }
    setBusy(true)
    try {
      await onComplete(order, 'debt', detail)
    } catch { /* The checkout owner displays the server error. */ }
    finally { setBusy(false) }
  }

  function animateAmount(method, value) {
    const source = amountInputRef.current?.getBoundingClientRect()
    const target = [...(methodListRef.current?.querySelectorAll('[data-method]') || [])]
      .find((element) => element.dataset.method === method)?.getBoundingClientRect()
    if (!source || !target || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const chip = document.createElement('span')
    chip.className = 'pay-amount-transfer'
    chip.textContent = fmt(value)
    Object.assign(chip.style, { left: source.left + 'px', top: source.top + 'px', width: source.width + 'px' })
    document.body.append(chip)
    const animation = chip.animate([
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${target.right - source.right - 16}px, ${target.top - source.top + 16}px)`, opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' })
    animation.finished.then(() => chip.remove(), () => chip.remove())
  }

  async function confirmPayment() {
    if (!confirmation || busy) return
    setBusy(true)
    try {
      await onComplete(order, confirmation.method, confirmation.detail)
    } catch { /* Keep the confirmation available for a safe retry. */ }
    finally { setBusy(false) }
  }

  async function resetPayments() {
    if (busy) return
    setBusy(true)
    try {
      await onResetPayments(order, recordedPayments.map((payment) => payment.id))
      setRecordedPayments([])
      setAmount('')
      setEditingAmount(false)
      setResetOpen(false)
    } catch (error) {
      toast(error?.response?.data?.detail || t('payment_reset_failed'), 'error')
    } finally { setBusy(false) }
  }

  function paymentLabel(method) {
    if (method === 'cash' || method === 'card' || method === 'debt') return t(method)
    return method
  }

  const allocated = new Map()
  for (const payment of recordedPayments) {
    allocated.set(payment.method, (allocated.get(payment.method) || 0) + Number(payment.amount))
  }
  const summary = new Map(allocated)
  if (confirmation) summary.set(confirmation.method, (summary.get(confirmation.method) || 0) + confirmation.amount)

  function closeDebt() { setDebtStep('none') }
  const spin = <span className="btn-spinner" aria-hidden="true" />

  const icons = { cash: Banknote, card: CreditCard, vip: Crown }
  const reservedNames = new Set(['cash', 'card', 'debt', 'vip', 'mixed', 'наличные', 'наличными', 'карта', 'в долг', 'смешанный'])
  const methodOptions = paymentMethods.flatMap((row) => {
    const builtIn = ['cash', 'card', 'vip', 'debt'].includes(row.type) &&
      (row.is_system || /^fef15000-0000-4000-8000-00000000000[1-4]$/.test(row.id))
    if (!builtIn && reservedNames.has(row.name.trim().toLowerCase())) return []
    if (builtIn && row.type === 'debt' && !debtAllowed) return []
    const isVip = builtIn && row.type === 'vip'
    const moneyMethod = builtIn && ['cash', 'card'].includes(row.type)
    const blocked = isVip && reopening
      ? t('payment_vip_unpaid_only')
      : paidBefore > 0 && !reopening && !builtIn ? t('payment_method_after_partial') : ''
    const MethodIcon = (builtIn && icons[row.type]) || Wallet
    return [{
      value: builtIn ? (isVip ? 'VIP' : row.type) : row.name,
      label: row.name, icon: <MethodIcon size={18} />, blocked,
      disabled: Boolean(blocked),
    }]
  })

  return (
    <div className="pay-screen">
      <PayHead
        title={`${t('pay_order')} #${order?.order_number ?? ''}${order?.table_number ? ` · ${t('table')} ${order.table_number}` : ''}`}
        onBack={onClose}
      />

      <div className="pay-screen__body">
        {/* Левая половина — чек, правая — управление оплатой столбцом. */}
        <div className="pay-screen__receipt-col">
          {/* Контакты доставки остаются над чеком: их нет в шаблоне, но кассир
              должен видеть адрес, пока закрывает заказ. */}
          {(order?.customer_phone || order?.customer_address) && (
            <div className="pay-order__meta">
              {order.customer_phone && <span><Phone size={15} /> {formatPhone(order.customer_phone)}</span>}
              {order.customer_address && <span><MapPin size={15} /> {order.customer_address}</span>}
            </div>
          )}

          {/* Чек на экране: реквизиты заказа, блюда и итоги — без шапки
              заведения, способа оплаты и крупного номера внизу. */}
          <div className="pay-receipt-scroll">
            <article className="pay-receipt" aria-label={`${t('print_receipt')} #${order?.order_number ?? ''}`}>
              <div className="pay-receipt__info">
                <div><span>{t('receipt_order_no')}:</span><b>{order?.order_number ?? ''}</b></div>
                <div><span>{t('receipt_order_type')}:</span><b>{t.type(order?.order_type || 'dine_in')}</b></div>
                {order?.table_number && <div><span>{t('receipt_table_no')}:</span><b>{order.table_number}</b></div>}
                {receiptStaff.map((row) => (
                  <div key={row.label}><span>{row.label}:</span><b>{row.name}</b></div>
                ))}
                {order?.created_at && <div><span>{t('receipt_date')}:</span><b>{fmtReceiptDateTime(order.created_at)}</b></div>}
              </div>

              <div className="pay-receipt__table">
                <div className="pay-receipt__row pay-receipt__row--head">
                  <span>{t('receipt_dish')}</span>
                  <span>{t('receipt_qty')}</span>
                  <span>{t('receipt_sum')}</span>
                </div>
                {items.length === 0 ? (
                  <div className="pay-receipt__empty">{t('order_items')}: —</div>
                ) : items.map((it) => (
                  <div className="pay-receipt__row" key={it.id}>
                    <span>
                      {it.name}
                      {it.takeaway ? ` · ${t('takeaway')}` : ''}
                    </span>
                    <span>{formatQty(it.quantity)}</span>
                    <span>{fmt(it.total ?? (Number(it.price) * Number(it.quantity)))}</span>
                  </div>
                ))}

                <div className="pay-receipt__row pay-receipt__row--sum">
                  <span>{t('receipt_items_total')}</span><span /><span>{fmt(subtotal)}</span>
                </div>
                {Number(order?.service_fee) > 0 && (
                  <div className="pay-receipt__row pay-receipt__row--amount">
                    <span>{t('receipt_service')} {servicePct}%</span><span /><span>{fmt(order.service_fee)}</span>
                  </div>
                )}
                {Number(order?.discount_amount) > 0 && (
                  <div className="pay-receipt__row pay-receipt__row--amount">
                    <span>{t('discount_word')}</span><span /><span>−{fmt(order.discount_amount)}</span>
                  </div>
                )}
                {Number(order?.tax_amount) > 0 && (
                  <div className="pay-receipt__row pay-receipt__row--amount">
                    <span>{t('z_tax')}</span><span /><span>{fmt(order.tax_amount)}</span>
                  </div>
                )}
                <div className="pay-receipt__row pay-receipt__row--total">
                  <span>{t('total')}:</span><span /><span>{fmt(total)}</span>
                </div>
                {reopening && (
                  <div className="pay-receipt__row pay-receipt__row--amount">
                    <span>{t('receipt_paid_earlier')}</span><span /><span>{fmt(paidBefore)}</span>
                  </div>
                )}
                {change > 0 && (
                  <div className="pay-receipt__row pay-receipt__row--amount">
                    <span>{t('change')}</span><span /><span>{fmt(change)}</span>
                  </div>
                )}
              </div>
            </article>
          </div>
        </div>

        <div className="pay-screen__side">
          {/* Официант, смена стола, отмена заказа и скидка (в правом углу) — одной строкой под шапкой */}
          <div className="pay-screen__toolbar">
            {onSetWaiter && staff.length > 0 && (
              <div className="pay-screen__control">
                <WaiterPicker
                  value={order?.waiter_id || ''}
                  staff={staff}
                  label={t('change_waiter')}
                  hideLabel
                  disabled={act === 'waiter'}
                  onChange={(waiterId) => run('waiter', () => onSetWaiter(order, waiterId || null))}
                />
                {act === 'waiter' && spin}
              </div>
            )}

            {onReassign && order?.table_number && (
              <button className="btn btn--outline pay-screen__reassign" onClick={() => onReassign(order)}>
                {t('move_table')}
              </button>
            )}

            {onApplyDiscount && (
              <div className="pay-screen__control">
                <label className="pay-dialog__disc">
                  <span className="pay-dialog__disc-label">{t('discount_word')}</span>
                  <div className="pay-dialog__disc-row">
                    <input
                      type="text" inputMode="none" data-keyboard="off"
                      className="pay-dialog__disc-input"
                      value={discPct} disabled={act === 'discount'} placeholder="0"
                      onFocus={() => setPadTarget('discount')}
                      onPointerDown={() => setPadTarget('discount')}
                      onChange={(e) => setDiscPct(sanitizeDecimal(e.target.value, 0).slice(0, 3))}
                    />
                    <span className="pay-dialog__disc-unit">%</span>
                    <button
                      type="button" className="btn btn--sm"
                      disabled={act === 'discount' || !discPct}
                      onClick={applyDiscount}
                    >
                      {act === 'discount' ? spin : t('apply')}
                    </button>
                  </div>
                </label>
              </div>
            )}

            {/* «Отменить заказ» стоит сразу под полем «Получено»: это редкое
                действие, и в паре с «Закрыть заказ» её легко нажать по ошибке. */}
            {onCancel && (
              <button className="btn btn--outline pay-order__cancel" onClick={() => onCancel(order)}>
                {t('cancel_order')}
              </button>
            )}
          </div>
          {/* Прокручиваются только поля оплаты: кнопки печати и закрытия стоят
              вне скролл-контейнера, иначе он обрезал их мягкую тень по краям. */}
          {/* Возврат в закрытый заказ */}
          {reopening && (
          <div className="pay-screen__controls">
            <div className="pay-order__reopen">
              <div className="pay-order__change"><span>{t('paid_before')}</span><strong>{fmt(paidBefore)} {t('currency')}</strong></div>
              {refundDue > 0 && (
                <div className="pay-order__change pay-order__change--refund">
                  <span><Undo2 size={14} /> {t('refund_to_client')}</span><strong>{fmt(refundDue)} {t('currency')}</strong>
                </div>
              )}
              {dueNow > 0 && (
                <div className="pay-order__change pay-order__change--short">
                  <span>{t('not_enough')}</span><strong>{fmt(dueNow)} {t('currency')}</strong>
                </div>
              )}
            </div>
          </div>
          )}

          {/* Способы оплаты и цифровая панель — прямо на экране, без всплывающего окна. */}
          <div className={`pay-screen__pay${reopening ? ' pay-screen__pay--single' : ''}`}>
            <div className="pay-method__card">
              <div className="pay-method__head">
                <span className="pay-method__title">{t('choose_payment')}</span>
                {!reopening && paidBefore > 0 && recordedPayments.length > 0 && onResetPayments && (
                  <button type="button" className="pay-method__reset" disabled={busy} onClick={() => setResetOpen(true)}>
                    {t('payment_reset')}
                  </button>
                )}
              </div>
              <button type="button" className="pay-method__sum" ref={amountTriggerRef}
                disabled={busy || reopening}
                onClick={() => { prefilledAmount.current = true; setAmount(String(dueNow)) }}>
                <span>{t('to_pay')}</span>
                <strong>{fmt(dueNow)} {t('currency')}</strong>
              </button>
              <div className="pay-method__list" ref={methodListRef}>
                {methodsStatus !== 'ready' ? (
                  <p className="pay-method__notice" role={methodsStatus === 'error' ? 'alert' : 'status'}>
                    {t(methodsStatus === 'error' ? 'payment_methods_load_error' : 'loading')}
                  </p>
                ) : methodOptions.length === 0 ? (
                  <p className="pay-method__notice" role="status">{t('payment_methods_empty')}</p>
                ) : methodOptions.map((option) => (
                  <button
                    key={option.value} type="button" data-method={option.value}
                        className={`pay-method__opt${option.blocked ? ' pay-method__opt--blocked' : ''}${busy && method === option.value ? ' is-selected' : ''}`}
                    disabled={busy || option.disabled}
                    onClick={() => { setPadTarget('amount'); setSelected(option.value); completeWithMethod(option.value) }}
                  >
                    <span className="pay-method__ico">{option.icon}</span>
                    <span className="pay-method__label">
                      <span className="pay-method__name">{option.label}</span>
                      {option.blocked && <span className="pay-method__reason">{option.blocked}</span>}
                    </span>
                    {allocated.has(option.value) && <strong className="pay-method__allocated" key={allocated.get(option.value)}>
                      {fmt(allocated.get(option.value))}
                    </strong>}
                    {busy && method === option.value && spin}
                  </button>
                ))}
              </div>
            </div>
            {!reopening && (
              <div id="payment-amount-pad" className="pay-amount-pad" role="group" aria-label={t('payment_amount')}>
                <label className="pay-amount-pad__label" htmlFor="payment-partial-amount">{padTarget === 'discount' ? t('discount_word') : t('payment_amount')}</label>
                <div className="pay-amount-pad__field">
                  <input id="payment-partial-amount" ref={amountInputRef} inputMode="none" data-keyboard="off"
                    readOnly={busy || padTarget === 'discount'}
                    value={padTarget === 'discount' ? discPct : formatAmountInput(amount)}
                    onPointerDown={() => { prefilledAmount.current = false; setPadTarget('amount') }}
                    onChange={(event) => updateAmountInput(event.target.value, event.target.selectionStart)}
                    onKeyDown={(event) => {
                      const field = event.currentTarget
                      const caret = field.selectionStart
                      if (prefilledAmount.current && /^[0-9.,]$/.test(event.key) && !event.ctrlKey && !event.metaKey) {
                        event.preventDefault()
                        pressAmountKey(event.key)
                      } else if (event.key === 'Backspace' && caret === field.selectionEnd && field.value[caret - 1] === ' ') {
                        event.preventDefault()
                        pressAmountKey('delete')
                      }
                    }} />
                  <span aria-hidden="true">{padTarget === 'discount' ? '%' : t('currency')}</span>
                </div>
                {padTarget !== 'discount' && (change > 0 || short > 0) && (
                  <div className="pay-amount__hint">
                    {change > 0 && <span className="pay-amount__hint--change">{t('change')}: {fmt(change)} {t('currency')}</span>}
                    {short > 0 && <span className="pay-amount__hint--short">{t('not_enough')}: {fmt(short)} {t('currency')}</span>}
                  </div>
                )}
                <div className="pay-amount-pad__keys">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'delete'].map((key) => (
                    <button key={key} type="button" className={`vkb__key${key === 'delete' ? ' vkb__key--medium' : ''}`}
                      disabled={busy} aria-label={key === 'delete' ? t('payment_delete_digit') : undefined}
                      onMouseDown={(event) => event.preventDefault()} onClick={() => pressPadKey(key)}>
                      {key === 'delete' ? <Delete size={20} /> : key === '.' ? ',' : key}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Печать и закрытие — прижаты к низу колонки. */}
          <div className="pay-screen__actions">
            <button className={`btn btn--outline btn--eq ${printed ? 'is-done' : ''}`} disabled={act === 'print'} onClick={doPrint}>
              {act === 'print' ? spin : printed ? <CheckCircle size={18} /> : <Printer size={18} />} {t('print_receipt')}
            </button>
            <button className="btn btn--primary btn--lg pay-order__close btn--eq" disabled={!canComplete || !selected}
              title={!selected ? t('choose_payment') : undefined}
              onClick={() => completeWithMethod(selected)}>
              {busy ? spin : <CheckCircle size={20} />} {t('complete_order')}
            </button>
          </div>
        </div>
      </div>

      {resetOpen && (
        <div className="pay-confirm" role="dialog" aria-modal="true" aria-label={t('payment_reset')}>
          <div className="pay-method__card">
            <div className="pay-method__head">
              <button className="icon-btn pay-reset__close" disabled={busy} aria-label={t('back')} onClick={() => setResetOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <button type="button" className="pay-method__reset pay-reset__submit" disabled={busy} onClick={resetPayments}>
              {busy ? spin : t('payment_reset')}
            </button>
          </div>
        </div>
      )}

      {confirmation && (
        <div className="pay-confirm" role="dialog" aria-modal="true" aria-label={t('payment_confirm_title')}>
          <div className="pay-method__card">
            <div className="pay-method__head">
              <span className="pay-method__title">{t('payment_confirm_title')}</span>
              <button className="icon-btn" disabled={busy} aria-label={t('back')} onClick={() => {
                setConfirmation(null)
                setAskPay(true)
              }}><X size={20} /></button>
            </div>
            <div className="pay-confirm__rows">
              {[...summary].map(([method, value]) => <div key={method}>
                <span>{paymentLabel(method)}</span><strong>{fmt(value)} {t('currency')}</strong>
              </div>)}
            </div>
            <button className="btn btn--primary" disabled={busy} onClick={confirmPayment}>
              {busy ? spin : t('pin_confirm')}
            </button>
          </div>
        </div>
      )}

      {/* Долг — такая же карточка поверх оплаты, как выбор способа,
          а не отдельный полноэкранный шаг. */}
      {debtStep === 'form' && (
        <div
          className="pay-method"
          role="dialog" aria-modal="true" aria-label={t('debt_title')}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeDebt() }}
        >
          <div className="pay-method__card pay-debt">
            <div className="pay-method__head">
              <span className="pay-method__title">{t('debt_title')}</span>
              <button className="icon-btn" onClick={closeDebt} title={t('back')} aria-label={t('back')}>
                <X size={20} />
              </button>
            </div>
            <div className="pay-debt__sum">
              <div className="pay-order__change"><span>{t('to_pay_label')}</span><strong>{fmt(total)} {t('currency')}</strong></div>
              <div className="pay-order__change pay-order__change--short"><span>{t('debt_left')}</span><strong>{fmt(dueNow)} {t('currency')}</strong></div>
            </div>
            <div className="login-field">
              <label className="login-field__label">{t('debt_client')}</label>
              <input className="login-field__input" value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)} placeholder={t('debt_client_ph')} />
            </div>
            <div className="login-field">
              <label className="login-field__label">{t('debt_phone')}</label>
              <input className="login-field__input" type="tel" inputMode="tel" value={formatPhone(debtorPhone)}
                onChange={(e) => setDebtorPhone(extractPhoneDigits(e.target.value))} placeholder="+998 __ ___-__-__" />
            </div>
            <div className="pay-debt__actions">
              <button className="btn btn--outline" onClick={closeDebt}>{t('back')}</button>
              <button className="btn btn--primary" disabled={busy} onClick={doDebtComplete}>
                {busy ? spin : <CheckCircle size={18} />} {t('debt_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
