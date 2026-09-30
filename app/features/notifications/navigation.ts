import type { NavigationMenuItem } from '@nuxt/ui'

/** "Telegram": the chats the cafe's messages go to (step 8.1c, D112). */
export const notificationsNavigation: NavigationMenuItem = {
  label: 'Telegram',
  icon: 'i-lucide-send',
  to: '/admin/telegram',
}
