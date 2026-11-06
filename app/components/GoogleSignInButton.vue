<script setup lang="ts">
defineProps<{ enabled: boolean, disabled: boolean, pending?: boolean }>()
defineEmits<{ click: [], cancel: [] }>()
</script>

<template>
  <div
    v-if="enabled"
    class="space-y-4"
  >
    <!--
      While Google is open this same button cancels it, in place: the form can't always tell when
      the Google window closes (D261), and a new row would move the form.
    -->
    <UButton
      type="button"
      :label="pending ? 'Cancel Google sign-in' : 'Continue with Google'"
      color="neutral"
      variant="outline"
      block
      :disabled="disabled && !pending"
      @click="pending ? $emit('cancel') : $emit('click')"
    >
      <template #leading>
        <img
          src="/google-g.png"
          alt=""
          width="200"
          height="204"
          class="size-5 object-contain"
        >
      </template>
    </UButton>
    <span
      class="sr-only"
      role="status"
    >{{ pending ? 'Finish signing in in the Google window, or cancel here.' : '' }}</span>
    <USeparator label="or" />
  </div>
</template>
