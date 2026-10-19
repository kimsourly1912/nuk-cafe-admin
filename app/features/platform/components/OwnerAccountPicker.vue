<script setup lang="ts">
/**
 * The account search of New cafe's "Use existing account" (D185): a `USelectMenu` whose options come
 * from a bounded server search by name or email (ui §14: records that can reach thousands are
 * searched on the server), never a list of everyone. The chosen account stays in the field while
 * the search changes. `seed` runs a search for an email and chooses its exact match: where "Create
 * new account" found that the email already has an account.
 */
import type { SelectMenuItem } from '@nuxt/ui'
import type { PlatformOwner } from '#shared/contracts/tenants'
import { OWNER_SEARCH_MIN } from '#shared/contracts/tenants'
import { useOwnerAccountSearch } from '../composables/useCafes'
import { ownerLabel } from '../schemas/cafe-form'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ seed?: { email: string } }>()
const account = defineModel<PlatformOwner | undefined>('account')

const term = ref('')
const search = useOwnerAccountSearch(term)

const toItem = (owner: PlatformOwner): SelectMenuItem => ({ label: owner.name, description: owner.email, value: owner.id })
const items = computed<SelectMenuItem[]>(() => {
  const found = search.items.value
  // The chosen one stays listed, whatever the search shows.
  const chosen = account.value && !found.some(owner => owner.id === account.value!.id) ? [account.value] : []
  return [...chosen, ...found].map(toItem)
})

function pick(id: unknown) {
  const owner = [...search.items.value, ...(account.value ? [account.value] : [])].find(candidate => candidate.id === id)
  if (owner) account.value = owner
}

// An email to find and choose, once its answer is in.
let wanted = ''
watch(() => props.seed, (seed) => {
  if (!seed) return
  wanted = seed.email.trim().toLowerCase()
  term.value = seed.email
}, { immediate: true })
watch([search.items, search.searching], () => {
  if (!wanted || search.searching.value) return
  const match = search.items.value.find(owner => owner.email.toLowerCase() === wanted)
  wanted = ''
  if (match) account.value = match
})

const emptyText = computed(() => {
  const typed = term.value.trim()
  if (typed.length < OWNER_SEARCH_MIN) return `Type at least ${OWNER_SEARCH_MIN} characters of a name or email`
  if (search.error.value) return 'Could not search. Try again.'
  if (search.searching.value) return 'Searching…'
  return `No accounts match “${typed}”`
})
</script>

<template>
  <USelectMenu
    v-bind="$attrs"
    v-model:search-term="term"
    :model-value="account?.id"
    role="combobox"
    :items="items"
    value-key="value"
    ignore-filter
    :loading="search.searching.value"
    :search-input="{ placeholder: 'Search by name or email…' }"
    @update:model-value="pick"
  >
    <template #default>
      <span
        v-if="account"
        class="truncate"
      >{{ ownerLabel(account) }}</span>
      <span
        v-else
        class="truncate text-muted"
      >Search by name or email</span>
    </template>
    <template #empty>
      {{ emptyText }}
    </template>
  </USelectMenu>
</template>
