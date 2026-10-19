import { refDebounced } from '@vueuse/core'
import * as v from 'valibot'
import type { Page } from '#shared/contracts/common'
import type { AddOwnerInput, ChangeTenantSlugInput, CreatedTenant, CreateTenantInput, OwnerChange, PlatformOwner, RemoveOwnerInput, SlugAvailability, SuspendTenantInput, TenantCounts, TenantDetail, TenantListQuery, TenantOwner, TenantSummary, TransferOwnerInput, UpdateTenantNotesInput } from '#shared/contracts/tenants'
import { OWNER_SEARCH_MIN, slugSchema } from '#shared/contracts/tenants'
import type { CafeForm } from '../schemas/cafe-form'

/** Pausing, resuming, moving one cafe and changing its owners must never overlap: all take this record lock. */
const lockOf = (id: string) => `cafe:${id}`

/** The New cafe page (`/platform/cafes/new`); `ownerId` opens it with that account chosen as the owner. */
export const NEW_CAFE_PATH = '/platform/cafes/new'
export const newCafePath = (ownerId?: string) => ownerId ? `${NEW_CAFE_PATH}?owner=${encodeURIComponent(ownerId)}` : NEW_CAFE_PATH

/** How long typing settles before a lookup asks the server. */
const LOOKUP_DELAY_MS = 300

/** The cafes, a page at a time. Refetches whenever `query` changes. */
export function useCafeList(query: MaybeRefOrGetter<Partial<TenantListQuery>>) {
  return useApiQuery('platform:cafes', () => apiFetch<Page<TenantSummary>>('/platform/tenants', { query: toValue(query) }), {
    watch: [() => ({ ...toValue(query) })],
  })
}

/** One cafe: its usage, owners and former addresses. */
export function useCafe(id: MaybeRefOrGetter<string>) {
  return useApiQuery(`platform:cafe:${toValue(id)}`, () => apiFetch<TenantDetail>(`/platform/tenants/${toValue(id)}`))
}

/**
 * The accounts a new cafe can be given to, found by name or email (New cafe's "Use existing
 * account", D185). A bounded server search, asked once typing settles; an answer is used only while
 * it is for the search on screen, so a slow older answer never shows.
 */
export function useOwnerAccountSearch(term: MaybeRefOrGetter<string>) {
  const typed = computed(() => toValue(term).trim())
  const settled = refDebounced(typed, LOOKUP_DELAY_MS)
  const query = useApiQuery('platform:owner-search', async () => {
    const search = settled.value
    if (search.length < OWNER_SEARCH_MIN) return { search, items: [] as PlatformOwner[] }
    return { search, items: await apiFetch<PlatformOwner[]>('/platform/owner-candidates', { query: { search } }) }
  }, { watch: [settled] })

  const current = computed(() => query.data.value?.search === typed.value)
  return {
    items: computed(() => (current.value ? query.data.value?.items ?? [] : [])),
    /** A search is long enough and its answer isn't here yet. */
    searching: computed(() => typed.value.length >= OWNER_SEARCH_MIN && !current.value && !query.error.value),
    error: query.error,
  }
}

/** One account the page opens with chosen (`?owner=<id>`); `null` without one, a 404 when it can't be chosen. */
export function useOwnerAccount(id: string | undefined) {
  return useApiQuery(`platform:owner-account:${id ?? 'none'}`, async () => (id ? apiFetch<PlatformOwner>(`/platform/owner-candidates/${id}`) : null))
}

export type SlugCheck = 'idle' | 'checking' | 'available' | 'taken' | 'unknown'

/**
 * Whether the address typed is free, now and in the address history (D185): asked once typing
 * settles and only for an address that passes the address rules. Each answer names its address, and
 * counts only while that is still the one typed: a stale answer is never shown. Advisory: the save
 * decides.
 */
export function useSlugAvailability(slug: MaybeRefOrGetter<string>) {
  const candidate = computed(() => {
    const parsed = v.safeParse(slugSchema, toValue(slug))
    return parsed.success ? parsed.output : ''
  })
  const settled = refDebounced(candidate, LOOKUP_DELAY_MS)
  const query = useApiQuery('platform:slug-availability', async () => {
    const address = settled.value
    return address ? apiFetch<SlugAvailability>('/platform/slug-availability', { query: { slug: address } }) : null
  }, { watch: [settled] })

  return computed<SlugCheck>(() => {
    if (!candidate.value) return 'idle'
    const answer = query.data.value
    if (answer?.slug === candidate.value) return answer.available ? 'available' : 'taken'
    if (settled.value === candidate.value && query.error.value && !query.pending.value) return 'unknown'
    return 'checking'
  })
}

/**
 * A form whose save failed after its page was left, handed to "Reopen" (an error toast's action).
 * Held in memory only, for the one click: the toast that carries it goes with a session change, and
 * the page takes it as it opens. It holds no password (the form has none).
 */
let reopenedForm: CafeForm | null = null

export function reopenCafeForm(draft: CafeForm) {
  reopenedForm = draft
  return navigateTo(NEW_CAFE_PATH)
}

