import { useState, useEffect, useCallback } from 'react'
import { Lock } from 'lucide-react'
import ServerSetup from './pages/ServerSetup'
import LoginPage from './pages/LoginPage'
import BranchSelector from './pages/BranchSelector'
import OrganizationScreen from './pages/OrganizationScreen'
import EmployeeSelector from './pages/EmployeeSelector'
import PinPad from './pages/PinPad'
import TopBar from './components/TopBar'
import BottomBar from './components/BottomBar'
import SettingsModal from './components/SettingsModal'
import CashierMode from './modes/cashier/CashierMode'
import KitchenMode from './modes/kitchen/KitchenMode'
import WaiterMode from './modes/waiter/WaiterMode'
import { auth, branding, flushQueue, queueSize } from './shared/api'
import { t } from './shared/i18n'
import { kitchenWS } from './services/kitchenWS'
import { connectPrinterWS, disconnectPrinterWS } from './shared/ws'

const MODES = {
  cashier: { component: CashierMode, label: 'Касса' },
  kitchen: { component: KitchenMode, label: 'Кухня' },
  waiter: { component: WaiterMode, label: 'Официант' },
}

// Relayed to mobile devices on the LAN via the desktop's local WS proxy.
const RELAY_EVENTS = ['new_order', 'order_updated', 'order_cancelled', 'item_status_changed']

// Роль → рабочий режим. Роли пока только официант/кассир; повар → кухня (KDS).
// Владелец/менеджер/админ и прочие по умолчанию → касса (полный доступ кассира).
const ROLE_TO_MODE = {
  waiter: 'waiter', cashier: 'cashier',
  cook: 'kitchen', chef: 'kitchen', kitchen: 'kitchen', bartender: 'kitchen',
}
function roleToMode(user, employee) {
  const slugs = [...(user?.role_slugs || [])]
  if (employee?.role_slug) slugs.push(employee.role_slug)
  for (const s of slugs) {
    const m = ROLE_TO_MODE[String(s || '').toLowerCase()]
    if (m) return m
  }
  return 'cashier'   // дефолт — касса
}

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

