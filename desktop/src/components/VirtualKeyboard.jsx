import { useState, useEffect, useCallback, useRef } from 'react'
import { Delete, Globe, ArrowBigUp, CornerDownLeft, X } from 'lucide-react'

const LAYOUTS = {
  en: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'backspace'],
    ['lang', 'num', 'space', '.', 'enter'],
  ],
  ru: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х'],
    ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
    ['shift', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'backspace'],
    ['lang', 'num', 'space', '.', 'enter'],
  ],
  num: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['sym', '.', ',', '?', '!', "'", '+', '=', '%', 'backspace'],
    ['abc', 'space', 'enter'],
  ],
  sym: [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '€', '₽', '№', '•'],
    ['num', '.', ',', '?', '!', "'", '-', '/', 'backspace'],
    ['abc', 'space', 'enter'],
  ],
}

const SPECIAL = new Set(['shift', 'backspace', 'enter', 'space', 'lang', 'num', 'abc', 'sym'])
const MEDIUM = new Set(['shift', 'backspace', 'enter', 'lang', 'num', 'abc', 'sym'])
// Типы input, для которых экранная клавиатура не нужна
const NON_TEXT = new Set(['range', 'checkbox', 'radio', 'color', 'file', 'date', 'datetime-local', 'month', 'time', 'week', 'button', 'submit', 'reset'])

