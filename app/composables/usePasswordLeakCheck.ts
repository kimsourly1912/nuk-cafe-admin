import type { MaybeRefOrGetter } from 'vue'
import { refDebounced } from '@vueuse/core'
import type { PasswordRange } from '#shared/contracts/identity'
import { PASSWORD_MIN } from '#shared/contracts/identity'

/**
 * `idle`: too short to check. `checking`: waiting for typing to pause, or for the answer.
 * `safe` / `leaked`: the answer. `unavailable`: no answer (offline, the service down, or a page
 * without `crypto.subtle`, which is only on https and localhost); the save checks it anyway.
 */
export type PasswordLeakCheck = 'idle' | 'checking' | 'safe' | 'leaked' | 'unavailable'

/**
 * Whether a new password is on Have I Been Pwned's list of leaked passwords, while typing (D210),
 * the list Better Auth refuses on save. The password never leaves the browser: it's hashed here
 * (SHA-1), only the hash's first 5 characters go to `/api/password-ranges/{prefix}`, and the rest
 * is compared here. Checked 400 ms after typing pauses; an older answer never shows for a newer
 * password.
 *
 * `generated` is the password the Generate button made: random, so it can't be on the list. While
 * the field holds exactly that, it's `safe` at once and nothing is requested, however often the
 * button is pressed; an edit to it is checked as usual.
 */
export function usePasswordLeakCheck(password: MaybeRefOrGetter<string>, generated?: MaybeRefOrGetter<string | undefined>) {
  const supported = import.meta.client && !!globalThis.crypto?.subtle
  const typed = computed(() => toValue(password))
  const settled = refDebounced(typed, 400)
  const hash = ref<{ password: string, prefix: string, suffix: string }>()

  watch(settled, async (value) => {
    if (!supported || value.length < PASSWORD_MIN || value === toValue(generated)) {
      hash.value = undefined
      return
    }
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
    if (value !== settled.value) return
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    hash.value = { password: value, prefix: hex.slice(0, 5), suffix: hex.slice(5) }
  }, { immediate: true })

  const prefix = computed(() => hash.value?.prefix)
  const { data, pending, error } = useApiQuery(
    'password:range',
    async () => {
      const asked = prefix.value
      return asked ? { prefix: asked, ...await apiFetch<PasswordRange>(`/password-ranges/${asked}`) } : null
    },
    { server: false, watch: [prefix] },
  )

  const state = computed<PasswordLeakCheck>(() => {
    const value = typed.value
    if (value.length < PASSWORD_MIN) return 'idle'
    if (value === toValue(generated)) return 'safe'
    if (!supported) return 'unavailable'
    const current = hash.value
    if (!current || current.password !== value) return 'checking'
    if (pending.value) return 'checking'
    if (error.value || data.value?.prefix !== current.prefix) return 'unavailable'
    return data.value.suffixes.includes(current.suffix) ? 'leaked' : 'safe'
  })

  return { state }
}
