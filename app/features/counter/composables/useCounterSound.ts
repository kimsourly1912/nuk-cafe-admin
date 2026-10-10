import { useEventListener } from '@vueuse/core'

interface Note {
  frequency: number
  /** Seconds after the sound starts. */
  at: number
}

/** The new-order chime: two rising notes. */
const CHIME: Note[] = [{ frequency: 880, at: 0 }, { frequency: 1320, at: 0.18 }]
/** The queue stopped updating: three low notes, so it isn't mistaken for an order. */
const WARNING: Note[] = [{ frequency: 440, at: 0 }, { frequency: 330, at: 0.25 }, { frequency: 440, at: 0.5 }]

/**
 * The counter's sounds (D102, D150), through one Web Audio context (no file to load). Browsers keep
 * it suspended until someone taps the page, so after any reload (a new version, a dropped tab) the
 * chime would be silent with nobody knowing: `blocked` says so, and the first tap anywhere turns
 * sound on. Without Web Audio, `blocked` stays false and the "New" badge still shows.
 */
export function useCounterSound() {
  const blocked = ref(false)
  let context: AudioContext | null = null

  function audio(): AudioContext | null {
    if (context) return context
    try {
      context = new AudioContext()
    }
    catch {
      return null
    }
    const current = context
    blocked.value = current.state === 'suspended'
    current.addEventListener('statechange', () => {
      blocked.value = current.state === 'suspended'
    })
    return current
  }

  function unlock() {
    const current = audio()
    if (current?.state === 'suspended') void current.resume().catch(() => {})
  }

  function play(notes: Note[]) {
    const current = audio()
    if (!current || current.state !== 'running') return
    for (const note of notes) {
      const oscillator = current.createOscillator()
      const gain = current.createGain()
      oscillator.frequency.value = note.frequency
      const start = current.currentTime + note.at
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
      oscillator.connect(gain).connect(current.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.32)
    }
  }

  onMounted(audio)
  useEventListener('pointerdown', unlock, { passive: true })
  onScopeDispose(() => void context?.close().catch(() => {}))

  return {
    /** The browser holds sound back until a tap on this page. */
    blocked: readonly(blocked),
    unlock,
    chime: () => play(CHIME),
    warning: () => play(WARNING),
  }
}
