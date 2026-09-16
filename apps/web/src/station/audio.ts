/** Original synthesized score: no downloaded recordings or playback dependencies. */
export class RelayAudio {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private lastBeat = -1
  enabled = true
  async unlock() {
    this.context ??= new AudioContext()
    if (!this.gain) { this.gain = this.context.createGain(); this.gain.connect(this.context.destination) }
    this.gain.gain.value = this.enabled ? 0.12 : 0
    await this.context.resume()
  }
  toggle() { this.enabled = !this.enabled; if (this.gain) this.gain.gain.value = this.enabled ? 0.12 : 0 }
  tick(tick: number, boost: boolean, world: string) {
    const beat = Math.floor(tick / 30)
    if (beat === this.lastBeat || !this.context || !this.gain) return
    this.lastBeat = beat
    const roots: Record<string, number> = { coast: 146.83, alpine: 130.81, metro: 164.81, solar: 110, ocean: 123.47 }
    const root = roots[world] ?? 146.83
    this.tone(root * [1, 1.5, 2, 1.25, 1, 2, 1.5, 2.5][beat % 8]!, 0.22, 'sine')
    if (beat % 2 === 0) this.tone(55, 0.12, 'triangle')
    if (boost) this.tone(root * 4, 0.07, 'triangle')
  }
  cue(success: boolean) { this.tone(success ? 587.33 : 82.41, 0.3, 'triangle'); if (this.enabled && navigator.vibrate) navigator.vibrate(success ? [15, 30, 20] : 45) }
  private tone(frequency: number, duration: number, type: OscillatorType) {
    if (!this.context || !this.gain || !this.enabled) return
    const oscillator = this.context.createOscillator(), envelope = this.context.createGain(), now = this.context.currentTime
    oscillator.type = type; oscillator.frequency.value = frequency
    envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(0.45, now + 0.01); envelope.gain.exponentialRampToValueAtTime(0.001, now + duration)
    oscillator.connect(envelope); envelope.connect(this.gain); oscillator.start(now); oscillator.stop(now + duration)
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
  }
  dispose() { void this.context?.close() }
}
