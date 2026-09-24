import { useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * DishModal — правка позиции заказа: порция, цена и комментарий.
 * Открывается по клику на позицию В КОРЗИНЕ (не в меню).
 *
 * Порция и цена ЖЁСТКО связаны через цену за 1 порцию (product.price):
 *   цена(итог) = порция × цена_за_порцию.
 * Меняешь порцию — пересчитывается цена; меняешь цену — пересчитывается порция.
 * Цена за порцию и себестоимость (product.cost_price) при этом НЕ меняются —
 * себестоимость показываем справочно, как константу.
 *
 * props: product (name, price = цена за порцию, cost_price = себестоимость),
 *        line ({qty,price,note,takeaway}) — начальные значения,
 *        onSubmit({ quantity, price, note, takeaway }) — price = цена за порцию (курс),
 *        onClose(). hideTakeaway — скрыть «с собой» (у курьера заказ всегда «с собой»).
 */
export default function DishModal({ product, line, onSubmit, onClose, hideTakeaway = false }) {
  // Базовая цена за 1 порцию БЕЗ добавок — фиксированный курс пересчёта порция↔цена.
  // Если позиция уже редактируется с добавками, line.price включает их наценку —
  // вычитаем её, чтобы получить чистую цену блюда.
  const initModifiers = Array.isArray(line?.modifiers) ? line.modifiers : []
  const initModDelta = initModifiers.reduce((s, m) => s + (Number(m.price_delta) || 0), 0)
  const unitPrice = (Number(line?.price ?? product?.price) || 0) - initModDelta
  const costPrice = Number(product?.cost_price) || 0
  // Порцию, которую кассир вводит НАПРЯМУЮ (или щёлкает ±), приводим к аккуратным
  // 2 знакам. Минимум — 0.01, чтобы порция не ушла в ноль/минус.
  const snapQty = (n) => {
    const v = Math.round(Number(n) * 100) / 100
    return v > 0 ? v : 0.01
  }
  // Отображение порции в поле: 2 знака с ОТБРАСЫВАНИЕМ лишнего (не округляя вверх),
  // чтобы выведенная из суммы 0.428571 читалась как 0.42. Точное значение остаётся
  // в состоянии qty — от него считается сумма. 1e-6 гасит float-«недолёт» (1.15→1.14).
  const fmtQty = (s) => {
    const n = Number(s)
    if (!Number.isFinite(n)) return s
    return String(Math.floor(n * 100 + 1e-6) / 100)
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
  if (!product) return null

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

  // Кнопки ±1 порция: считаем от числа и приводим к аккуратному виду (2 знака).
  const stepQty = (delta) => {
    const nq = snapQty(qtyNum + delta)
    setQty(String(nq))
    setTotal(String(Math.round(nq * linePrice)))
  }

  // Уход из поля — чиним только пустое/невалидное поле. Валидную порцию НЕ округляем:
  // округление увело бы выведенную из суммы порцию (0.428571) и сумма к оплате уплыла бы.
  const normalizeQty = () => {
    if (qty === '' || !(qtyNum > 0)) {
      setQty('0.01')
      setTotal(String(Math.round(0.01 * linePrice)))
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{product.name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="dish-modal__body">
          <div className="dish-modal__grid">
            <section className="dish-modal__card">
              <div className="dish-modal__card-head">
                <label htmlFor="dish-qty">{t('qty')}</label>
                <span>× {linePrice.toLocaleString('ru-RU')} {t('currency')}</span>
              </div>
              <div className="dish-modal__control qty-stepper">
                <button type="button" aria-label="Уменьшить порцию" onClick={() => stepQty(-1)}>
                  <Minus size={22} />
                </button>
                <input
                  id="dish-qty"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  className="qty-stepper__input dish-modal__number-input"
                  value={qtyFocused ? qty : fmtQty(qty)}
                  onChange={(e) => applyQty(e.target.value)}
                  onFocus={() => setQtyFocused(true)}
                  onBlur={() => { setQtyFocused(false); normalizeQty() }}
                />
                <button type="button" aria-label="Увеличить порцию" onClick={() => stepQty(1)}>
                  <Plus size={22} />
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
                  <Minus size={22} />
                </button>
                <div className="dish-modal__price-field">
                  <input
                    id="dish-price"
                    type="number"
                    min="0"
                    step="500"
                    inputMode="numeric"
                    value={total}
                    onChange={(e) => applyTotal(e.target.value)}
                    onBlur={normalizeTotal}
                    className="dish-modal__price dish-modal__number-input"
                  />
                  <span>{t('currency')}</span>
                </div>
                <button type="button" aria-label="Увеличить цену" onClick={() => stepTotal(500)}>
                  <Plus size={22} />
                </button>
              </div>
            </section>
          </div>

          <div className="dish-modal__cost-row">
            <div>
              <span className="dish-modal__cost-label">{t('cost_price')}</span>
              <small>{t('cost_fixed')}</small>
            </div>
            <strong className="dish-modal__cost">
              {costPrice > 0 ? `${costPrice.toLocaleString('ru-RU')} ${t('currency')}` : '—'}
            </strong>
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

          {!hideTakeaway && (
            <div className="dish-modal__option-row">
              <div>
                <label>{t('takeaway')}</label>
              </div>
              <button type="button" className={`toggle ${takeaway ? 'toggle--on' : ''}`} onClick={() => setTakeaway((v) => !v)}>
                <span className="toggle__dot" />
              </button>
            </div>
          )}

          <div className="dish-modal__note-block">
            <label htmlFor="dish-note">{t('comment')}</label>
            <textarea
              id="dish-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input dish-modal__note"
              placeholder={t('dish_note_ph')}
              rows={3}
            />
          </div>
        </div>

        <div className="dish-modal__actions">
          {/* price = цена порции С учётом добавок (курс, который увидит корзина);
              modifiers — снапшот выбранных опций (уходит в позицию заказа). */}
          <button className="btn btn--primary" onClick={() => onSubmit({ quantity: qtyNum, price: linePrice, note, takeaway, modifiers: Object.values(selected) })}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
