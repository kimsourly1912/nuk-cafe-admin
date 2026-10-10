<script setup lang="ts">
/**
 * A menu item's photo wherever it's shown (D158), chosen by where it's used, not by the screen:
 * `card` (the square: menu cards, checkout, orders) or `detail` (4:3: the item's page, the admin
 * grid; a 600 px file on phones, 1200 px on larger screens). While it loads, its tiny blurred
 * placeholder fills the box, then the photo fades in; below the fold it loads only when scrolled
 * near (`eager` for the one photo that must show at once). No photo, or one that fails: `icon`.
 *
 * The parent gives the box its size and shape (`class="size-24 rounded-md"`, `aspect-4/3 w-full`);
 * the photo covers it.
 *
 * @example
 * <MenuItemImage :image="item.image" usage="detail" eager class="aspect-4/3 w-full rounded-lg" />
 * <MenuItemImage :src="line.imageUrl" usage="card" class="size-14 rounded-md" />
 */
import type { MenuImage } from '#shared/contracts/media'

const props = withDefaults(defineProps<{
  image?: MenuImage | null
  /** Only a URL (a checkout line, a photo the form just uploaded): used as every size. */
  src?: string | null
  usage: 'card' | 'detail'
  /** The `detail` photo's width on screen, for the browser's choice of file. */
  sizes?: string
  eager?: boolean
  alt?: string
  icon?: string
  /** Greyed out (a sold-out or archived item). */
  muted?: boolean
}>(), { sizes: '(min-width: 640px) 32rem, 100vw', alt: '', icon: 'i-lucide-coffee' })

const url = computed(() => (props.image ? (props.usage === 'card' ? props.image.card : props.image.detail) : props.src) ?? null)
const srcset = computed(() => (props.usage === 'detail' && props.image?.detailSmall ? `${props.image.detailSmall} 600w, ${props.image.detail} 1200w` : undefined))
const placeholder = computed(() => props.image?.placeholder ?? null)

const img = useTemplateRef<HTMLImageElement>('img')
// The server's page shows the photo as soon as it arrives; once the app runs, a photo still
// loading fades in over its placeholder. Both start the same, so hydration matches.
const mounted = ref(false)
const loaded = ref(false)
const failed = ref(false)
onMounted(() => {
  loaded.value = Boolean(img.value?.complete && img.value.naturalWidth > 0)
  mounted.value = true
})
watch(url, () => {
  loaded.value = false
  failed.value = false
})
</script>

<template>
  <div
    class="relative flex shrink-0 items-center justify-center overflow-hidden bg-elevated"
    :class="muted && 'opacity-50 grayscale'"
  >
    <img
      v-if="placeholder && url && !failed && !loaded"
      :src="placeholder"
      alt=""
      aria-hidden="true"
      class="absolute inset-0 size-full scale-110 object-cover blur-md"
    >
    <img
      v-if="url && !failed"
      ref="img"
      :src="url"
      :srcset="srcset"
      :sizes="srcset ? sizes : undefined"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      :fetchpriority="eager ? 'high' : undefined"
      decoding="async"
      class="relative size-full object-cover transition-opacity duration-300 motion-reduce:transition-none"
      :class="mounted && !loaded && 'opacity-0'"
      @load="loaded = true"
      @error="failed = true"
    >
    <UIcon
      v-else
      :name="icon"
      class="size-1/3 max-h-10 max-w-10 text-dimmed"
    />
  </div>
</template>
