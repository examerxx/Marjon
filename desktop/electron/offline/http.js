// Минимальный HTTP-клиент основного процесса. axios в main не подключён
// (он живёт в рендерере), а тянуть ещё одну зависимость ради JSON-запросов
// незачем: http/https из Node хватает.
const http = require('node:http')
const https = require('node:https')

class NetworkError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'NetworkError'
    this.network = true
    this.cause = cause
  }
}

class HttpError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

function joinUrl(base, path) {
  const root = String(base || '').replace(/\/+$/, '')
  const tail = String(path || '').startsWith('/') ? path : `/${path || ''}`
  return root + tail
}

/**
 * JSON-запрос к бэкенду.
 * @returns {Promise<any>} распарсенный ответ
 * @throws {NetworkError} сервер недоступен (нет ответа)
 * @throws {HttpError} сервер ответил 4xx/5xx
 */
function request({ base, method = 'GET', path, body, token, headers, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(joinUrl(base, path))
    } catch (err) {
      reject(new NetworkError(`bad api base: ${base}`, err))
      return
    }
    const client = url.protocol === 'https:' ? https : http
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = client.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        if (text) {
          try { data = JSON.parse(text) } catch { data = text }
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
          return
        }
        const detail = data && typeof data === 'object' ? (data.detail || data.message) : data
        reject(new HttpError(
          typeof detail === 'string' ? detail : `HTTP ${res.statusCode}`,
          res.statusCode,
          data,
        ))
      })
    })
    req.setTimeout(timeout, () => {
      req.destroy(new NetworkError(`timeout ${url.host}${url.pathname}`))
    })
    req.on('error', (err) => {
      reject(err instanceof NetworkError ? err : new NetworkError(err.message, err))
    })
    if (payload) req.write(payload)
    req.end()
  })
}

// /health висит на корне сервера, а не под /api/v1.
function healthUrl(apiBase) {
  try {
    const url = new URL(String(apiBase))
    return `${url.origin}/health`
  } catch {
    return null
  }
}

module.exports = { request, healthUrl, NetworkError, HttpError }
