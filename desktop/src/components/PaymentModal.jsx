import { useState, useEffect, useRef } from 'react'
import {
  ArrowLeft, Printer, Banknote, CreditCard, CheckCircle, Check, ChevronDown,
  Phone, MapPin, Wallet, Undo2,
} from 'lucide-react'
import { t } from '../shared/i18n'
import { formatPhone, extractPhoneDigits, fullPhone } from '../shared/phone'
import { formatQty } from '../shared/qty'
import { sanitizeDecimal, parseNum } from '../shared/numeric'
import { parseApiDate } from '../shared/time'
import { toast } from './Toast'
import WaiterPicker from './WaiterPicker'

/**
 * PaymentScreen — экран оплаты и закрытие заказа (полноэкранный, без оверлея).
 *
 * Способы оплаты: наличные, карта и способы из веб-админки (Uzum, Yandex, …).
 * Все они — строки одного свёрнутого списка, как «смена официанта»: отдельных
 * крупных кнопок под каждый способ не рисуем, их может быть сколько угодно.
 *
 * Сумма к получению — ОДНО поле на любой способ. Пустое = ровно к оплате
 * (можно закрывать сразу). Ввели больше — показываем сдачу, меньше — «не хватает»
 * и закрытие блокируется.
 *
 * props:
 *   order — заказ ({ order_number, table_number, items[], total_amount, waiter_id, created_at })
 *   staff — сотрудники (для «кто добавил» и смены официанта стола)
 *   paymentMethods — дополнительные способы оплаты из веб-админки ([{ id, name }])
 *   paidBefore — сколько уже оплачено до повторного закрытия
 *   canDebt — можно ли закрывать в долг
 *   onPrint(order) — печать чека
 *   onComplete(order, method, detail) — подтвердить оплату и закрыть заказ
 *   onApplyDiscount(order, amount) — применить скидку
 *   onSetWaiter(order, waiterId) — сменить ответственного официанта
 *   onRefreshOrder(order) — живой пересчёт заказа
 *   onClose() — назад к залу/заказу
 */
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
// Формат печатного чека: 26.10.26 15:36.
function fmtReceiptDateTime(iso) {
  const date = parseApiDate(iso)
  if (!date) return ''
  const two = (n) => String(n).padStart(2, '0')
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export default function PaymentScreen({
  order, onPrint, onComplete, onCancel, onReassign, onClose, canClose = true, staff = [],
  onSetWaiter, onApplyDiscount, onRefreshOrder,
  paymentMethods = [], paidBefore = 0, canDebt = false,
}) {
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [act, setAct] = useState('')
  const [printed, setPrinted] = useState(false)
  const [discPct, setDiscPct] = useState('')
  const [debtStep, setDebtStep] = useState('none')
  const [debtorName, setDebtorName] = useState('')
  const [debtorPhone, setDebtorPhone] = useState('')
  const [methodOpen, setMethodOpen] = useState(false)
  const methodRef = useRef(null)
  // Сумма, которую дал гость. Строкой: пустое поле ≠ 0, это «ровно к оплате».
  const [amount, setAmount] = useState('')

  const total = Number(order?.total_amount || 0)
  const items = (order?.items || []).filter((item) => item.status !== 'cancelled')
  const subtotal = items.reduce((s, it) => s + Number(it.total ?? (Number(it.price) * Number(it.quantity))), 0)
  // Кто участвовал в заказе — те же строки, что печатаются на чеке.
  const receiptStaff = (order?.receipt_staff || []).filter((row) => row && row.name)
  const servicePct = subtotal > 0 ? Math.round(Number(order?.service_fee || 0) / subtotal * 100) : 0

  // Кастомные способы (Uzum, Yandex…).
  const customMethods = (paymentMethods || []).filter((m) => m && m.name)
  const isCustom = method !== 'cash' && method !== 'card' && method !== 'debt'
  const paymentLabel = isCustom
    ? method
    : method === 'card' ? t('card') : method === 'debt' ? t('debt') : t('cash')
  const reopening = Number(paidBefore || 0) > 0
  const refundDue = Math.max(0, Number(paidBefore || 0) - total)
  const dueNow = Math.max(0, total - (reopening ? Number(paidBefore || 0) : 0))
  const debtAllowed = canDebt && !reopening

  // ── Введённая сумма ──────────────────────────────────────────────────
  const entered = parseNum(amount)
  // Пустое поле = оплата ровно на остаток (так «Закрыть заказ» работает сразу).
  const paid = entered > 0 ? entered : dueNow
  const change = Math.max(0, paid - dueNow)
  const short = Math.max(0, dueNow - paid)
  // Карта не может «переплатить»: терминал списывает ровно сумму чека.
  const cardOver = method === 'card' && entered > dueNow
  const canComplete = canClose && !busy && short === 0 && !cardOver

  // Живой пересчёт итога
  const refreshTimer = useRef(null)
  useEffect(() => {
    if (!onRefreshOrder || !order?.id) return
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { onRefreshOrder(order) }, 1200)
    return () => clearTimeout(refreshTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.total_amount, order?.discount_amount])

  // Список способов оплаты ведёт себя как «смена официанта»: закрывается
  // тапом мимо и по Escape.
  useEffect(() => {
    if (!methodOpen) return
    function onDoc(e) {
      if (methodRef.current && !methodRef.current.contains(e.target)) setMethodOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setMethodOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [methodOpen])

  function pickMethod(next) {
    setMethodOpen(false)
    if (next === method) return
    setMethod(next)
    setAmount('')      // у каждого способа своя принятая сумма
  }

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
    await run('discount', async () => {
      try {
        await onApplyDiscount(order, sum)
        setDiscPct('')
      } catch { toast(t('create_order_error')) }
    })
  }

  async function doComplete() {
    if (!canComplete) return
    if (debtAllowed && dueNow > 0 && method === 'debt') {
      setDebtStep('form'); return
    }
    setBusy(true)
    // detail несём только когда кассир реально ввёл сумму. Пустое поле — оплата
    // ровно на итог: backend (buildOrderPayment) сам подставит полную сумму.
    const detail = entered > 0 && (method === 'cash' || method === 'card')
      ? { [method]: entered }
      : undefined
    const payMethod = isCustom ? method : (method === 'card' ? 'card' : 'cash')
    try {
      await onComplete(order, payMethod, detail)
    } finally { setBusy(false) }
  }

  async function doDebtComplete() {
    if (busy) return
    setBusy(true)
    const detail = {
      debt: dueNow,
      client_name: debtorName.trim() || undefined,
      client_phone: fullPhone(debtorPhone) || undefined,
    }
    try { await onComplete(order, 'debt', detail) } finally { setBusy(false) }
  }

  function closeDebt() { setDebtStep('none') }
  const spin = <span className="btn-spinner" aria-hidden="true" />

  const methodOptions = [
    { value: 'cash', label: t('cash'), icon: <Banknote size={18} /> },
    { value: 'card', label: t('card'), icon: <CreditCard size={18} /> },
    ...customMethods.map((m) => ({ value: m.name, label: m.name, icon: <Wallet size={18} /> })),
    ...(debtAllowed ? [{ value: 'debt', label: t('debt'), icon: <Wallet size={18} /> }] : []),
  ]
  const currentMethodIcon = method === 'card'
    ? <CreditCard size={18} />
    : method === 'cash' ? <Banknote size={18} /> : <Wallet size={18} />

  // Закрытие в долг — отдельный экран поверх оплаты
  if (debtStep === 'form') {
    return (
      <div className="pay-screen">
        <header className="pay-screen__head">
          <button className="icon-btn" onClick={closeDebt} title={t('back')}><ArrowLeft size={20} /></button>
          <h3>{t('debt_title')}</h3>
          <div style={{ width: 40 }} />
        </header>
        <div className="pay-screen__body pay-screen__body--form">
          <div className="pay-order__cash">
            <div className="pay-order__change"><span>{t('to_pay_label')}</span><strong>{fmt(total)} {t('currency')}</strong></div>
            <div className="pay-order__change pay-order__change--short"><span>{t('debt_left')}</span><strong>{fmt(dueNow)} {t('currency')}</strong></div>
            <div className="login-field" style={{ marginTop: 'var(--spacing-md)' }}>
              <label className="login-field__label">{t('debt_client')}</label>
              <input className="login-field__input" value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)} placeholder={t('debt_client_ph')} />
            </div>
            <div className="login-field">
              <label className="login-field__label">{t('debt_phone')}</label>
              <input className="login-field__input" type="tel" inputMode="tel" value={formatPhone(debtorPhone)}
                onChange={(e) => setDebtorPhone(extractPhoneDigits(e.target.value))} placeholder="+998 __ ___-__-__" />
            </div>
          </div>
        </div>
        <footer className="pay-screen__foot">
          <div className="pay-dialog__actions">
            <button className="btn btn--outline" onClick={closeDebt}>{t('back')}</button>
            <button className="btn btn--primary btn--lg pay-order__close" disabled={busy} onClick={doDebtComplete}>
              {busy ? spin : <CheckCircle size={20} />} {t('debt_close')}
            </button>
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div className="pay-screen">
      <header className="pay-screen__head">
        <button className="icon-btn" onClick={onClose} title={t('back')}><ArrowLeft size={22} /></button>
        <h3>{t('pay_order')} #{order?.order_number ?? ''}{order?.table_number ? ` · ${t('table')} ${order.table_number}` : ''}</h3>
        <div style={{ width: 40 }} />
      </header>

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
                  <div className="pay-receipt__row">
                    <span>{t('receipt_service')} {servicePct}%</span><span /><span>{fmt(order.service_fee)}</span>
                  </div>
                )}
                {Number(order?.discount_amount) > 0 && (
                  <div className="pay-receipt__row">
                    <span>{t('discount_word')}</span><span /><span>−{fmt(order.discount_amount)}</span>
                  </div>
                )}
                {Number(order?.tax_amount) > 0 && (
                  <div className="pay-receipt__row">
                    <span>{t('z_tax')}</span><span /><span>{fmt(order.tax_amount)}</span>
                  </div>
                )}
                <div className="pay-receipt__row pay-receipt__row--total">
                  <span>{t('total')}:</span><span /><span>{fmt(total)}</span>
                </div>
                {reopening && (
                  <div className="pay-receipt__row">
                    <span>{t('receipt_paid_earlier')}</span><span /><span>{fmt(paidBefore)}</span>
                  </div>
                )}
                {change > 0 && (
                  <div className="pay-receipt__row">
                    <span>{t('change')}</span><span /><span>{fmt(change)}</span>
                  </div>
                )}
              </div>
            </article>
          </div>
        </div>

        <div className="pay-screen__side">
          {/* Способ оплаты — один свёрнутый список, как «смена официанта».
              Раскрывается вниз; строки: наличные, карта, способы из админки, долг. */}
          <div className="pay-screen__control">
            <div className={`wpick ${methodOpen ? 'wpick--open' : ''}`} ref={methodRef}>
              <button
                type="button" className="wpick__trigger"
                aria-haspopup="listbox" aria-expanded={methodOpen}
                onClick={() => setMethodOpen((v) => !v)}
              >
                <span className="wpick__label">{t('z_pay_methods')}</span>
                <span className="wpick__value">
                  <span className="wpick__ico">{currentMethodIcon}</span>
                  {paymentLabel}
                </span>
                <ChevronDown size={18} className="wpick__chev" />
              </button>

              {methodOpen && (
                <div className="wpick__list" role="listbox">
                  {methodOptions.map((option) => {
                    const on = option.value === method
                    return (
                      <button
                        key={option.value} type="button" role="option" aria-selected={on}
                        className={`wpick__opt ${on ? 'wpick__opt--on' : ''}`}
                        onClick={() => pickMethod(option.value)}
                      >
                        <span className="wpick__ico">{option.icon}</span>
                        <span className="wpick__opt-name">{option.label}</span>
                        {on && <Check size={18} />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Возврат в закрытый заказ */}
          {reopening && (
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
          )}

          {onSetWaiter && staff.length > 0 && (
            <div className="pay-screen__control">
              <WaiterPicker
                value={order?.waiter_id || ''}
                staff={staff}
                label={t('change_waiter')}
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
                    type="text" inputMode="numeric" data-keyboard="num"
                    className="pay-dialog__disc-input"
                    value={discPct} disabled={act === 'discount'} placeholder="0"
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

          {method !== 'debt' && !reopening && (
            <div className="pay-screen__control">
              <div className="pay-amount pay-amount--inline">
                <label className="pay-dialog__disc pay-amount__field" htmlFor="pay-amount-input">
                  <span className="pay-dialog__disc-label">
                    {method === 'card' ? t('card_amount') : t('cash_received')}
                  </span>
                  <div className="pay-dialog__disc-row">
                    <input
                      id="pay-amount-input"
                      type="text" inputMode="decimal" data-keyboard="num"
                      className="pay-dialog__disc-input pay-amount__input"
                      value={amount}
                      disabled={busy}
                      placeholder={String(Math.round(dueNow))}
                      onClick={fillDue}
                      onChange={(e) => setAmount(sanitizeDecimal(e.target.value, 2))}
                    />
                    <span className="pay-dialog__disc-unit">{t('currency')}</span>
                  </div>
                </label>
                {(change > 0 || short > 0 || cardOver) && (
                  <div className="pay-amount__hint">
                    {change > 0 && <span className="pay-amount__hint--change">{t('change')}: {fmt(change)} {t('currency')}</span>}
                    {short > 0 && <span className="pay-amount__hint--short">{t('not_enough')}: {fmt(short)} {t('currency')}</span>}
                    {cardOver && <span className="pay-amount__hint--short">{t('payment_card_over_total')}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Главные действия — столбцом: отмена · печать · закрыть. */}
          <div className="pay-screen__actions">
            {onCancel && (
              <button className="btn btn--outline pay-order__cancel btn--eq" onClick={() => onCancel(order)}>
                {t('cancel_order')}
              </button>
            )}
            <button className={`btn btn--outline btn--eq ${printed ? 'is-done' : ''}`} disabled={act === 'print'} onClick={doPrint}>
              {act === 'print' ? spin : printed ? <CheckCircle size={18} /> : <Printer size={18} />} {t('print_receipt')}
            </button>
            <button className="btn btn--primary btn--lg pay-order__close btn--eq" disabled={!canComplete} onClick={doComplete}>
              {busy ? spin : <CheckCircle size={20} />} {t('complete_order')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
