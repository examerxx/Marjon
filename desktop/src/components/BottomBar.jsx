import { useState, useEffect } from 'react'
import { Minus, Printer } from 'lucide-react'
import { t } from '../shared/i18n'
import { printers as printersApi } from '../shared/api'

/**
 * BottomBar — плавающий нижний док рабочего экрана. Слева вкладки режима
 * («Схема зала / Все столы / …», приходят порталом), справа — тихий статус
 * связи и принтеров и кнопка сворачивания. Часы переехали в TopBar.
 */
export default function BottomBar({ isOnline = true, queued = 0, onMinimize }) {
  // Принтеры филиала: имена + IP + живой статус (тихий индикатор рядом с онлайном).
  const [printerList, setPrinterList] = useState([])
  const [printerState, setPrinterState] = useState({})   // { [id]: 'ok' | 'fail' }

  useEffect(() => {
    let alive = true
    async function refreshPrinters() {
      let list = []
      try {
        const data = await printersApi.list()
        list = Array.isArray(data) ? data : data?.items || []
      } catch { /* офлайн — прячем блок */ }
      if (!alive) return
      setPrinterList(list)
      // Статус — серверным пингом (сервер печатает первым, его доступность главная).
      const states = await Promise.all(list.map(async (p) => {
        try {
          const r = await printersApi.ping(p.ip_address, p.port ?? 9100)
          return [p.id, r?.reachable ? 'ok' : 'fail']
        } catch {
          return [p.id, 'fail']
        }
      }))
      if (alive) setPrinterState(Object.fromEntries(states))
    }
    refreshPrinters()
    const timer = setInterval(refreshPrinters, 90_000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const handleMinimize = () => {
    if (onMinimize) {
      onMinimize()
    } else if (window.electron?.minimize) {
      window.electron.minimize()
    }
  }

  const failed = printerList.filter((p) => printerState[p.id] === 'fail').length
  const printersHint = printerList
    .map((p) => `${p.name} · ${p.ip_address || '—'}:${p.port ?? 9100}`)
    .join('\n')

  return (
    <footer className="bottombar dock">
      <nav className="dock__nav" id="bottombar-nav-slot" aria-label={t('menu_more')} />

      <div className="dock__status">
        {/* Статус связи: тихий в норме, заметный только при обрыве */}
        <span className={`dock__online ${isOnline ? '' : 'dock__online--offline'}`}
              title={isOnline ? t('online') : t('offline')}>
          <span className={`status-dot ${isOnline ? 'status-dot--online' : 'status-dot--offline'}`} />
          <span className="dock__online-text">{isOnline ? t('online') : t('offline')}</span>
        </span>
        {queued > 0 && (
          <span className="dock__queue" title={t('queue_hint')}>↻ {queued}</span>
        )}

        {/* Принтеры: счётчик доступных, полный список — в подсказке. */}
        {printerList.length > 0 && (
          <span className={`dock__printers ${failed ? 'dock__printers--fail' : ''}`}
                title={printersHint} aria-label={t('printers_diag')}>
            <Printer size={15} />
            <span>{printerList.length - failed}/{printerList.length}</span>
          </span>
        )}

        <button className="dock__minimize" onClick={handleMinimize} title={t('minimize')}>
          <Minus size={18} />
        </button>
      </div>
    </footer>
  )
}
