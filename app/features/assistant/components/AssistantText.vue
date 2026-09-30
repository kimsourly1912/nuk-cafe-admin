<script setup lang="ts">
import { formatAnswer } from '../utils/chat'

/**
 * An answer's text: a paragraph per line, with `**bold**` screen labels in bold. Built as text
 * nodes (never HTML), and by a render function so no template whitespace gets between the runs.
 */
const props = defineProps<{ text: string }>()

const Answer = () => h('div', { class: 'space-y-1 break-words' }, formatAnswer(props.text).map(runs => h(
  'p',
  { class: runs.length ? undefined : 'h-1' },
  runs.map(run => (run.bold ? h('strong', { class: 'font-semibold text-highlighted' }, run.text) : run.text)),
)))
</script>

<template>
  <Answer />
</template>
