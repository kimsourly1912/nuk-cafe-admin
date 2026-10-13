import type { Modifier, ModifierGroup } from '#shared/contracts/menu-modifiers'
import type { Ref } from 'vue'

type SendResult = { ok: true, data: ModifierGroup } | { ok: false, status: 'error' | 'cancelled' | 'skipped' }

interface PreselectQueueOptions {
  group: Ref<ModifierGroup | null | undefined>
  /** Sends one change at the group's version (the page's `setDefault` mutation). */
  send: (group: ModifierGroup, modifier: Modifier, isDefault: boolean) => Promise<SendResult>
  /** The server's answer: the whole group, now the page's copy. */
  saved: (group: ModifierGroup) => void
  /** Another change to the group is running: a skipped send starts again once it's done. */
  busy: () => boolean
}

/**
 * Preselected boxes that never wait (the owner, 2026-10-13, D166). A group's add-ons share the
 * group's one `version` (D59), so two changes can't be sent at once the way the counter's sold-out
 * switches are. Instead a box shows its new value at once and the changes wait in order: each is
 * sent after the previous answer, with the version that answer gave. Ticking a box back before its
 * change is sent sends nothing. A refused change puts every waiting box back to the saved value
 * (the page says why). The rules (the group's maximum) are checked on the boxes as shown.
 */
export function usePreselectQueue(options: PreselectQueueOptions) {
  const { group, send, saved, busy } = options
  /** Add-on id → the value its box shows, until the server has it. */
  const wanted = reactive(new Map<string, boolean>())
  const sending = ref<string>()
  let running = false

  const savedValue = (id: string) => group.value?.modifiers.find(m => m.id === id)?.isDefault

  /** The group as its boxes show it. */
  const shown = computed(() => group.value && {
    ...group.value,
    modifiers: group.value.modifiers.map(m => (wanted.has(m.id) ? { ...m, isDefault: wanted.get(m.id)! } : m)),
  })

  async function drain() {
    if (running) return
    running = true
    try {
      while (group.value) {
        for (const [id, value] of wanted) {
          if (savedValue(id) === undefined || savedValue(id) === value) wanted.delete(id)
        }
        const next = wanted.entries().next()
        if (next.done) break
        const [id, value] = next.value
        const modifier = group.value.modifiers.find(m => m.id === id)!
        sending.value = id
        const result = await send(group.value, modifier, value)
        sending.value = undefined
        if (result.ok) {
          saved(result.data)
          continue
        }
        // Skipped: another change holds the group; the watch below starts again after it.
        if (result.status !== 'skipped') wanted.clear()
        break
      }
    }
    finally {
      running = false
    }
  }

  watch(busy, (isBusy) => {
    if (!isBusy && wanted.size) drain()
  })

  function set(modifier: Modifier, isDefault: boolean) {
    wanted.set(modifier.id, isDefault)
    drain()
  }

  return {
    shown,
    set,
    /** The box's change isn't saved yet (sending or waiting its turn). */
    isSaving: (id: string) => wanted.has(id) || sending.value === id,
    /** A change is being sent now (the page's other actions stay available meanwhile). */
    sending: computed(() => !!sending.value),
  }
}
