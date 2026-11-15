import { useEffect, useRef, useState } from 'react'
import { X, Plus, Minus, Ban, Clock, User } from 'lucide-react'
import { t } from '../shared/i18n'
import { formatQty } from '../shared/qty'
import { sanitizeDecimal, sanitizeInt } from '../shared/numeric'
import { fmtTime } from '../shared/time'
import WaiterPicker from './WaiterPicker'

/**
 * DishModal — правка позиции заказа: порция, цена и комментарий.
 * Открывается по клику на позицию В КОРЗИНЕ (не в меню).
 *
 * Порция и цена ЖЁСТКО связаны через цену за 1 порцию (product.price):
 *   цена(итог) = порция × цена_за_порцию.
 * Меняешь порцию — пересчитывается цена; меняешь цену — пересчитывается порция.
 * Цена за порцию при этом НЕ меняется.
 *
 * Себестоимость здесь НЕ показываем: экран открывает официант/кассир у гостя,
 * закупочные цены — не их информация (убрано по требованию заказчика).
 *
 * Компактная вёрстка: экран должен целиком влезать на терминал вместе с блоком
 * «кто добавил», сменой официанта и отменой блюда.
 *
 * props: product (name, price = цена за порцию),
 *        line ({qty,price,note,takeaway,modifiers}) — начальные значения,
 *        onSubmit({ quantity, price, note, takeaway, modifiers }) — price = цена за порцию (курс),
 *        onClose(). hideTakeaway — скрыть «с собой» (у курьера заказ всегда «с собой»).
 *        meta — { addedByName, createdAt } кто и когда добавил позицию,
 *        onCancelDish — отменить (вернуть) блюдо с обязательной причиной.
 *
 * Смены официанта здесь больше нет: ответственного за позицию меняет касса
 * на экране заказа, а карточка блюда — только про порцию, цену и комментарий.
 */
