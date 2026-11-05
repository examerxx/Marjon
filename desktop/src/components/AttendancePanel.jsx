import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Clock, LogIn, LogOut, Check, Ban, RefreshCw, Search, Users, History } from 'lucide-react'
import { attendance, auth } from '../shared/api'
import { t } from '../shared/i18n'
import { must } from '../shared/permissions'
import { fmtTime } from '../shared/time'
import CalendarField from './CalendarField'
import { toast } from './Toast'

// 5.5 — экран посещаемости кассира. Кассир отмечает приход/уход любого сотрудника
// (отметка кассира = разрешение зайти, поэтому сразу approved), видит журнал за
// сегодня и подтверждает/отклоняет самостоятельные отметки из очереди (pending).

// Владелец/менеджер/кладовщик не работают на кассе-терминале — прячем из ростера.
const HIDDEN_ROLES = ['owner', 'manager', 'warehouse']
const AVATAR_COLORS = ['#b08e42', '#2563eb', '#7c3aed', '#f59e0b', '#16a34a', '#ef4444', '#7a6127', '#e11d48']

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?'
}
// Стабильный цвет аватара по имени
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function roleOf(u) { return u.role_slug || (u.role_slugs && u.role_slugs[0]) }

export default function AttendancePanel({ user, onClose }) {
  const [staff, setStaff] = useState([])
  const [journal, setJournal] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [q, setQ] = useState('')
  // Прошлые дни журнала — только по тумблеру владельца (can_view_past_periods);
  // без права бэкенд игнорирует date и всегда отдаёт сегодняшний журнал.
  const canPast = must(user, 'can_view_past_periods')
  const [day, setDay] = useState('')          // '' = сегодня
  const [pastLog, setPastLog] = useState([])

  const loadStaff = useCallback(() => {
    return auth.staffUsers(user?.branch_id)
      .then((d) => {
        const list = (Array.isArray(d) ? d : d?.items || [])
          .filter((u) => u.is_active !== false && !HIDDEN_ROLES.includes(String(roleOf(u) || '').toLowerCase()))
        setStaff(list)
      })
      .catch(() => setStaff([]))
  }, [user?.branch_id])

  const loadJournal = useCallback(() => {
    return attendance.log()
      .then((d) => setJournal(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setJournal([]))
  }, [])

  const loadPending = useCallback(() => {
    return attendance.pending()
      .then((d) => setPending(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setPending([]))
  }, [])

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([loadStaff(), loadJournal(), loadPending()]).finally(() => setLoading(false))
  }, [loadStaff, loadJournal, loadPending])
  useEffect(reload, [reload])

  // Журнал за прошлый день держим отдельно: сегодняшний journal кормит ростер
  // (последняя отметка, кнопки прихода/ухода) — подменять его нельзя.
  useEffect(() => {
    if (!canPast || !day) { setPastLog([]); return }
    attendance.log(day)
      .then((d) => setPastLog(Array.isArray(d) ? d : d?.items || []))
      .catch(() => setPastLog([]))
  }, [canPast, day])
  const viewLog = (canPast && day) ? pastLog : journal

  // user_id → последнее действие за сегодня (journal отсортирован desc → первое совпадение свежее)
  const lastAction = useMemo(() => {
    const m = new Map()
    for (const r of journal) {
      const uid = r.user_id && String(r.user_id)
      if (uid && !m.has(uid)) m.set(uid, r.action)
    }
    return m
  }, [journal])

  const onShiftCount = useMemo(
    () => staff.filter((u) => lastAction.get(String(u.id)) === 'check_in').length,
    [staff, lastAction],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return staff
    return staff.filter((u) => String(u.name || u.email || '').toLowerCase().includes(s))
  }, [staff, q])

  // Отметка кассира: приход/уход выбранного сотрудника (сразу approved на бэкенде).
  async function mark(u, action) {
    setBusyId(u.id)
    try {
      await attendance.mark(u.id, action)
      toast(action === 'check_in' ? t('att_marked_in') : t('att_marked_out'), 'success')
      await loadJournal()
    } catch (e) {
      toast(e?.response?.data?.detail || e.message || t('att_err'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  // Подтверждение/отклонение самостоятельной отметки из очереди pending.
  async function decide(row, approve) {
    setBusyId(row.id)
    setPending((prev) => prev.filter((x) => x.id !== row.id)) // оптимистично
    try {
      if (approve) await attendance.approve(row.id)
      else await attendance.reject(row.id)
      toast(approve ? t('att_approved') : t('att_rejected'), 'success')
      await loadJournal()
    } catch (e) {
      toast(e?.response?.data?.detail || e.message || t('att_err'), 'error')
      loadPending() // откат
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="attn-screen">
      <div className="attn-screen__panel">
        <header className="attn-head">
          <div className="attn-head__title">
            <span className="attn-head__ico"><Clock size={24} /></span>
            <div>
              <h1>{t('attendance_page')}</h1>
              <p>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
          </div>
          <div className="attn-head__stats">
            <div className="attn-stat attn-stat--on"><span>{onShiftCount}</span><label>{t('att_cnt_on')}</label></div>
            <div className="attn-stat attn-stat--off"><span>{Math.max(0, staff.length - onShiftCount)}</span><label>{t('att_cnt_off')}</label></div>
            <div className="attn-stat"><span>{journal.length}</span><label>{t('att_cnt_marks')}</label></div>
          </div>
          <div className="attn-head__actions">
            <button className="icon-btn" onClick={reload} title={t('att_refresh')}><RefreshCw size={20} /></button>
            <button className="icon-btn" onClick={onClose}><X size={24} /></button>
          </div>
        </header>

        <div className="attn-body">
          <section className="attn-col attn-col--roster">
            <div className="attn-col__head">
              <h2><Users size={18} /> {t('att_staff')} <span className="attn-count">{filtered.length}</span></h2>
              <div className="attn-search">
                <Search size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('att_search')} />
              </div>
            </div>
            {loading ? (
              <div className="attn-state"><div className="spinner" /><p>{t('loading')}</p></div>
            ) : filtered.length === 0 ? (
              <p className="attn-empty">{t('att_no_staff')}</p>
            ) : (
              <div className="attn-roster">
                {filtered.map((u) => {
                  const on = lastAction.get(String(u.id)) === 'check_in'
                  return (
                    <div className={`attn-card ${on ? 'attn-card--on' : ''}`} key={u.id}>
                      <span className="attn-card__avatar" style={{ background: avatarColor(u.name || u.email) }}>{initials(u.name || u.email)}</span>
                      <div className="attn-card__info">
                        <span className="attn-card__name">{u.name || u.email}</span>
                        <span className="attn-card__role">{t.role(roleOf(u))}</span>
                      </div>
                      <span className={`attn-badge ${on ? 'attn-badge--on' : 'attn-badge--off'}`}>{on ? t('att_on_shift') : t('att_off_shift')}</span>
                      <div className="attn-card__actions">
                        <button className="btn btn--sm btn--primary" disabled={busyId === u.id || on} onClick={() => mark(u, 'check_in')}><LogIn size={16} /> {t('att_mark_in')}</button>
                        <button className="btn btn--sm btn--danger-soft" disabled={busyId === u.id || !on} onClick={() => mark(u, 'check_out')}><LogOut size={16} /> {t('att_mark_out')}</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
          {/* PLACEHOLDER_SIDE */}
          <section className="attn-col attn-col--side">
            {pending.length > 0 && (
              <div className="attn-block">
                <h2><Clock size={18} /> {t('att_pending')} <span className="attn-count attn-count--warn">{pending.length}</span></h2>
                <div className="attn-pending">
                  {pending.map((row) => {
                    const isIn = row.action === 'check_in'
                    return (
                      <div className="attn-prow" key={row.id}>
                        <span className={`attn-prow__badge ${isIn ? 'attn-prow__badge--in' : 'attn-prow__badge--out'}`}>{isIn ? <LogIn size={16} /> : <LogOut size={16} />}</span>
                        <div className="attn-prow__info">
                          <span className="attn-prow__name">{row.employee_name || '—'}</span>
                          <span className="attn-prow__meta">{isIn ? t('att_check_in') : t('att_check_out')} · {fmtTime(row.timestamp)}</span>
                        </div>
                        <div className="attn-prow__actions">
                          <button className="btn btn--sm btn--primary" disabled={busyId === row.id} onClick={() => decide(row, true)}><Check size={16} /></button>
                          <button className="btn btn--sm btn--danger-soft" disabled={busyId === row.id} onClick={() => decide(row, false)}><Ban size={16} /></button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="attn-block attn-block--journal">
              <h2><History size={18} /> {day ? t('att_journal_day') : t('att_journal')} <span className="attn-count">{viewLog.length}</span></h2>
              {canPast ? (
                <div className="attn-period">
                  <CalendarField value={day} onChange={setDay} />
                  {day && <button className="btn btn--sm" onClick={() => setDay('')}>{t('today')}</button>}
                </div>
              ) : (
                <p className="attn-empty">{t('past_locked')}</p>
              )}
              {loading ? (
                <div className="attn-state"><div className="spinner" /></div>
              ) : viewLog.length === 0 ? (
                <p className="attn-empty">{t('att_journal_empty')}</p>
              ) : (
                <div className="attn-journal">
                  {viewLog.map((r) => {
                    const isIn = r.action === 'check_in'
                    return (
                      <div className="attn-jrow" key={r.id}>
                        <span className={`attn-jrow__dot ${isIn ? 'attn-jrow__dot--in' : 'attn-jrow__dot--out'}`} />
                        <span className="attn-jrow__name">{r.employee_name || '—'}</span>
                        <span className="attn-jrow__action">{isIn ? t('att_check_in') : t('att_check_out')}</span>
                        <span className="attn-jrow__time">{fmtTime(r.timestamp)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
