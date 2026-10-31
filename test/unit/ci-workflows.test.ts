import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The deploy and backup jobs hold the Cloudflare token and the backup keys (D244). An action named
 * by a tag runs whatever its publisher later points that tag at, inside those jobs; a full commit
 * id can't move. The version stays readable in a comment after the id.
 */
const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url)
const workflows = readdirSync(WORKFLOWS).filter(name => /\.ya?ml$/.test(name))
const read = (name: string) => readFileSync(new URL(name, WORKFLOWS), 'utf8')

describe('GitHub Actions workflows (D244)', () => {
  it('finds the workflows', () => {
    expect(workflows).toContain('ci.yml')
  })

  it.each(workflows)('%s names every action by a full commit id', (name) => {
    const uses = [...read(name).matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map(match => match[1]!)
    const unpinned = uses.filter(action => !action.startsWith('./') && !/@[0-9a-f]{40}$/.test(action))
    expect(unpinned).toEqual([])
  })

  it.each(workflows)('%s gives the workflow token no write access by default', (name) => {
    // A top-level block, so a new job can't inherit the repository's default token permissions.
    expect(read(name)).toMatch(/^permissions:\s*(?:\{\}|\n {2}contents: read\n(?! ))/m)
  })
})