export default function App() {
  // Привязка терминала (admin login — сохраняется навсегда)
  const [orgToken, setOrgToken] = useState(() => localStorage.getItem('marjon_org_token'))
  const [orgUser, setOrgUser] = useState(() => loadJson('marjon_org_user'))
  const [branch, setBranch] = useState(() => loadJson('marjon_branch'))

  // Сотрудник (PIN-вход — текущая сессия)
  const [staffToken, setStaffToken] = useState(() => localStorage.getItem('marjon_token'))
  const [staffUser, setStaffUser] = useState(() => loadJson('marjon_user'))
  const [mode, setMode] = useState(() => localStorage.getItem('marjon_mode') || null)

  // Под-поток входа сотрудника
  const [staffView, setStaffView] = useState('org')      // org | employees | pin
  const [pinEmployee, setPinEmployee] = useState(null)

  const [isOnline, setIsOnline] = useState(true)
  const [queued, setQueued] = useState(() => queueSize())
  const [, setLangVersion] = useState(0)   // бамп для перерисовки при смене языка
  const [isLocked, setIsLocked] = useState(false)
  const [lockPin, setLockPin] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const isStaffLoggedIn = !!(staffToken && staffUser)

  // WebSocket при полном входе
  useEffect(() => {
    if (!staffToken || !branch?.id || !mode) return
    const serverUrl = localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1'
    kitchenWS.connect(serverUrl, staffToken, branch.id)
    // Принтерный WS: терминал получает задания печати (чек/кухня) и печатает через Electron
    connectPrinterWS(serverUrl, staffToken, branch.id)
    // Локальный прокси: мобильные устройства в LAN ходят через этот терминал,
    // когда у них нет прямого доступа в облако (офлайн-режим).
    window.electron?.localWS?.setServerUrl(serverUrl)
    const unsubscribe = kitchenWS.on('connection', ({ status }) => {
      const online = status === 'online'
      setIsOnline(online)
      if (online) flushQueue()   // связь вернулась — досылаем накопленные записи
    })
    // Ретранслируем события кухни мобильным устройствам на LAN
    const relayUnsubs = RELAY_EVENTS.map((event) =>
      kitchenWS.on(event, (data) => window.electron?.localWS?.broadcast(event, data))
    )
    return () => {
      unsubscribe()
      relayUnsubs.forEach((fn) => fn())
      kitchenWS.disconnect()
      disconnectPrinterWS()
      window.electron?.localWS?.setServerUrl(null)
    }
  }, [staffToken, branch?.id, mode])

  // Счётчик несинхронизированных записей (офлайн-очередь)
  useEffect(() => {
    const onQ = (e) => setQueued(e.detail?.size ?? queueSize())
    window.addEventListener('marjon:queue', onQ)
    return () => window.removeEventListener('marjon:queue', onQ)
  }, [])

  // Смена языка без перезагрузки: перерисовываем всё дерево (t() читает язык при вызове)
  useEffect(() => {
    const onLang = () => setLangVersion((v) => v + 1)
    window.addEventListener('marjon:lang', onLang)
    return () => window.removeEventListener('marjon:lang', onLang)
  }, [])

  // Кастомный фон организации (задаётся в веб-админке) — применяем к экранам входа
  useEffect(() => {
    if (!orgToken) return
    branding.activeBackground()
      .then((bg) => {
        const photo = bg?.photo || ''
        if (photo) {
          localStorage.setItem('marjon_bg', photo)
          document.documentElement.style.setProperty('--org-bg-image', `url("${photo}")`)
        } else {
          localStorage.removeItem('marjon_bg')
          document.documentElement.style.removeProperty('--org-bg-image')
        }
      })
      .catch(() => { /* нет фона — остаётся дефолтный */ })
  }, [orgToken])

  // 1. Админ привязывает терминал (логин/пароль)
  const handleAdminLogin = useCallback((data) => {
    localStorage.setItem('marjon_org_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('marjon_org_refresh', data.refresh_token)
    localStorage.setItem('marjon_org_user', JSON.stringify(data.user))
    // Не оставляем админа как «сотрудника»: вход сотрудника идёт через выбор + PIN
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_user')
    setOrgToken(data.access_token)
    setOrgUser(data.user)
  }, [])

  // 2. Выбор филиала
  const handleBranchSelect = useCallback((selectedBranch) => {
    localStorage.setItem('marjon_branch', JSON.stringify(selectedBranch))
    setBranch(selectedBranch)
  }, [])

  // 3. PIN-вход выбранного сотрудника → авто-маршрут по роли
  const handleEmployeePin = useCallback(async (pin) => {
    const data = await auth.loginByPin(pin)         // бросит при неверном PIN → PinPad покажет ошибку
    localStorage.setItem('marjon_token', data.access_token)

    let me = null
    try { me = await auth.me() } catch { /* ignore — используем выбранного сотрудника */ }

    // PIN должен принадлежать ВЫБРАННОМУ сотруднику (иначе вход был бы «по любому PIN»)
    const isRealEmp = pinEmployee?.id && /^[0-9a-f-]{16,}$/i.test(String(pinEmployee.id))
    if (isRealEmp && me?.id && String(me.id) !== String(pinEmployee.id)) {
      localStorage.removeItem('marjon_token')
      throw new Error('PIN не соответствует выбранному сотруднику')
    }
    setStaffToken(data.access_token)
    const user = me || pinEmployee || {}
    localStorage.setItem('marjon_user', JSON.stringify(user))
    setStaffUser(user)

    const m = roleToMode(user, pinEmployee)   // всегда вернёт режим (дефолт — касса)
    localStorage.setItem('marjon_mode', m); setMode(m)
    setStaffView('org')
    setPinEmployee(null)
  }, [pinEmployee])

  // Выход сотрудника (не отвязывает терминал). toEmployees=true → сразу к выбору сотрудника
  const handleStaffLogout = useCallback((toEmployees = false) => {
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_user')
    localStorage.removeItem('marjon_mode')
    setStaffToken(null)
    setStaffUser(null)
    setMode(null)
    setStaffView(toEmployees === true ? 'employees' : 'org')
    setPinEmployee(null)
    kitchenWS.disconnect()
  }, [])
  // Кнопка аккаунта в шапке — сразу к выбору сотрудника
  const handleAccount = useCallback(() => handleStaffLogout(true), [handleStaffLogout])

  // Полный сброс терминала (отвязка от организации)
  const handleFullReset = useCallback(() => {
    ['marjon_org_token', 'marjon_org_refresh', 'marjon_org_user', 'marjon_branch', 'marjon_token', 'marjon_user', 'marjon_mode']
      .forEach((k) => localStorage.removeItem(k))
    setOrgToken(null); setOrgUser(null); setBranch(null)
    setStaffToken(null); setStaffUser(null); setMode(null)
    setStaffView('org'); setPinEmployee(null)
    kitchenWS.disconnect()
  }, [])

  const handleLock = useCallback(() => {
    setIsLocked(true)
    try { window.electron?.setLocked?.(true) } catch { /* not in electron */ }
  }, [])
  const handleUnlock = useCallback((pin) => {
    const exitPin = localStorage.getItem('marjon_exit_pin')
    if (pin === staffUser?.pin_code || (exitPin && pin === exitPin)) {
      setIsLocked(false); setLockPin('')
      try { window.electron?.setLocked?.(false) } catch { /* not in electron */ }
      return true
    }
    return false
  }, [staffUser])

  // Electron: при попытке закрыть окно в режиме блокировки — показываем PIN-экран
  useEffect(() => {
    try { window.electron?.onRequestExitPin?.(() => setIsLocked(true)) } catch { /* not in electron */ }
  }, [])

  // ── Экран блокировки ──
  if (isLocked) {
    return (
      <div className="lock-screen">
        <div className="lock-screen__content">
          <div className="lock-screen__icon"><Lock size={40} strokeWidth={2} /></div>
          <h2 className="lock-screen__title">Экран заблокирован</h2>
          <p className="lock-screen__user">{staffUser?.name || staffUser?.email}</p>
          <div className="pin-input-group">
            <input
              type="password"
              className="pin-input"
              maxLength={4}
              placeholder="PIN"
              value={lockPin}
              onChange={(e) => setLockPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && lockPin.length === 4) { if (!handleUnlock(lockPin)) setLockPin('') } }}
              autoFocus
            />
            <button className="btn btn--primary" disabled={lockPin.length < 4} onClick={() => { if (!handleUnlock(lockPin)) setLockPin('') }}>
              Разблокировать
            </button>
          </div>
        </div>
      </div>
    )
  }

  const settingsOverlay = showSettings ? <SettingsModal open onClose={() => setShowSettings(false)} /> : null

  // ── Поток ──
  // Шаг 0: адрес сервера
  const serverUrl = localStorage.getItem('marjon_server_url')
  if (!serverUrl) return <ServerSetup onComplete={() => window.location.reload()} />

  // Шаг 1: терминал не привязан — вход администратора
  if (!orgToken || !orgUser) return <LoginPage mode="admin" onLogin={handleAdminLogin} />

  // Шаг 2: выбор филиала
  if (!branch) {
    return <BranchSelector user={orgUser} onSelect={handleBranchSelect} onLogout={handleFullReset} />
  }

  // Шаг 3: вход сотрудника — организация → выбор сотрудника → пин-пад
  if (!isStaffLoggedIn) {
    if (staffView === 'employees') {
      return (
        <EmployeeSelector
          branch={branch}
          onSelect={(emp) => { setPinEmployee(emp); setStaffView('pin') }}
          onBack={() => setStaffView('org')}
        />
      )
    }
    if (staffView === 'pin' && pinEmployee) {
      return <PinPad employee={pinEmployee} onSubmit={handleEmployeePin} onBack={() => setStaffView('employees')} />
    }
    return (
      <>
        <OrganizationScreen
          orgName={orgUser?.company_name || orgUser?.name}
          branchName={branch?.name}
          onEnter={() => setStaffView('employees')}
          onSettings={() => setShowSettings(true)}
          onReset={handleFullReset}
        />
        {settingsOverlay}
      </>
    )
  }

  // ── Рабочий режим (только официант/кассир/кухня; дефолт — касса) ──
  const activeMode = mode && MODES[mode] ? mode : 'cashier'
  const { component: ModeComponent } = MODES[activeMode]
  const modeLabel = t('mode_' + activeMode)
  const userWithBranch = { ...staffUser, branch_id: branch.id }

  return (
    <div className="app-shell">
      <TopBar
        title={modeLabel}
        subtitle={branch?.name}
        isOnline={isOnline}
        queued={queued}
        onRefresh={() => window.location.reload()}
        onLock={handleLock}
        onSettings={() => setShowSettings(true)}
        onAccount={handleAccount}
      />

      <main className="app-shell__content">
        <ModeComponent user={userWithBranch} branch={branch} onLogout={handleStaffLogout} onBack={handleAccount} />
      </main>

      <BottomBar userName={staffUser?.name} branchName={branch?.name} mode={modeLabel} />
      {settingsOverlay}
    </div>
  )
}
