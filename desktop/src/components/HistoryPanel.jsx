import { useState, useEffect, useCallback } from 'react'
import { X, History } from 'lucide-react'
import { orders } from '../shared/api'
import { t } from '../shared/i18n'

function fmtDt(iso) { return iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '' }

export default function HistoryPanel({ branch, onClose }) {
  const TYPES = [
    { id: 'all', label: t('all') },
    { id: 'dine_in', label: t('dine_in') },
    { id: 'takeaway', label: t('takeaway') },
    { id: 'delivery', label: t('delivery') },
  ]
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('all')

  const load = useCallback(() => {
    setLoading(true)
    orders.list({ branch_id: branch?.id })
      .then((d) => setRows(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [branch?.id])
  useEffect(load, [load])

  const shown = type === 'all' ? rows : rows.filter((o) => o.order_type === type)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal hist-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><History size={20} /> {t('hist_title')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="hist-tabs">
          {TYPES.map((ty) => (
            <button key={ty.id} className={`filter-chip ${type === ty.id ? 'filter-chip--active' : ''}`} onClick={() => setType(ty.id)}>{ty.label}</button>
          ))}
        </div>

        <div className="modal__body hist-body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('loading')}</p></div>
          ) : shown.length === 0 ? (
            <p className="settings-hint">{t('no_orders_found')}</p>
          ) : (
            <table className="hist-table">
              <thead>
                <tr><th>{t('col_no')}</th><th>{t('col_type')}</th><th>{t('col_table')}</th><th>{t('col_status')}</th><th>{t('col_time')}</th><th className="ta-r">{t('col_sum')}</th></tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td className="hist-num">#{o.order_number ?? '—'}</td>
                    <td>{o.order_type ? t.type(o.order_type) : '—'}</td>
                    <td>{o.table_number || '—'}</td>
                    <td><span className={`hist-status hist-status--${o.status}`}>{t.status(o.status)}</span></td>
                    <td className="hist-date">{fmtDt(o.created_at)}</td>
                    <td className="ta-r hist-sum">{Number(o.total_amount || 0).toLocaleString('ru-RU')} {t('currency')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
