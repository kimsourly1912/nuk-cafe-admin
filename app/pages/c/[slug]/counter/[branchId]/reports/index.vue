<script setup lang="ts">
definePageMeta({ layout: 'counter', title: 'Reports', redirect: to => ({ path: `${to.path.replace(/\/$/, '')}/summary`, query: to.query }) })
</script>

<template>
  <div />
</template>
