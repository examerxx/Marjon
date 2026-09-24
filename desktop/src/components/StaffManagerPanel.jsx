import { useState, useEffect, useCallback } from 'react'
import { X, Users, UserPlus, Pencil, ArrowLeft, Lock } from 'lucide-react'
import { auth } from '../shared/api'
import { t } from '../shared/i18n'
import { toast } from './Toast'
import CustomSelect from './CustomSelect'

// Роли, которые кассир-менеджер вправе назначать (owner-assignable на бэкенде).
// owner/admin сюда НЕ входят — такие карточки редактирует только владелец.
const ASSIGNABLE_ROLES = ['cashier', 'waiter', 'kitchen', 'monoblock', 'courier', 'warehouse']

const asItems = (raw) => (Array.isArray(raw) ? raw : raw?.items || [])
const onlyDigits = (s) => String(s || '').replace(/\D/g, '').slice(0, 8)
// Владелец/админ — карточка только для чтения (совпадает с анти-эскалацией бэкенда).
const isAdminRow = (u) => (u.role_slugs || [u.role_slug]).some((s) => s === 'owner' || s === 'admin')

const EMPTY = { name: '', phone: '', roleSlug: 'cashier', pin: '', isActive: true }

/**
 * StaffManagerPanel — управление сотрудниками (открывается из меню «…»).
 * Создание/редактирование: имя, телефон, роль (owner-assignable), PIN, активность.
 * Права здесь НЕ правятся — только владелец в веб-админке.
 * Секреты (pin_code/nfc_id) НЕ отображаем — PIN вводится только на запись.
 */
export default function StaffManagerPanel({ onClose }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // null | 'new' | user-объект
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    auth.users()
      .then((d) => setUsers(asItems(d)))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  function startNew() {
    setForm(EMPTY)
    setEditing('new')
  }
  function startEdit(u) {
    setForm({
      name: u.name || '',
      phone: u.phone || '',
      roleSlug: ASSIGNABLE_ROLES.includes(u.role_slug) ? u.role_slug : 'cashier',
      pin: '',                       // пусто = оставить прежний PIN
      isActive: u.is_active !== false,
    })
    setEditing(u)
  }

  async function save() {
    if (!form.name.trim() || !form.roleSlug) { toast(t('required_fields'), 'error'); return }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      role_slug: form.roleSlug,
      is_active: form.isActive,
    }
    // PIN: при создании — если введён; при правке — только если поле непусто.
    if (editing === 'new' ? form.pin : form.pin !== '') {
      const pin = onlyDigits(form.pin)
      if (pin && !/^\d{2,8}$/.test(pin)) { toast(t('staff_pin_invalid'), 'error'); return }
      payload.pin_code = pin
    }
    setSaving(true)
    try {
      if (editing === 'new') await auth.createUser(payload)
      else await auth.updateUser(editing.id, payload)
      toast(t('saved'), 'ok')
      setEditing(null)
      load()
    } catch (e) {
      toast(e?.response?.data?.detail || t('save_failed'), 'error')
    } finally { setSaving(false) }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2><Users size={20} /> {t('dev_staff')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>
        <div className="modal__body">
    <div className="dev-screen">
      <div className="dev-screen__head">
        {editing && (
          <button className="icon-btn" onClick={() => setEditing(null)}><ArrowLeft size={26} /></button>
        )}
        <h3><Users size={20} /> {editing ? (editing === 'new' ? t('staff_add') : t('edit')) : t('dev_staff')}</h3>
        {!editing && !loading && (
          <>
            <span className="dev-screen__spacer" />
            <button className="btn btn--sm btn--primary" onClick={startNew}><UserPlus size={16} /> {t('staff_add')}</button>
          </>
        )}
      </div>

      {editing ? (
        <section className="settings-section">
          <div className="settings-row settings-row--col">
            <label>{t('staff_name')}</label>
            <input className="input" value={form.name} onChange={set('name')} maxLength={120} />
          </div>
          <div className="settings-row settings-row--col">
            <label>{t('staff_phone')}</label>
            <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={30} />
          </div>
          <div className="settings-row settings-row--col">
            <label>{t('staff_role')}</label>
            <CustomSelect className="cselect--block" value={form.roleSlug}
              onChange={(v) => setForm((f) => ({ ...f, roleSlug: v }))}
              options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: t.role(r) }))} />
          </div>
          <div className="settings-row settings-row--col">
            <label>{t('staff_pin')}</label>
            <input className="input" value={form.pin} inputMode="numeric" maxLength={8}
              placeholder={editing === 'new' ? '' : t('staff_pin_keep')}
              onChange={(e) => setForm((f) => ({ ...f, pin: onlyDigits(e.target.value) }))} />
          </div>
          <div className="settings-row">
            <label>{t('staff_active')}</label>
            <button type="button" className={`toggle ${form.isActive ? 'toggle--on' : ''}`}
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}>
              <span className="toggle__dot" />
            </button>
          </div>
          <div className="settings-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--primary settings-save" onClick={save} disabled={saving}>
              {saving ? t('loading') : t('save')}
            </button>
          </div>
        </section>
      ) : loading ? (
        <div className="kitchen-empty"><div className="spinner" /><p>{t('loading')}</p></div>
      ) : (
        <section className="settings-section">
          {users.length === 0 && <p className="settings-hint">{t('emp_empty')}</p>}
          {users.map((u) => {
            const locked = isAdminRow(u)
            return (
              <div className="settings-row" key={u.id}>
                <span>
                  {u.name || '—'}
                  {' · '}<span style={{ color: 'var(--color-text-muted)' }}>{t.role(u.role_slug)}</span>
                  {u.is_active === false && <span style={{ color: 'var(--color-text-muted)' }}> · {t('staff_inactive')}</span>}
                </span>
                {locked
                  ? <span className="settings-hint" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2xs)', whiteSpace: 'nowrap' }}><Lock size={16} /> {t('staff_readonly')}</span>
                  : <button className="btn btn--sm" onClick={() => startEdit(u)}><Pencil size={16} /> {t('edit')}</button>}
              </div>
            )
          })}
        </section>
      )}
    </div>
        </div>
      </div>
    </div>
  )
}