export default function VirtualKeyboard({ onVisibilityChange }) {
  const [layout, setLayout] = useState('ru')
  const [shifted, setShifted] = useState(false)
  const [activeInput, setActiveInput] = useState(null)
  const lastAlpha = useRef('ru')
  const kbRef = useRef(null)

  useEffect(() => {
    function onFocusIn(e) {
      const el = e.target
      if (el.dataset.keyboard === 'off') {
        setActiveInput(null)
        return
      }
      const isText = el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && !NON_TEXT.has((el.getAttribute('type') || 'text').toLowerCase()))
      if (isText) {
        setActiveInput(el)
        const kb = el.dataset.keyboard
        if (kb && LAYOUTS[kb]) { setLayout(kb); if (kb === 'ru' || kb === 'en') lastAlpha.current = kb }
        // Поле без своей раскладки (комментарий, причина отмены) открываем
        // буквами, а не тем num/sym, что остались от предыдущего поля.
        else setLayout(lastAlpha.current || 'ru')
        // Держим фокусное поле в зоне видимости над клавиатурой
        setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* ignore */ } }, 60)
      }
    }
    function onFocusOut() {
      setTimeout(() => {
        const a = document.activeElement
        if (a?.tagName !== 'INPUT' && a?.tagName !== 'TEXTAREA') setActiveInput(null)
      }, 100)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => { document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut) }
  }, [])

  useEffect(() => {
    onVisibilityChange?.(!!activeInput)
    // Глобальный сигнал для CSS (сдвиг карточек входа), т.к. клавиатура смонтирована один раз в корне
    try {
      document.body.classList.toggle('vkb-open', !!activeInput)
      // Вне модалок рабочий экран поднимается целиком (vkb-lift);
      // внутри модалок оверлей сам сжимается на высоту клавиатуры.
      // .pay-dialog-overlay — оверлей оплаты (position: fixed), сжимается сам:
      // поднимать под ним .app-shell бессмысленно, поэтому он тоже в списке.
      document.body.classList.toggle('vkb-lift', !!activeInput && !activeInput.closest('.modal-overlay, .pay-dialog-overlay, .attn-screen'))
    } catch { /* no body */ }
  }, [activeInput, onVisibilityChange])

  // Реальная высота клавиатуры → CSS-переменная --vkb-height.
  // По ней модальные окна сжимают рабочую область, чтобы активное поле
  // никогда не оказывалось под клавиатурой (см. правило body.vkb-open в CSS).
  // Пересчитываем и при смене раскладки: у num/sym другое число рядов.
  useEffect(() => {
    const root = document.documentElement
    if (!activeInput) {
      root.style.setProperty('--vkb-height', '0px')
      return undefined
    }
    const apply = () => {
      const h = kbRef.current?.offsetHeight || 0
      root.style.setProperty('--vkb-height', `${h}px`)
    }
    apply()
    const reveal = () => { try { activeInput.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* ignore */ } }
    // Доводим поле до центра видимой части дважды: сразу после монтажа
    // клавиатуры и после анимации высоты .app-shell (0.22s). Без второго
    // прохода прокрутка считалась по старой геометрии и поле у нижнего края
    // оставалось под клавиатурой (скролл-контейнер сжимается по ходу анимации).
    const t1 = setTimeout(() => { apply(); reveal() }, 90)
    const t2 = setTimeout(() => { apply(); reveal() }, 320)
    window.addEventListener('resize', apply)
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', apply) }
  }, [activeInput, layout])

  function close() { activeInput?.blur(); setActiveInput(null) }

  const handleKey = useCallback((key) => {
    if (!activeInput) return
    const el = activeInput
    // Сеттер значения берём с ПРАВИЛЬНОГО прототипа: у <textarea> это
    // HTMLTextAreaElement, иначе setter от input бросает «Illegal invocation»
    // и в поле комментария (блюдо, причина отмены) не набирается ни буквы.
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const val = el.value
    const put = (next, caret) => {
      setter?.call(el, next)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      // number/email не поддерживают выделение — там setSelectionRange бросает
      // InvalidStateError и обрывает обработчик (клавиатура «залипала»).
      if (caret != null) { try { el.setSelectionRange(caret, caret) } catch { /* не поддерживается */ } }
    }

    switch (key) {
      case 'backspace':
        if (start === end && start > 0) put(val.slice(0, start - 1) + val.slice(end), start - 1)
        else if (start !== end) put(val.slice(0, start) + val.slice(end), start)
        break
      case 'enter':
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
        break
      case 'space':
        put(val.slice(0, start) + ' ' + val.slice(end), start + 1)
        break
      case 'shift': setShifted((s) => !s); return
      case 'lang': { const n = layout === 'ru' ? 'en' : 'ru'; lastAlpha.current = n; setLayout(n); return }
      case 'num': setLayout('num'); return
      case 'sym': setLayout('sym'); return
      case 'abc': setLayout(lastAlpha.current || 'ru'); return
      default: {
        const ch = shifted ? key.toUpperCase() : key
        put(val.slice(0, start) + ch + val.slice(end), start + ch.length)
        if (shifted) setShifted(false)
      }
    }
    el.focus()
  }, [activeInput, shifted, layout])

  if (!activeInput) return null
  const rows = LAYOUTS[layout] || LAYOUTS.ru

  return (
    <div className="vkb" ref={kbRef} onMouseDown={(e) => e.preventDefault()}>
      <div className="vkb__header">
        <span className="vkb__lang">{layout.toUpperCase()}</span>
        <button className="vkb__close" onClick={close}><X size={18} /></button>
      </div>
      <div className="vkb__rows">
        {rows.map((row, ri) => (
          <div className="vkb__row" key={ri}>
            {row.map((key, ki) => {
              const isDigit = /^[0-9]$/.test(key) && (layout === 'ru' || layout === 'en')
              const cls = [
                'vkb__key',
                key === 'space' && 'vkb__key--wide',
                MEDIUM.has(key) && 'vkb__key--medium',
                isDigit && 'vkb__key--num',
                shifted && key === 'shift' && 'vkb__key--active',
              ].filter(Boolean).join(' ')
              return (
                <button key={`${ri}-${ki}`} className={cls} onClick={() => handleKey(key)}>
                  {label(key, shifted)}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function label(key, shifted) {
  switch (key) {
    case 'backspace': return <Delete size={22} />
    case 'shift': return <ArrowBigUp size={22} />
    case 'enter': return <CornerDownLeft size={22} />
    case 'lang': return <Globe size={18} />
    case 'num': return '123'
    case 'sym': return '#+='
    case 'abc': return 'АБВ'
    case 'space': return ''
    default: return shifted ? key.toUpperCase() : key
  }
}
