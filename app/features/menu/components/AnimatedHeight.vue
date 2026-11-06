<script setup lang="ts">
/**
 * Follows its content's height smoothly (D268), so what sits below it travels with the rows sliding
 * inside instead of jumping a whole row at once. A `ResizeObserver` reports the new height before the
 * browser paints, and the box animates from the height on screen to it: a change mid-way continues
 * from where the box is. Same 200 ms and curve as a row's slide (`.list-move`, `--ease-move`), so the
 * two stay together. Nothing on the first measure, on a width change (a layout change, not content)
 * or with reduced motion.
 *
 * Growing clips the content to the box; shrinking doesn't, so rows still fading out stay visible.
 *
 * @example
 * <AnimatedHeight :frozen="rowsStillLeaving"><ul>…</ul></AnimatedHeight>
 */
import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  /** Keeps the current height whatever the content does, then animates to it when released. */
  frozen?: boolean
}>()

const DURATION_MS = 200
const EASE_MOVE = 'cubic-bezier(0.2, 0, 0, 1)'

const box = useTemplateRef<HTMLElement>('box')
const content = useTemplateRef<HTMLElement>('content')
const reducedMotion = usePreferredReducedMotion()

let measured: { width: number, height: number } | undefined
let slide: Animation | undefined
/** The height kept while frozen. */
let held: number | undefined

function clear(el: HTMLElement) {
  slide?.cancel()
  slide = undefined
  held = undefined
  el.style.height = ''
  el.style.overflow = ''
}

function slideTo(el: HTMLElement, from: number, to: number) {
  clear(el)
  if (from === to) return
  if (to > from) el.style.overflow = 'clip'
  const started = el.animate({ height: [`${from}px`, `${to}px`] }, { duration: DURATION_MS, easing: EASE_MOVE })
  slide = started
  started.onfinish = () => {
    if (slide === started) clear(el)
  }
}

useResizeObserver(content, ([entry]) => {
  const el = box.value
  if (!el || !entry) return
  const { width, height } = entry.contentRect
  const previous = measured
  measured = { width, height }
  if (!previous || !width || previous.width !== width || reducedMotion.value === 'reduce') {
    clear(el)
    return
  }
  if (previous.height === height) return

  // Something inside eases its own height (a note box opening): follow it. Animating towards every
  // step of it would ease twice and trail behind.
  const easing = entry.target.getAnimations({ subtree: true })
    .some(animation => animation instanceof CSSTransition && animation.transitionProperty === 'grid-template-rows')
  if (easing) {
    clear(el)
    return
  }

  // The box already has the new height in layout unless something holds it: start from what shows.
  const from = held ?? (slide ? el.getBoundingClientRect().height : previous.height)
  if (props.frozen) {
    clear(el)
    held = from
    el.style.height = `${from}px`
    return
  }
  slideTo(el, from, height)
})

// `post`: the content of this render is in the page, so the height read is the one to reach.
watch(() => props.frozen, (frozen) => {
  if (frozen || held === undefined || !box.value || !content.value) return
  slideTo(box.value, held, content.value.getBoundingClientRect().height)
}, { flush: 'post' })
</script>

<template>
  <div ref="box">
    <div ref="content">
      <slot />
    </div>
  </div>
</template>
