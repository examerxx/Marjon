import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, LogOut, Clock, Wallet, ShoppingBag, Store } from 'lucide-react'
import { shifts } from '../shared/api'
import { t } from '../shared/i18n'
import { errorMessage } from '../shared/errorMessage.mjs'
import { fmtTime } from '../shared/time'

function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h <= 0) return `${m} ${t('minute_short')}`
  return `${h} ${t('hour_short')} ${m} ${t('minute_short')}`
}

function fmtMoney(value) {
  return Number(value || 0).toLocaleString('ru-RU')
}

/** Профиль сотрудника на терминале: имя, роль, выработка и продажи за день,
 *  статус смены и закрытие смены. Аватар намеренно не показываем. */
export default function StaffProfileModal({
  user = {},
  branchId,
  branchName,
  onClose,
  onSwitchStaff,
  onShiftClosed,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [closingCash, setClosingCash] = useState('')
  const [closing, setClosing] = useState(false)

  const role = user.role_slug || (user.role_slugs && user.role_slugs[0])

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    shifts.summary(branchId)
      .then(setData)
      .catch((e) => setError(errorMessage(e, t('profile_load_err'))))
      .finally(() => setLoading(false))
  }, [branchId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !closing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, closing])

  const shift = data?.shift || null
  // Официант свою смену не открывает — показываем время работы открытой
  // смены филиала, чтобы профиль выглядел и считался так же, как у кассира.
  const workedSeconds = Number(data?.worked_seconds) > 0
    ? data.worked_seconds
    : (shift ? data?.shift_seconds : 0)

  const closeShift = async () => {
    if (closing) return
    setClosing(true)
    setError('')
    try {
      await shifts.close(branchId, Number(closingCash) || 0)
      onShiftClosed?.()
    } catch (e) {
      setError(errorMessage(e, t('shift_close_err')))
      setClosing(false)
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !closing) onClose() }}
    >
      <div className="modal profile-modal" role="dialog" aria-modal="true" aria-label={t('profile')}>
        <div className="modal__header">
          <h2>{t('profile')}</h2>
          <button className="icon-btn" onClick={onClose} title={t('close')} disabled={closing}>
            <X size={20} />
          </button>
        </div>

        <div className="modal__body profile">
          <div className="profile__head">
            <span className="profile__role">{t.role(role)}</span>
            <span className="profile__name">{user.name || user.email || t('staff')}</span>
            {branchName && (
              <span className="profile__branch"><Store size={14} /> {branchName}</span>
            )}
          </div>

          {loading ? (
            <p className="profile__hint">{t('loading')}</p>
          ) : (
            <>
              <div className="profile__stats">
                <div className="profile__stat">
                  <span className="profile__stat-label"><Clock size={15} /> {t('worked_today')}</span>
                  <span className="profile__stat-value">{fmtDuration(workedSeconds)}</span>
                </div>
                <div className="profile__stat">
                  <span className="profile__stat-label"><Wallet size={15} /> {t('sales_today')}</span>
                  <span className="profile__stat-value">{fmtMoney(data?.sales_total)} {t('currency')}</span>
                </div>
                <div className="profile__stat">
                  <span className="profile__stat-label"><ShoppingBag size={15} /> {t('orders_count')}</span>
                  <span className="profile__stat-value">{Number(data?.orders_count) || 0}</span>
                </div>
                <div className="profile__stat">
                  <span className="profile__stat-label"><Clock size={15} /> {t('shift')}</span>
                  <span className={`profile__stat-value ${shift ? 'profile__stat-value--open' : ''}`}>
                    {shift ? t('fin_status_open') : t('shift_not_open')}
                  </span>
                </div>
              </div>

              {shift && (
                <div className="profile__shift">
                  <div className="profile__shift-row">
                    <span>{t('opened_at')}</span>
                    <strong>{fmtTime(shift.opened_at) || '—'}</strong>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="profile__error">{error}</p>}

          <div className="profile__actions">
            {shift && !confirming && (
              <button className="btn btn--danger profile__close" onClick={() => setConfirming(true)}>
                <LogOut size={18} /> {t('close_shift')}
              </button>
            )}

            {shift && confirming && (
              <div className="profile__confirm">
                <p>{t('close_shift_confirm')}</p>
                <label className="profile__field">
                  <span>{t('cash_end')}</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    placeholder="0"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    disabled={closing}
                  />
                </label>
                <div className="profile__confirm-actions">
                  <button className="btn" onClick={() => setConfirming(false)} disabled={closing}>
                    {t('cancel')}
                  </button>
                  <button className="btn btn--danger" onClick={closeShift} disabled={closing}>
                    {closing ? t('loading') : t('close_shift')}
                  </button>
                </div>
              </div>
            )}

            {!loading && !shift && <p className="profile__hint">{t('shift_not_open')}</p>}

            <button className="btn-ghost profile__switch" onClick={onSwitchStaff} disabled={closing}>
              <LogOut size={18} /> {t('switch_staff')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
