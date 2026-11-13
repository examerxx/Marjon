import { useState, useEffect } from 'react'
import { X, Volume2, Server, Monitor, Timer, Globe, Maximize, ZoomIn, ZoomOut, Check, Printer, Tv, Wifi, Minus, Plus } from 'lucide-react'
import { soundService } from '../services/sound'
import { guestDisplay, printers as printersApi, queueSize } from '../shared/api'
import { t } from '../shared/i18n'
import { DEFAULT_SERVER_URL, normalizeServerUrl } from '../shared/config'

const el = () => (typeof window !== 'undefined' ? window.electron : null)

// Тач-степпер целых значений: крупные кнопки −/+ вместо число-инпута (кухонный терминал).
function Stepper({ value, onChange, min = 1, max = 99, step = 1, unit }) {
  const clamp = (n) => Math.min(max, Math.max(min, n))
  return (
    <div className="stepper" role="group">
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label="−"
      >
        <Minus size={20} />
      </button>
      <span className="stepper__value">{value}{unit ? ` ${unit}` : ''}</span>
      <button
        type="button"
        className="stepper__btn"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label="+"
      >
        <Plus size={20} />
      </button>
    </div>
  )
}

export default function SettingsModal({ open, onClose, branchId }) {
  const [soundEnabled, setSoundEnabled] = useState(soundService.enabled)
  const [volume, setVolume] = useState(soundService.volume)
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('marjon_server_url') || DEFAULT_SERVER_URL)
  const [serverSaved, setServerSaved] = useState(false)
  const [timersSaved, setTimersSaved] = useState(false)

  const [zoom, setZoom] = useState(1)
  const [autoLaunch, setAutoLaunch] = useState(() => localStorage.getItem('marjon_autolaunch') === '1')
  const [timerYellow, setTimerYellow] = useState(() => Number(localStorage.getItem('marjon_timer_yellow')) || 5)
  const [timerRed, setTimerRed] = useState(() => Number(localStorage.getItem('marjon_timer_red')) || 10)
  const [lang, setLang] = useState(() => localStorage.getItem('marjon_lang') || 'ru')
  const [theme, setTheme] = useState(() => localStorage.getItem('marjon_theme') || 'light')
  const [printerList, setPrinterList] = useState([])
  const [pingState, setPingState] = useState({})   // { [id]: 'ok'|'fail'|'...' }
  // Экран очереди привязан к филиалу, а не к терминалу — тумблер меняет
  // серверный флаг, поэтому его видят все подключённые ТВ этого филиала.
  const [displayEnabled, setDisplayEnabled] = useState(null)
  const [displayBusy, setDisplayBusy] = useState(false)
  const [displayError, setDisplayError] = useState('')

  useEffect(() => {
    if (!open) return
    Promise.resolve(el()?.getZoom?.()).then((z) => { if (z) setZoom(z) }).catch(() => {})
    printersApi.list().then((d) => setPrinterList(Array.isArray(d) ? d : d?.items || [])).catch(() => setPrinterList([]))
  }, [open])

  useEffect(() => {
    if (!open || !branchId) { setDisplayEnabled(null); return }
    let alive = true
    setDisplayError('')
    guestDisplay.get(branchId)
      .then((d) => { if (alive) setDisplayEnabled(Boolean(d?.enabled)) })
      .catch(() => { if (alive) { setDisplayEnabled(null); setDisplayError(t('s_guest_display_error')) } })
    return () => { alive = false }
  }, [open, branchId])

  // Печатает в первую очередь СЕРВЕР (бэкенд сам шлёт ESC/POS на ip:9100), и только
  // если он не смог — задание уходит на терминал по WebSocket. Поэтому проверяем обе
  // стороны: результат сервера главный, доступность с терминала — резервный путь.
  async function pingPrinter(p) {
    setPingState((s) => ({ ...s, [p.id]: '...' }))
    const ip = p.ip_address
    const port = p.port ?? 9100
    const [fromServer, fromTerminal] = await Promise.all([
      printersApi.ping(ip, port).then((r) => Boolean(r?.reachable)).catch(() => false),
      Promise.resolve(el()?.pingPrinter?.({ ip, port })).then((r) => r?.ok || r === true).catch(() => false),
    ])
    setPingState((s) => ({ ...s, [p.id]: fromServer ? 'ok' : fromTerminal ? 'terminal' : 'fail' }))
  }

  if (!open) return null
  const persist = (k, v) => localStorage.setItem(k, v)

  function applyTheme(next) {
    setTheme(next)
    persist('marjon_theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }
  // Смена языка без перезагрузки окна: сохраняем + сообщаем приложению событием,
  // App перерисует дерево, и все вызовы t() подхватят новый язык.
  function changeLang(next) {
    persist('marjon_lang', next)
    setLang(next)
    try { window.dispatchEvent(new CustomEvent('marjon:lang', { detail: { lang: next } })) } catch { /* no window */ }
  }

  async function zoomStep(dir) {
    const fn = dir > 0 ? el()?.zoomIn : el()?.zoomOut
    const next = await Promise.resolve(fn?.()).catch(() => null)
    if (next) setZoom(next)
  }
  function saveTimers() {
    persist('marjon_timer_yellow', String(timerYellow))
    persist('marjon_timer_red', String(timerRed))
    setTimersSaved(true); setTimeout(() => setTimersSaved(false), 1600)
  }

  async function toggleDisplay() {
    if (!branchId || displayBusy || displayEnabled === null) return
    const next = !displayEnabled
    setDisplayBusy(true)
    setDisplayError('')
    try {
      const d = await guestDisplay.setEnabled(branchId, next)
      setDisplayEnabled(Boolean(d?.enabled))
    } catch {
      setDisplayError(t('s_guest_display_error'))
    } finally {
      setDisplayBusy(false)
    }
  }
  function saveServer() {
    // Канонический вид: адрес без /api/v1 ломал вход (404 Not Found),
    // потому что клиент дописывает пути сам.
    const next = normalizeServerUrl(serverUrl)
    if (!next) return
    setServerUrl(next)
    persist('marjon_server_url', next)
    setServerSaved(true); setTimeout(() => setServerSaved(false), 1600)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t('settings')}</h2>
          <button className="icon-btn" onClick={onClose}><X size={24} /></button>
        </div>

        <div className="modal__body">
          {/* Звук */}
          <section className="settings-section">
            <h3><Volume2 size={18} /> {t('s_sound')}</h3>
            <div className="settings-row">
              <span>{t('s_sound_notif')}</span>
              <button
                className={`toggle ${soundEnabled ? 'toggle--on' : ''}`}
                onClick={() => { const n = !soundEnabled; setSoundEnabled(n); soundService.enabled = n }}
              ><span className="toggle__dot" /></button>
            </div>
            <div className="settings-row">
              <span>{t('s_volume')}</span>
              <input type="range" min="0" max="1" step="0.05" value={volume}
                onChange={(e) => { const v = parseFloat(e.target.value); setVolume(v); soundService.volume = v }}
                className="range-input" />
              <span className="settings-value">{Math.round(volume * 100)}%</span>
            </div>
            <div className="settings-row">
              <span>{t('s_test_sound')}</span>
              <button className="btn btn--outline" onClick={() => soundService.play('newOrder')}>{t('s_play')}</button>
            </div>
          </section>

          {/* Таймеры кухни */}
          <section className="settings-section">
            <h3><Timer size={18} /> {t('s_kitchen_timers')}</h3>
            <p className="settings-hint">{t('s_timers_hint')}</p>
            <div className="settings-row">
              <span>{t('s_yellow_after')}</span>
              <Stepper value={timerYellow} onChange={setTimerYellow} min={1} max={60} unit={t('unit_min')} />
            </div>
            <div className="settings-row">
              <span>{t('s_red_after')}</span>
              <Stepper value={timerRed} onChange={setTimerRed} min={1} max={120} unit={t('unit_min')} />
            </div>
            <div className="settings-row">
              <span>{t('s_save_thresholds')}</span>
              <button className="btn btn--primary settings-save" onClick={saveTimers}>
                {timersSaved ? <Check size={20} /> : t('save')}
              </button>
            </div>
          </section>

          {/* Экран */}
          <section className="settings-section">
            <h3><Monitor size={18} /> {t('s_screen')}</h3>
            <div className="settings-row">
              <span>{t('s_fullscreen')}</span>
              <button className="btn btn--outline" onClick={() => el()?.toggleFullscreen?.()}>
                <Maximize size={18} /> {t('s_toggle')}
              </button>
            </div>
            <div className="settings-row">
              <span>{t('s_zoom')}</span>
              <div className="settings-input-group">
                <button className="btn btn--outline settings-icon-btn" onClick={() => zoomStep(-1)}><ZoomOut size={18} /></button>
                <span className="settings-value">{Math.round(zoom * 100)}%</span>
                <button className="btn btn--outline settings-icon-btn" onClick={() => zoomStep(1)}><ZoomIn size={18} /></button>
              </div>
            </div>
            <div className="settings-row">
              <span>{t('s_autolaunch')}</span>
              <button className={`toggle ${autoLaunch ? 'toggle--on' : ''}`}
                onClick={() => { const n = !autoLaunch; setAutoLaunch(n); persist('marjon_autolaunch', n ? '1' : '0'); try { el()?.setAutoLaunch?.(n) } catch {} }}
              ><span className="toggle__dot" /></button>
            </div>
          </section>

          {/* Экран очереди для гостей (отдельный ТВ/монитор) */}
          <section className="settings-section">
            <h3><Tv size={18} /> {t('s_guest_display')}</h3>
            <p className="settings-hint">{t('s_guest_display_hint')}</p>
            {!branchId ? (
              <p className="settings-hint">{t('s_guest_display_no_branch')}</p>
            ) : (
              <div className="settings-row">
                <span>{t('s_guest_display_show')}</span>
                <button
                  className={`toggle ${displayEnabled ? 'toggle--on' : ''}`}
                  onClick={toggleDisplay}
                  disabled={displayBusy || displayEnabled === null}
                  aria-label={t('s_guest_display_show')}
                ><span className="toggle__dot" /></button>
              </div>
            )}
            {displayError ? <p className="settings-hint settings-hint--error">{displayError}</p> : null}
          </section>

          {/* Язык и тема */}
          <section className="settings-section">
            <h3><Globe size={18} /> {t('s_lang_theme')}</h3>
            <div className="settings-row">
              <span>{t('s_lang')}</span>
              <div className="settings-input-group">
                <button className={`btn ${lang === 'ru' ? 'btn--primary' : 'btn--outline'}`} onClick={() => changeLang('ru')}>RU</button>
                <button className={`btn ${lang === 'uz' ? 'btn--primary' : 'btn--outline'}`} onClick={() => changeLang('uz')}>UZ</button>
              </div>
            </div>
            <div className="settings-row">
              <span>{t('s_theme')}</span>
              <div className="settings-input-group">
                <button className={`btn ${theme === 'light' ? 'btn--primary' : 'btn--outline'}`} onClick={() => applyTheme('light')}>{t('s_light')}</button>
                <button className={`btn ${theme === 'dark' ? 'btn--primary' : 'btn--outline'}`} onClick={() => applyTheme('dark')}>{t('s_dark')}</button>
              </div>
            </div>
          </section>

          {/* Подключение */}
          <section className="settings-section">
            <h3><Server size={18} /> {t('s_connection')}</h3>
            <div className="settings-row settings-row--col">
              <label>{t('s_server_addr')}</label>
              <div className="settings-input-group">
                <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} onBlur={() => { const next = normalizeServerUrl(serverUrl); if (next) setServerUrl(next) }} className="input" placeholder="http://192.168.1.x:8000/api/v1" />
                <button className="btn btn--primary settings-save" onClick={saveServer}>
                  {serverSaved ? <Check size={20} /> : t('save')}
                </button>
              </div>
            </div>
          </section>

          {/* Принтеры — диагностика */}
          <section className="settings-section">
            <h3><Printer size={18} /> {t('printers_diag')}</h3>
            <p className="settings-hint">{t('printers_queue')}: {queueSize()}</p>
            {printerList.length === 0 ? (
              <p className="settings-hint">{t('printers_none')}</p>
            ) : printerList.map((p) => (
              <div className="settings-row" key={p.id}>
                <span>{p.name} · {p.printer_type === 'receipt' ? t('cash') : t('mode_kitchen')} · {p.ip_address || '—'}:{p.port ?? 9100}</span>
                <button
                  className="btn btn--outline btn--sm"
                  onClick={() => pingPrinter(p)}
                  title={pingState[p.id] === 'ok' ? t('ping_ok')
                    : pingState[p.id] === 'terminal' ? t('ping_terminal')
                    : pingState[p.id] === 'fail' ? t('ping_fail') : ''}
                >
                  <Wifi size={16} /> {pingState[p.id] === 'ok' ? '✓'
                    : pingState[p.id] === 'terminal' ? '✓*'
                    : pingState[p.id] === 'fail' ? '✕'
                    : pingState[p.id] === '...' ? '…' : t('printers_ping')}
                </button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
