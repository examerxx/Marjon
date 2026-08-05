import { useState, useEffect } from 'react'
import {
  LayoutDashboard, ShoppingCart, ChefHat, UtensilsCrossed, Wallet, BarChart3, History, Ban, LogOut,
  Receipt, TrendingUp, Coins,
} from 'lucide-react'
import { orders } from '../../shared/api'
import FinancePanel from '../../components/FinancePanel'
import HistoryPanel from '../../components/HistoryPanel'
import ReportsPanel from '../../components/ReportsPanel'
import StopListPanel from '../../components/StopListPanel'
import { t } from '../../shared/i18n'
function fmt(n) { return Number(n || 0).toLocaleString('ru-RU') }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '' }

export default function ManagerMode({ user = {}, branch = {}, onSwitchMode, onLogout }) {
  const [stats, setStats] = useState({ orders: 0, revenue: 0, avg: 0 })
  const [recent, setRecent] = useState([])
  const [panel, setPanel] = useState(null)

  useEffect(() => {
    orders.list({ branch_id: user.branch_id })
      .then((d) => {
        const all = Array.isArray(d) ? d : d?.items || []
        const today = new Date().toDateString()
        const todays = all.filter((o) => o.created_at && new Date(o.created_at).toDateString() === today)
        const revenue = todays.reduce((s, o) => s + Number(o.total_amount || 0), 0)
        setStats({ orders: todays.length, revenue, avg: todays.length ? Math.round(revenue / todays.length) : 0 })
        setRecent(all.slice(0, 8))
      })
      .catch(() => {})
  }, [user.branch_id])

  const nav = [
    { id: 'overview', name: t('overview'), Icon: LayoutDashboard, active: true },
    { id: 'cashier', name: t('mode_cashier'), Icon: ShoppingCart, onClick: () => onSwitchMode?.('cashier') },
    { id: 'kitchen', name: t('mode_kitchen'), Icon: ChefHat, onClick: () => onSwitchMode?.('kitchen') },
    { id: 'waiter', name: t('mode_waiter'), Icon: UtensilsCrossed, onClick: () => onSwitchMode?.('waiter') },
    { id: 'fin', name: t('finance'), Icon: Wallet, onClick: () => setPanel('fin') },
    { id: 'rep', name: t('reports'), Icon: BarChart3, onClick: () => setPanel('rep') },
    { id: 'hist', name: t('history'), Icon: History, onClick: () => setPanel('hist') },
    { id: 'stop', name: t('stoplist'), Icon: Ban, onClick: () => setPanel('stop') },
  ]

  return (
    <div className="floor">
      <aside className="ws-side">
        <div className="ws-side__label">{t('mode_manager')}</div>
        <nav className="ws-side__nav">
          {nav.map(({ id, name, Icon, active, onClick }) => (
            <button key={id} className={`zone ${active ? 'zone--active' : ''}`} onClick={onClick}>
              <Icon size={20} /><span className="zone__name">{name}</span>
            </button>
          ))}
        </nav>
        <div className="ws-side__spacer" />
        <button className="zone" onClick={onLogout}><LogOut size={20} /><span className="zone__name">{t('logout')}</span></button>
      </aside>

      <main className="ws__main">
        <div className="board__head">
          <div className="board__title">
            <h2>{t('overview')}</h2>
            <span className="board__subtitle">{branch?.name || t('branch')} · {t('today')}</span>
          </div>
        </div>

        <div className="board__scroll">
          <div className="mgr-stats">
            <div className="mgr-tile">
              <span className="mgr-tile__icon mgr-tile__icon--a"><Receipt size={22} /></span>
              <span className="mgr-tile__val">{fmt(stats.orders)}</span>
              <span className="mgr-tile__lbl">{t('orders_today')}</span>
            </div>
            <div className="mgr-tile">
              <span className="mgr-tile__icon mgr-tile__icon--b"><TrendingUp size={22} /></span>
              <span className="mgr-tile__val">{fmt(stats.revenue)} {t('currency')}</span>
              <span className="mgr-tile__lbl">{t('revenue')}</span>
            </div>
            <div className="mgr-tile">
              <span className="mgr-tile__icon mgr-tile__icon--c"><Coins size={22} /></span>
              <span className="mgr-tile__val">{fmt(stats.avg)} {t('currency')}</span>
              <span className="mgr-tile__lbl">{t('avg_check')}</span>
            </div>
          </div>

          <div className="mgr-recent">
            <h3 className="mgr-recent__title">{t('recent_orders')}</h3>
            {recent.length === 0 ? (
              <p className="settings-hint">{t('no_orders_yet')}</p>
            ) : (
              <table className="hist-table">
                <thead><tr><th>{t('col_no')}</th><th>{t('col_table')}</th><th>{t('col_status')}</th><th>{t('col_time')}</th><th className="ta-r">{t('col_sum')}</th></tr></thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.id}>
                      <td className="hist-num">#{o.order_number ?? '—'}</td>
                      <td>{o.table_number || '—'}</td>
                      <td><span className={`hist-status hist-status--${o.status}`}>{t.status(o.status)}</span></td>
                      <td className="hist-date">{fmtTime(o.created_at)}</td>
                      <td className="ta-r hist-sum">{fmt(o.total_amount)} {t('currency')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {panel === 'fin' && <FinancePanel branch={branch} onClose={() => setPanel(null)} />}
      {panel === 'hist' && <HistoryPanel branch={branch} onClose={() => setPanel(null)} />}
      {panel === 'rep' && <ReportsPanel branch={branch} onClose={() => setPanel(null)} />}
      {panel === 'stop' && <StopListPanel onClose={() => setPanel(null)} />}
    </div>
  )
}
