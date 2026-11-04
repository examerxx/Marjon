import { useState, useEffect, useCallback } from 'react'
import ServerSetup from './pages/ServerSetup'
import LoginPage from './pages/LoginPage'
import OrganizationScreen from './pages/OrganizationScreen'
import EmployeeSelector from './pages/EmployeeSelector'
import PinPad from './pages/PinPad'
import TopBar from './components/TopBar'
import BottomBar from './components/BottomBar'
import SettingsModal from './components/SettingsModal'
import StaffProfileModal from './components/StaffProfileModal'
import CashierMode from './modes/cashier/CashierMode'
import WaiterMode from './modes/waiter/WaiterMode'
import { auth, branding, flushQueue, halls, queueSize, shifts } from './shared/api'
import { DEFAULT_SERVER_URL } from './shared/config'
import { t } from './shared/i18n'
import { errorMessage } from './shared/errorMessage.mjs'
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
// Повар на десктопе не работает: у него отдельный веб-экран кухни (KDS).
// Раньше он молча проваливался в кассу — это ломало и права, и сценарий смены.
const KITCHEN_ROLES = new Set(['kitchen', 'cook', 'chef'])
function roleToMode(user, employee) {
  const slugs = [...(user?.role_slugs || [])]
  if (employee?.role_slug) slugs.push(employee.role_slug)
  const normalized = slugs.map((s) => String(s || '').toLowerCase())
  for (const s of normalized) {
    const m = ROLE_TO_MODE[s]
    if (m) return m
  }
  if (normalized.some((s) => KITCHEN_ROLES.has(s))) return null   // только кухня
  return 'cashier'   // дефолт — касса
}

function loadJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

