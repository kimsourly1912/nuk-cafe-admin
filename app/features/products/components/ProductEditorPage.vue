<script setup lang="ts">
/**
 * The Menu item editor as a page: `/admin/products/[id]` (the canonical, shareable URL) and
 * `/admin/products/new` (D90, page-patterns §4 "Menu item editor URLs"). The list opens it on phones; it
 * works at every width. On phones it's a focused screen, one section at a time (tabs), with Save in
 * the bottom bar; from `lg` the sections are one column and Save is in the navbar. The same editor
 * as the slide-over (`useItemEditor`, `ProductFormFields`): same data, rules and actions.
 *
 * Saving returns to the list, like the slide-over closing. A new item or a draft also has "Save and
 * publish" (D125). Back (and ←) returns to the list with its
 * search and filters: the route was pushed from it. Unsaved input is guarded by the route guard.
 */
import { useItemEditor } from '../composables/useItemEditor'
import { ITEM_FORM_SECTIONS } from '../schemas/item-form'
import type { ItemFormSection } from '../schemas/item-form'
import { ITEM_STATUS_LABELS } from '../utils/item-display'
import ProductFormFields from './ProductFormFields.vue'
import ProductFormSlideover from './ProductFormSlideover.vue'

const props = defineProps<{
  /** The item's id, or `new`. */
  id: string
}>()

const overlay = useOverlay()
const editor = useItemEditor({
  itemId: props.id === 'new' ? undefined : props.id,
  onLoaded: () => unsaved.markClean(),
  // The page may be gone by then: reopen the input in the slide-over, which works on any page.
  reopen: (item, draft) => overlay.create(ProductFormSlideover, { destroyOnClose: true }).open({ item, draft }),
})
const { isEdit, itemQuery, loaded, ready, archived, canPublish, state, saving, uploading, lastError } = editor

const unsaved = useUnsavedChanges(state, { initial: editor.initial, paused: saving })

const title = computed(() => loaded.value?.name ?? (isEdit ? 'Menu item' : 'New menu item'))

// --- Sections: one at a time on phones ---
const { isCompact } = useLayoutContext()
const section = ref<ItemFormSection>('details')
const sectionTabs = ITEM_FORM_SECTIONS.map(s => ({ label: s.label, value: s.value }))

// --- Leave and save ---
const router = useRouter()
/** Back to the list: to the entry it came from (search and filters kept), or the list itself. */
function leave() {
  const back = window.history.state?.back
  if (typeof back === 'string' && /^\/admin\/products(\?|$)/.test(back)) router.back()
  else navigateTo('/admin/products')
}

const fields = useTemplateRef('fields')
/** Which button submitted the form: "Save and publish" sets it (D125); Save and Ctrl/⌘+Enter clear it. */
const publishNext = ref(false)
function submit(publish: boolean) {
  publishNext.value = publish
  fields.value?.submit()
}
useSubmitShortcut(() => submit(false))

async function onSubmit() {
  const result = await editor.save({ publish: publishNext.value })
  publishNext.value = false
  if (!result.ok) {
    fields.value?.setServerErrors(result.error?.fieldErrors)
    return
  }
  unsaved.markClean()
  leave()
}
</script>

<template>
  <UDashboardPanel id="product-editor">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            aria-label="Back to Menu items"
            class="lg:hidden"
            @click="leave()"
          />
        </template>
        <template #title>
          <UBreadcrumb
            :items="[{ label: 'Menu items', onClick: leave }, { label: title }]"
            class="hidden min-w-0 lg:flex"
          />
          <span class="truncate lg:hidden">{{ title }}</span>
        </template>
        <template #right>
          <UButton
            v-if="canPublish"
            :label="isEdit ? 'Save and publish' : 'Create and publish'"
            color="neutral"
            variant="outline"
            class="hidden lg:inline-flex"
            :loading="saving && publishNext"
            :disabled="uploading || !ready || saving"
            @click="submit(true)"
          />
          <UTooltip
            v-if="!archived"
            :text="isEdit ? 'Save' : 'Create'"
            :kbds="['meta', 'enter']"
          >
            <UButton
              type="submit"
              form="product-page-form"
              :label="isEdit ? 'Save' : 'Create'"
              icon="i-lucide-save"
              class="hidden lg:inline-flex"
              :loading="saving && !publishNext"
              :disabled="uploading || !ready || (saving && publishNext)"
              @click="publishNext = false"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-4">
        <p class="text-sm text-muted">
          {{ loaded ? `Status: ${ITEM_STATUS_LABELS[loaded.status]}` : isEdit ? 'Loading…' : 'Create saves a draft; Create and publish also puts it on the menu.' }}
        </p>

        <ApiErrorAlert
          v-if="itemQuery?.error.value"
          :error="itemQuery.error.value"
          title="Could not load the menu item"
          @retry="itemQuery.refresh()"
        />
        <ListSkeleton
          v-else-if="!ready"
          label="Loading the menu item…"
          variant="row"
        />
        <template v-else>
          <UTabs
            v-if="isCompact"
            v-model="section"
            :items="sectionTabs"
            :content="false"
            variant="link"
            class="w-full"
          />
          <ProductFormFields
            ref="fields"
            v-model:uploading="uploading"
            :state="state"
            form-id="product-page-form"
            :section="isCompact ? section : 'all'"
            :disabled="saving || archived"
            :archived="archived"
            :last-error="lastError"
            @submit="onSubmit"
            @invalid="next => section = next"
          />
        </template>

        <!-- Phones and tablets: Save at the bottom (from lg it's in the navbar) -->
        <BottomActionBar
          v-if="ready && !archived"
          label="Save"
          expanded="hidden"
        >
          <p class="min-w-0 flex-1 text-sm text-muted">
            {{ uploading ? 'Waiting for the image upload…' : saving ? 'Saving continues if you leave.' : '' }}
          </p>
          <UButton
            v-if="canPublish"
            :label="isEdit ? 'Save and publish' : 'Create and publish'"
            color="neutral"
            variant="outline"
            :loading="saving && publishNext"
            :disabled="uploading || saving"
            @click="submit(true)"
          />
          <UButton
            type="submit"
            form="product-page-form"
            :label="isEdit ? 'Save' : 'Create'"
            icon="i-lucide-save"
            :loading="saving && !publishNext"
            :disabled="uploading || (saving && publishNext)"
            @click="publishNext = false"
          />
        </BottomActionBar>
      </div>
    </template>
  </UDashboardPanel>
</template>
