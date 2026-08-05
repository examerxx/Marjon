import { useState } from 'react'
import { X, Printer, Banknote, CreditCard, CheckCircle } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * PaymentModal — оплата и закрытие СУЩЕСТВУЮЩЕГО заказа (переданного официантом).
 * Кассир: печатает чек → выбирает способ оплаты → закрывает заказ.
 * Оплату (платёжку) интегрируем позже — сейчас способ фиксируется вручную.
 *
 * props:
 *   order — заказ ({ order_number, table_number, items[], total_amount })
 *   onPrint(order) — печать чека (через сетевой принтер)
 *   onComplete(order, method) — закрыть заказ (status → completed)
 *   onClose()
 */
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }

export default function PaymentModal({ order, onPrint, onComplete, onCancel, onReassign, onClose, canClose = true, staff = [], onSetWaiter }) {
  const [method, setMethod] = useState('cash')
  const [received, setReceived] = useState('')
  const [cashPart, setCashPart] = useState('')   // при смешанной оплате
  const [cardPart, setCardPart] = useState('')
  const [busy, setBusy] = useState(false)
  const [printed, setPrinted] = useState(false)

  const total = Number(order?.total_amount || 0)
  const items = order?.items || []
  const change = method === 'cash' && received ? Math.max(0, Number(received) - total) : 0
  const mixedSum = (Number(cashPart) || 0) + (Number(cardPart) || 0)
  const mixedLeft = Math.max(0, total - mixedSum)
  const canComplete = method !== 'mixed' || mixedSum >= total

  async function doPrint() {
    setPrinted(true)
    try { await onPrint(order) } finally { setTimeout(() => setPrinted(false), 1600) }
  }
  async function doComplete() {
    if (busy || !canComplete) return
    setBusy(true)
    const detail = method === 'mixed' ? { cash: Number(cashPart) || 0, card: Number(cardPart) || 0 } : undefined
    try { await onComplete(order, method, detail) } finally { setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pay-order-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{t('pay_order')} #{order?.order_number ?? ''}{order?.table_number ? ` · ${t('table')} ${order.table_number}` : ''}</h3>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        <div className="modal__body">
          <div className="pay-order__items">
            {items.length === 0 ? (
              <p className="settings-hint">{t('order_items')}: —</p>
            ) : items.map((it) => (
              <div className="pay-order__row" key={it.id}>
                <span className="pay-order__qty">{Number(it.quantity)}×</span>
                <span className="pay-order__name">{it.name}</span>
                <span className="pay-order__sum">{fmt(it.total ?? (Number(it.price) * Number(it.quantity)))} {t('currency')}</span>
              </div>
            ))}
          </div>

          <div className="pay-order__total">
            <span>{t('to_pay_label')}</span>
            <strong>{fmt(total)} {t('currency')}</strong>
          </div>

          {onSetWaiter && staff.length > 0 && (
            <div className="pay-order__mixrow" style={{ marginBottom: 12 }}>
              <label>{t('change_waiter')}</label>
              <select className="input" value={order?.waiter_id || ''} onChange={(e) => onSetWaiter(order, e.target.value || null)}>
                <option value="">—</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
              </select>
            </div>
          )}

          <button className={`btn btn--outline pay-order__print ${printed ? 'is-done' : ''}`} onClick={doPrint}>
            {printed ? <CheckCircle size={18} /> : <Printer size={18} />} {t('print_receipt')}
          </button>

          <div className="pay-order__methods pay-order__methods--3">
            <button className={`pay-method-btn ${method === 'cash' ? 'is-active' : ''}`} onClick={() => setMethod('cash')}>
              <Banknote size={26} /><span>{t('cash')}</span>
            </button>
            <button className={`pay-method-btn ${method === 'card' ? 'is-active' : ''}`} onClick={() => setMethod('card')}>
              <CreditCard size={26} /><span>{t('card')}</span>
            </button>
            <button className={`pay-method-btn ${method === 'mixed' ? 'is-active' : ''}`} onClick={() => setMethod('mixed')}>
              <span className="pay-method-btn__mix"><Banknote size={20} /><CreditCard size={20} /></span><span>{t('mixed')}</span>
            </button>
          </div>

          {method === 'cash' && (
            <div className="pay-order__cash">
              <label>{t('cash_received')}</label>
              <input type="number" min="0" className="input" value={received}
                onChange={(e) => setReceived(e.target.value)} placeholder={String(total)} />
              {received !== '' && Number(received) >= total && (
                <div className="pay-order__change"><span>{t('change')}</span><strong>{fmt(change)} {t('currency')}</strong></div>
              )}
            </div>
          )}

          {method === 'mixed' && (
            <div className="pay-order__cash">
              <div className="pay-order__mixrow">
                <label>{t('cash')}</label>
                <input type="number" min="0" className="input" value={cashPart}
                  onChange={(e) => setCashPart(e.target.value)} placeholder="0" />
              </div>
              <div className="pay-order__mixrow">
                <label>{t('card')}</label>
                <input type="number" min="0" className="input" value={cardPart}
                  onChange={(e) => setCardPart(e.target.value)} placeholder="0" />
              </div>
              <div className="pay-order__change">
                <span>{mixedLeft > 0 ? t('to_pay_label') : t('change')}</span>
                <strong>{fmt(mixedLeft > 0 ? mixedLeft : mixedSum - total)} {t('currency')}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="pay-order__actions">
          {onReassign && order?.table_number && (
            <button className="btn btn--outline" disabled={busy} onClick={() => onReassign(order)}>
              {t('move_table')}
            </button>
          )}
          {onCancel && (
            <button className="btn btn--outline pay-order__cancel" disabled={busy} onClick={() => onCancel(order)}>
              {t('cancel_order')}
            </button>
          )}
          <button className="btn btn--primary btn--lg" disabled={busy || !canComplete || !canClose} onClick={doComplete}>
            <CheckCircle size={20} /> {t('complete_order')}
          </button>
        </div>
      </div>
    </div>
  )
}
