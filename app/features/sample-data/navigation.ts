import type { NavigationMenuItem } from '@nuxt/ui'

/** Only in the sidebar where the environment turns sample data on (D94). */
export const sampleDataNavigation: NavigationMenuItem = {
  label: 'Sample data',
  icon: 'i-lucide-flask-conical',
  to: '/admin/sample-data',
  badge: { label: 'Test', color: 'warning', variant: 'outline' },
}
