import { useState, useEffect, useRef } from 'react'
import { X, ArrowLeft, Printer, Banknote, CreditCard, CheckCircle, Percent, User, Clock, Plus, Phone, MapPin } from 'lucide-react'
import { t } from '../shared/i18n'
import { formatPhone, extractPhoneDigits, fullPhone } from '../shared/phone'
import { formatQty } from '../shared/qty'
import { toast } from './Toast'
import WaiterPicker from './WaiterPicker'

/**
 * PaymentModal — оплата и закрытие СУЩЕСТВУЮЩЕГО заказа (переданного официантом).
 * Кассир: печатает чек → при необходимости даёт скидку → выбирает способ оплаты → закрывает заказ.
 * Оплату (платёжку) интегрируем позже — сейчас способ фиксируется вручную.
 *
 * props:
 *   order — заказ ({ order_number, table_number, items[], total_amount, waiter_id, created_at })
 *   staff — сотрудники (для «кто добавил» и смены официанта)
 *   onPrint(order) — печать чека (через сетевой принтер)
 *   onComplete(order, method) — закрыть заказ (status → completed)
 *   onApplyDiscount(order, amount) — применить скидку к заказу (PATCH /orders)
 *   onSetWaiter(order, waiterId) — сменить ответственного официанта всего заказа (стола)
 *   onSetItemWaiter(order, item, waiterId) — сменить ответственного официанта у ОДНОЙ позиции
 *   onRemoveItems(order, itemIds, onDone) — отменить выбранные позиции с причиной
 *   onAddItems(order) — дозаказ: открыть меню и добавить блюда в этот заказ
 *   onRefreshOrder(order) — живой пересчёт: подтянуть заказ с сервера (сдача считается от серверного итога)
 *   onClose()
 */
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }

