import { BAR_SECONDS, judgeDrift, loopDrift, planLoopStart, raceAnchor } from './grid'
import type { LoopVoice } from './voices'

/** Headroom between deciding to start a source and it starting. */
const START_LEAD_SECONDS = 0.03
const FRESH_START_FADE_SECONDS = 0.005
const RESYNC_FADE_SECONDS = 0.03
const PAUSE_FADE_SECONDS = 0.06
const OUTRO_SECONDS = 3.2

/**
 * Keeps the race track and the hat layer locked to the race clock. The race controller reports the
 * tick on screen every frame; the music is started at the loop position that tick implies and
 * rescheduled whenever it drifts out of tolerance (a stalled frame loop, a suspended context).
 * Both layers share one anchor, and the track length is a whole number of bars, so the hat
 * layer's one-bar loop stays on the track's grid.
 */
export class RaceMusic {
  private track: { buffer: AudioBuffer; loopSeconds: number } | null = null
  private hats: AudioBuffer | null = null
  private strikes = 0
  private finished = false

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly music: LoopVoice,
    private readonly hatLayer: LoopVoice,
    private readonly musicLevel: () => number,
  ) {}

  get isFinished(): boolean {
    return this.finished
  }

  get hasTrack(): boolean {
    return this.track !== null
  }

  /** Arms a new race: silence whatever played, forget the finish. */
  reset(): void {
    this.finished = false
    this.strikes = 0
    this.music.stop(PAUSE_FADE_SECONDS)
    this.hatLayer.stop(PAUSE_FADE_SECONDS)
    this.music.glideLevel(this.musicLevel(), 0.01)
  }

  setTrack(buffer: AudioBuffer, loopSeconds: number): void {
    if (this.track?.buffer === buffer) return
    this.track = { buffer, loopSeconds }
    this.music.stop(PAUSE_FADE_SECONDS)
    this.hatLayer.stop(PAUSE_FADE_SECONDS)
  }

  /** The hat layer can arrive after the music started (it renders in its own task); it then joins in phase. */
  setHats(buffer: AudioBuffer): void {
    this.hats = buffer
    const anchor = this.music.anchor
    if (anchor === null || this.finished) return
    const start = planLoopStart(anchor, this.ctx.currentTime + START_LEAD_SECONDS, BAR_SECONDS)
    this.hatLayer.start(buffer, { ...start, loopSeconds: BAR_SECONDS, fade: RESYNC_FADE_SECONDS })
  }

  /**
   * `heard`: context time reaching the speakers now. `tick`: the race tick on screen now; it may
   * be fractional, and negative during a countdown, in which case the loop's tail plays as a
   * count-in and beat 0 lands exactly on tick 0.
   */
  sync(heard: number, tick: number, running: boolean): void {
    if (this.finished) return
    if (!running) {
      this.pause()
      return
    }
    const track = this.track
    if (!track) return
    const anchor = raceAnchor(heard, tick)
    const playing = this.music.anchor
    if (playing === null) {
      this.startAt(track, anchor, FRESH_START_FADE_SECONDS)
      return
    }
    const verdict = judgeDrift(loopDrift(playing, anchor, track.loopSeconds), this.strikes)
    this.strikes = verdict.strikes
    if (verdict.resync) this.startAt(track, anchor, RESYNC_FADE_SECONDS)
  }

  pause(): void {
    this.strikes = 0
    this.music.stop(PAUSE_FADE_SECONDS)
    this.hatLayer.stop(PAUSE_FADE_SECONDS)
  }

  /** The race is over: the track plays on unsynced and fades out under the finish stinger. */
  finish(): void {
    if (this.finished) return
    this.finished = true
    this.music.glideLevel(0, OUTRO_SECONDS / 4)
    this.music.stop(0.05, this.ctx.currentTime + OUTRO_SECONDS)
    this.hatLayer.stop(0.3)
  }

  /** Leaving the race scene. */
  stop(fade: number): void {
    this.strikes = 0
    this.music.stop(fade)
    this.hatLayer.stop(fade)
    this.track = null
  }

  private startAt(track: { buffer: AudioBuffer; loopSeconds: number }, anchor: number, fade: number): void {
    const earliest = this.ctx.currentTime + START_LEAD_SECONDS
    const start = planLoopStart(anchor, earliest, track.loopSeconds)
    this.music.glideLevel(this.musicLevel(), 0.01)
    this.music.start(track.buffer, { ...start, loopSeconds: track.loopSeconds, fade })
    if (this.hats) this.hatLayer.start(this.hats, { ...planLoopStart(anchor, earliest, BAR_SECONDS), loopSeconds: BAR_SECONDS, fade })
    this.strikes = 0
  }
}
