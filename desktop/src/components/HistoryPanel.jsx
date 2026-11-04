import { useState, useEffect, useCallback } from 'react'
import { X, History, Printer, Undo2 } from 'lucide-react'
import { orders, printers as printersApi } from '../shared/api'
import { pickReceiptPrinter } from '../shared/printers'
import { t } from '../shared/i18n'
import { fmtDateTime } from '../shared/time'
import { toast } from './Toast'

export default function HistoryPanel({ branch, printerId, onReopen, onClose }) {
  const TYPES = [
    { id: 'all', label: t('all') },
    { id: 'dine_in', label: t('dine_in') },
    { id: 'takeaway', label: t('takeaway') },
    { id: 'delivery', label: t('delivery') },
  ]
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('all')

  // Чековый принтер филиала — для печати общего чека по списку
  const [receiptPrinter, setReceiptPrinter] = useState(null)
  useEffect(() => {
    printersApi.list()
      .then((list) => setReceiptPrinter(pickReceiptPrinter(list, { printerId })))
      .catch(() => setReceiptPrinter(null))
  }, [printerId])

  const load = useCallback(() => {
    setLoading(true)
    orders.list({ branch_id: branch?.id })
      .then((d) => setRows(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [branch?.id])
  useEffect(load, [load])

  const shown = type === 'all' ? rows : rows.filter((o) => o.order_type === type)

  // Общий чек: список заказов текущего фильтра → строки → чековый принтер
  async function printSummary() {
    if (!shown.length) return
    if (!receiptPrinter) { toast(t('no_receipt_printer')); return }
    const lines = shown.map((o) => {
      const where = o.table_number ? `${t('table')} ${o.table_number}` : t.type(o.order_type)
      return `#${o.order_number ?? '—'} ${where}`
    })
    try {
      await printersApi.printSummary({
        printer_id: receiptPrinter.id,
        title: t('hist_title'),
        lines,
        footer: `${t('total')}: ${shown.length}`,
        copies: 1,
      })
      toast(t('receipt_sent'), 'ok')
    } catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : '')) }
  }

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
                <tr>
                  <th>{t('col_no')}</th><th>{t('col_type')}</th><th>{t('col_table')}</th>
                  <th>{t('col_status')}</th><th>{t('col_time')}</th>
                  {onReopen && <th />}
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td className="hist-num">#{o.order_number ?? '—'}</td>
                    <td>{o.order_type ? t.type(o.order_type) : '—'}</td>
                    <td>{o.table_number || '—'}</td>
                    <td><span className={`hist-status hist-status--${o.status}`}>{t.status(o.status)}</span></td>
                    <td className="hist-date">{fmtDateTime(o.created_at)}</td>
                    {/* Закрытый заказ можно вернуть в работу: гость вернул блюдо —
                        отменяем позицию с причиной, отдаём сдачу и закрываем снова. */}
                    {onReopen && (
                      <td>
                        {o.status === 'completed' ? (
                          <button type="button" className="btn btn--outline btn--sm hist-reopen" onClick={() => onReopen(o)}>
                            <Undo2 size={16} /> {t('reopen_order')}
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && shown.length > 0 && (
            <button className="btn btn--outline rep-print" onClick={printSummary}><Printer size={18} /> {t('print_summary')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
