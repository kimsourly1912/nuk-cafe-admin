import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { familyModule, splitBarrelImports } from '../../modules/reka-namespaced'

const BARREL = `import { HoverCardRoot, HoverCardTrigger, PopoverRoot, PopoverTrigger } from "../index.js";
const HoverCard = {
  Root: HoverCardRoot,
  Trigger: HoverCardTrigger
};
const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger
};
export { HoverCard, Popover };
`

describe('splitting Reka UI\'s namespaced barrel (D123)', () => {
  it('turns one barrel import into one import per family, keeping renames', () => {
    const code = 'import { Calendar as SingleCalendar, RangeCalendar } from "reka-ui/namespaced";\nconst x = 1'
    expect(splitBarrelImports(code)).toBe([
      'import { Calendar as SingleCalendar } from "reka-ui/namespaced/Calendar";',
      'import { RangeCalendar } from "reka-ui/namespaced/RangeCalendar";',
      'const x = 1',
    ].join('\n'))
  })

  it('leaves other imports alone', () => {
    const code = 'import { PopoverRoot } from "reka-ui";\nimport { useForwardProps } from \'reka-ui\''
    expect(splitBarrelImports(code)).toBe(code)
  })

  it('builds one family from its definition, importing its parts from Reka UI', () => {
    expect(familyModule(BARREL, 'Popover', '/abs/reka-ui/dist/index.js')).toBe([
      'import { PopoverRoot, PopoverTrigger } from "/abs/reka-ui/dist/index.js";',
      'export const Popover = {\n  Root: PopoverRoot,\n  Trigger: PopoverTrigger\n}',
      '',
    ].join('\n'))
  })

  it('finds nothing for an unknown family (the build then fails)', () => {
    expect(familyModule(BARREL, 'Calendar')).toBeUndefined()
  })

  it('finds every family the installed Nuxt UI imports in the installed Reka UI', () => {
    // Nuxt UI's exports hide package.json; its folder (pnpm's real path) resolves Reka UI as Nuxt UI does.
    const nuxtUi = realpathSync('node_modules/@nuxt/ui')
    // `require` finds the CommonJS copy; the build reads the ES module next to it.
    const barrelPath = createRequire(join(nuxtUi, 'package.json')).resolve('reka-ui/namespaced').replace(/\.cjs$/, '.mjs')
    const barrel = readFileSync(barrelPath, 'utf8')
    const components = join(nuxtUi, 'dist/runtime/components')
    const families = new Set<string>()
    for (const file of readdirSync(components).filter(name => name.endsWith('.vue'))) {
      const split = splitBarrelImports(readFileSync(join(components, file), 'utf8'))
      for (const match of split.matchAll(/from "reka-ui\/namespaced\/(\w+)"/g)) families.add(match[1]!)
    }
    expect(families.size).toBeGreaterThan(5)
    for (const family of families) expect(familyModule(barrel, family), family).toContain(`export const ${family} = {`)
  })
})