export function takeReopenedCafeForm(): CafeForm | null {
  const draft = reopenedForm
  reopenedForm = null
  return draft
}

/**
 * The console's changes. State is shared app-wide by mutation id, so a page knows a cafe is being
 * changed even after the page that started it closed.
 */
export function useCafeMutations() {
  const create = useMutation(
    (body: CreateTenantInput) => apiFetch<CreatedTenant>('/platform/tenants', { method: 'POST', body }),
    {
      id: 'platform:create-cafe',
      // The address identifies the submission: a double submit is skipped.
      key: body => body.slug,
      successMessage: (_, body) => `${body.name} created`,
      errorMessage: body => `Could not create ${body.name}`,
      invalidate: ['platform'],
    },
  )

  const suspend = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: SuspendTenantInput }) =>
      apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/suspend`, { method: 'POST', body }),
    {
      id: 'platform:suspend-cafe',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (_, { cafe }) => `${cafe.name} is paused`,
      errorMessage: ({ cafe }) => `Could not pause ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  const resume = useMutation(
    (cafe: TenantDetail) => apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/resume`, { method: 'POST', body: { version: cafe.version } }),
    {
      id: 'platform:resume-cafe',
      key: cafe => cafe.id,
      lock: cafe => lockOf(cafe.id),
      confirm: cafe => ({
        title: `Resume ${cafe.name}?`,
        description: 'Customers can order again, and the cafe\'s staff can use the admin and the counter.',
        confirmLabel: 'Resume',
      }),
      successMessage: (_, cafe) => `${cafe.name} is open again`,
      errorMessage: cafe => `Could not resume ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  const changeSlug = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: ChangeTenantSlugInput }) =>
      apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/slug`, { method: 'POST', body }),
    {
      id: 'platform:change-cafe-address',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (updated, { cafe }) => `${cafe.name} moved to /c/${updated.slug}`,
      errorMessage: ({ cafe }) => `Could not change ${cafe.name}'s address`,
      invalidate: ['platform'],
    },
  )

  // --- Owners (step P2, D189): the dialogs show a new account's password, so no toast repeats it ---

  const addOwner = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: AddOwnerInput }) =>
      apiFetch<OwnerChange>(`/platform/tenants/${cafe.id}/owners`, { method: 'POST', body }),
    {
      id: 'platform:add-cafe-owner',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (_, { cafe }) => `Owner added to ${cafe.name}`,
      errorMessage: ({ cafe }) => `Could not add an owner to ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  const removeOwner = useMutation(
    ({ cafe, owner, body }: { cafe: TenantDetail, owner: TenantOwner, body: RemoveOwnerInput }) =>
      apiFetch<OwnerChange>(`/platform/tenants/${cafe.id}/owners/${owner.id}/remove`, { method: 'POST', body }),
    {
      id: 'platform:remove-cafe-owner',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (_, { cafe, owner }) => `${owner.name} no longer owns ${cafe.name}`,
      errorMessage: ({ owner }) => `Could not remove ${owner.name}`,
      invalidate: ['platform'],
    },
  )

  const transferOwner = useMutation(
    ({ cafe, owner, body }: { cafe: TenantDetail, owner: TenantOwner, body: TransferOwnerInput }) =>
      apiFetch<OwnerChange>(`/platform/tenants/${cafe.id}/owners/${owner.id}/transfer`, { method: 'POST', body }),
    {
      id: 'platform:transfer-cafe-owner',
      key: ({ cafe }) => cafe.id,
      lock: ({ cafe }) => lockOf(cafe.id),
      successMessage: (_, { cafe, owner }) => `${owner.name}'s ownership of ${cafe.name} transferred`,
      errorMessage: ({ owner }) => `Could not transfer ${owner.name}'s ownership`,
      invalidate: ['platform'],
    },
  )

  // Notes have their own version: they don't wait for the cafe's other changes.
  const updateNotes = useMutation(
    ({ cafe, body }: { cafe: TenantDetail, body: UpdateTenantNotesInput }) =>
      apiFetch<TenantDetail>(`/platform/tenants/${cafe.id}/notes`, { method: 'PUT', body }),
    {
      id: 'platform:cafe-notes',
      key: ({ cafe }) => cafe.id,
      successMessage: (_, { cafe }) => `Notes about ${cafe.name} saved`,
      errorMessage: ({ cafe }) => `Could not save the notes about ${cafe.name}`,
      invalidate: ['platform'],
    },
  )

  return {
    create,
    suspend,
    resume,
    changeSlug,
    addOwner,
    removeOwner,
    transferOwner,
    updateNotes,
    /** Any change in flight for this cafe: its actions wait. */
    isBusy: (id: string) => [suspend, resume, changeSlug, addOwner, removeOwner, transferOwner].some(mutation => mutation.isPending(id)),
  }
}

/** How many cafes each status tab holds, in one read. */
export function useCafeCounts() {
  return useApiQuery('platform:cafe-counts', async () => {
    const { active, suspended } = await apiFetch<TenantCounts>('/platform/tenants/counts')
    return { all: active + suspended, active, suspended }
  })
}
