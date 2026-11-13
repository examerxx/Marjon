// ── PRINT-LAT-01: печать задания на терминале ────────────────────────────────
//
// Задание на печать приходит двумя путями:
//   1) по WebSocket (быстро, но соединение может быть в переподключении);
//   2) опросом очереди GET /printers/{id}/jobs/pending (страховка).
//
// Раньше был только путь (1), и обработчик начинался с `if (!printer) return`:
// если список принтеров ещё не загрузился или WS отвалился, задание молча
// оставалось в pending — чек не выходил вообще. Плюс оба пути могут принести
// одно и то же задание, поэтому здесь дедупликация по job_id.
import { printers as printersApi } from './api'

const handled = new Set()
const HANDLED_LIMIT = 200

function remember(jobId) {
  handled.add(jobId)
  if (handled.size > HANDLED_LIMIT) {
    const oldest = handled.values().next().value
    handled.delete(oldest)
  }
}

/**
 * Печатает одно задание и закрывает его на сервере (done/fail).
 * printer может быть undefined — тогда ip/port берутся из самого задания.
 * Возвращает true, если задание действительно напечатано.
 */
export async function printJob(job, printer) {
  const jobId = job?.job_id || job?.id
  if (!jobId || handled.has(jobId)) return false
  // PRINT-DUP-01: занимаем job_id ДО первого await. WS и опрос очереди штатно
  // приносят одно и то же задание; пока печать шла (сотни миллисекунд), второй
  // вызов ещё не видел id в `handled` и печатал чек повторно.
  remember(jobId)

  const ip = job?.ip_address || printer?.ip_address
  const port = job?.port ?? printer?.port ?? 9100
  console.log('[printJob]', jobId, 'ip=', ip, 'port=', port)

  if (!ip || !window.electron?.print) {
    try {
      await printersApi.jobFail(jobId, !ip ? 'no printer ip' : 'electron print unavailable')
    } catch {
      /* сеть недоступна — задание просто останется в очереди */
    }
    return false
  }

  try {
    const t0 = performance.now()
    await window.electron.print({
      ip,
      port,
      payloadBase64: job.payload,
      copies: job.copies ?? 1,
    })
    console.log('[printJob]', jobId, 'printed in', Math.round(performance.now() - t0), 'ms')
    await printersApi.jobDone(jobId)
    return true
  } catch (err) {
    console.error('[printJob]', jobId, 'failed:', err)
    try {
      await printersApi.jobFail(jobId, String(err?.message || err))
    } catch {
      /* игнорируем: главное — не зациклить печать */
    }
    throw err
  }
}

/**
 * Опрос очереди печати. getPrinterMap() должен возвращать { [id]: printer }.
 * Возвращает функцию остановки.
 */
export function startPrintPoller(getPrinterMap, { intervalMs = 2000, onError } = {}) {
  let stopped = false

  async function tick() {
    if (stopped) return
    const map = getPrinterMap() || {}
    for (const printer of Object.values(map)) {
      let jobs = []
      try {
        jobs = await printersApi.pendingJobs(printer.id)
      } catch {
        continue // сервер недоступен — попробуем на следующем тике
      }
      if (jobs.length) console.log('[poller] pending jobs for', printer.name || printer.id, ':', jobs.length)
      for (const job of Array.isArray(jobs) ? jobs : []) {
        try {
          await printJob({ ...job, printer_id: printer.id }, printer)
        } catch (err) {
          onError?.(err)
        }
      }
    }
  }

  const timer = setInterval(tick, intervalMs)
  tick()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
