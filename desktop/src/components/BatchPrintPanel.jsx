import { useState, useEffect } from 'react'
import { X, Printer, Users, FileText, Package, ClipboardList } from 'lucide-react'
import { auth, menu, warehouse, printers as printersApi } from '../shared/api'
import { t } from '../shared/i18n'
import { toast } from './Toast'

// Ограниченная параллельность: техкарты тянутся по одной (bulk-эндпоинта нет),
// поэтому не заваливаем бэкенд — обрабатываем список блюд чанками.
async function mapLimit(items, limit, fn) {
  const out = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)))
  }
  return out
}

const asItems = (raw) => (Array.isArray(raw) ? raw : raw?.items || [])
const fmtMoney = (x) => Number(x || 0).toLocaleString('ru-RU')

/**
 * BatchPrintPanel — пакетная печать сводок на чековом принтере филиала.
 * Переехала из удалённой панели разработчика в меню «…» (доступна всем —
 * как и раньше; защита записей — на бэкенде).
 */
export default function BatchPrintPanel({ branch, onClose }) {
  const [receiptPrinter, setReceiptPrinter] = useState(null)
  const [busy, setBusy] = useState(null)      // ключ печатающейся сейчас категории

  // Чековый принтер филиала — тот же путь, что в Истории/Отчётах
  useEffect(() => {
    printersApi.list()
      .then((list) => setReceiptPrinter((Array.isArray(list) ? list : []).find((p) => p.printer_type === 'receipt' && p.branch_id === branch?.id) || null))
      .catch(() => setReceiptPrinter(null))
  }, [branch?.id])

  // Категории пакетной печати: каждая сама тянет данные и собирает строки чека.
  const CATS = [
    {
      key: 'accounts', icon: Users, label: t('dev_accounts'),
      build: async () => {
        const items = asItems(await auth.staffUsers(branch?.id))
        // Безопасность: НЕ печатаем pin_code/nfc_id — только имя, роль, телефон
        const lines = items.map((u) => {
          const role = u.role_name || (u.role_slug ? t.role(u.role_slug) : '')
          return [u.name || '—', role, u.phone].filter(Boolean).join(' · ')
        })
        return { lines, count: items.length }
      },
    },
    {
      key: 'techcards', icon: FileText, label: t('dev_techcards'),
      build: async () => {
        // Bulk-эндпоинта нет: список блюд → техкарта по каждому блюду.
        const products = asItems(await menu.products())
        const recipes = await mapLimit(products, 6, (p) =>
          menu.recipe(p.id).catch(() => null)   // нет доступа/техкарты — пропускаем
        )
        const lines = []
        let count = 0
        recipes.forEach((r) => {
          const ings = r?.items || []
          if (!ings.length) return              // печатаем только заполненные техкарты
          count += 1
          lines.push(`— ${r.product_name || '—'} —`)
          ings.forEach((ing) => {
            const qty = ing.quantity != null ? ing.quantity : ''
            lines.push(`  • ${ing.ingredient_name}: ${qty}${ing.unit ? ` ${ing.unit}` : ''}`)
          })
        })
        return { lines, count }
      },
    },
    {
      key: 'arrivals', icon: Package, label: t('dev_arrivals'),
      build: async () => {
        const items = asItems(await warehouse.purchases())
        const lines = items.map((d) =>
          [`#${d.number ?? '—'}`, d.supplier || '—', `${fmtMoney(d.total_amount)} ${t('currency')}`, d.status]
            .filter(Boolean).join(' · ')
        )
        return { lines, count: items.length }
      },
    },
    {
      key: 'inventory', icon: ClipboardList, label: t('dev_inventory'),
      build: async () => {
        const items = asItems(await warehouse.inventoryChecks())
        const lines = items.map((c) =>
          [c.warehouse_name || '—', c.check_type, c.status, c.created_by_name].filter(Boolean).join(' · ')
        )
        return { lines, count: items.length }
      },
    },
  ]

  async function runPrint(cat) {
    if (busy) return
    if (!receiptPrinter) { toast(t('no_receipt_printer')); return }
    setBusy(cat.key)
    try {
      const { lines, count } = await cat.build()
      if (!lines.length) { toast(t('dev_empty')); return }
      await printersApi.printSummary({
        printer_id: receiptPrinter.id,
        title: cat.label,
        lines,
        footer: `${t('total')}: ${count}`,
        copies: 1,
      })
      toast(t('receipt_sent'), 'ok')
    } catch (e) {
      toast(t('print_failed') + (e?.response?.data?.detail ? `: ${e.response.data.detail}` : ''))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><Printer size={20} /> {t('print')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="modal__body">
          <p className="settings-hint">{t('dev_hint')}</p>
          {!receiptPrinter && <p className="settings-hint">{t('no_receipt_printer')}</p>}
          <div className="dev-tiles">
            {CATS.map((cat) => {
              const Icon = cat.icon
              const isBusy = busy === cat.key
              return (
                <button
                  key={cat.key}
                  type="button"
                  className="dev-tile"
                  onClick={() => runPrint(cat)}
                  disabled={!receiptPrinter || !!busy}
                >
                  <Icon size={28} />
                  <span className="dev-tile__label">{cat.label}</span>
                  <span className="dev-tile__hint">{isBusy ? t('dev_printing') : t('print')}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
