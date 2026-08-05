import { useState, useEffect } from 'react'
import { X, ChefHat } from 'lucide-react'
import { menu } from '../shared/api'
import { t } from '../shared/i18n'

export default function RecipeModal({ product, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    menu.recipe(product.id)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [product.id])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal recipe-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3><ChefHat size={20} /> {t('tech_card')} — {product.name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={22} /></button>
        </div>
        <div className="modal__body">
          {loading ? (
            <div className="kitchen-empty"><div className="spinner" /></div>
          ) : data?.items?.length ? (
            <>
              {data.description && <p className="recipe-desc">{data.description}</p>}
              <table className="hist-table">
                <thead><tr><th>{t('ingredient')}</th><th className="ta-r">{t('amount')}</th></tr></thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={i}><td>{it.ingredient_name}</td><td className="ta-r hist-sum">{it.quantity} {it.unit}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="recipe-out">{t('recipe_yield')}: 1 {data.unit || t('portion')}</div>
            </>
          ) : (
            <p className="settings-hint">{t('recipe_empty')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
