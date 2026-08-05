import { useState, useCallback } from 'react'
import { X, BarChart3, Printer } from 'lucide-react'
import { reports } from '../shared/api'
import { t } from '../shared/i18n'

// Ключ колонки с сервера → ключ словаря
const COL_KEY = {
  name: 'col_name', title: 'col_name', product: 'col_product', staff: 'col_staff', cashier: 'col_cashier',
  count: 'col_count', qty: 'col_count', quantity: 'col_count', dishes_count: 'col_count', orders: 'col_orders', orders_count: 'col_orders',
  total: 'col_sum', amount: 'col_sum', sum: 'col_sum', orders_total: 'col_sum', revenue: 'col_revenue', date: 'col_date',
  service_fee: 'col_service', waiter_share: 'col_share', price: 'col_price', unit: 'col_unit', profit: 'col_profit',
}
function colLabel(c) { return COL_KEY[c] ? t(COL_KEY[c]) : c }

function today() { return new Date().toISOString().slice(0, 10) }
function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)) && /[0-9]/.test(v)) }
function fmtCell(k, v) {
  if (v == null) return '—'
  if (isNum(v) && /total|amount|revenue|sum|price|fee|share|profit|cost/i.test(k)) return Number(v).toLocaleString('ru-RU')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function ReportsPanel({ branch, onClose }) {
  const TABS = [
    { id: 'sales', label: t('rep_sales') },
    { id: 'products', label: t('rep_products') },
    { id: 'staff', label: t('rep_staff') },
  ]
  const [tab, setTab] = useState('sales')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(false)

  const run = useCallback((which) => {
    const active = which || tab
    setTab(active); setLoading(true); setErr(false); setRows(null)
    reports[active]?.({ date_from: from, date_to: to, branch_id: branch?.id })
      .then((d) => {
        const arr = Array.isArray(d) ? d : d?.items || d?.rows || d?.data || (d && typeof d === 'object' ? [d] : [])
        setRows(arr)
      })
      .catch(() => { setErr(true); setRows([]) })
      .finally(() => setLoading(false))
  }, [tab, from, to, branch?.id])

  const cols = rows && rows.length
    ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object' && !/_id$|^id$/i.test(k)).slice(0, 8)
    : []

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal rep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><BarChart3 size={20} /> {t('reports')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="rep-controls">
          <div className="hist-tabs">
            {TABS.map((tb) => (
              <button key={tb.id} className={`filter-chip ${tab === tb.id ? 'filter-chip--active' : ''}`} onClick={() => run(tb.id)}>{tb.label}</button>
            ))}
          </div>
          <div className="rep-dates">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>—</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn btn--primary" onClick={() => run()}>{t('generate')}</button>
          </div>
        </div>

        <div className="modal__body rep-body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('generating')}</p></div>
          ) : rows == null ? (
            <p className="settings-hint">{t('rep_hint')}</p>
          ) : rows.length === 0 ? (
            <p className="settings-hint">{err ? t('rep_unavailable') : t('rep_no_data')}</p>
          ) : (
            <>
              <div className="rep-table-wrap">
                <table className="hist-table">
                  <thead><tr>{cols.map((c) => <th key={c} className={/total|amount|revenue|sum|fee|share|price|profit|cost/i.test(c) ? 'ta-r' : ''}>{colLabel(c)}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>{cols.map((c) => <td key={c} className={/total|amount|revenue|sum|fee|share|price|profit|cost/i.test(c) ? 'ta-r hist-sum' : ''}>{fmtCell(c, r[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn--outline rep-print" onClick={() => window.print()}><Printer size={18} /> {t('print')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
