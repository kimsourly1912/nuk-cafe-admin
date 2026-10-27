<script setup lang="ts">
/**
 * The site's root is the platform's, never a cafe's (D221): until the platform's own page replaces
 * this (an owner-approved mockup first), it goes to Your cafes, which sends a signed-out visitor to
 * sign in. Customers arrive through a cafe's link or a table's QR, which name the cafe. A route
 * redirect, so it holds for a page load and for a link inside the app alike.
 */
definePageMeta({ redirect: '/cafes' })
</script>

<template>
  <div />
</template>