export default function DishModal({
  product, line, onSubmit, onClose, hideTakeaway = false,
  meta = null, onCancelDish, onMoveTable, onSaveSent, readOnly = false,
  onChangeWaiter, waiterOptions,
}) {
  const closeTimer = useRef(null)
  const [closing, setClosing] = useState(false)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  function dismiss(callback = onClose) {
    if (closeTimer.current !== null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      callback()
      return
    }
    setClosing(true)
    closeTimer.current = setTimeout(callback, 150)
  }

  const overlayClass = `modal-overlay dish-overlay${closing ? ' dish-overlay--closing' : ''}`
  const step = Number(product?.portion_step) || 1
  const isFractional = step !== 1 && step > 0

  // Базовая цена за 1 порцию БЕЗ добавок — фиксированный курс пересчёта порция↔цена.
  // Если позиция уже редактируется с добавками, line.price включает их наценку —
  // вычитаем её, чтобы получить чистую цену блюда.
  const initModifiers = Array.isArray(line?.modifiers) ? line.modifiers : []
  const initModDelta = initModifiers.reduce((s, m) => s + (Number(m.price_delta) || 0), 0)
  const unitPrice = (Number(line?.price ?? product?.price) || 0) - initModDelta
  // Порцию, которую кассир вводит НАПРЯМУЮ (или щёлкает ±), приводим к аккуратным
  // знакам в зависимости от шага (0.1→1 знак, 0.25→2 знака, иначе 2).
  const snapQty = (n) => {
    const decimals = step === 0.1 ? 1 : step === 0.25 ? 2 : 2
    const factor = 10 ** decimals
    const v = Math.round(Number(n) * factor) / factor
    return v > 0 ? v : step
  }
  // Отображение порции в поле: знаки с ОТБРАСЫВАНИЕМ лишнего (не округляя вверх),
  // чтобы выведенная из суммы 0.428571 читалась как 0.42. Точное значение остаётся
  // в состоянии qty — от него считается сумма. 1e-6 гасит float-«недолёт» (1.15→1.14).
  const fmtQty = (s) => {
    const n = Number(s)
    if (!Number.isFinite(n)) return s
    const decimals = step === 0.1 ? 1 : step === 0.25 ? 2 : 2
    const factor = 10 ** decimals
    return String(Math.floor(n * factor + 1e-6) / factor)
  }
  // Порция, ВЫВЕДЕННАЯ из введённой суммы, НЕ округляется вообще — храним полную
  // точность деления, иначе сумма к оплате (linePrice × порция) уедет от набранной
  // (ввёл 30000 — вышло бы 30002/29800). В поле такую порцию показываем через
  // fmtQty (0.428571 → 0.42), а в расчёт идёт точное значение.
  const qtyFromSum = (sum) => {
    const v = sum / linePrice
    return v > 0 ? v : 0.01
  }

  // Группы добавок: показываем на кассе только те, у которых show_in_pos !== false.
  const groups = (product?.modifier_groups || []).filter((g) => g.show_in_pos !== false)
  // Выбранные опции: { [modifierId]: modifierObject }. Восстанавливаем из line.modifiers
  // при повторном открытии позиции.
  const [selected, setSelected] = useState(() => {
    const map = {}
    for (const m of initModifiers) if (m.id) map[m.id] = m
    return map
  })
  const modDelta = Object.values(selected).reduce((s, m) => s + (Number(m.price_delta) || 0), 0)
  // Цена порции с учётом выбранных добавок — основа пересчёта порция↔цена.
  const linePrice = unitPrice + modDelta

  // Порцию из сохранённой позиции берём КАК ЕСТЬ (не округляем): она могла быть
  // выведена из суммы (0.428571) — округление увело бы сумму при повторном открытии.
  const initQty = Number(line?.qty) > 0 ? Number(line.qty) : 1
  // Порция — строка (как и цена ниже): даёт спокойно набирать «1.7», «0.5», «1.25»
  // без прыжков курсора и досрочного округления на каждой цифре.
  const [qty, setQty] = useState(String(initQty))
  const qtyNum = Number(qty) || 0
  // Фокус поля порции: пока редактируют — показываем точное значение (свободный ввод),
  // без фокуса — аккуратные 2 знака (fmtQty).
  const [qtyFocused, setQtyFocused] = useState(false)
  // Строка позволяет временно очистить поле и спокойно набрать новую цену.
  const [total, setTotal] = useState(String(Math.round(initQty * (unitPrice + initModDelta))))
  const [note, setNote] = useState(line?.note ?? '')
  const [takeaway, setTakeaway] = useState(line?.takeaway ?? false)
  if (!product && !line) return null

  // Клик по опции добавки. Одиночный выбор (max_select≤1) заменяет выбор в группе,
  // множественный — переключает с учётом лимита max_select. min/max мягкие:
  // сохранение не блокируем, цена пересчитывается сразу от количества.
  const toggleModifier = (group, mod) => {
    const groupIds = (group.modifiers || []).map((m) => m.id)
    const next = { ...selected }
    const isOn = Boolean(next[mod.id])
    if (isOn) {
      delete next[mod.id]
    } else {
      const maxSelect = Number(group.max_select) || 1
      if (maxSelect <= 1) {
        for (const id of groupIds) delete next[id]
      } else if (groupIds.filter((id) => next[id]).length >= maxSelect) {
        return   // лимит группы достигнут
      }
      next[mod.id] = {
        id: mod.id, name: mod.name,
        price_delta: Number(mod.price_delta) || 0,
        group_id: group.id, group_name: group.name,
      }
    }
    setSelected(next)
    // total пересчитываем от нового набора добавок (setSelected асинхронный).
    const nextDelta = Object.values(next).reduce((s, m) => s + (Number(m.price_delta) || 0), 0)
    setTotal(String(Math.round(qtyNum * (unitPrice + nextDelta))))
  }

  // Свободный ввод порции: пишем строку как есть, цену пересчитываем на лету.
  const applyQty = (rawValue) => {
    setQty(rawValue)
    if (rawValue === '') return
    const q = Number(rawValue)
    if (!Number.isFinite(q) || q <= 0) return
    setTotal(String(Math.round(q * linePrice)))
  }

  // Кнопки ± порция: считаем от числа и приводим к аккуратному виду.
  const stepQty = (delta) => {
    const nq = snapQty(qtyNum + delta * step)
    setQty(String(nq))
    setTotal(String(Math.round(nq * linePrice)))
  }

  // Уход из поля — чиним только пустое/невалидное поле. Валидную порцию НЕ округляем:
  // округление увело бы выведенную из суммы порцию (0.428571) и сумма к оплате уплыла бы.
  const normalizeQty = () => {
    if (qty === '' || !(qtyNum > 0)) {
      setQty(String(step))
      setTotal(String(Math.round(step * linePrice)))
    }
  }

  const applyTotal = (rawValue) => {
    setTotal(rawValue)
    if (rawValue === '') return
    const sum = Number(rawValue)
    if (!Number.isFinite(sum) || sum <= 0 || linePrice <= 0) return
    setQty(String(qtyFromSum(sum)))
  }

  const stepTotal = (delta) => {
    const minimum = linePrice > 0 ? Math.max(1, Math.round(linePrice * 0.1)) : 0
    applyTotal(String(Math.max(minimum, (Number(total) || 0) + delta)))
  }

  const normalizeTotal = () => {
    // Сумму, набранную кассиром, НЕ переписываем — иначе введённые 30000
    // превратились бы в 30500/29800. Пустое поле возвращаем к пересчёту от порции.
    if (total === '') setTotal(String(Math.round(qtyNum * linePrice)))
  }

  const addedBy = meta?.addedByName || meta?.waiterName || ''
  const hasMeta = Boolean(addedBy || meta?.createdAt)

  // Изменения сохранённой позиции отправляем отдельной операцией через onSaveSent.
  const [sentPrice, setSentPrice] = useState(null)
  // Итог, который кассир задал напрямую (150 000): количество считается из него,
  // а при сохранении цена за порцию подгоняется так, чтобы итог был ровно таким.
  const [exactTotal, setExactTotal] = useState(null)
  const [priceOpen, setPriceOpen] = useState(false)
  const [editingTotal, setEditingTotal] = useState(false)
  const [priceDraft, setPriceDraft] = useState('')
  const [qtyOpen, setQtyOpen] = useState(false)
  const [qtyDraft, setQtyDraft] = useState('')
  const [sentBusy, setSentBusy] = useState(false)
  const [sentError, setSentError] = useState('')
  if (readOnly) {
    const initialPrice = Number(line?.price || 0) + initModDelta
    const roPrice = sentPrice ?? initialPrice
    const changed = qtyNum !== initQty || roPrice !== initialPrice || exactTotal != null
    const roSum = exactTotal != null ? exactTotal : changed ? Math.max(0, qtyNum * roPrice - Number(line?.discount || 0)) : Number(line?.total ?? qtyNum * roPrice)
    // Цена за порцию фиксирована; итог ↔ количество связаны. Бэкенд хранит 3 знака.
    const qtyFromTotal = (sum) => Math.max(0.001, Math.round(((sum + Number(line?.discount || 0)) / (roPrice || 1)) * 1000) / 1000)
    async function finish() {
      if (!changed || !onSaveSent) { dismiss(); return }
      setSentBusy(true)
      setSentError('')
      try {
        const unit = exactTotal != null ? (exactTotal + Number(line?.discount || 0)) / qtyNum : roPrice
        await onSaveSent(qtyNum, Math.round((unit - initModDelta) * 100) / 100)
        dismiss()
      } catch (error) {
        setSentError(error?.response?.data?.detail || error.message)
      } finally { setSentBusy(false) }
    }
    async function changeWaiter(id) {
      setSentBusy(true)
      setSentError('')
      try {
        await onChangeWaiter(id)
      } catch (error) {
        setSentError(error?.response?.data?.detail || error.message)
      } finally {
        setSentBusy(false)
      }
    }
    const mods = Array.isArray(line?.modifiers) ? line.modifiers.filter((m) => m && m.name) : []
    return (
      <div className={overlayClass} inert={closing ? '' : undefined} onClick={() => { if (!sentBusy && !priceOpen) dismiss() }}>
        <div className={`modal dish-modal dish-modal--compact dish-modal--sent${priceOpen ? ' dish-modal--shifted' : ''}${qtyOpen ? ' dish-modal--shifted-right' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="modal__header dish-modal__head">
            <div className="dish-sent-heading"><h3>{product?.name || line?.name}</h3>
            {hasMeta && (
              <div className="dish-modal__meta">
                {addedBy && <span><User size={14} /> {addedBy}</span>}
                {meta?.createdAt && <span><Clock size={14} /> {fmtTime(meta.createdAt)}</span>}
              </div>
            )}
            </div>
            <button className="icon-btn" disabled={sentBusy} onClick={() => dismiss()}><X size={24} /></button>
          </div>
          <div className="dish-modal__body">
            <div className="dish-modal__grid">
              <section className="dish-modal__card dish-modal__card--accent">
                <div className="dish-modal__card-head">
                  <span className="dish-sent-label">{t('qty')}</span>
                  <span className="dish-sent-total">× {roPrice.toLocaleString('ru-RU')} {t('currency')}</span>
                </div>
                {onSaveSent ? <div className="dish-modal__control qty-stepper dish-sent-qty">
                <button aria-label={t('qty_less')} disabled={sentBusy || qtyNum <= step}
                  onClick={() => { setQty(String(snapQty(qtyNum - step))); setExactTotal(null) }}><Minus size={16} /></button>
                <button type="button" className="dish-sent-value" aria-label={t('qty')} disabled={sentBusy}
                  onClick={() => { setPriceOpen(false); setQtyDraft(String(qtyNum)); setQtyOpen(true) }}>
                  {formatQty(qtyNum)}
                </button>
                <button aria-label={t('qty_more')} disabled={sentBusy}
                  onClick={() => { setQty(String(snapQty(qtyNum + step))); setExactTotal(null) }}><Plus size={16} /></button>
                </div> : <strong className="dish-sent-value">{formatQty(qtyNum)}</strong>}
              </section>
              <section className="dish-modal__card dish-modal__card--accent">
                <div className="dish-modal__card-head">
                  <span className="dish-sent-label">{t('price')}</span>
                  <span className="dish-sent-total">{t('qty')}: {formatQty(qtyNum)}</span>
                </div>
                {onSaveSent ? <div className="dish-modal__control dish-modal__price-stepper">
                  <button type="button" aria-label="Уменьшить цену" disabled={sentBusy || roSum - 500 <= 0}
                    onClick={() => { setQty(String(qtyFromTotal(roSum - 500))); setExactTotal(roSum - 500) }}><Minus size={20} /></button>
                  <button type="button" className="dish-sent-value" disabled={sentBusy} onClick={() => {
                    setQtyOpen(false); setEditingTotal(true); setPriceDraft(String(Math.round(roSum))); setPriceOpen(true)
                  }}>{Math.round(roSum).toLocaleString('ru-RU')} {t('currency')}</button>
                  <button type="button" aria-label="Увеличить цену" disabled={sentBusy}
                    onClick={() => { setQty(String(qtyFromTotal(roSum + 500))); setExactTotal(roSum + 500) }}><Plus size={20} /></button>
                </div> : <strong className="dish-sent-value">{Math.round(roSum).toLocaleString('ru-RU')} {t('currency')}</strong>}
              </section>
            </div>
            {mods.length > 0 && (
              <div className="dish-modal__static-mods">
                {mods.map((m) => <span key={m.id || m.name}>{m.name}</span>)}
              </div>
            )}
            {(onChangeWaiter || onMoveTable || onCancelDish) && <div className="dish-sent-actions">
              {onChangeWaiter && <WaiterPicker staff={waiterOptions} value={line.waiterId} label={t('change_waiter')} hideLabel
                onChange={changeWaiter} disabled={sentBusy || !waiterOptions?.length} />}
              {onMoveTable && <button type="button" className="btn btn--outline" disabled={sentBusy} onClick={onMoveTable}>{t('move_table')}</button>}
              {onCancelDish && <button type="button" className="btn btn--outline" disabled={sentBusy} onClick={onCancelDish}>
                <Ban size={18} /> {t('cancel_dish')}
              </button>}
            </div>}
            {sentError && <p role="alert">{sentError}</p>}
          </div>
          <div className="dish-modal__actions">
            <button type="button" className="cart-btn cart-btn--pay" disabled={sentBusy || !(qtyNum > 0)} onClick={finish}>{t(changed ? 'save' : 'close')}</button>
          </div>
        </div>
        {qtyOpen && <div className="pay-confirm pay-confirm--side pay-confirm--left" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('qty')}>
          <div className="pay-amount-pad dish-price-pad">
            <div className="pay-method__head">
              <label className="pay-amount-pad__label" htmlFor="dish-sent-qty">{t('qty')}</label>
              <button className="icon-btn" aria-label={t('close')} onClick={() => setQtyOpen(false)}><X size={18} /></button>
            </div>
            <div className="pay-amount-pad__field">
              <input id="dish-sent-qty" inputMode="none" data-keyboard="off" autoFocus
                value={qtyDraft.replace('.', ',')} onFocus={(event) => event.target.select()}
                onChange={(event) => setQtyDraft(sanitizeDecimal(event.target.value.replace(',', '.'), 3))} />
            </div>
            <div className="pay-amount-pad__keys">
              {['1','2','3','4','5','6','7','8','9','.','0','delete'].map((key) => (
                <button key={key} type="button" className="vkb__key"
                  aria-label={key === 'delete' ? t('payment_delete_digit') : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setQtyDraft((d) => sanitizeDecimal(key === 'delete' ? d.slice(0, -1) : d + key, 3))}>
                  {key === 'delete' ? '⌫' : key === '.' ? ',' : key}
                </button>
              ))}
            </div>
            <button className="btn btn--primary" disabled={!(Number(qtyDraft) > 0)}
              onClick={() => { setQty(String(Number(qtyDraft))); setExactTotal(null); setQtyOpen(false) }}>{t('save')}</button>
          </div>
        </div>}
        {priceOpen && <div className="pay-confirm pay-confirm--side" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('price')}>
          <div className="pay-amount-pad dish-price-pad">
            <div className="pay-method__head">
              <label className="pay-amount-pad__label" htmlFor="dish-unit-price">{t('price')}</label>
              <button className="icon-btn" aria-label={t('close')} onClick={() => setPriceOpen(false)}><X size={18} /></button>
            </div>
            <div className="pay-amount-pad__field">
              <input id="dish-unit-price" inputMode="none" data-keyboard="off" autoFocus
                value={priceDraft.split('.').map((part, index) => index === 0 ? part.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : part).join(',')} onFocus={(event) => event.target.select()}
                onChange={(event) => setPriceDraft(sanitizeDecimal(event.target.value, 2))} />
              <span>{t('currency')}</span>
            </div>
            <div className="pay-amount-pad__keys">
              {['1','2','3','4','5','6','7','8','9','.','0','delete'].map((key) => (
                <button key={key} type="button" className="vkb__key"
                  aria-label={key === 'delete' ? t('payment_delete_digit') : undefined}
                  onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
                    const field = event.currentTarget.closest('.dish-price-pad').querySelector('input')
                    const from = sanitizeDecimal(field.value.slice(0, field.selectionStart), 2).length
                    const to = sanitizeDecimal(field.value.slice(0, field.selectionEnd), 2).length
                    const start = key === 'delete' && from === to ? Math.max(0, from - 1) : from
                    setPriceDraft(sanitizeDecimal(priceDraft.slice(0, start) + (key === 'delete' ? '' : key) + priceDraft.slice(to), 2))
                  }}>{key === 'delete' ? '⌫' : key === '.' ? ',' : key}</button>
              ))}
            </div>
            <button className="btn btn--primary" disabled={!priceDraft || !Number.isFinite(Number(priceDraft)) || Number(priceDraft) <= 0}
              onClick={() => {
                setQty(String(qtyFromTotal(Number(priceDraft))))
                setExactTotal(Number(priceDraft))
                setPriceOpen(false)
              }}>{t('save')}</button>
          </div>
        </div>}
      </div>
    )
  }

  return (
    <div className={overlayClass} inert={closing ? '' : undefined} onClick={() => dismiss()}>
      <div className="modal dish-modal dish-modal--compact" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header dish-modal__head">
          <h3>{product.name}</h3>
          <button className="icon-btn" onClick={() => dismiss()}><X size={24} /></button>
        </div>

        <div className="dish-modal__body">
          {/* Кто и когда добавил — компактной строкой, без отдельной карточки */}
          {hasMeta && (
            <div className="dish-modal__meta">
              {addedBy && <span><User size={14} /> {addedBy}</span>}
              {meta?.createdAt && <span><Clock size={14} /> {fmtTime(meta.createdAt)}</span>}
            </div>
          )}

          <div className="dish-modal__grid">
            <section className="dish-modal__card">
              <div className="dish-modal__card-head">
                <label htmlFor="dish-qty">{t('qty')}{isFractional && <small style={{marginLeft:6,opacity:.7}}>×{step}</small>}</label>
                <span>× {linePrice.toLocaleString('ru-RU')} {t('currency')}</span>
              </div>
              <div className="dish-modal__control qty-stepper">
                <button type="button" aria-label="Уменьшить порцию" onClick={() => stepQty(-1)}>
                  <Minus size={20} />
                </button>
                <input
                  id="dish-qty"
                  type="text"
                  inputMode="decimal"
                  data-keyboard="num"
                  className="qty-stepper__input dish-modal__number-input"
                  value={qtyFocused ? qty : fmtQty(qty)}
                  onChange={(e) => applyQty(sanitizeDecimal(e.target.value, 3))}
                  onFocus={() => setQtyFocused(true)}
                  onBlur={() => { setQtyFocused(false); normalizeQty() }}
                />
                <button type="button" aria-label="Увеличить порцию" onClick={() => stepQty(1)}>
                  <Plus size={20} />
                </button>
              </div>
            </section>

            <section className="dish-modal__card dish-modal__card--accent">
              <div className="dish-modal__card-head">
                <label htmlFor="dish-price">{t('price')}</label>
                <span>{t('qty')}: {fmtQty(qty)}</span>
              </div>
              <div className="dish-modal__control dish-modal__price-stepper">
                <button type="button" aria-label="Уменьшить цену" onClick={() => stepTotal(-500)}>
                  <Minus size={20} />
                </button>
                <div className="dish-modal__price-field">
                  <input
                    id="dish-price"
                    type="text"
                    inputMode="numeric"
                    data-keyboard="num"
                    value={total.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                    onChange={(e) => applyTotal(sanitizeInt(e.target.value))}
                    onBlur={normalizeTotal}
                    className="dish-modal__price dish-modal__number-input"
                  />
                  <span>{t('currency')}</span>
                </div>
                <button type="button" aria-label="Увеличить цену" onClick={() => stepTotal(500)}>
                  <Plus size={20} />
                </button>
              </div>
            </section>
          </div>

          {/* Добавки: настроены в веб-админке, показываем только группы с show_in_pos.
              Наценка выбранной опции сразу входит в цену порции (пересчёт total). */}
          {groups.length > 0 && (
            <div className="dish-modal__addons">
              {groups.map((group) => (
                <div className="dish-modal__addon-group" key={group.id}>
                  <div className="dish-modal__addon-head">
                    <span>{group.name}</span>
                    {group.is_required && <em className="dish-modal__addon-req">{t('addon_required')}</em>}
                  </div>
                  <div className="dish-modal__addon-opts">
                    {(group.modifiers || []).map((mod) => {
                      const on = Boolean(selected[mod.id])
                      const delta = Number(mod.price_delta) || 0
                      return (
                        <button
                          type="button"
                          key={mod.id}
                          className={`dish-modal__addon ${on ? 'is-on' : ''}`}
                          onClick={() => toggleModifier(group, mod)}
                        >
                          <span className="dish-modal__addon-name">{mod.name}</span>
                          {delta !== 0 && (
                            <span className="dish-modal__addon-price">
                              {delta > 0 ? '+' : ''}{delta.toLocaleString('ru-RU')} {t('currency')}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* «С собой» — отдельная строка настроек (официанта позиции здесь больше нет) */}
          <div className="dish-modal__settings">
            {!hideTakeaway && (
              <button
                type="button"
                className={`dish-modal__toggle-row ${takeaway ? 'is-on' : ''}`}
                onClick={() => setTakeaway((v) => !v)}
                aria-pressed={takeaway ? 'true' : 'false'}
              >
                <span>{t('takeaway')}</span>
                <span className={`toggle ${takeaway ? 'toggle--on' : ''}`}><span className="toggle__dot" /></span>
              </button>
            )}
          </div>

          <div className="dish-modal__note-block">
            <label htmlFor="dish-note">{t('comment')}</label>
            <textarea
              id="dish-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input dish-modal__note"
              placeholder={t('dish_note_ph')}
              rows={2}
            />
          </div>
        </div>

        <div className="dish-modal__actions">
          {/* Отмена блюда — только для позиции, которая уже в заказе. Причина
              обязательна (спросит родитель) и печатается в чеке. */}
          {onCancelDish && (
            <button type="button" className="btn btn--outline dish-modal__cancel" onClick={onCancelDish}>
              <Ban size={18} /> {t('cancel_dish')}
            </button>
          )}
          {/* price = цена порции С учётом добавок (курс, который увидит корзина);
              modifiers — снапшот выбранных опций (уходит в позицию заказа). */}
          <button className="cart-btn cart-btn--pay" onClick={() => dismiss(() => onSubmit({ quantity: qtyNum, price: linePrice, note, takeaway, modifiers: Object.values(selected) }))}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
