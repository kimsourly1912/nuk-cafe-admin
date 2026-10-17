<script setup lang="ts">
/**
 * The promotion editor (`/admin/promotions/new`, `…/[id]/edit`, M1, D163): one page, sections in
 * the order an owner thinks (what it's called, how much off, on what, when, where, the poster), and
 * beside them from `lg` how customers will see it. A new promotion or a draft saves as a draft or
 * publishes; a published one saves its changes (the menu shows them at once). `copy` starts a new
 * one from another (Run again). Leaving with changes asks first; someone else's save (409) keeps
 * the input and offers Reload.
 */
import type { Promotion } from '#shared/contracts/menu-promotions'
import { discountLabel, discountOff, PROMOTION_DESCRIPTION_MAX } from '#shared/contracts/menu-promotions'
import { useCategoryOptions } from '~/features/categories'
import { useBranchOptions } from '~/features/branches'
import { fetchPromotion, usePromotionList, usePromotionMenuItems, usePromotionMutations } from '../composables/usePromotions'
import type { PromotionForm } from '../schemas/promotion-form'
import { addDays, categoryPath, daysBetween, formDiscount, localToday, newPromotionForm, overlapping, pickerTree, promotionFormSchema, toPromotionBody, toPromotionForm, whenText } from '../schemas/promotion-form'
import PromotionDateField from './PromotionDateField.vue'
import PromotionPosterInput from './PromotionPosterInput.vue'
import PromotionTargetsModal from './PromotionTargetsModal.vue'

const props = defineProps<{
  /** The promotion to edit; none for a new one. */
  id?: string
  /** A new promotion filled from this one (Run again). */
  copyId?: string
}>()

const tenantPath = useTenantPath()
const today = localToday()

const { create, update } = usePromotionMutations()
const { data: list } = usePromotionList()
const { data: branches } = useBranchOptions()
const { data: menuItems, loading: itemsLoading } = usePromotionMenuItems()
const { data: categories } = useCategoryOptions()

/** The saved promotion this draft is based on (its version is what Save names); none for a new one. */
const saved = shallowRef<Promotion>()
const loadError = ref<unknown>()
const ready = ref(!props.id && !props.copyId)
const state = reactive<PromotionForm>(newPromotionForm(today))
const saving = ref(false)
const uploading = ref(false)
const unsaved = useUnsavedChanges(state, { paused: saving, pending: uploading })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
// Each branch checkbox its own id: inside the branchIds field they'd all take the field's, and
// every label would tick the first one.
const formId = useId()

async function load() {
  loadError.value = undefined
  try {
    if (props.id) {
      saved.value = await fetchPromotion(props.id)
      Object.assign(state, toPromotionForm(saved.value))
    }
    else if (props.copyId) {
      const source = await fetchPromotion(props.copyId)
      const length = source.endsOn ? daysBetween(source.startsOn, source.endsOn) : null
      Object.assign(state, { ...toPromotionForm(source), name: `${source.name} (again)`, startsOn: today, endsOn: length === null ? null : addDays(today, length), posterId: undefined, posterUrl: undefined })
    }
    unsaved.markClean()
    ready.value = true
  }
  catch (error) {
    loadError.value = error
  }
}
if (!ready.value) void load()

const isNew = computed(() => !props.id)
const isDraft = computed(() => !saved.value || saved.value.status === 'draft')
const title = computed(() => (isNew.value ? 'New promotion' : 'Edit promotion'))
const backTo = computed(() => tenantPath(saved.value ? `/admin/promotions/${saved.value.id}` : '/admin/promotions'))

// --- What's included ---

const tree = computed(() => pickerTree(categories.value, menuItems.value ?? []))
const categoryNames = computed(() => new Map(categories.value.map(c => [c.id, c.name])))
const itemsById = computed(() => new Map((menuItems.value ?? []).map(i => [i.id, i])))
const chosenCategories = computed(() => state.categoryIds.map(id => ({ id, name: categoryNames.value.get(id) ?? saved.value?.categories.find(c => c.id === id)?.name ?? 'Unknown category' })))
const chosenItems = computed(() => state.itemIds.map(id => ({ id, name: itemsById.value.get(id)?.name ?? saved.value?.items.find(i => i.id === id)?.name ?? 'Unknown item' })))

