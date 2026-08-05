/**
 * Marjon Desktop — Звуковые уведомления
 */

const SOUNDS = {
  newOrder: { frequency: 880, duration: 200, repeat: 2, gap: 100 },
  orderOverdue: { frequency: 440, duration: 300, repeat: 3, gap: 150 },
  orderCancelled: { frequency: 330, duration: 400, repeat: 2, gap: 200 },
  orderCompleted: { frequency: 660, duration: 150, repeat: 1, gap: 0 },
  stopListUpdated: { frequency: 550, duration: 250, repeat: 1, gap: 0 },
  connectionRestored: { frequency: 770, duration: 100, repeat: 3, gap: 80 },
}

class SoundService {
  constructor() {
    this._ctx = null
    this._enabled = true
    this._volume = 0.8
    this._overdueTimers = new Map()
  }

  get enabled() { return this._enabled }
  set enabled(val) { this._enabled = val }

  get volume() { return this._volume }
  set volume(val) { this._volume = Math.max(0, Math.min(1, val)) }

  _getContext() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)()
    }
    return this._ctx
  }

  async play(soundName) {
    if (!this._enabled) return
    const config = SOUNDS[soundName]
    if (!config) return

    const ctx = this._getContext()
    if (ctx.state === 'suspended') await ctx.resume()

    for (let i = 0; i < config.repeat; i++) {
      if (i > 0) await this._delay(config.gap)
      await this._beep(ctx, config.frequency, config.duration)
    }
  }

  startOverdueAlert(orderId) {
    if (this._overdueTimers.has(orderId)) return
    this.play('orderOverdue')
    const timer = setInterval(() => this.play('orderOverdue'), 30000)
    this._overdueTimers.set(orderId, timer)
  }

  stopOverdueAlert(orderId) {
    const timer = this._overdueTimers.get(orderId)
    if (timer) {
      clearInterval(timer)
      this._overdueTimers.delete(orderId)
    }
  }

  stopAllAlerts() {
    this._overdueTimers.forEach(timer => clearInterval(timer))
    this._overdueTimers.clear()
  }

  _beep(ctx, frequency, duration) {
    return new Promise(resolve => {
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)

      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gainNode.gain.value = this._volume

      oscillator.start()
      oscillator.stop(ctx.currentTime + duration / 1000)
      oscillator.onended = resolve
    })
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const soundService = new SoundService()
