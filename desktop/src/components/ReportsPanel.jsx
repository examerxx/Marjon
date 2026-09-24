import { useState, useCallback, useEffect } from 'react'
import { X, BarChart3, Printer } from 'lucide-react'
import { reports, printers as printersApi } from '../shared/api'
import { t } from '../shared/i18n'
import CalendarField from './CalendarField'
import CustomSelect from './CustomSelect'
import { must } from '../shared/permissions'
import { toast } from './Toast'

// Ключ колонки с сервера → ключ словаря
const COL_KEY = {
  name: 'col_name', title: 'col_name', product: 'col_product', staff: 'col_staff', cashier: 'col_cashier',
  count: 'col_count', qty: 'col_count', quantity: 'col_count', dishes_count: 'col_count', orders: 'col_orders', orders_count: 'col_orders',
  total: 'col_sum', amount: 'col_sum', sum: 'col_sum', orders_total: 'col_sum', revenue: 'col_revenue', date: 'col_date',
  service_fee: 'col_service', waiter_share: 'col_share', price: 'col_price', unit: 'col_unit', profit: 'col_profit',
  // Продажи (список заказов)
  order_number: 'col_order_no', created_at: 'col_created', status: 'col_status', table_number: 'col_table',
  waiter_name: 'col_waiter', items_count: 'col_items', total_amt: 'col_sum', total_amount: 'col_sum',
  discount_amount: 'col_discount', payment_method: 'col_pay_method', order_type: 'col_type', avg_check: 'col_avg',
}
function colLabel(c) { return COL_KEY[c] ? t(COL_KEY[c]) : c }

// Z-отчёт: строки показателей (метка-ключ словаря → поле ответа сервера)
const Z_FIN = [
  ['z_gross', 'gross_sales'], ['z_discounts', 'discounts_total'], ['z_service', 'service_fee_total'],
  ['z_tax', 'tax_total'], ['z_refunds', 'refunds_total'], ['z_net', 'net_sales'],
  ['z_cash', 'cash_total'], ['z_cash_received', 'cash_received_total'], ['z_change', 'change_given_total'],
  ['z_non_cash', 'non_cash_total'], ['z_avg', 'avg_check'],
]
const Z_CNT = [
  ['z_orders', 'orders_count'], ['z_cancelled', 'cancelled_orders_count'],
  ['z_payments', 'payments_count'], ['z_fiscal', 'fiscal_receipts_count'],
]

