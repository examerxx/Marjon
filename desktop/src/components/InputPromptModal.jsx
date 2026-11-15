import { useState } from 'react'
import { ArrowRight, ChevronDown, Lock, MessageSquare, X } from 'lucide-react'
import { t } from '../shared/i18n'
import { formatQty } from '../shared/qty'

/**
 * InputPromptModal — замена window.prompt (в Electron он не работает и молча
 * возвращает null). Используется для пароля отмены заказа и номера нового стола.
 *
 * props:
 *   title — заголовок
 *   hint? — подпись к полю
 *   placeholder?, initial?, type? ('text' | 'password' | 'number')
 *   options? — если передан список [{ value, label }], вместо ввода показывается кастомный выбор
 *   extra? — доп. необязательное поле-комментарий { label, placeholder }
 *   changes? — список изменённых блюд [{ name, from, to }]: показывается над полями
 *   submitLabel? — текст кнопки (по умолчанию «Сохранить»)
 *   allowEmpty? — разрешить отправить пустое значение (для необязательного
 *                 комментария: причина возврата заказа и т.п.)
 *   onSubmit(value, extraValue) — async; при ошибке текст показывается внутри модалки
 *   onClose()
 */
export default function InputPromptModal({ title, hint, placeholder = '', initial = '', type = 'text', options = [], extra, changes, submitLabel, allowEmpty = false, compact = false, sidePad = false, onSubmit, onClose }) {
  const [value, setValue] = useState(() => String(initial || options[0]?.value || ''))
  const [extraValue, setExtraValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const hasChanges = Array.isArray(changes) && changes.length > 0
  // Цифровая панель видна только пока вводят пароль; при вводе причины (экранная
  // клавиатура снизу) она скрывается, чтобы обе не торчали на экране сразу.
  const [padFocus, setPadFocus] = useState(true)
  const showPad = sidePad && type === 'password' && padFocus
  const normalizedOptions = options.filter((option, index) =>
    options.findIndex((item) => String(item.value) === String(option.value)) === index
  )
  const selectedOption = normalizedOptions.find((option) => String(option.value) === value) || normalizedOptions[0]
  const availableOptions = normalizedOptions.filter((option) => String(option.value) !== value)

  async function submit() {
    if (busy || (!allowEmpty && String(value).trim() === '')) return
    setBusy(true); setErr('')
    try {
      await onSubmit(String(value).trim(), extraValue.trim())
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || t('cancel_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={compact ? "modal-overlay prompt-overlay--compact" : "modal-overlay"} style={{ zIndex: 'calc(var(--z-modal) + 10)' }} onClick={onClose}>
      <div className={`modal prompt-modal${hasChanges ? ' prompt-modal--changes' : ''}${showPad ? ' prompt-modal--sidepad' : ''}`} onClick={(e) => e.stopPropagation()}>
        {hasChanges ? (
          <div className="modal__header pcm-header">
            <div className="pcm-header__text">
              <h3>{title}</h3>
              <p>{t('changes_subtitle')}</p>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label={t('close')}><X size={24} /></button>
          </div>
        ) : (
          <div className="modal__header">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose}><X size={24} /></button>
          </div>
        )}
        <div className="prompt-modal__body">
          {hasChanges && (
            <aside className="prompt-changes" aria-label={t('changed_dishes')}>
              <h4 className="prompt-changes__head">{t('changed_dishes')}</h4>
              <ul className="prompt-changes__list">
                {changes.map((c, i) => {
                  const kind = c.to === 0 ? 'removed' : c.to < c.from ? 'down' : 'up'
                  return (
                    <li key={i} className={`prompt-changes__row is-${kind}`}>
                      <span className="prompt-changes__name" title={c.name}>{c.name}</span>
                      <span className="prompt-changes__qty">
                        {formatQty(c.from)} <ArrowRight size={12} aria-hidden="true" /> {c.to === 0 ? t('changed_cancelled') : formatQty(c.to)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </aside>
          )}
          {hint && (
            <label className="prompt-modal__hint">
              {hasChanges && type === 'password' && <Lock size={14} aria-hidden="true" />} {hint}
            </label>
          )}
          {options.length > 0 ? (
            <div className={`prompt-select ${optionsOpen ? 'prompt-select--open' : ''}`}>
              <button
                type="button"
                className="prompt-select__trigger"
                aria-haspopup="listbox"
                aria-expanded={optionsOpen}
                disabled={busy}
                autoFocus
                onClick={() => setOptionsOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOptionsOpen(false)
                }}
              >
                <span>{selectedOption?.label || placeholder}</span>
                <ChevronDown className="prompt-select__chevron" size={22} />
              </button>
              {optionsOpen && availableOptions.length > 0 && (
                <div className="prompt-select__menu" role="listbox" aria-label={hint || title}>
                  {availableOptions.map((option) => {
                    const optionValue = String(option.value)
                    return (
                      <button
                        type="button"
                        key={optionValue}
                        role="option"
                        aria-selected="false"
                        className="prompt-select__option"
                        onClick={() => {
                          setValue(optionValue)
                          setOptionsOpen(false)
                        }}
                      >
                        <span>{option.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <input
              className="input"
              type={type}
              value={value}
              placeholder={placeholder}
              autoFocus
              disabled={busy}
              {...(sidePad && type === 'password' ? { inputMode: 'none', 'data-keyboard': 'off', onFocus: () => setPadFocus(true) } : {})}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
          )}
          {extra && (
            <>
              <label className="prompt-modal__hint">
                {hasChanges && <MessageSquare size={14} aria-hidden="true" />} {extra.label}
              </label>
              <textarea
                className="input prompt-modal__extra"
                value={extraValue}
                placeholder={extra.placeholder || ''}
                rows={2}
                disabled={busy}
                onFocus={() => setPadFocus(false)}
                onChange={(e) => setExtraValue(e.target.value)}
              />
            </>
          )}
          {err && <p className="prompt-modal__err">{err}</p>}
        </div>
        <div className="prompt-modal__actions">
          <button className="btn btn--outline" disabled={busy} onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn--primary" disabled={busy || (!allowEmpty && String(value).trim() === '')} onClick={submit}>
            {busy && <span className="btn-spinner" aria-hidden="true" />} {submitLabel || t('save')}
          </button>
        </div>
      </div>
      {showPad && (
        <aside className="prompt-sidepad" onClick={(e) => e.stopPropagation()} aria-label={hint || title}>
          <div className="pay-amount-pad__keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'].map((key, i) => key === '' ? <span key={i} /> : (
              <button key={key} type="button" className="vkb__key" disabled={busy}
                aria-label={key === 'delete' ? t('payment_delete_digit') : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setValue((v) => (key === 'delete' ? v.slice(0, -1) : v + key))}>
                {key === 'delete' ? '⌫' : key}
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
