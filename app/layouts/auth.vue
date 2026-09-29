<!-- Admin task-flow pages (D84): centered from sm; on phones the page's frame fills the screen -->
<template>
  <div class="relative flex min-h-dvh items-center justify-center bg-muted p-4 max-sm:items-stretch max-sm:p-0">
    <slot />
    <UColorModeButton class="absolute end-2 top-2" />
  </div>
</template>