function today() { return new Date().toISOString().slice(0, 10) }
function isNum(v) { return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)) && /[0-9]/.test(v)) }
function fmtCell(k, v) {
  if (v == null || v === '') return '—'
  if (k === 'status') return t.status(String(v))
  if (k === 'order_type') return t.type(String(v))
  // Даты вида 2026-08-05T17:41:00 → 05.08 17:41
  if (/_at$|^date/.test(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v)
    if (!isNaN(d)) {
      const dm = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      return v.includes('T') || v.includes(' ') ? `${dm} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : dm
    }
  }
  if (isNum(v) && /total|amount|revenue|sum|price|fee|share|profit|cost/i.test(k)) return Number(v).toLocaleString('ru-RU')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function ReportsPanel({ branch, user, onClose }) {
  // Вкладка Z-отчёта — только у кого право явно выдано в админке
  // (тумблер «Z-отчёт», permissions.can_view_z_report). Остальным бэкенд
  // всё равно отдаст 403 — вкладку прячем, чтобы не упираться в ошибку.
  const TABS = [
    { id: 'products', label: t('rep_products') },
    { id: 'staff', label: t('rep_staff') },
    ...(must(user, 'can_view_z_report') ? [{ id: 'z', label: t('rep_z') }] : []),
  ]
  const [tab, setTab] = useState('products')
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState(null)
  const [zData, setZData] = useState(null)   // структурированный Z-отчёт (своя форма, не таблица)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(false)
  const [filter, setFilter] = useState('')   // клиентский фильтр по названию (блюдо/сотрудник)

  // Чековый принтер филиала — тот же поиск, что у кассира (для общего чека)
  const [receiptPrinter, setReceiptPrinter] = useState(null)
  useEffect(() => {
    printersApi.list()
      .then((list) => setReceiptPrinter((Array.isArray(list) ? list : []).find((p) => p.printer_type === 'receipt' && p.branch_id === branch?.id) || null))
      .catch(() => setReceiptPrinter(null))
  }, [branch?.id])

  const run = useCallback((which) => {
    const active = which || tab
    setTab(active); setLoading(true); setErr(false); setRows(null); setZData(null); setFilter('')
    // Z-отчёт — свой эндпоинт (день или период) и своя форма ответа
    const req = active === 'z'
      ? reports.zReport(from, to).then((d) => setZData(d))
      : reports[active]?.({ date_from: from, date_to: to, branch_id: branch?.id })
          .then((d) => {
            const arr = Array.isArray(d) ? d : d?.items || d?.rows || d?.data || (d && typeof d === 'object' ? [d] : [])
            setRows(arr)
          })
    Promise.resolve(req)
      .catch((e) => {
        // Ошибка видна всегда: и в таблице, и тостом с причиной
        setErr(true); setRows([])
        const detail = e?.response?.data?.detail || e?.message
        toast(detail ? `${t('rep_error')}: ${detail}` : t('rep_error'))
      })
      .finally(() => setLoading(false))
  }, [tab, from, to, branch?.id])

  const cols = rows && rows.length
    ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object' && !/_id$|^id$/i.test(k)).slice(0, 8)
    : []

  // Колонка с названием (блюдо/сотрудник) для фильтра
  const nameCol = cols.find((c) => /name|title|product|staff|cashier|waiter/i.test(c)) || cols[0]
  // Уникальные названия из отчёта — пункты выпадающего фильтра «по определённому блюду/сотруднику»
  const nameOptions = nameCol
    ? [...new Set((rows || []).map((r) => String(r[nameCol] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'))
    : []
  // filter хранит точное выбранное название ('' = показать все)
  const shown = (rows || []).filter((r) => {
    if (!filter || !nameCol) return true
    return String(r[nameCol] ?? '').trim() === filter
  })

  function fmtDate(isoStr) {
    if (!isoStr) return ''
    const [y, m, d] = isoStr.split('-')
    return `${d}.${m}.${y}`
  }

  // Общий чек: текущая таблица отчёта → строки → чековый принтер
  async function printSummary() {
    if (!shown?.length) return
    if (!receiptPrinter) { toast(t('no_receipt_printer')); return }
    const nameC = nameCol || cols[0]
    const sumCol = cols.find((c) => /total|amount|revenue|sum/i.test(c))
    const lines = shown.map((r) => {
      const name = String(r[nameC] ?? '—')
      return sumCol ? `${name} — ${Number(r[sumCol] || 0).toLocaleString('ru-RU')}` : name
    })
    const footer = sumCol
      ? `${t('total')}: ${shown.reduce((s, r) => s + (Number(r[sumCol]) || 0), 0).toLocaleString('ru-RU')} ${t('currency')}`
      : `${t('total')}: ${shown.length}`
    const label = TABS.find((x) => x.id === tab)?.label || t('reports')
    try {
      await printersApi.printSummary({
        printer_id: receiptPrinter.id,
        title: label,
        lines: [`${fmtDate(from)} — ${fmtDate(to)}`, ...lines],
        footer,
        copies: 1,
      })
      toast(t('receipt_sent'), 'ok')
    } catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : '')) }
  }

  // Печать Z-отчёта на чековом принтере: показатели + разбивка по оплатам
  async function printZReport() {
    if (!zData) return
    if (!receiptPrinter) { toast(t('no_receipt_printer')); return }
    const money = (v) => Number(v || 0).toLocaleString('ru-RU')
    const lines = [
      ...Z_FIN.map(([label, key]) => `${t(label)} — ${money(zData[key])}`),
      ...Z_CNT.map(([label, key]) => `${t(label)} — ${zData[key] ?? 0}`),
      `${t('z_pay_methods')}:`,
      ...((zData.payment_methods || []).map((m) => `  ${m.method} ×${m.count} — ${money(m.amount)}`)),
    ]
    try {
      await printersApi.printSummary({
        printer_id: receiptPrinter.id,
        title: `${t('rep_z')} · ${fmtDate(from)}${from !== to ? ` — ${fmtDate(to)}` : ''}`,
        lines,
        footer: `${t('z_net')}: ${money(zData.net_sales)} ${t('currency')}`,
        copies: 1,
      })
      toast(t('receipt_sent'), 'ok')
    } catch (e) { toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : '')) }
  }

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
            <CalendarField value={from} onChange={setFrom} />
            <span>—</span><CalendarField value={to} onChange={setTo} />
            <button className="btn btn--primary" onClick={() => run()}>{t('generate')}</button>
          </div>
          {/* Селект показываем, как только в отчёте есть хоть одно имя: в отчёте по
              сотрудникам часто одна строка, а фильтр всё равно должен быть виден */}
          {tab !== 'z' && nameOptions.length > 0 && (
            <CustomSelect
              className="rep-filter"
              value={filter}
              onChange={setFilter}
              placeholder={tab === 'staff' ? t('rep_all_staff') : t('rep_all_dishes')}
              options={[
                { value: '', label: tab === 'staff' ? t('rep_all_staff') : t('rep_all_dishes') },
                ...nameOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          )}
        </div>

        <div className="modal__body rep-body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /><p>{t('generating')}</p></div>
          ) : tab === 'z' ? (
            zData == null ? (
              <p className="settings-hint">{err ? t('rep_unavailable') : t('rep_hint')}</p>
            ) : (
              <div className="z-report">
                <div className="z-report__head">
                  <div className="z-report__meta">
                    <span>{t('col_date')}: <strong>{fmtDate(from)}{from !== to ? ` — ${fmtDate(to)}` : ''}</strong></span>
                    <span>{t('z_closed')}: <strong>{zData.is_closed ? t('z_yes') : t('z_no')}</strong></span>
                    <span>{t('z_shift_open')}: <strong>{zData.shift_opened_at || '—'}</strong></span>
                    <span>{t('z_shift_close')}: <strong>{zData.shift_closed_at || '—'}</strong></span>
                  </div>
                  <button className="btn btn--outline" onClick={printZReport}><Printer size={18} /> {t('z_print')}</button>
                </div>
                <div className="rep-table-wrap">
                  <table className="hist-table">
                    <tbody>
                      {Z_FIN.map(([label, key]) => (
                        <tr key={key}><td>{t(label)}</td><td className="ta-r hist-sum">{Number(zData[key] || 0).toLocaleString('ru-RU')} {t('currency')}</td></tr>
                      ))}
                      {Z_CNT.map(([label, key]) => (
                        <tr key={key}><td>{t(label)}</td><td className="ta-r">{zData[key] ?? 0}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rep-table-wrap">
                  <table className="hist-table">
                    <thead><tr><th>{t('z_method')}</th><th className="ta-r">{t('z_count')}</th><th className="ta-r">{t('z_amount')}</th></tr></thead>
                    <tbody>
                      {(zData.payment_methods || []).length === 0 ? (
                        <tr><td colSpan={3}>{t('z_no_data')}</td></tr>
                      ) : zData.payment_methods.map((m) => (
                        <tr key={m.method}><td>{m.method}</td><td className="ta-r">{m.count}</td><td className="ta-r hist-sum">{Number(m.amount || 0).toLocaleString('ru-RU')} {t('currency')}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : rows == null ? (
            <p className="settings-hint">{t('rep_hint')}</p>
          ) : rows.length === 0 ? (
            <p className="settings-hint">{err ? t('rep_unavailable') : t('rep_no_data')}</p>
          ) : shown.length === 0 ? (
            <p className="settings-hint">{t('nothing_found')}</p>
          ) : (
            <>
              <div className="rep-table-wrap">
                <table className="hist-table">
                  <thead><tr>{cols.map((c) => <th key={c} className={/total|amount|revenue|sum|fee|share|price|profit|cost/i.test(c) ? 'ta-r' : ''}>{colLabel(c)}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i}>{cols.map((c) => <td key={c} className={/total|amount|revenue|sum|fee|share|price|profit|cost/i.test(c) ? 'ta-r hist-sum' : ''}>{fmtCell(c, r[c])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn btn--outline rep-print" onClick={printSummary}><Printer size={18} /> {t('print_summary')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
