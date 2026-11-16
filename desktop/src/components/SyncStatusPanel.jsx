import { useCallback, useEffect, useState } from 'react'
import { Printer, RefreshCw, X } from 'lucide-react'
import { t } from '../shared/i18n'
import { toast } from './Toast'

// Панель открывается из пилюли в шапке: показать, что именно не ушло или не
// напечаталось, и дать кассиру повтор без перезапуска терминала.
const OP_KEYS = {
  order_create: 'sync_op_order_create',
  order_add_items: 'sync_op_order_items',
  order_set_qty: 'sync_op_order_qty',
  order_remove_item: 'sync_op_order_remove',
  order_update: 'sync_op_order_update',
  order_status: 'sync_op_order_status',
  order_pay: 'sync_op_order_pay',
  order_totals: 'sync_op_order_totals',
  shift_open: 'sync_op_shift_open',
  shift_close: 'sync_op_shift_close',
}

function timeOf(iso) {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function SyncStatusPanel({ open, onClose, state }) {
  const bridge = typeof window !== 'undefined' ? window.electron?.offline : null
  const [dead, setDead] = useState([])
  const [prints, setPrints] = useState([])
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    if (!bridge) return
    try { setDead(await bridge.deadOps()) } catch { /* панель покажет только счётчики */ }
    try { setPrints(await bridge.printJobs({ status: 'failed' })) } catch { /* то же */ }
  }, [bridge])

  // Состояние ядра меняется после каждой досылки — перечитываем списки, чтобы
  // повисшие операции исчезали из панели сами, без закрытия окна.
  useEffect(() => {
    if (!open) return
    load()
  }, [open, load, state?.pending, state?.dead, state?.printFailed])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  async function run(name, fn) {
    if (busy) return
    setBusy(name)
    try {
      await fn()
    } catch (error) {
      toast(error?.message || t('sync_failed'), 'error')
    } finally {
      setBusy('')
      load()
    }
  }

  const syncNow = () => run('sync', () => bridge?.syncNow?.())
  const retryAll = () => run('retry-all', async () => {
    await bridge?.retryDead?.()
    // Досылка идёт фоном; небольшой паузы хватает, чтобы счётчик успел обновиться.
    await new Promise((resolve) => setTimeout(resolve, 600))
  })
  const retryOp = (op) => run(`op-${op.id}`, async () => {
    await bridge?.retryDead?.(op.id)
    await new Promise((resolve) => setTimeout(resolve, 600))
  })
  const retryPrint = (job) => run(`print-${job.id}`, () => bridge?.retryPrintJob?.(job.id))

  return (
    <div className="sync-panel" role="dialog" aria-modal="true" aria-label={t('sync_title')}>
      <div className="sync-panel__card">
        <header className="sync-panel__head">
          <span className="sync-panel__title">{t('sync_title')}</span>
          <button className="icon-btn" onClick={onClose} disabled={!!busy} aria-label={t('back')}>
            <X size={20} />
          </button>
        </header>

        <div className="sync-panel__rows">
          <div>
            <span>{t('sync_connection')}</span>
            <strong className={state?.online ? 'is-ok' : 'is-bad'}>
              {state?.online ? t('sync_online') : t('offline')}
            </strong>
          </div>
          <div>
            <span>{t('sync_pending')}</span><strong>{state?.pending ?? 0}</strong>
          </div>
          <div>
            <span>{t('sync_dead')}</span>
            <strong className={state?.dead > 0 ? 'is-bad' : ''}>{state?.dead ?? 0}</strong>
          </div>
          <div>
            <span>{t('sync_print_failed')}</span>
            <strong className={state?.printFailed > 0 ? 'is-bad' : ''}>{state?.printFailed ?? 0}</strong>
          </div>
          <div>
            <span>{t('sync_last')}</span><strong>{timeOf(state?.lastSyncAt)}</strong>
          </div>
        </div>

        {state?.lastError && <p className="sync-panel__error">{state.lastError}</p>}

        <div className="sync-panel__actions">
          <button className="btn btn--primary btn--eq" disabled={!!busy} onClick={syncNow}>
            {busy === 'sync' ? <span className="btn-spinner" aria-hidden="true" /> : <RefreshCw size={17} />}
            {t('sync_now')}
          </button>
          {dead.length > 0 && (
            <button className="btn btn--outline btn--eq" disabled={!!busy} onClick={retryAll}>
              {busy === 'retry-all' ? <span className="btn-spinner" aria-hidden="true" /> : <RefreshCw size={17} />}
              {t('sync_retry_all')}
            </button>
          )}
        </div>

        {dead.length > 0 && (
          <section className="sync-panel__section">
            <h4>{t('sync_dead_title')}</h4>
            <ul className="sync-panel__list">
              {dead.map((op) => (
                <li key={op.id}>
                  <div className="sync-panel__item-text">
                    <strong>{op.orderNumber ? `#${op.orderNumber}` : '—'}</strong>
                    <span>{t(OP_KEYS[op.op] || 'sync_op_other')}</span>
                    {op.error && <em>{op.error}</em>}
                  </div>
                  <button
                    className="btn btn--outline btn--sm"
                    disabled={!!busy}
                    onClick={() => retryOp(op)}
                  >
                    {busy === `op-${op.id}` ? <span className="btn-spinner" aria-hidden="true" /> : <RefreshCw size={15} />}
                    {t('sync_retry')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {prints.length > 0 && (
          <section className="sync-panel__section">
            <h4>{t('sync_prints_title')}</h4>
            <ul className="sync-panel__list">
              {prints.map((job) => (
                <li key={job.id}>
                  <div className="sync-panel__item-text">
                    <strong><Printer size={15} /> {job.printerName || t('sync_print_job')}</strong>
                    <span>{timeOf(job.created_at)}</span>
                    {job.error && <em>{job.error}</em>}
                  </div>
                  <button
                    className="btn btn--outline btn--sm"
                    disabled={!!busy}
                    onClick={() => retryPrint(job)}
                  >
                    {busy === `print-${job.id}` ? <span className="btn-spinner" aria-hidden="true" /> : <RefreshCw size={15} />}
                    {t('sync_retry')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
