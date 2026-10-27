<script setup lang="ts">
/**
 * The site's root, `/` (D221, owner-approved mockup 2026-10-27): the platform's page, never a cafe's.
 * Customers arrive through their cafe's link or a table's QR, so it only says so; owners and staff
 * sign in to Your cafes, which checks what the account may open. The same page for everyone: no
 * session, no cafe and no list of cafes (that would show every cafe and its address), so one
 * server render serves every visitor. A task-flow page (page-patterns §5), like Your cafes.
 */
// Your cafes, `/cafes` (not the console's `/platform/cafes`).
import { CAFES_PATH } from '~/utils/account-cafes'
</script>

<template>
  <TaskFrame>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-coffee"
            class="size-6"
          />
        </div>
        <div class="min-w-0">
          <h1 class="text-lg font-semibold text-highlighted">
            Angder
          </h1>
          <p class="text-sm text-muted">
            Ordering and the counter for cafes.
          </p>
        </div>
      </div>
    </template>

    <div class="space-y-5">
      <section
        aria-labelledby="home-customers"
        class="flex items-start gap-3"
      >
        <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-highlighted">
          <UIcon
            name="i-lucide-qr-code"
            class="size-4"
          />
        </div>
        <div class="min-w-0">
          <h2
            id="home-customers"
            class="font-medium text-highlighted"
          >
            Ordering at a cafe?
          </h2>
          <p class="text-sm text-muted">
            Scan the QR on your table or open your cafe's link.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="home-staff"
        class="flex items-start gap-3"
      >
        <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-highlighted">
          <UIcon
            name="i-lucide-store"
            class="size-4"
          />
        </div>
        <div class="min-w-0">
          <h2
            id="home-staff"
            class="font-medium text-highlighted"
          >
            Work at a cafe?
          </h2>
          <p class="text-sm text-muted">
            Sign in to open your cafe's admin or counter.
          </p>
        </div>
      </section>
    </div>

    <template #footer>
      <!-- Your cafes sends a signed-out visitor to sign in and back, so one link serves both. -->
      <UButton
        :to="CAFES_PATH"
        label="Sign in"
        icon="i-lucide-log-in"
        block
      />
    </template>
  </TaskFrame>
</template>