export default function PaymentModal({ order, onPrint, onComplete, onCancel, onReassign, onClose, canClose = true, staff = [], onSetWaiter, onSetItemWaiter, onRemoveItems, onApplyDiscount, onAddItems, onRefreshOrder, fullscreen = false }) {
  const [method, setMethod] = useState('cash')
  // Наличные и карта — РАЗНЫЕ суммы (смешанная оплата): у каждого способа своё поле.
  // Закрываем на нал+карту; при недоборе — экран долга на остаток.
  const [cashAmt, setCashAmt] = useState('')
  const [cardAmt, setCardAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const [act, setAct] = useState('')             // какое действие выполняется (для лоадера кнопки)
  const [printed, setPrinted] = useState(false)
  const [discPct, setDiscPct] = useState('')
  const [selectingItems, setSelectingItems] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set())
  const [debtStep, setDebtStep] = useState('none')   // none | form (экран долга)
  const [debtorName, setDebtorName] = useState('')
  const [debtorPhone, setDebtorPhone] = useState('')   // 9 локальных цифр
  const [editAmount, setEditAmount] = useState(false)  // поле суммы раскрыто для правки (иначе — крупные цифры)

  const total = Number(order?.total_amount || 0)
  const items = (order?.items || []).filter((item) => item.status !== 'cancelled')
  const subtotal = items.reduce((s, it) => s + Number(it.total ?? (Number(it.price) * Number(it.quantity))), 0)
  const waiter = staff.find((s) => String(s.id) === String(order?.waiter_id || '')) || null
  const creatorName = waiter ? (waiter.name || waiter.email) : (order?.waiter_name || '—')
  const cashNum = Number(cashAmt) || 0
  const cardNum = Number(cardAmt) || 0
  const hasCash = cashAmt !== ''
  const hasCard = cardAmt !== ''
  const anyEntered = hasCash || hasCard
  const paid = cashNum + cardNum                  // всего внесено (нал + карта)
  const change = Math.max(0, paid - total)        // переплата (сдача с наличных)
  const remaining = Math.max(0, total - paid)     // недобор → в долг
  // Пустые поля = оплата ровно на итог выбранным способом (закрыть можно сразу).
  // Что-то введено и меньше итога → предложим закрыть остаток в долг.
  const canComplete = true

  // Живой пересчёт итога: пока кассир вводит суммы — дебаунсом подтягиваем заказ
  // с сервера (скидки, дозаказы с других терминалов). Ничего не сохраняем, итог всегда
  // от серверной правды. В зависимостях только введённые суммы: обновление order из
  // refresh не должно перезапускать таймер, иначе будет бесконечный цикл.
  const refreshTimer = useRef(null)
  useEffect(() => {
    if (!onRefreshOrder || !order?.id || !anyEntered) return
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => { onRefreshOrder(order) }, 600)
    return () => clearTimeout(refreshTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAmt, cardAmt])

  // Переключение вкладки: у наличных и карты СВОИ суммы (независимы), поэтому просто
  // меняем активный способ и сворачиваем ввод в крупные цифры.
  function pickMethod(next) {
    if (next === method) return
    setMethod(next)
    setEditAmount(false)
  }

  // Любое серверное действие — с лоадером внутри кнопки
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
  // Скидка применяется к самому заказу (сервер пересчитает итог). 0 — снять скидку.
  async function applyDiscount(pct) {
    if (!onApplyDiscount) return
    const amount = Math.round(subtotal * pct / 100)
    await run('discount', async () => {
      try { await onApplyDiscount(order, amount) } catch { toast(t('create_order_error')) }
    })
  }
  async function doComplete() {
    if (busy || !canComplete) return
    // Введено меньше итога — открываем экран долга на остаток (без лишних шагов).
    if (anyEntered && remaining > 0) { setDebtStep('form'); return }
    setBusy(true)
    // Способ и разбивка: нал+карта → mixed; иначе конкретный способ.
    // Пустые поля — оплата ровно на итог активным способом (detail не шлём).
    let payMethod = method
    let detail
    if (anyEntered) {
      const parts = {}
      if (cashNum > 0) parts.cash = cashNum
      if (cardNum > 0) parts.card = cardNum
      payMethod = cashNum > 0 && cardNum > 0 ? 'mixed' : cardNum > 0 ? 'card' : 'cash'
      detail = Object.keys(parts).length ? parts : undefined
    }
    try { await onComplete(order, payMethod, detail) } finally { setBusy(false) }
  }
  // Закрытие в долг с экрана долга: внесено (нал+карта) + остаток + имя и телефон клиента
  async function doDebtComplete() {
    if (busy) return
    setBusy(true)
    const detail = {
      cash: cashNum, card: cardNum || undefined, debt: remaining,
      client_name: debtorName.trim() || undefined,
      client_phone: fullPhone(debtorPhone) || undefined,
    }
    try { await onComplete(order, 'debt', detail) } finally { setBusy(false) }
  }
  function closeDebt() { setDebtStep('none') }
  function toggleItem(itemId) {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }
  function stopSelecting() {
    setSelectingItems(false)
    setSelectedItemIds(new Set())
  }
  function removeSelectedItems() {
    if (!onRemoveItems || selectedItemIds.size === 0) return
    onRemoveItems(order, [...selectedItemIds], stopSelecting)
  }
  const spin = <span className="btn-spinner" aria-hidden="true" />

  // fullscreen — заход в стол на кассе открывает ЭКРАН, а не модалку поверх пола.
  return (
    <div className={fullscreen ? 'pay-screen' : 'modal-overlay'} onClick={fullscreen ? undefined : onClose}>
      <div className={fullscreen ? 'pay-screen__panel pay-order-modal' : 'modal pay-order-modal'} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          {/* На полном экране (заход в стол) нужна явная «Назад» с подписью — так удобнее
              попасть пальцем: экран долга → к оплате, экран оплаты → к столам. */}
          {fullscreen && (
            <button className="btn btn--outline btn--lg pay-order__back" onClick={debtStep === 'form' ? closeDebt : onClose}>
              <ArrowLeft size={22} /> {t('back')}
            </button>
          )}
          <h3>{debtStep === 'form' ? t('debt_title') : t('pay_order')} #{order?.order_number ?? ''}{order?.table_number ? ` · ${t('table')} ${order.table_number}` : ''}</h3>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="modal__body">
          {debtStep === 'form' ? (
          /* Экран долга на весь экран: цифры + имя и телефон клиента сразу */
          <div className="pay-order__cash">
            <div className="pay-order__change"><span>{t('to_pay_label')}</span><strong>{fmt(total)} {t('currency')}</strong></div>
            <div className="pay-order__change"><span>{t('cash_received')}</span><strong>{fmt(cashNum)} {t('currency')}</strong></div>
            {cardNum > 0 && (
              <div className="pay-order__change"><span>{t('card')}</span><strong>{fmt(cardNum)} {t('currency')}</strong></div>
            )}
            <div className="pay-order__change pay-order__change--short"><span>{t('debt_left')}</span><strong>{fmt(remaining)} {t('currency')}</strong></div>
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
          ) : (
          <>
          {/* Две колонки: слева состав заказа, справа «касса» — итог, скидка,
              способ оплаты и сдача. На узком экране колонки складываются в одну. */}
          <div className="pay-order__cols">
            <div className="pay-order__col pay-order__col--items">
              {/* Кто и когда добавил заказ */}
              <div className="pay-order__meta">
                <span><User size={15} /> {creatorName}</span>
                {order?.created_at && <span><Clock size={15} /> {fmtTime(order.created_at)}</span>}
                {/* Доставка: номер и адрес, введённые курьером/кассиром при создании заказа */}
                {order?.customer_phone && <span><Phone size={15} /> {formatPhone(order.customer_phone)}</span>}
                {order?.customer_address && <span><MapPin size={15} /> {order.customer_address}</span>}
              </div>

              {onRemoveItems && items.length > 0 && (
                <div className="pay-order__selection-bar">
                  {selectingItems ? (
                    <>
                      <span>{t('dishes_selected')}: <strong>{selectedItemIds.size}</strong></span>
                      <button type="button" className="btn btn--outline" onClick={stopSelecting}>{t('cancel')}</button>
                      <button type="button" className="btn btn--outline pay-order__remove-selected" disabled={selectedItemIds.size === 0} onClick={removeSelectedItems}>
                        {t('cancel_selected_dishes')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--outline" onClick={() => setSelectingItems(true)}>
                      {t('select_dishes_to_cancel')}
                    </button>
                  )}
                </div>
              )}

              <div className="pay-order__items">
                {items.length === 0 ? (
                  <p className="settings-hint">{t('order_items')}: —</p>
                ) : items.map((it) => {
                  const selected = selectedItemIds.has(it.id)
                  return (
                  <div className={`pay-order__row ${selected ? 'pay-order__row--selected' : ''}`} key={it.id}>
                    {selectingItems && (
                      <button type="button" className="pay-order__select" role="checkbox" aria-checked={selected} aria-label={`${t('select_dish')} ${it.name}`} onClick={() => toggleItem(it.id)}>
                        {selected && <CheckCircle size={20} />}
                      </button>
                    )}
                    <span className="pay-order__qty">{formatQty(it.quantity)}×</span>
                    <span className="pay-order__name">
                      {it.name}
                      {it.takeaway && <span className="pay-order__take">{t('takeaway')}</span>}
                      {(it.created_at || it.added_by_name || it.waiter_name) && (
                        <span className="pay-order__added">
                          {it.created_at ? fmtTime(it.created_at) : ''}
                          {(it.added_by_name || it.waiter_name) ? `${it.created_at ? ' · ' : ''}${it.added_by_name || it.waiter_name}` : ''}
                        </span>
                      )}
                    </span>
                    <span className="pay-order__sum">{fmt(it.total ?? (Number(it.price) * Number(it.quantity)))} {t('currency')}</span>
                    {/* Кассир правит ответственного официанта у конкретного блюда (доля обслуги идёт по нему).
                        Своей строкой на всю ширину — внутри .pay-order__name список обрезался бы overflow. */}
                    {onSetItemWaiter && staff.length > 0 && !selectingItems && (
                      <div className="pay-order__waiter">
                        <WaiterPicker value={it.added_by} staff={staff}
                          disabled={act === `item-waiter-${it.id}`}
                          onChange={(waiterId) => run(`item-waiter-${it.id}`, () => onSetItemWaiter(order, it, waiterId))} />
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>

            <div className="pay-order__col pay-order__col--pay">
              <div className="pay-order__total">
                <span>{t('to_pay_label')}</span>
                <strong>{fmt(total)} {t('currency')}</strong>
              </div>

              {Number(order?.discount_amount) > 0 && (
                <div className="pay-order__change pay-order__change--discount">
                  <span>{t('discount_word')}</span>
                  <strong>−{fmt(order.discount_amount)} {t('currency')}</strong>
                </div>
              )}

              {onApplyDiscount && (
                <div className="pay-order__mixrow pay-order__discount">
                  <label><Percent size={14} /> {t('discount_word')}</label>
                  <input type="number" min="0" max="100" className="input" value={discPct} disabled={act === 'discount'}
                    onChange={(e) => setDiscPct(e.target.value)} placeholder="0"
                    onBlur={() => { const p = Math.min(100, Math.max(0, Number(discPct) || 0)); setDiscPct(p ? String(p) : ''); applyDiscount(p) }} />
                  {act === 'discount' && spin}
                </div>
              )}

              {onSetWaiter && staff.length > 0 && (
                <div className="pay-order__waiter pay-order__waiter--order">
                  <WaiterPicker value={order?.waiter_id || ''} staff={staff} label={t('change_waiter')}
                    disabled={act === 'waiter'}
                    onChange={(waiterId) => run('waiter', () => onSetWaiter(order, waiterId || null))} />
                  {act === 'waiter' && spin}
                </div>
              )}

              <button className={`btn btn--outline pay-order__print ${printed ? 'is-done' : ''}`} disabled={act === 'print'} onClick={doPrint}>
                {act === 'print' ? spin : printed ? <CheckCircle size={18} /> : <Printer size={18} />} {t('print_receipt')}
              </button>

              <div className="pay-order__methods">
                <button className={`pay-method-btn ${method === 'cash' ? 'is-active' : ''}`} onClick={() => pickMethod('cash')}>
                  <Banknote size={26} /><span>{t('cash')}</span>
                </button>
                <button className={`pay-method-btn ${method === 'card' ? 'is-active' : ''}`} onClick={() => pickMethod('card')}>
                  <CreditCard size={26} /><span>{t('card')}</span>
                </button>
              </div>

              {/* Наличные: своё поле. Пустое = оплата ровно на итог (можно закрыть сразу).
                  Ввёл сумму — сворачивается в крупные цифры рядом с «Получено», клик снова
                  открывает ввод. Плейсхолдер — сколько осталось после карты (если её вносили). */}
              {method === 'cash' && (
                <div className="pay-order__cash">
                  <div className="pay-order__cash-head">
                    <label>{t('cash_received')}</label>
                    {hasCash && !editAmount && (
                      <button type="button" className="pay-order__amount" onClick={() => setEditAmount(true)}>
                        {fmt(cashNum)} {t('currency')}
                      </button>
                    )}
                  </div>
                  {(!hasCash || editAmount) && (
                    <input type="number" min="0" step="any" className="input" value={cashAmt} autoFocus={editAmount}
                      onFocus={() => setEditAmount(true)}
                      onChange={(e) => setCashAmt(e.target.value)}
                      onBlur={() => { if (cashAmt !== '') setEditAmount(false) }} placeholder={String(Math.max(0, total - cardNum))} />
                  )}
                </div>
              )}

              {/* Карта: своё поле, независимое от наличных. Пустое = списать остаток на
                  терминале; ввёл сумму — сворачивается в цифры рядом с подписью. */}
              {method === 'card' && (
                <div className="pay-order__cash">
                  <div className="pay-order__cash-head">
                    <label>{t('card_amount')}</label>
                    {hasCard && !editAmount && (
                      <button type="button" className="pay-order__amount" onClick={() => setEditAmount(true)}>
                        {fmt(cardNum)} {t('currency')}
                      </button>
                    )}
                  </div>
                  {(!hasCard || editAmount) && (
                    <input type="number" min="0" step="any" className="input" value={cardAmt} autoFocus={editAmount}
                      onFocus={() => setEditAmount(true)}
                      onChange={(e) => setCardAmt(e.target.value)}
                      onBlur={() => { if (cardAmt !== '') setEditAmount(false) }} placeholder={String(Math.max(0, total - cashNum))} />
                  )}
                  <p className="settings-hint">{t('card_hint')}</p>
                </div>
              )}

              {/* Итог оплаты: сколько наличными, сколько картой (смешанная оплата),
                  сдача при переплате или остаток к долгу. Виден на любой вкладке. */}
              {anyEntered && (
                <div className="pay-order__split">
                  {cashNum > 0 && (
                    <div className="pay-order__change"><span>{t('cash')}</span><strong>{fmt(cashNum)} {t('currency')}</strong></div>
                  )}
                  {cardNum > 0 && (
                    <div className="pay-order__change"><span>{t('card')}</span><strong>{fmt(cardNum)} {t('currency')}</strong></div>
                  )}
                  {change > 0 && (
                    <div className="pay-order__change"><span>{t('change')}</span><strong>{fmt(change)} {t('currency')}</strong></div>
                  )}
                  {remaining > 0 && (
                    <div className="pay-order__change pay-order__change--short"><span>{t('not_enough')}</span><strong>{fmt(remaining)} {t('currency')}</strong></div>
                  )}
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </div>

        <div className="pay-order__actions">
          {debtStep === 'form' ? (
          <>
            <button className="btn btn--outline" onClick={closeDebt}>{t('back')}</button>
            <button className="btn btn--primary btn--lg" disabled={busy} onClick={doDebtComplete}>
              {busy ? spin : <CheckCircle size={20} />} {t('debt_close')}
            </button>
          </>
          ) : (
          <>
          {onAddItems && (
            <button className="btn btn--outline" onClick={() => onAddItems(order)}>
              <Plus size={18} /> {t('add_dishes')}
            </button>
          )}
          {onReassign && order?.table_number && (
            <button className="btn btn--outline" onClick={() => onReassign(order)}>
              {t('move_table')}
            </button>
          )}
          {onCancel && (
            <button className="btn btn--outline pay-order__cancel" onClick={() => onCancel(order)}>
              {t('cancel_order')}
            </button>
          )}
          <button className="btn btn--primary btn--lg pay-order__close" disabled={busy || !canComplete || !canClose} onClick={doComplete}>
            {busy ? spin : <CheckCircle size={20} />} {t('complete_order')}
          </button>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
