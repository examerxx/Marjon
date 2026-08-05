import { useState } from 'react'
import { Server, Check, Wifi, WifiOff } from 'lucide-react'
import { t } from '../shared/i18n'

/**
 * ServerSetup — экран первого запуска.
 * Показывается только один раз: когда в localStorage нет marjon_server_url.
 * IT-специалист вводит адрес сервера при установке терминала.
 */
export default function ServerSetup({ onComplete }) {
  const [url, setUrl] = useState('http://localhost:8000/api/v1')
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState(null) // 'ok' | 'error'
  const [error, setError] = useState('')

  async function testConnection() {
    setTesting(true)
    setStatus(null)
    setError('')

    const baseUrl = url.trim().replace(/\/api\/v1\/?$/, '')

    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        setStatus('ok')
      } else {
        setStatus('error')
        setError(`${t('srv_err_status')} ${res.status}`)
      }
    } catch (err) {
      setStatus('error')
      setError(t('srv_err_conn'))
    } finally {
      setTesting(false)
    }
  }

  function handleSave() {
    const trimmed = url.trim().replace(/\/+$/, '')
    localStorage.setItem('marjon_server_url', trimmed)
    onComplete()
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__logo">MARJON</div>
          <p className="login-card__subtitle">{t('srv_setup')}</p>
        </div>

        <div className="server-setup">
          <div className="server-setup__icon">
            <Server size={48} strokeWidth={1.5} />
          </div>

          <p className="server-setup__hint">{t('srv_intro')}</p>

          <div className="login-field">
            <label className="login-field__label">{t('s_server_addr')}</label>
            <input
              className="login-field__input"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setStatus(null) }}
              placeholder="http://192.168.1.100:8000/api/v1"
              data-keyboard="url"
            />
          </div>

          {status === 'ok' && (
            <div className="server-setup__status server-setup__status--ok">
              <Wifi size={18} />
              <span>{t('srv_conn_ok')}</span>
            </div>
          )}

          {status === 'error' && (
            <div className="server-setup__status server-setup__status--error">
              <WifiOff size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="server-setup__actions">
            <button
              className="login-btn login-btn--outline"
              onClick={testConnection}
              disabled={testing || !url.trim()}
            >
              {testing ? t('check') : t('srv_test')}
            </button>

            <button
              className="login-btn"
              onClick={handleSave}
              disabled={!url.trim()}
            >
              <Check size={18} />
              {t('srv_save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
