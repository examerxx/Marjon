import { useState } from 'react'
import { X, Plus, Minus, Trash2 } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * DishModal — правка позиции заказа: количество, цена за порцию, комментарий.
 * Открывается по клику на позицию В КОРЗИНЕ (не в меню).
 * props: product (для названия), line ({qty,price,note}) — начальные значения,
 *        onSubmit({ quantity, price, note }), onRemove?(), onClose().
 */
export default function DishModal({ product, line, onSubmit, onRemove, onClose }) {
  const [qty, setQty] = useState(line?.qty ?? 1)
  const [price, setPrice] = useState(line?.price ?? (Number(product?.price) || 0))
  const [note, setNote] = useState(line?.note ?? '')
  const [takeaway, setTakeaway] = useState(line?.takeaway ?? false)
  if (!product) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal dish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{product.name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>

        <div className="dish-modal__body">
          <div className="dish-modal__row">
            <label>{t('qty')}</label>
            <div className="qty-stepper">
              <button onClick={() => setQty((q) => Math.max(0.1, Math.round((q - 1) * 1000) / 1000))}><Minus size={18} /></button>
              <input
                type="number" step="0.5" min="0.1"
                className="qty-stepper__input"
                value={qty}
                onChange={(e) => setQty(Math.max(0.1, Number(e.target.value) || 0.1))}
              />
              <button onClick={() => setQty((q) => Math.round((q + 1) * 1000) / 1000)}><Plus size={18} /></button>
            </div>
          </div>

          <div className="dish-modal__row">
            <label>{t('price_per')}</label>
            <input type="number" min="0" step="500" value={price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
              className="input dish-modal__price" />
          </div>

          <div className="dish-modal__row">
            <label>{t('takeaway')}</label>
            <button type="button" className={`toggle ${takeaway ? 'toggle--on' : ''}`} onClick={() => setTakeaway((v) => !v)}>
              <span className="toggle__dot" />
            </button>
          </div>

          <div className="dish-modal__row dish-modal__row--col">
            <label>{t('comment')}</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)}
              className="input dish-modal__note" placeholder={t('dish_note_ph')} rows={2} />
          </div>

          <div className="dish-modal__total">{t('total')}: <strong>{(qty * price).toLocaleString('ru-RU')} {t('currency')}</strong></div>
        </div>

        <div className="dish-modal__actions">
          {onRemove && <button className="btn btn--danger dish-modal__del" onClick={onRemove}><Trash2 size={18} /></button>}
          <button className="btn btn--primary" onClick={() => onSubmit({ quantity: qty, price, note, takeaway })}>{t('save')}</button>
        </div>
      </div>
    </div>
  )
}
