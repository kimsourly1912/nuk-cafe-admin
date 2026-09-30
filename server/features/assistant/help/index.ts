import addOns from './add-ons.md'
import availability from './availability.md'
import branch from './branch.md'
import categories from './categories.md'
import counter from './counter.md'
import general from './general.md'
import menuItems from './menu-items.md'
import menu from './menu.md'
import options from './options.md'
import payments from './payments.md'
import reports from './reports.md'
import sampleData from './sample-data.md'
import staff from './staff.md'

/**
 * The staff help guide (step 9.1, D109): what the assistant knows, one Markdown file per screen,
 * bundled into the server (Nitro imports `.md` as text). It describes the app, so a change to a
 * screen updates its page here in the same pull request. Order: general first, then the menu, the
 * admin pages, the reports and the counter.
 */
export const HELP_PAGES = [
  { name: 'general', text: general },
  { name: 'menu', text: menu },
  { name: 'menu-items', text: menuItems },
  { name: 'categories', text: categories },
  { name: 'options', text: options },
  { name: 'add-ons', text: addOns },
  { name: 'availability', text: availability },
  { name: 'staff', text: staff },
  { name: 'branch', text: branch },
  { name: 'payments', text: payments },
  { name: 'reports', text: reports },
  { name: 'counter', text: counter },
  { name: 'sample-data', text: sampleData },
] as const

/** The whole guide as the model reads it (Sample data only where it exists, D94). */
export function helpGuide(options: { sampleData: boolean }): string {
  return HELP_PAGES
    .filter(page => page.name !== 'sample-data' || options.sampleData)
    .map(page => page.text.trim())
    .join('\n\n---\n\n')
}
