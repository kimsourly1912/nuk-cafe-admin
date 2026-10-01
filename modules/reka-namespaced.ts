import { readFile } from 'node:fs/promises'
import { addVitePlugin, defineNuxtModule } from 'nuxt/kit'

/**
 * Splits Reka UI's namespaced barrel per component family (D123).
 *
 * Nuxt UI imports some primitives as `import { Popover, HoverCard } from 'reka-ui/namespaced'`.
 * That barrel is one module defining every family (`const Calendar = { Root: CalendarRoot, … }`),
 * so the bundler puts everything any page uses from it into one chunk: the customer menu's popover
 * loaded the admin's calendar, date pickers and time field (~40 KB compressed). Here each import
 * names its own family (`reka-ui/namespaced/Popover`), a module that builds that one object from
 * `reka-ui`'s named exports, so each family is chunked with the pages that use it.
 *
 * Build only: the dev server doesn't chunk. A family whose definition can't be found fails the
 * build, so a changed barrel format can't slip through silently.
 */
/** Vite's plugin type, from Nuxt (pnpm doesn't let the app import `vite` itself). */
type Plugin = Extract<Parameters<typeof addVitePlugin>[0], { name: string }>

const BARREL = 'reka-ui/namespaced'
const VIRTUAL = '\0reka-namespaced:'
const BARREL_IMPORT = /import\s*\{([^}]+)\}\s*from\s*["']reka-ui\/namespaced["'];?/g

/** `import { Calendar as SingleCalendar, Popover }` → one import per family. */
export function splitBarrelImports(code: string): string {
  return code.replace(BARREL_IMPORT, (_, specifiers: string) => specifiers
    .split(',')
    .map(specifier => specifier.trim())
    .filter(Boolean)
    .map((specifier) => {
      const family = specifier.split(/\s+as\s+/)[0]
      return `import { ${specifier} } from "${BARREL}/${family}";`
    })
    .join('\n'))
}

/** The module for one family, from its definition in the barrel's source; `reka` is where `reka-ui` resolves. */
export function familyModule(barrelSource: string, family: string, reka = 'reka-ui'): string | undefined {
  const definition = barrelSource.match(new RegExp(`\\nconst ${family} = (\\{[^}]*\\});`))?.[1]
  if (!definition) return undefined
  const parts = [...definition.matchAll(/:\s*(\w+)/g)].map(match => match[1])
  return `import { ${parts.join(', ')} } from ${JSON.stringify(reka)};\nexport const ${family} = ${definition}\n`
}

function splitRekaNamespaced(): Plugin {
  // pnpm lets only Nuxt UI resolve Reka UI, so both are resolved from the file that imported the family.
  let paths: Promise<{ barrel: string, reka: string }> | undefined
  const importers = new Map<string, string>()
  return {
    name: 'nuk:reka-namespaced',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/node_modules/') && code.includes(BARREL)) return splitBarrelImports(code)
    },
    resolveId(id, importer) {
      if (!id.startsWith(`${BARREL}/`)) return
      const family = id.slice(BARREL.length + 1)
      if (importer && !importers.has(family)) importers.set(family, importer)
      return VIRTUAL + family
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL)) return
      const family = id.slice(VIRTUAL.length)
      const importer = importers.get(family)
      paths ??= Promise.all([this.resolve(BARREL, importer), this.resolve('reka-ui', importer)]).then(([barrel, reka]) => {
        if (!barrel || !reka) throw new Error(`Cannot resolve ${BARREL} from ${importer}`)
        return { barrel: barrel.id, reka: reka.id }
      })
      const { barrel, reka } = await paths
      const module = familyModule(await readFile(barrel, 'utf8'), family, reka)
      if (!module) this.error(`${BARREL}: no definition of "${family}" found (has the barrel's format changed?)`)
      return module
    },
  }
}

export default defineNuxtModule({
  meta: { name: 'reka-namespaced' },
  setup() {
    addVitePlugin(splitRekaNamespaced())
  },
})
