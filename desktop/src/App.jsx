import { useState, useEffect, useCallback } from 'react'
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
import WaiterMode from './modes/waiter/WaiterMode'
import { auth, branding, flushQueue, queueSize } from './shared/api'
import { t } from './shared/i18n'
import { kitchenWS } from './services/kitchenWS'
import { connectPrinterWS, disconnectPrinterWS } from './shared/ws'

const MODES = {
  cashier: { component: CashierMode, label: 'Касса' },
  waiter: { component: WaiterMode, label: 'Официант' },
  // Курьер = урезанная касса: только заказы «с собой», без столов и кнопок кассира
  courier: { component: CashierMode, label: 'Курьер' },
}

// Роль → рабочий режим. На десктопе только касса, официант и курьер.
// Владелец и менеджер на кассе-терминале не работают: владелец управляет через
// веб-админку, роль менеджера удалена. Прочие роли → касса по умолчанию (см. roleToMode).
const ROLE_TO_MODE = {
  waiter: 'waiter', cashier: 'cashier', courier: 'courier',
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
  const [sessionPin, setSessionPin] = useState('')       // PIN текущего входа — для разблокировки экрана

  const [isOnline, setIsOnline] = useState(true)
  const [queued, setQueued] = useState(() => queueSize())
  const [, setLangVersion] = useState(0)   // бамп для перерисовки при смене языка
  const [isLocked, setIsLocked] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const isStaffLoggedIn = !!(staffToken && staffUser)

  // WebSocket при полном входе
  useEffect(() => {
    if (!staffToken || !branch?.id || !mode) return
    const serverUrl = localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1'
    kitchenWS.connect(serverUrl, staffToken, branch.id)
    // Принтерный WS: терминал получает задания печати (чек/кухня) и печатает через Electron
    connectPrinterWS(serverUrl, staffToken, branch.id)
    const unsubscribe = kitchenWS.on('connection', ({ status }) => {
      const online = status === 'online'
      setIsOnline(online)
      if (online) flushQueue()   // связь вернулась — досылаем накопленные записи
    })
    return () => { unsubscribe(); kitchenWS.disconnect(); disconnectPrinterWS() }
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

  // 1. Вход на кассе по логину/паролю филиала (6.2/6.3) — один шаг.
  // Ответ /auth/branch-login несёт токен терминала + сведения о branch/company:
  // сохраняем и организацию, и филиал атомарно, поэтому шаг выбора филиала пропускается.
  const handleBranchLogin = useCallback((data) => {
    localStorage.setItem('marjon_org_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('marjon_org_refresh', data.refresh_token)
    // Синтетический org-user из company: сотрудникам не показываем личный логин владельца
    const orgU = {
      name: data.company?.name,
      company_name: data.company?.name,
      company_id: data.company?.id,
      currency: data.company?.currency,
    }
    localStorage.setItem('marjon_org_user', JSON.stringify(orgU))
    const br = data.branch || null
    if (br) localStorage.setItem('marjon_branch', JSON.stringify(br))
    // Не оставляем терминал как «сотрудника»: вход сотрудника идёт через выбор + PIN
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_user')
    setOrgToken(data.access_token)
    setOrgUser(orgU)
    if (br) setBranch(br)
  }, [])

  // 2. Выбор филиала (legacy-фолбэк: при branch-login филиал уже привязан)
  const handleBranchSelect = useCallback((selectedBranch) => {
    localStorage.setItem('marjon_branch', JSON.stringify(selectedBranch))
    setBranch(selectedBranch)
  }, [])

  // 3. PIN-вход выбранного сотрудника → авто-маршрут по роли
  const handleEmployeePin = useCallback(async (pin) => {
    // PIN должен принадлежать ВЫБРАННОМУ сотруднику (иначе вход был бы «по любому PIN»)
    const isRealEmp = pinEmployee?.id && /^[0-9a-f-]{16,}$/i.test(String(pinEmployee.id))
    // Отдаём id выбранного сотрудника: бэкенд сверит PIN только с ним, иначе при
    // одинаковых PIN у двоих токен приходил чужой и вход отклонялся ниже.
    const data = await auth.loginByPin(pin, isRealEmp ? pinEmployee.id : undefined)
    localStorage.setItem('marjon_token', data.access_token)

    let me = null
    try { me = await auth.me() } catch { /* ignore — используем выбранного сотрудника */ }

    if (isRealEmp && me?.id && String(me.id) !== String(pinEmployee.id)) {
      localStorage.removeItem('marjon_token')
      throw new Error('PIN не соответствует выбранному сотруднику')
    }
    setStaffToken(data.access_token)
    const user = me || pinEmployee || {}
    localStorage.setItem('marjon_user', JSON.stringify(user))
    setStaffUser(user)
    setSessionPin(pin)   // запомнили PIN входа — им же разблокируется экран

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
    setSessionPin('')
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
  const doUnlock = useCallback(() => {
    setIsLocked(false)
    try { window.electron?.setLocked?.(false) } catch { /* not in electron */ }
  }, [])
  const handleUnlock = useCallback(async (pinRaw) => {
    const pin = String(pinRaw || '').trim()
    if (!pin) return false
    // 1) Быстрый локальный путь: PIN текущего входа или служебный exit-pin.
    //    Работает офлайн и мгновенно, пока сессия жива в памяти.
    const exitPin = localStorage.getItem('marjon_exit_pin')
    if ((sessionPin && pin === sessionPin) || (exitPin && pin === exitPin)) {
      doUnlock(); return true
    }
    // 2) После перезагрузки sessionPin теряется (токен сотрудника хранится в
    //    localStorage, а PIN — нет), поэтому раньше разблокировка не срабатывала
    //    никогда. Подтверждаем PIN на сервере тем же механизмом, что и вход
    //    (verifyPin не меняет сессию). ВАЖНО: сверяем с id текущего сотрудника —
    //    без user_id бэкенд отдаёт «первого совпавшего», и при одинаковых PIN у
    //    двух сотрудников /me возвращал чужого → верный PIN считался неверным.
    try {
      const me = await auth.verifyPin(pin, staffUser?.id)
      if (!staffUser?.id || String(me?.id) === String(staffUser.id)) {
        setSessionPin(pin)   // восстановили — следующие разблокировки снова офлайн
        doUnlock(); return true
      }
    } catch { /* неверный PIN или сервер недоступен — отказ ниже */ }
    return false
  }, [staffUser, sessionPin, doUnlock])

  // Electron: при попытке закрыть окно в режиме блокировки — показываем PIN-экран
  useEffect(() => {
    try { window.electron?.onRequestExitPin?.(() => setIsLocked(true)) } catch { /* not in electron */ }
  }, [])

  // ── Экран блокировки: тот же пин-пад с уже выбранным сотрудником ──
  if (isLocked && isStaffLoggedIn) {
    return (
      <PinPad
        employee={staffUser || {}}
        title={t('locked_title')}
        onSubmit={async (pin) => { if (!(await handleUnlock(pin))) throw new Error('bad-pin') }}
      />
    )
  }

  const settingsOverlay = showSettings ? <SettingsModal open onClose={() => setShowSettings(false)} /> : null

  // ── Поток ──
  // Шаг 0: адрес сервера
  const serverUrl = localStorage.getItem('marjon_server_url')
  if (!serverUrl) return <ServerSetup onComplete={() => window.location.reload()} />

  // Шаг 1: терминал не привязан — вход по логину/паролю филиала (6.2)
  if (!orgToken || !orgUser) return <LoginPage mode="admin" onLogin={handleBranchLogin} />

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

  // ── Рабочий режим (только кассир/официант/курьер; дефолт — касса) ──
  const activeMode = mode && MODES[mode] ? mode : 'cashier'
  const { component: ModeComponent } = MODES[activeMode]
  const modeLabel = t('mode_' + activeMode)
  const userWithBranch = { ...staffUser, branch_id: branch.id }

  return (
    <div className="app-shell">
      <TopBar
        onRefresh={() => window.location.reload()}
        onLock={handleLock}
        onSettings={() => setShowSettings(true)}
        onAccount={handleAccount}
      />

      <main className="app-shell__content">
        <ModeComponent
          user={userWithBranch}
          branch={branch}
          courier={activeMode === 'courier'}
          onLogout={handleStaffLogout}
          onBack={handleAccount}
          onSwitchMode={(m) => { if (MODES[m]) { localStorage.setItem('marjon_mode', m); setMode(m) } }}
        />
      </main>

      <BottomBar userName={staffUser?.name} branchName={branch?.name} mode={modeLabel}
                 isOnline={isOnline} queued={queued} />
      {settingsOverlay}
    </div>
  )
}
