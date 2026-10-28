<script setup lang="ts">
/**
 * The site's root, `/` (D221, owner-approved mockup 2026-10-27, revised with the storefront mockup):
 * the platform's page, never a cafe's. Customers arrive through their cafe's link or a table's QR, so
 * it only says so and how ordering works; owners and staff sign in to Your cafes, which checks what
 * the account may open. The same page for everyone: no session, no cafe and no list of cafes (that
 * would show every cafe and its address), so one server render serves every visitor. It brings its
 * own header and footer, like the customer site's pages (the `shop` layout is only the page).
 */
// Your cafes, `/cafes` (not the console's `/platform/cafes`).
import { CAFES_PATH } from '~/utils/account-cafes'
import storefront from '~/assets/img/cafe-storefront.png'

const steps = [
  { icon: 'i-lucide-link', title: 'Open the cafe link', text: 'Use the link or QR code shared by your cafe.' },
  { icon: 'i-lucide-file-text', title: 'Explore the menu', text: 'Choose the items you\'d like to order.' },
  { icon: 'i-lucide-coffee', title: 'Place your order', text: 'Review your choices and follow the cafe\'s instructions.' },
]

// Mock footer links and channels until the platform has its own (owner, 2026-10-28).
const links = [
  { label: 'Help center', to: 'https://example.com/help', target: '_blank' },
  { label: 'Terms', to: 'https://example.com/terms', target: '_blank' },
  { label: 'Privacy', to: 'https://example.com/privacy', target: '_blank' },
]
const socials = [
  { label: 'Facebook', icon: 'i-lucide-facebook', to: 'https://example.com/facebook' },
  { label: 'Instagram', icon: 'i-lucide-instagram', to: 'https://example.com/instagram' },
  { label: 'YouTube', icon: 'i-lucide-youtube', to: 'https://example.com/youtube' },
]
const year = new Date().getFullYear()
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <UHeader
      title="Angder"
      :toggle="false"
      :ui="{ title: 'items-center' }"
    >
      <template #title>
        <UIcon
          name="i-lucide-coffee"
          class="size-5 text-primary"
        />
        Angder
      </template>
      <template #right>
        <UColorModeButton />
        <!-- Your cafes sends a signed-out visitor to sign in and back, so one link serves both. -->
        <UButton
          :to="CAFES_PATH"
          label="Sign in"
          icon="i-lucide-log-in"
        />
      </template>
    </UHeader>

    <main class="flex-1">
      <UContainer class="space-y-6 py-6">
        <section class="grid items-center gap-6 lg:grid-cols-2">
          <div class="space-y-6">
            <div class="space-y-3">
              <p class="text-sm text-muted">
                Welcome to Angder
              </p>
              <h1 class="text-3xl font-semibold text-highlighted">
                A better way to order from your cafe
              </h1>
              <p class="max-w-xl text-muted">
                Each cafe has its own ordering page. Open the link or scan the QR code shared by your cafe to explore its menu and place an order.
              </p>
            </div>
            <UCard
              variant="outline"
              class="max-w-xl"
            >
              <div class="flex items-center gap-4">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated text-highlighted">
                  <UIcon
                    name="i-lucide-info"
                    class="size-5"
                  />
                </div>
                <div class="min-w-0">
                  <h2 class="font-semibold text-highlighted">
                    Looking for a cafe?
                  </h2>
                  <p class="text-sm text-muted">
                    Ask the cafe for its ordering link or QR code.
                  </p>
                </div>
              </div>
            </UCard>
          </div>
          <img
            :src="storefront"
            alt=""
            width="1583"
            height="994"
            class="h-auto w-full"
          >
        </section>

        <section
          aria-labelledby="home-how"
          class="space-y-6"
        >
          <USeparator>
            <h2
              id="home-how"
              class="font-semibold text-highlighted"
            >
              How it works
            </h2>
          </USeparator>
          <ol class="flex flex-col gap-4 lg:flex-row lg:items-center">
            <template
              v-for="(step, index) in steps"
              :key="step.title"
            >
              <li class="flex-1 self-stretch">
                <UCard
                  variant="outline"
                  class="flex h-full flex-col"
                  :ui="{ body: 'flex flex-1 items-center' }"
                >
                  <div class="flex items-center gap-4">
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated text-highlighted">
                      <UIcon
                        :name="step.icon"
                        class="size-5"
                      />
                    </div>
                    <div class="min-w-0">
                      <h3 class="font-semibold text-highlighted">
                        {{ index + 1 }}. {{ step.title }}
                      </h3>
                      <p class="text-sm text-muted">
                        {{ step.text }}
                      </p>
                    </div>
                  </div>
                </UCard>
              </li>
              <li
                v-if="index < steps.length - 1"
                aria-hidden="true"
                class="hidden text-muted lg:block"
              >
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-5"
                />
              </li>
            </template>
          </ol>
        </section>
      </UContainer>
    </main>

    <UFooter class="border-t border-default">
      <template #left>
        <p class="text-sm text-muted">
          Copyright © {{ year }} Angder
        </p>
      </template>
      <UNavigationMenu
        :items="links"
        aria-label="Footer"
        color="neutral"
        variant="pill"
        :ui="{ list: 'flex-wrap justify-center' }"
      />
      <template #right>
        <UTooltip
          v-for="social in socials"
          :key="social.label"
          :text="social.label"
        >
          <UButton
            :icon="social.icon"
            :to="social.to"
            :aria-label="social.label"
            target="_blank"
            color="neutral"
            variant="ghost"
          />
        </UTooltip>
      </template>
    </UFooter>
  </div>
</template>