const targetsModal = useOverlay().create(PromotionTargetsModal)
async function chooseTargets() {
  const chosen = await targetsModal.open({ tree: tree.value, itemIds: state.itemIds, categoryIds: state.categoryIds }).result
  if (!chosen) return
  state.itemIds = chosen.itemIds
  state.categoryIds = chosen.categoryIds
  form.value?.clear('itemIds')
}

const pathOf = computed(() => categoryPath(categories.value, menuItems.value ?? []))
const alongside = computed(() => overlapping(state, (list.value ?? []).filter(p => p.id !== props.id), pathOf.value))

// --- When ---

const noEnd = computed({
  get: () => state.endsOn === null,
  set: (value: boolean) => {
    state.endsOn = value ? null : addDays(state.startsOn, 6)
  },
})
const LENGTHS = [
  { label: '1 day', days: 1 },
  { label: 'Weekend', days: 2 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
]
const lengthDays = computed(() => (state.endsOn === null ? null : daysBetween(state.startsOn, state.endsOn) + 1))
function setLength(days: number) {
  state.endsOn = addDays(state.startsOn, days - 1)
}
// A first day moved past the last moves the last with it, keeping the length.
watch(() => state.startsOn, (start, before) => {
  if (state.endsOn !== null && state.endsOn < start) state.endsOn = addDays(start, Math.max(0, daysBetween(before, state.endsOn)))
})

// --- How customers see it ---

const discount = computed(() => formDiscount(state))
const label = computed(() => (discount.value ? discountLabel(discount.value) : '—'))
/** An item it lowers, for the price preview: the first chosen, or the menu's first. */
const example = computed(() => {
  const all = menuItems.value ?? []
  const first = state.scope === 'menu'
    ? all.find(i => i.priceMinMinor !== null)
    : all.find(i => i.priceMinMinor !== null && (state.itemIds.includes(i.id) || pathOf.value(i.id).some(id => state.categoryIds.includes(id))))
  if (!first || first.priceMinMinor === null || !discount.value) return null
  return { name: first.name, before: first.priceMinMinor, after: first.priceMinMinor - discountOff(discount.value, first.priceMinMinor) }
})

// --- Saving ---

const conflict = ref(false)
const lastError = ref<string>()
const publishing = ref(false)

async function submit(publish: boolean) {
  publishing.value = publish
  await form.value?.submit()
}

const FIELD: Record<string, string> = { 'discount.percent': 'percent', 'discount.amountMinor': 'amount', 'posterId': 'posterId' }
const fieldOf = (path: string) => FIELD[path] ?? path.replace(/\.\d+$/, '')

async function onSubmit() {
  if (saving.value || uploading.value) return
  saving.value = true
  lastError.value = undefined
  conflict.value = false
  const body = toPromotionBody(state)
  const result = saved.value
    ? await update.execute({ id: saved.value.id, wasDraft: saved.value.status === 'draft', body: { ...body, version: saved.value.version, publish: publishing.value } })
    : await create.execute({ ...body, publish: publishing.value })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    await navigateTo(tenantPath(`/admin/promotions/${result.data.id}`))
    return
  }
  if (result.status !== 'error') return
  if (result.error.code === 'VERSION_CONFLICT') {
    conflict.value = true
    return
  }
  const fieldErrors = Object.entries(result.error.fieldErrors ?? {})
    .flatMap(([field, messages]) => (messages[0] ? [{ name: fieldOf(field), message: messages[0] }] : []))
  form.value?.setErrors(fieldErrors)
  if (!fieldErrors.length) lastError.value = result.error.message
}

/** Someone else saved: base the save on their version, keeping this input. */
async function reload() {
  if (!saved.value) return
  const latest = await fetchPromotion(saved.value.id).catch(() => undefined)
  if (!latest) return
  saved.value = latest
  conflict.value = false
}

useSubmitShortcut(() => submit(!isDraft.value))
</script>

