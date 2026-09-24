import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { t } from '../shared/i18n'

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
 *   submitLabel? — текст кнопки (по умолчанию «Сохранить»)
 *   onSubmit(value, extraValue) — async; при ошибке текст показывается внутри модалки
 *   onClose()
 */
export default function InputPromptModal({ title, hint, placeholder = '', initial = '', type = 'text', options = [], extra, submitLabel, onSubmit, onClose }) {
  const [value, setValue] = useState(() => String(initial || options[0]?.value || ''))
  const [extraValue, setExtraValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const normalizedOptions = options.filter((option, index) =>
    options.findIndex((item) => String(item.value) === String(option.value)) === index
  )
  const selectedOption = normalizedOptions.find((option) => String(option.value) === value) || normalizedOptions[0]
  const availableOptions = normalizedOptions.filter((option) => String(option.value) !== value)

  async function submit() {
    if (busy || String(value).trim() === '') return
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
    <div className="modal-overlay" style={{ zIndex: 'calc(var(--z-modal) + 10)' }} onClick={onClose}>
      <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>
        <div className="prompt-modal__body">
          {hint && <label className="prompt-modal__hint">{hint}</label>}
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
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
          )}
          {extra && (
            <>
              <label className="prompt-modal__hint">{extra.label}</label>
              <textarea
                className="input prompt-modal__extra"
                value={extraValue}
                placeholder={extra.placeholder || ''}
                rows={2}
                disabled={busy}
                onChange={(e) => setExtraValue(e.target.value)}
              />
            </>
          )}
          {err && <p className="prompt-modal__err">{err}</p>}
        </div>
        <div className="prompt-modal__actions">
          <button className="btn btn--outline" disabled={busy} onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn--primary" disabled={busy || String(value).trim() === ''} onClick={submit}>
            {busy && <span className="btn-spinner" aria-hidden="true" />} {submitLabel || t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
