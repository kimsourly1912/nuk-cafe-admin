<script setup lang="ts">
/**
 * The Menu item editor's form (D70, D90), shared by the slide-over and the route: the `UForm` and
 * its four sections (details, prices, add-ons, availability). `section` shows one of them (the route
 * on phones) or all (default). Every section stays mounted, so a hidden one keeps its input and is
 * validated too: an invalid field emits `invalid` with its section, for the owner to show it.
 * Submit with a button carrying `form="<formId>"`, or `submit()`.
 */
import type { DropdownMenuItem, FormErrorEvent } from '@nuxt/ui'
import { MAX_ITEM_OPTION_SETS } from '#shared/contracts/menu-items'
import { AvailabilityRuleSelect } from '~/features/availability-rules'
import { CategorySelect } from '~/features/categories'
import { useOptionSetOptions } from '~/features/option-sets'
import { buildGrid, formFieldOf, itemFormSchema, optionSetFromLibrary, sectionOf } from '../schemas/item-form'
import type { FormOptionSet, ItemForm, ItemFormSection } from '../schemas/item-form'
import ItemAddOnGroups from './ItemAddOnGroups.vue'
import ItemPriceGrid from './ItemPriceGrid.vue'

const props = withDefaults(defineProps<{
  formId: string
  /** Saving, or archived: nothing can change. */
  disabled?: boolean
  archived?: boolean
  /** The last refused save, shown at the top. */
  lastError?: string
  section?: ItemFormSection | 'all'
  /** Focus the name when it opens (the slide-over; not on phones, where it'd open the keyboard). */
  autofocus?: boolean
}>(), { section: 'all' })

const state = defineModel<ItemForm>('state', { required: true })
const uploading = defineModel<boolean>('uploading', { default: false })
const emit = defineEmits<{ submit: [], invalid: [section: ItemFormSection] }>()

const shows = (section: ItemFormSection) => props.section === 'all' || props.section === section

const { data: optionSets, error: optionSetsError, refresh: refreshOptionSets } = useOptionSetOptions()

// --- Option sets: changing them rebuilds the grid, keeping the prices of the same combinations ---
function setOptionSets(sets: FormOptionSet[]) {
  state.value.optionSets = sets
  state.value.grid = buildGrid(sets, state.value.grid, true)
}

const addSetItems = computed<DropdownMenuItem[]>(() => optionSets.value
  .filter(set => set.status === 'active' && !state.value.optionSets.some(chosen => chosen.id === set.id))
  .map(set => ({ label: set.name, onSelect: () => setOptionSets([...state.value.optionSets, optionSetFromLibrary(set)]) })))
const canAddSet = computed(() => state.value.optionSets.length < MAX_ITEM_OPTION_SETS && addSetItems.value.length > 0)

// --- Errors ---
const form = useTemplateRef('form')

function onError(event: FormErrorEvent) {
  const first = event.errors[0]?.name
  if (first) emit('invalid', sectionOf(first))
}

/** Shows the server's field errors on the fields they name. */
function setServerErrors(fieldErrors: Record<string, string[]> | undefined) {
  const errors = Object.entries(fieldErrors ?? {}).flatMap(([field, messages]) =>
    messages[0] ? [{ name: formFieldOf(field), message: messages[0] }] : [])
  form.value?.setErrors(errors)
  if (errors[0]) emit('invalid', sectionOf(errors[0].name))
}

defineExpose({ submit: () => form.value?.submit(), setServerErrors })
</script>

<template>
  <UForm
    :id="formId"
    ref="form"
    :schema="itemFormSchema"
    :state="state"
    :validate-on="['input', 'change']"
    :disabled="disabled"
    class="space-y-6"
    @submit="emit('submit')"
    @error="onError"
  >
    <UAlert
      v-if="archived"
      color="neutral"
      variant="subtle"
      icon="i-lucide-archive"
      title="This menu item is archived. Restore it from the list to edit it."
    />
    <UAlert
      v-if="lastError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Not saved"
      :description="lastError"
    />

    <section
      v-show="shows('details')"
      class="space-y-6"
    >
      <UFormField
        label="Image"
        name="imageId"
      >
        <ImageInput
          v-model:image-url="state.imageUrl"
          v-model:image-id="state.imageId"
          v-model:uploading="uploading"
          alt="Menu item image"
          :disabled="disabled"
        />
      </UFormField>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="state.name"
            class="w-full"
            :autofocus="autofocus"
          />
        </UFormField>
        <UFormField
          label="Category"
          name="categoryId"
          required
        >
          <CategorySelect
            v-model="state.categoryId"
            level="leaf"
            aria-label="Category"
          />
        </UFormField>
      </div>

      <UFormField
        label="Description"
        name="description"
      >
        <UTextarea
          v-model="state.description"
          :rows="2"
          autoresize
          class="w-full"
        />
      </UFormField>
    </section>

    <section
      v-show="shows('prices')"
      aria-label="Options and prices"
      class="space-y-3"
    >
      <div>
        <h3 class="font-medium text-highlighted">
          Options and prices
        </h3>
        <p class="text-sm text-muted">
          Up to {{ MAX_ITEM_OPTION_SETS }} option sets from the Options library, e.g. size and temperature. Each combination is a version with its own price; switch off the ones you don't sell.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          v-for="set in state.optionSets"
          :key="set.id"
          color="neutral"
          variant="outline"
          size="lg"
        >
          {{ set.name }}{{ set.status === 'archived' ? ' (archived)' : '' }}
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            :aria-label="`Remove option set ${set.name}`"
            :disabled="disabled"
            @click="setOptionSets(state.optionSets.filter(s => s.id !== set.id))"
          />
        </UBadge>
        <ApiErrorAlert
          v-if="optionSetsError"
          :error="optionSetsError"
          title="Could not load the Options library"
          @retry="refreshOptionSets()"
        />
        <UDropdownMenu
          v-else
          :items="addSetItems"
          :disabled="disabled || !canAddSet"
        >
          <UButton
            label="Add option set"
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="disabled || !canAddSet"
          />
        </UDropdownMenu>
      </div>
      <ItemPriceGrid
        v-model="state.grid"
        :sets="state.optionSets"
        :disabled="disabled"
      />
    </section>

    <section
      v-show="shows('add-ons')"
      aria-label="Add-ons"
      class="space-y-3"
    >
      <h3 class="font-medium text-highlighted">
        Add-ons
      </h3>
      <ItemAddOnGroups
        v-model="state.addOnGroups"
        :disabled="disabled"
      />
    </section>

    <section
      v-show="shows('availability')"
    >
      <UFormField
        label="Availability"
        name="availabilityRuleIds"
        description="When it's sold. None: whenever the branch is open. Its category's rules apply too."
      >
        <AvailabilityRuleSelect
          v-model="state.availabilityRuleIds"
          aria-label="Availability"
        />
      </UFormField>
    </section>
  </UForm>
</template>
