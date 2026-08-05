import { useState, useEffect, useCallback } from 'react'
import { X, Wallet, TrendingUp, TrendingDown, Play, Square } from 'lucide-react'
import { shifts as shiftsApi, finance } from '../shared/api'
import { t } from '../shared/i18n'

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
function fmtDt(iso) { return iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' }

export default function FinancePanel({ branch, onClose }) {
  const [shift, setShift] = useState(null)
  const [txs, setTxs] = useState([])
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [cash, setCash] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    shiftsApi.current(branch?.id).then((d) => setShift(d && d.id ? d : null)).catch(() => setShift(null))
    finance.incomeExpense({ size: 30 }).then((d) => setTxs(Array.isArray(d) ? d : d?.items || [])).catch(() => setTxs([]))
  }, [branch?.id])
  useEffect(load, [load])

  async function openShift() {
    setBusy(true)
    try { await shiftsApi.open(branch?.id, Number(cash) || 0); setCash(''); load() }
    catch (e) { alert(e.response?.data?.detail || t('shift_open_err')) }
    finally { setBusy(false) }
  }
  async function closeShift() {
    setBusy(true)
    try { await shiftsApi.close(Number(cash) || 0); setCash(''); load() }
    catch (e) { alert(e.response?.data?.detail || t('shift_close_err')) }
    finally { setBusy(false) }
  }
  async function add(kind) {
    const amt = Number(amount)
    if (!amt || amt <= 0) return
    setBusy(true)
    try {
      await (kind === 'income' ? finance.addIncome : finance.addExpense)({ amount: amt, comment: comment || null })
      setAmount(''); setComment(''); load()
    } catch (e) { alert(e.response?.data?.detail || t('op_err')) }
    finally { setBusy(false) }
  }

  const isOpen = shift && shift.status === 'open'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal fin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><Wallet size={20} /> {t('fin_title')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="modal__body">
          {/* Смена */}
          <section className="settings-section">
            <h3>{t('shift')}</h3>
            {isOpen ? (
              <>
                <div className="settings-row"><span>{t('status')}</span><span className="fin-badge fin-badge--open">{t('fin_status_open')}</span></div>
                <div className="settings-row"><span>{t('opened_label')}</span><span>{fmtDt(shift.opened_at)}</span></div>
                <div className="settings-row"><span>{t('cash_start_bal')}</span><span>{fmt(shift.opening_cash)} {t('currency')}</span></div>
                <div className="settings-row settings-row--col">
                  <label>{t('cash_end')}</label>
                  <div className="settings-input-group">
                    <input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} className="input" placeholder="0" />
                    <button className="btn btn--danger" disabled={busy} onClick={closeShift}><Square size={18} /> {t('close_shift')}</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="settings-row settings-row--col">
                <label>{t('cash_start_input')}</label>
                <div className="settings-input-group">
                  <input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} className="input" placeholder="0" />
                  <button className="btn btn--primary" disabled={busy} onClick={openShift}><Play size={18} /> {t('open_shift')}</button>
                </div>
              </div>
            )}
          </section>

          {/* Приход / расход */}
          <section className="settings-section">
            <h3>{t('income_expense')}</h3>
            <div className="fin-form">
              <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" placeholder={t('amount_sum')} />
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} className="input" placeholder={t('comment')} />
            </div>
            <div className="fin-actions">
              <button className="btn fin-btn fin-btn--in" disabled={busy} onClick={() => add('income')}><TrendingUp size={18} /> {t('income')}</button>
              <button className="btn fin-btn fin-btn--out" disabled={busy} onClick={() => add('expense')}><TrendingDown size={18} /> {t('expense')}</button>
            </div>
          </section>

          {/* История операций */}
          <section className="settings-section">
            <h3>{t('recent_ops')}</h3>
            {txs.length === 0 ? (
              <p className="settings-hint">{t('no_ops')}</p>
            ) : (
              <div className="fin-list">
                {txs.map((tx) => (
                  <div className="fin-row" key={tx.id}>
                    <span className={`fin-row__dir fin-row__dir--${tx.direction}`}>
                      {tx.direction === 'income' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    </span>
                    <div className="fin-row__info">
                      <span className="fin-row__cat">{tx.comment || tx.category_name || (tx.direction === 'income' ? t('income') : t('expense'))}</span>
                      <span className="fin-row__date">{fmtDt(tx.date)}</span>
                    </div>
                    <span className={`fin-row__amt fin-row__amt--${tx.direction}`}>
                      {tx.direction === 'income' ? '+' : '−'}{fmt(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