<template>
  <UDashboardPanel id="promotion-editor">
    <template #header>
      <UDashboardNavbar :title="title">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="backTo"
            :aria-label="saved ? 'Back to the promotion' : 'Back to promotions'"
          />
        </template>
        <template
          v-if="ready"
          #right
        >
          <div class="hidden items-center gap-2 lg:flex">
            <template v-if="isDraft">
              <UButton
                label="Save draft"
                color="neutral"
                variant="outline"
                :loading="saving && !publishing"
                :disabled="saving || uploading"
                @click="submit(false)"
              />
              <UButton
                label="Publish"
                icon="i-lucide-send"
                :loading="saving && publishing"
                :disabled="saving || uploading"
                @click="submit(true)"
              />
            </template>
            <UButton
              v-else
              label="Save changes"
              icon="i-lucide-save"
              :loading="saving"
              :disabled="!unsaved.isDirty.value || uploading"
              @click="submit(true)"
            />
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="loadError"
        :error="loadError"
        title="Could not load the promotion"
        @retry="load()"
      />
      <ListSkeleton
        v-else-if="!ready"
        label="Loading the promotion…"
        variant="card"
      />
      <div
        v-else
        class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div class="min-w-0 space-y-6">
          <UAlert
            v-if="conflict"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Someone else changed this promotion"
            description="Reload to base your changes on theirs (your input stays), then save again."
            :actions="[{ label: 'Reload', color: 'neutral', variant: 'outline', onClick: reload }]"
          />
          <UAlert
            v-if="lastError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Not saved"
            :description="lastError"
          />
          <UAlert
            v-if="saved && saved.phase === 'live'"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="This promotion is live"
            description="Changes reach the menu as soon as you save. Orders already placed keep their price."
          />

          <UForm
            id="promotion-form"
            ref="form"
            :schema="promotionFormSchema"
            :state="state"
            :validate-on="['input', 'change']"
            :disabled="saving"
            class="space-y-6"
            @submit="onSubmit"
          >
            <UCard variant="outline">
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  Details
                </h2>
                <p class="text-sm text-muted">
                  Customers see the name beside the poster on the menu.
                </p>
              </template>
              <div class="space-y-4">
                <UFormField
                  label="Name"
                  name="name"
                  required
                >
                  <UInput
                    v-model="state.name"
                    placeholder="Coffee week"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  label="Description"
                  name="description"
                  :hint="`${state.description.length}/${PROMOTION_DESCRIPTION_MAX}`"
                  help="Optional. One line under the name: “Every coffee 20% off, all week.”"
                >
                  <UTextarea
                    v-model="state.description"
                    :rows="2"
                    autoresize
                    class="w-full"
                  />
                </UFormField>
              </div>
            </UCard>

            <UCard variant="outline">
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  Discount
                </h2>
                <p class="text-sm text-muted">
                  Taken off each item's price. Add-ons keep their price.
                </p>
              </template>
              <div class="space-y-4">
                <URadioGroup
                  v-model="state.kind"
                  variant="card"
                  orientation="horizontal"
                  aria-label="Kind of discount"
                  :items="[
                    { label: 'Percent off', value: 'percent', description: 'Like 20% off' },
                    { label: 'Amount off', value: 'amount', description: 'Like $1.00 off each' },
                  ]"
                  :ui="{ fieldset: 'grid grid-cols-2 gap-3', item: 'w-full', description: 'text-toned' }"
                />
                <UFormField
                  v-if="state.kind === 'percent'"
                  label="Percent off"
                  name="percent"
                  required
                >
                  <div class="flex items-center gap-2">
                    <UInputNumber
                      v-model="state.percent"
                      :min="1"
                      :max="100"
                      :step="1"
                      class="w-32"
                    />
                    <span class="text-sm text-muted">% off</span>
                  </div>
                </UFormField>
                <UFormField
                  v-else
                  label="Amount off each item"
                  name="amount"
                  required
                >
                  <UInputNumber
                    :model-value="state.amount"
                    :format-options="PRICE_FORMAT"
                    :min="0"
                    :step="0.25"
                    class="w-36"
                    @update:model-value="value => state.amount = value ?? undefined"
                  />
                </UFormField>
              </div>
            </UCard>

            <UCard variant="outline">
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  What's included
                </h2>
                <p class="text-sm text-muted">
                  If another promotion also covers an item, customers get the bigger discount, never both.
                </p>
              </template>
              <div class="space-y-4">
                <URadioGroup
                  v-model="state.scope"
                  variant="card"
                  orientation="horizontal"
                  aria-label="What's included"
                  :items="[
                    { label: 'Chosen items', value: 'selected', description: 'Items or whole categories' },
                    { label: 'Whole menu', value: 'menu', description: 'Everything, also items added later' },
                  ]"
                  :ui="{ fieldset: 'grid grid-cols-2 gap-3', item: 'w-full', description: 'text-toned' }"
                />
                <UFormField
                  v-if="state.scope === 'selected'"
                  name="itemIds"
                >
                  <div
                    v-if="!chosenCategories.length && !chosenItems.length"
                    class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-accented p-6 text-center"
                  >
                    <p class="text-sm text-muted">
                      Nothing chosen yet
                    </p>
                    <UButton
                      label="Choose items"
                      icon="i-lucide-list-checks"
                      :loading="itemsLoading"
                      @click="chooseTargets()"
                    />
                  </div>
                  <div
                    v-else
                    class="space-y-3"
                  >
                    <ul
                      class="divide-y divide-default rounded-lg border border-default"
                      aria-label="Included"
                    >
                      <li
                        v-for="category in chosenCategories"
                        :key="category.id"
                        class="flex items-center gap-3 px-3 py-2"
                      >
                        <UIcon
                          name="i-lucide-folder"
                          class="size-4 shrink-0 text-muted"
                        />
                        <span class="min-w-0 flex-1 truncate text-sm"><span class="font-medium text-highlighted">{{ category.name }}</span> <span class="text-muted">· every item</span></span>
                        <UButton
                          icon="i-lucide-x"
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          :aria-label="`Remove ${category.name}`"
                          @click="state.categoryIds = state.categoryIds.filter(id => id !== category.id)"
                        />
                      </li>
                      <li
                        v-for="item in chosenItems"
                        :key="item.id"
                        class="flex items-center gap-3 px-3 py-2"
                      >
                        <UIcon
                          name="i-lucide-coffee"
                          class="size-4 shrink-0 text-muted"
                        />
                        <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ item.name }}</span>
                        <UButton
                          icon="i-lucide-x"
                          color="neutral"
                          variant="ghost"
                          size="sm"
                          :aria-label="`Remove ${item.name}`"
                          @click="state.itemIds = state.itemIds.filter(id => id !== item.id)"
                        />
                      </li>
                    </ul>
                    <UButton
                      label="Change"
                      icon="i-lucide-list-checks"
                      color="neutral"
                      variant="outline"
                      :loading="itemsLoading"
                      @click="chooseTargets()"
                    />
                  </div>
                </UFormField>
                <UAlert
                  v-if="alongside.length"
                  color="info"
                  variant="subtle"
                  icon="i-lucide-layers"
                  :title="`Also covered by ${alongside.map(p => `“${p.name}” (${p.label})`).join(', ')}`"
                  description="Where both apply, customers get the bigger discount."
                />
              </div>
            </UCard>

            <UCard variant="outline">
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  When
                </h2>
                <p class="text-sm text-muted">
                  All day on these dates, on each branch's own clock.
                </p>
              </template>
              <div class="space-y-4">
                <div class="grid gap-4 sm:grid-cols-2">
                  <UFormField
                    label="First day"
                    name="startsOn"
                    required
                  >
                    <PromotionDateField
                      v-model="state.startsOn"
                      label="First day"
                      :disabled="saving"
                    />
                  </UFormField>
                  <UFormField
                    label="Last day"
                    name="endsOn"
                  >
                    <PromotionDateField
                      v-if="state.endsOn !== null"
                      :model-value="state.endsOn"
                      label="Last day"
                      :min="state.startsOn"
                      :disabled="saving"
                      @update:model-value="value => state.endsOn = value"
                    />
                    <p
                      v-else
                      class="flex h-8 items-center text-sm text-muted"
                    >
                      Runs until you end it
                    </p>
                  </UFormField>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    v-for="length in LENGTHS"
                    :key="length.days"
                    :label="length.label"
                    size="sm"
                    color="neutral"
                    :variant="lengthDays === length.days ? 'solid' : 'outline'"
                    :aria-pressed="lengthDays === length.days"
                    @click="setLength(length.days)"
                  />
                  <UCheckbox
                    v-model="noEnd"
                    label="No end date"
                    class="ml-1"
                  />
                </div>
              </div>
            </UCard>

            <UCard
              v-if="(branches?.length ?? 0) > 1"
              variant="outline"
            >
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  Branches
                </h2>
                <p class="text-sm text-muted">
                  Where the lower prices apply.
                </p>
              </template>
              <div class="space-y-4">
                <URadioGroup
                  :model-value="state.allBranches ? 'all' : 'chosen'"
                  aria-label="Branches"
                  :items="[{ label: 'Every branch', value: 'all' }, { label: 'Chosen branches', value: 'chosen' }]"
                  @update:model-value="value => state.allBranches = value === 'all'"
                />
                <UFormField
                  v-if="!state.allBranches"
                  name="branchIds"
                >
                  <div class="grid gap-2 sm:grid-cols-2">
                    <UCheckbox
                      v-for="branch in branches"
                      :id="`${formId}-branch-${branch.id}`"
                      :key="branch.id"
                      :model-value="state.branchIds.includes(branch.id)"
                      :label="branch.name"
                      @update:model-value="on => state.branchIds = on ? [...state.branchIds, branch.id] : state.branchIds.filter(id => id !== branch.id)"
                    />
                  </div>
                </UFormField>
              </div>
            </UCard>

            <UCard variant="outline">
              <template #header>
                <h2 class="font-semibold text-highlighted">
                  Poster
                </h2>
                <p class="text-sm text-muted">
                  Optional. Customers see it on the menu while the promotion runs.
                </p>
              </template>
              <UFormField name="posterId">
                <PromotionPosterInput
                  v-model:poster-url="state.posterUrl"
                  v-model:poster-id="state.posterId"
                  v-model:uploading="uploading"
                  :disabled="saving"
                />
              </UFormField>
            </UCard>
          </UForm>
        </div>

        <aside
          class="space-y-3 lg:sticky lg:top-4"
          aria-labelledby="promotion-preview"
        >
          <UCard variant="outline">
            <template #header>
              <h2
                id="promotion-preview"
                class="font-semibold text-highlighted"
              >
                How customers see it
              </h2>
            </template>
            <div class="space-y-4">
              <div class="flex gap-3 rounded-lg bg-elevated/50 p-3">
                <div class="aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-md bg-elevated ring ring-default">
                  <img
                    v-if="state.posterUrl"
                    :src="state.posterUrl"
                    alt=""
                    class="size-full object-cover"
                  >
                  <div
                    v-else
                    class="flex size-full items-center justify-center text-dimmed"
                  >
                    <UIcon
                      name="i-lucide-badge-percent"
                      class="size-6"
                    />
                  </div>
                </div>
                <div class="min-w-0 space-y-1">
                  <UBadge
                    :label="label"
                    color="primary"
                    variant="solid"
                    size="sm"
                  />
                  <p class="truncate font-semibold text-highlighted">
                    {{ state.name.trim() || 'Promotion name' }}
                  </p>
                  <p
                    v-if="state.description.trim()"
                    class="line-clamp-2 text-xs text-muted"
                  >
                    {{ state.description }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ whenText(state.startsOn, state.endsOn) }}
                  </p>
                </div>
              </div>
              <div
                v-if="example"
                class="flex items-center justify-between gap-3 text-sm"
              >
                <span class="min-w-0 truncate">{{ example.name }}</span>
                <span class="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <s class="text-muted">{{ formatMinor(example.before) }}</s>
                  <span class="font-semibold text-highlighted">{{ formatMinor(example.after) }}</span>
                </span>
              </div>
              <p class="text-xs text-muted">
                The lower price shows on the menu, at checkout and on the order. Add-ons keep their price.
              </p>
            </div>
          </UCard>
        </aside>
      </div>

      <BottomActionBar
        label="Save"
        :open="ready"
        expanded="hidden"
      >
        <template v-if="isDraft">
          <UButton
            label="Save draft"
            color="neutral"
            variant="outline"
            class="flex-1 justify-center"
            :loading="saving && !publishing"
            :disabled="saving || uploading"
            @click="submit(false)"
          />
          <UButton
            label="Publish"
            icon="i-lucide-send"
            class="flex-1 justify-center"
            :loading="saving && publishing"
            :disabled="saving || uploading"
            @click="submit(true)"
          />
        </template>
        <UButton
          v-else
          label="Save changes"
          icon="i-lucide-save"
          class="flex-1 justify-center"
          :loading="saving"
          :disabled="!unsaved.isDirty.value || uploading"
          @click="submit(true)"
        />
      </BottomActionBar>
    </template>
  </UDashboardPanel>
</template>
