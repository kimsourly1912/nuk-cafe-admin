import { it } from 'vitest'
import { generateMenuFixtures } from './generate-fixtures'
import { fixtureHtml, MENU_CASES } from './menu-cases'

it.skipIf(process.env.ASSISTANT_GENERATE_FIXTURES !== '1')('generates synthetic menu fixtures without inference', { timeout: 60_000 }, async () => {
  await generateMenuFixtures(MENU_CASES, fixtureHtml, process.env.ASSISTANT_EVAL_CHROMIUM)
})