// /pos/shifts/current отдаёт либо { shift: null }, либо сам ShiftResponse.
function openShiftOf(resp) {
  if (!resp) return null
  if (Object.prototype.hasOwnProperty.call(resp, 'shift')) return resp.shift || null
  return resp.id ? resp : null
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
  // PIN верный, но смена закрыта: сессию ещё не фиксируем, показываем
  // «Открыть смену» прямо на PIN-экране.
  const [shiftGate, setShiftGate] = useState(null)
  const [shiftBusy, setShiftBusy] = useState(false)
  const [shiftError, setShiftError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)

  const [isOnline, setIsOnline] = useState(true)
  const [queued, setQueued] = useState(() => queueSize())
  const [, setLangVersion] = useState(0)   // бамп для перерисовки при смене языка
  const [isLocked, setIsLocked] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const isStaffLoggedIn = !!(staffToken && staffUser)

  // IDLE-LOCK-01: принудительного выхода по таймеру больше НЕТ. Раньше кассира
  // «выкидывало в логин каждые 15 минут» — это был протухший access-токен без
  // refresh (см. shared/api.js). Теперь сессия продлевается тихо, а терминал
  // блокируется ТОЛЬКО если им реально не пользовались: ни клика, ни касания,
  // ни клавиши. Разблокировка — PIN текущего сотрудника.
  const IDLE_LOCK_MS = 15 * 60 * 1000
  useEffect(() => {
    if (!isStaffLoggedIn) return undefined
    let timer = null
    const lock = () => {
      setIsLocked(true)
      try { window.electron?.setLocked?.(true) } catch { /* не в Electron */ }
    }
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(lock, IDLE_LOCK_MS)
    }
    const events = ['mousedown', 'pointerdown', 'touchstart', 'keydown', 'wheel']
    events.forEach((name) => window.addEventListener(name, reset, { passive: true }))
    reset()
    return () => {
      events.forEach((name) => window.removeEventListener(name, reset))
      if (timer) clearTimeout(timer)
    }
  }, [isStaffLoggedIn])

  // Единый филиал сессии. При входе моноблока бэкенд присылает branch только в
  // легаси-режиме, поэтому marjon_branch часто пуст — раньше из-за этого
  // branch_id уходил null, и ломалось всё, что от него зависит:
  //   • принтерный/кухонный WebSocket вообще не подключался (задания печати
  //     не доходили до терминала);
  //   • поиск чекового принтера по филиалу не находил его («Чековый принтер
  //     не настроен»);
  //   • залы и заказы грузились без фильтра по филиалу.
  // Сотрудник всегда привязан к филиалу, поэтому берём его branch_id как опору.
  const effectiveBranchId = branch?.id ?? staffUser?.branch_id ?? null

  // WebSocket при полном входе
  useEffect(() => {
    if (!staffToken || !mode) return
    const serverUrl = localStorage.getItem('marjon_server_url') || DEFAULT_SERVER_URL
    // Задания печати получает только терминал филиала текущей сессии.
    connectPrinterWS(serverUrl, staffToken, effectiveBranchId)
    if (effectiveBranchId) {
      kitchenWS.connect(serverUrl, staffToken, effectiveBranchId)
    }
    const unsubscribe = kitchenWS.on('connection', ({ status }) => {
      const online = status === 'online'
      setIsOnline(online)
      if (online) flushQueue()   // связь вернулась — досылаем накопленные записи
    })
    return () => { unsubscribe(); kitchenWS.disconnect(); disconnectPrinterWS() }
  }, [staffToken, effectiveBranchId, mode])

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

  // 1. Вход на кассе по телефону+паролю моноблока.
  // Моноблок привязан к company (к филиалу НЕ привязан). Экран выбора филиала
  // убран: если бэкенд прислал branch (легаси) — сохраняем, иначе работаем без него.
  const handleMonoblockLogin = useCallback((data) => {
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
    else localStorage.removeItem('marjon_branch')
    // Не оставляем терминал как «сотрудника»: вход сотрудника идёт через выбор + PIN
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_user')
    setOrgToken(data.access_token)
    setOrgUser(orgU)
    setBranch(br)
  }, [])

  // 2. Выбор филиала убран для моноблока (branch опционален, приходит из
  // данных входа при легаси-привязке). Отдельного экрана выбора больше нет.

  // 3. PIN-вход выбранного сотрудника → проверка смены → авто-маршрут по роли.
  // Сессию фиксируем только после того, как смена открыта (или уже была открыта):
  // при закрытой смене кассир остаётся на PIN-экране и видит «Открыть смену».
  const finalizeStaffLogin = useCallback((pending) => {
    localStorage.setItem('marjon_token', pending.token)
    if (pending.refresh) localStorage.setItem('marjon_staff_refresh', pending.refresh)
    localStorage.setItem('marjon_user', JSON.stringify(pending.user))
    localStorage.setItem('marjon_mode', pending.mode)
    setStaffToken(pending.token)
    setStaffUser(pending.user)
    setSessionPin(pending.pin || '')
    setMode(pending.mode)
    setStaffView('org')
    setPinEmployee(null)
    setShiftGate(null)
    setShiftError('')
  }, [])

  const handleEmployeePin = useCallback(async (pin) => {
    // PIN должен принадлежать ВЫБРАННОМУ сотруднику (иначе вход был бы «по любому PIN»)
    const isRealEmp = pinEmployee?.id && /^[0-9a-f-]{16,}$/i.test(String(pinEmployee.id))
    // Отдаём id выбранного сотрудника: бэкенд сверит PIN только с ним, иначе при
    // одинаковых PIN у двоих токен приходил чужой и вход отклонялся ниже.
    const data = await auth.loginByPin(pin, isRealEmp ? pinEmployee.id : undefined)
    // Токен ещё не сохранён — /me читаем под ним явным заголовком.
    let me = null
    try { me = await auth.meWithToken(data.access_token) } catch { /* ignore — используем выбранного сотрудника */ }

    if (isRealEmp && me?.id && String(me.id) !== String(pinEmployee.id)) {
      throw new Error('PIN не соответствует выбранному сотруднику')
    }
    const user = me || pinEmployee || {}
    const m = roleToMode(user, pinEmployee)
    if (!m) {
      // Кухня — только на отдельном экране, касса повару недоступна.
      throw new Error('Повар работает на кухонном экране: откройте kitchen.marjon.tech')
    }

    const pending = {
      token: data.access_token,
      refresh: data.refresh_token,
      user,
      mode: m,
      pin,
    }

    let branchId = branch?.id || user?.branch_id || pinEmployee?.branch_id || null
    // Моноблок может быть привязан только к компании, а сотрудник — без
    // филиала: тогда branchId пуст и проверка смены молча пропускалась, хотя
    // смена на кассе не открыта. Филиал терминала определяем по его залам.
    if (!branchId) {
      try {
        const hallList = await halls.listWithToken(data.access_token)
        branchId = hallList?.[0]?.branch_id || null
      } catch { /* нет залов — работаем как раньше, без блокировки */ }
    }
    if (branchId) {
      try {
        const current = await shifts.currentWithToken(data.access_token, branchId)
        if (!openShiftOf(current)) {
          // PIN верный, смена закрыта → на месте цифр показываем «Открыть смену».
          setShiftGate({ ...pending, branchId })
          setShiftError('')
          return
        }
      } catch {
        // Нет связи/ошибка проверки — не запираем кассира, работаем как раньше.
      }
    }
    finalizeStaffLogin(pending)
  }, [pinEmployee, branch, finalizeStaffLogin])

  const handleOpenShiftClick = useCallback(async () => {
    if (!shiftGate || shiftBusy) return
    const pending = shiftGate
    setShiftBusy(true)
    setShiftError('')
    try {
      if (!pending.branchId) throw new Error(t('shift_open_err'))
      try {
        await shifts.openWithToken(pending.token, pending.branchId, 0)
      } catch (e) {
        // Смену мог открыть другой терминал между проверкой и нажатием —
        // перепроверяем, чтобы не показывать ложную ошибку.
        const status = e?.response?.status
        if (status === 400 || status === 409 || status === 422) {
          const current = await shifts.currentWithToken(pending.token, pending.branchId)
          if (!openShiftOf(current)) throw e
        } else {
          throw e
        }
      }
      finalizeStaffLogin(pending)
    } catch (e) {
      setShiftError(errorMessage(e, t('shift_open_err')))
    } finally {
      setShiftBusy(false)
    }
  }, [shiftGate, shiftBusy, finalizeStaffLogin])

  const handleCancelShift = useCallback(() => {
    setShiftGate(null)
    setShiftError('')
    setPinEmployee(null)
    setStaffView('employees')
  }, [])

  // Выход сотрудника (не отвязывает терминал). toEmployees=true → сразу к выбору сотрудника
  const handleStaffLogout = useCallback((toEmployees = false) => {
    localStorage.removeItem('marjon_token')
    localStorage.removeItem('marjon_staff_refresh')
    localStorage.removeItem('marjon_user')
    localStorage.removeItem('marjon_mode')
    setStaffToken(null)
    setStaffUser(null)
    setMode(null)
    setSessionPin('')
    setStaffView(toEmployees === true ? 'employees' : 'org')
    setPinEmployee(null)
    setShiftGate(null)
    setShiftError('')
    setProfileOpen(false)
    kitchenWS.disconnect()
  }, [])
  // Кнопка аккаунта в шапке — профиль сотрудника (имя, роль, выработка, смена).
  const handleAccount = useCallback(() => setProfileOpen(true), [])
  // «Назад» в TopBar: сначала просим активный режим закрыть верхний слой
  // (модалка/панель/меню заказа). Если он не взялся — уводим к выбору
  // сотрудника. Так кнопка не разлогинивает случайно.
  const handleNavBack = useCallback(() => {
    if (profileOpen) { setProfileOpen(false); return }
    const detail = { handled: false }
    try { window.dispatchEvent(new CustomEvent('marjon:back', { detail })) } catch { /* no window */ }
    if (!detail.handled) handleStaffLogout(true)
  }, [profileOpen, handleStaffLogout])

  // Полный сброс терминала (отвязка от организации)
  const handleFullReset = useCallback(() => {
    ['marjon_org_token', 'marjon_org_refresh', 'marjon_org_user', 'marjon_branch', 'marjon_token', 'marjon_staff_refresh', 'marjon_user', 'marjon_mode']
      .forEach((k) => localStorage.removeItem(k))
    setOrgToken(null); setOrgUser(null); setBranch(null)
    setStaffToken(null); setStaffUser(null); setMode(null)
    setStaffView('org'); setPinEmployee(null)
    setShiftGate(null); setShiftError(''); setProfileOpen(false)
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

  // Шаг 1: терминал не привязан — вход по телефону+паролю моноблока
  // onSettings здесь обязателен: без него при неверном адресе сервера
  // терминал запирался на экране входа без доступа к настройкам.
  if (!orgToken || !orgUser) {
    return (
      <>
        <LoginPage
          mode="admin"
          onLogin={handleMonoblockLogin}
          onSettings={() => setShowSettings(true)}
        />
        {settingsOverlay}
      </>
    )
  }

  // Шаг 2 (выбор филиала) убран: моноблок не привязан к филиалу, после входа
  // сразу идём к выбору сотрудника.

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
      return (
        <PinPad
          employee={pinEmployee}
          onSubmit={handleEmployeePin}
          onBack={shiftGate ? undefined : () => setStaffView('employees')}
          shiftClosed={!!shiftGate}
          shiftBusy={shiftBusy}
          shiftError={shiftError}
          onOpenShift={handleOpenShiftClick}
          onCancelShift={handleCancelShift}
        />
      )
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
  const userWithBranch = { ...staffUser, branch_id: effectiveBranchId }

  return (
    <div className="app-shell">
      <TopBar
        onBack={handleNavBack}
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
          onBack={handleNavBack}
          onSwitchMode={(m) => { if (MODES[m]) { localStorage.setItem('marjon_mode', m); setMode(m) } }}
        />
      </main>

      <BottomBar userName={staffUser?.name} branchName={branch?.name} mode={modeLabel}
                 isOnline={isOnline} queued={queued} />
      {settingsOverlay}
      {profileOpen && (
        <StaffProfileModal
          user={staffUser || {}}
          branchId={effectiveBranchId}
          branchName={branch?.name}
          onClose={() => setProfileOpen(false)}
          onSwitchStaff={() => { setProfileOpen(false); handleStaffLogout(true) }}
          onShiftClosed={() => { setProfileOpen(false); handleStaffLogout(true) }}
        />
      )}
    </div>
  )
}
