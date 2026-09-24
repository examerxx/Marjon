import { useState, useEffect, useCallback } from 'react'
import { X, Boxes, Plus, Trash2, ArrowLeft } from 'lucide-react'
import { warehouse } from '../shared/api'
import { t } from '../shared/i18n'
import { toast } from './Toast'
import CustomSelect from './CustomSelect'

const UNITS = ['кг', 'г', 'л', 'мл', 'шт', 'уп']
const num = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0 }
const EMPTY_ITEM = { name: '', quantity: '', unit: 'кг', cost_price: '' }

/**
 * WarehouseWritePanel — складские записи (открывается из меню «…»):
 * приход (с позициями), списание, инвентаризация. Перемещения между складами
 * и создание самих складов остаются за владельцем/админом (не здесь).
 */
export default function WarehouseWritePanel({ onClose }) {
  const [tab, setTab] = useState('purchase')  // purchase | writeoff | inventory
  const [saving, setSaving] = useState(false)
  const [recent, setRecent] = useState([])
  const [adding, setAdding] = useState(false)  // список ⇄ форма добавления

  // Приход
  const [pur, setPur] = useState({ supplier: '', warehouse_name: '', note: '', items: [{ ...EMPTY_ITEM }] })
  // Списание
  const [wo, setWo] = useState({ category: '', items_count: '', note: '' })
  // Инвентаризация
  const [inv, setInv] = useState({ warehouse_name: '', comment: '', check_type: '' })

  const loadRecent = useCallback(() => {
    const fetch = tab === 'purchase' ? warehouse.purchases
      : tab === 'writeoff' ? warehouse.writeOffs : warehouse.inventoryChecks
    fetch().then((d) => setRecent(Array.isArray(d) ? d.slice(0, 8) : [])).catch(() => setRecent([]))
  }, [tab])
  useEffect(loadRecent, [loadRecent])

  const setPurField = (k) => (e) => setPur((s) => ({ ...s, [k]: e.target.value }))
  const setPurItem = (i, k) => (e) => setPur((s) => {
    const items = s.items.map((it, idx) => (idx === i ? { ...it, [k]: e.target.value } : it))
    return { ...s, items }
  })
  const addPurItem = () => setPur((s) => ({ ...s, items: [...s.items, { ...EMPTY_ITEM }] }))
  const rmPurItem = (i) => setPur((s) => ({ ...s, items: s.items.filter((_, idx) => idx !== i) }))

  async function save() {
    setSaving(true)
    try {
      if (tab === 'purchase') {
        const items = pur.items
          .filter((it) => it.name.trim())
          .map((it) => ({ name: it.name.trim(), quantity: num(it.quantity), unit: it.unit, cost_price: num(it.cost_price) }))
        if (!items.length) { toast(t('wh_need_item'), 'error'); setSaving(false); return }
        await warehouse.createPurchase({
          supplier: pur.supplier.trim() || null,
          warehouse_name: pur.warehouse_name.trim() || null,
          note: pur.note.trim() || null,
          items,
        })
        setPur({ supplier: '', warehouse_name: '', note: '', items: [{ ...EMPTY_ITEM }] })
      } else if (tab === 'writeoff') {
        await warehouse.createWriteOff({
          category: wo.category.trim() || null,
          items_count: Math.trunc(num(wo.items_count)),
          note: wo.note.trim() || null,
        })
        setWo({ category: '', items_count: '', note: '' })
      } else {
        await warehouse.createInventoryCheck({
          warehouse_name: inv.warehouse_name.trim() || null,
          comment: inv.comment.trim() || null,
          ...(inv.check_type.trim() ? { check_type: inv.check_type.trim() } : {}),
        })
        setInv({ warehouse_name: '', comment: '', check_type: '' })
      }
      setAdding(false)
      toast(t('saved'), 'ok')
      loadRecent()
    } catch (e) {
      toast(e?.response?.data?.detail || t('save_failed'), 'error')
    } finally { setSaving(false) }
  }

  const TABS = [
    ['purchase', t('wh_tab_purchase')],
    ['writeoff', t('wh_tab_writeoff')],
    ['inventory', t('wh_tab_inventory')],
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><Boxes size={20} /> {t('dev_warehouse')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>
        <div className="modal__body">
    <div className="dev-screen">
      <div className="dev-screen__head">
        {adding && (
          <button className="icon-btn" onClick={() => setAdding(false)}><ArrowLeft size={26} /></button>
        )}
        <h3><Boxes size={20} /> {adding ? (TABS.find(([k]) => k === tab)?.[1] || t('dev_warehouse')) : t('dev_warehouse')}</h3>
        {!adding && (
          <>
            <span className="dev-screen__spacer" />
            <button className="btn btn--sm btn--primary" onClick={() => setAdding(true)}><Plus size={16} /> {t('wh_add')}</button>
          </>
        )}
      </div>

      {!adding && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
          {TABS.map(([k, label]) => (
            <button key={k} className={`filter-chip ${tab === k ? 'filter-chip--active' : ''}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {adding && tab === 'purchase' && (
            <section className="settings-section">
              <div className="settings-row settings-row--col">
                <label>{t('wh_supplier')}</label>
                <input className="input" value={pur.supplier} onChange={setPurField('supplier')} maxLength={200} />
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('wh_warehouse')}</label>
                <input className="input" value={pur.warehouse_name} onChange={setPurField('warehouse_name')} maxLength={200} />
              </div>
              {pur.items.map((it, i) => (
                <div className="settings-row settings-row--col" key={i}>
                  <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end' }}>
                    <div style={{ flex: 2 }}>
                      <label>{t('wh_item_name')}</label>
                      <input className="input" value={it.name} onChange={setPurItem(i, 'name')} maxLength={200} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>{t('qty')}</label>
                      <input className="input" value={it.quantity} onChange={setPurItem(i, 'quantity')} inputMode="decimal" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>{t('wh_unit')}</label>
                      <CustomSelect className="cselect--block" value={it.unit}
                        onChange={(v) => setPur((s) => ({ ...s, items: s.items.map((row, idx) => (idx === i ? { ...row, unit: v } : row)) }))}
                        options={UNITS} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label>{t('wh_cost')}</label>
                      <input className="input" value={it.cost_price} onChange={setPurItem(i, 'cost_price')} inputMode="decimal" />
                    </div>
                    {pur.items.length > 1 && (
                      <button type="button" className="icon-btn" onClick={() => rmPurItem(i)}><Trash2 size={18} /></button>
                    )}
                  </div>
                </div>
              ))}
              <div className="settings-row">
                <button type="button" className="btn btn--sm" onClick={addPurItem}><Plus size={16} /> {t('wh_add_item')}</button>
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('comment')}</label>
                <input className="input" value={pur.note} onChange={setPurField('note')} maxLength={500} />
              </div>
            </section>
          )}

          {adding && tab === 'writeoff' && (
            <section className="settings-section">
              <div className="settings-row settings-row--col">
                <label>{t('wh_category')}</label>
                <input className="input" value={wo.category} onChange={(e) => setWo((s) => ({ ...s, category: e.target.value }))} maxLength={200} />
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('wh_items_count')}</label>
                <input className="input" value={wo.items_count} inputMode="numeric"
                  onChange={(e) => setWo((s) => ({ ...s, items_count: e.target.value }))} />
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('comment')}</label>
                <input className="input" value={wo.note} onChange={(e) => setWo((s) => ({ ...s, note: e.target.value }))} maxLength={500} />
              </div>
            </section>
          )}

          {adding && tab === 'inventory' && (
            <section className="settings-section">
              <div className="settings-row settings-row--col">
                <label>{t('wh_warehouse')}</label>
                <input className="input" value={inv.warehouse_name} onChange={(e) => setInv((s) => ({ ...s, warehouse_name: e.target.value }))} maxLength={200} />
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('wh_check_type')}</label>
                <input className="input" value={inv.check_type} onChange={(e) => setInv((s) => ({ ...s, check_type: e.target.value }))}
                  placeholder={t('wh_check_type_ph')} maxLength={200} />
              </div>
              <div className="settings-row settings-row--col">
                <label>{t('comment')}</label>
                <input className="input" value={inv.comment} onChange={(e) => setInv((s) => ({ ...s, comment: e.target.value }))} maxLength={500} />
              </div>
            </section>
          )}

          {adding && (
            <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn--primary settings-save" onClick={save} disabled={saving}>
                {saving ? t('loading') : t('save')}
              </button>
            </div>
          )}

          {!adding && (recent.length > 0 ? (
            <section className="settings-section">
              <p className="settings-hint">{t('wh_recent')}</p>
              {recent.map((d) => (
                <div className="settings-row" key={d.id}>
                  <span>
                    {d.number != null && <span style={{ color: 'var(--color-text-muted)' }}>№{d.number} · </span>}
                    {d.supplier || d.category || d.warehouse_name || d.check_type || '—'}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{d.created_by_name || ''}</span>
                </div>
              ))}
            </section>
          ) : (
            <p className="settings-hint">{t('emp_empty')}</p>
          ))}
    </div>
        </div>
      </div>
    </div>
  )
}
