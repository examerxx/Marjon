import { useState, useEffect } from 'react'
import { X, Volume2, Server, Monitor, Timer, Globe, Maximize, ZoomIn, ZoomOut, Check, Printer, Wifi, Router } from 'lucide-react'
import { soundService } from '../services/sound'
import { printers as printersApi, queueSize } from '../shared/api'
import { t } from '../shared/i18n'

const el = () => (typeof window !== 'undefined' ? window.electron : null)

export default function SettingsModal({ open, onClose }) {
  const [soundEnabled, setSoundEnabled] = useState(soundService.enabled)
  const [volume, setVolume] = useState(soundService.volume)
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('marjon_server_url') || 'http://localhost:8000/api/v1')
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
  const [localWsInfo, setLocalWsInfo] = useState(null)

  useEffect(() => {
    if (!open) return
    Promise.resolve(el()?.getZoom?.()).then((z) => { if (z) setZoom(z) }).catch(() => {})
    printersApi.list().then((d) => setPrinterList(Array.isArray(d) ? d : d?.items || [])).catch(() => setPrinterList([]))
  }, [open])

  useEffect(() => {
    if (!open || !el()?.localWS) return
    const refresh = () => el().localWS.info().then(setLocalWsInfo).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [open])

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
  function saveServer() {
    persist('marjon_server_url', serverUrl.trim())
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
              <input type="number" min="1" max="60" value={timerYellow} onChange={(e) => setTimerYellow(Number(e.target.value) || 5)} className="input settings-num" />
            </div>
            <div className="settings-row">
              <span>{t('s_red_after')}</span>
              <input type="number" min="1" max="120" value={timerRed} onChange={(e) => setTimerRed(Number(e.target.value) || 10)} className="input settings-num" />
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
                <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} className="input" placeholder="http://192.168.1.x:8000/api/v1" />
                <button className="btn btn--primary settings-save" onClick={saveServer}>
                  {serverSaved ? <Check size={20} /> : t('save')}
                </button>
              </div>
            </div>
          </section>

          {/* Локальная сеть для мобильных устройств (офлайн-режим) */}
          {localWsInfo ? (
            <section className="settings-section">
              <h3><Router size={18} /> {t('s_lan')}</h3>
              <p className="settings-hint">{t('s_lan_hint')}</p>
              <div className="settings-row">
                <span>{t('s_lan_addr')}</span>
                <span className="settings-value">{localWsInfo.ip}:{localWsInfo.port}</span>
              </div>
              <div className="settings-row">
                <span>{t('s_lan_token')}</span>
                <span className="settings-value" style={{ letterSpacing: 1, wordBreak: 'break-all' }}>{localWsInfo.token}</span>
              </div>
              <div className="settings-row">
                <span>{t('s_lan_clients')}</span>
                <span className="settings-value">{localWsInfo.clients}</span>
              </div>
            </section>
          ) : null}

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
