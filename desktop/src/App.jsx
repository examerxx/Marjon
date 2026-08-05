import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import BranchSelector from './pages/BranchSelector'
import ModeSelector from './pages/ModeSelector'
import CashierMode from './modes/cashier/CashierMode'
import KitchenMode from './modes/kitchen/KitchenMode'
import WaiterMode from './modes/waiter/WaiterMode'
import BarMode from './modes/bar/BarMode'
import {
  connectPrinterWS, disconnectPrinterWS,
  connectKitchenWS, disconnectKitchenWS,
  onKitchenEvent,
} from './shared/ws'

const MODES = { cashier: CashierMode, kitchen: KitchenMode, waiter: WaiterMode, bar: BarMode }
const RELAY_EVENTS = ['new_order', 'order_updated', 'order_cancelled', 'item_status_changed']

function loadUser()   { try { return JSON.parse(localStorage.getItem('marjon_user'))   } catch { return null } }
function loadBranch() { try { return JSON.parse(localStorage.getItem('marjon_branch')) } catch { return null } }

export default function App() {
  const [token,       setToken]       = useState(() => localStorage.getItem('marjon_token'))
  const [user,        setUser]        = useState(loadUser)
  const [branch,      setBranch]      = useState(loadBranch)
  const [mode,        setMode]        = useState(null)
  const [localWsInfo, setLocalWsInfo] = useState(null)

  // Refresh local WS info periodically so client count stays current
  useEffect(() => {
    if (!window.electron?.localWS) return
    const refresh = () => window.electron.localWS.info().then(setLocalWsInfo)
    refresh()
    const t = setInterval(refresh, 5_000)
    return () => clearInterval(t)
  }, [])

  // Connect cloud WS + relay to local mobile clients after mode is chosen
  useEffect(() => {
    if (!token || !branch?.id || !mode) return
    const serverUrl = localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1'
    window.electron?.localWS?.setServerUrl(serverUrl)
    connectPrinterWS(serverUrl, token, branch.id)
    connectKitchenWS(serverUrl, token, branch.id)

    // Relay every kitchen event to local mobile clients on the LAN
    const unsubs = RELAY_EVENTS.map((event) =>
      onKitchenEvent(event, (data) => window.electron?.localWS?.broadcast(event, data))
    )

    return () => {
      disconnectPrinterWS()
      disconnectKitchenWS()
      unsubs.forEach((fn) => fn())
    }
  }, [token, branch?.id, mode])

  function handleLogin(data) {
    localStorage.setItem('marjon_token', data.access_token)
    localStorage.setItem('marjon_user', JSON.stringify(data.user))
    setToken(data.access_token)
    setUser(data.user)
    setBranch(null)
    localStorage.removeItem('marjon_branch')
  }

  function handleBranchSelect(selectedBranch) {
    localStorage.setItem('marjon_branch', JSON.stringify(selectedBranch))
    setBranch(selectedBranch)
  }

  function handleLogout() {
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_user')
    localStorage.removeItem('marjon_branch')
    setToken(null); setUser(null); setBranch(null); setMode(null)
    disconnectPrinterWS()
    disconnectKitchenWS()
    window.electron?.localWS?.setServerUrl(null)
  }

  if (!token || !user)  return <LoginPage onLogin={handleLogin} />
  if (!branch)          return <BranchSelector user={user} onSelect={handleBranchSelect} onLogout={handleLogout} />
  if (!mode)            return <ModeSelector user={user} branch={branch} onSelect={setMode} onLogout={handleLogout} localWsInfo={localWsInfo} />

  const userWithBranch = { ...user, branch_id: branch.id }
  const ModeComponent = MODES[mode]
  return (
    <>
      <ModeComponent user={userWithBranch} onLogout={handleLogout} onBack={() => setMode(null)} />
      {localWsInfo && (
        <LocalWsBadge info={localWsInfo} />
      )}
    </>
  )
}

/** Small bottom-right badge showing local WS IP for mobile staff to see. */
function LocalWsBadge({ info }) {
  const [visible, setVisible] = useState(false)
  return (
    <div
      style={{
        position: 'fixed', bottom: 12, right: 12,
        zIndex: 9999, fontFamily: 'monospace', fontSize: 12,
      }}
    >
      {visible ? (
        <div style={{
          background: '#071428', color: '#fff', borderRadius: 10,
          padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          minWidth: 220,
        }}>
          <div style={{ color: '#1db5b5', fontWeight: 700, marginBottom: 6 }}>
            📱 Локальный WS
          </div>
          <div>ws://{info.ip}:{info.port}</div>
          <div style={{ marginTop: 6 }}>
            <div style={{ color: '#7a94b4' }}>Код подключения (ввести на телефоне):</div>
            <div style={{ color: '#1db5b5', fontWeight: 700, letterSpacing: 1, wordBreak: 'break-all' }}>
              {info.token}
            </div>
          </div>
          <div style={{ color: '#7a94b4', marginTop: 6 }}>
            Подключено устройств: {info.clients}
          </div>
          <button
            onClick={() => setVisible(false)}
            style={{
              marginTop: 8, background: 'none', border: 'none',
              color: '#7a94b4', cursor: 'pointer', fontSize: 11,
            }}
          >
            Скрыть
          </button>
        </div>
      ) : (
        <button
          onClick={() => setVisible(true)}
          title={`Локальный WS: ws://${info.ip}:${info.port} (${info.clients} устройств)`}
          style={{
            background: info.clients > 0 ? '#1db5b5' : '#162840',
            border: 'none', borderRadius: 20, padding: '4px 10px',
            color: '#fff', cursor: 'pointer', fontSize: 11,
          }}
        >
          📱 {info.clients}
        </button>
      )}
    </div>
  )
}
