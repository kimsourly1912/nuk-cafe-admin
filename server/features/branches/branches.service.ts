import type { Db } from '../../utils/batch'
import { newId } from '../../utils/ids'
import * as repo from './branches.repository'

export interface SeededBranch {
  id: string
  name: string
}

/**
 * The seed task's demo branch, only while no branch exists (so it runs safely on every deploy of a
 * disposable environment). Returns `null` when branches already exist.
 */
export async function seedDemoBranch(db: Db, input: { timezone: string }): Promise<SeededBranch | null> {
  if (await repo.hasAnyBranch(db)) return null
  const branch = { id: newId(), name: 'Main branch', slug: 'main', timezone: input.timezone, now: new Date() }
  await db.batch([repo.insertBranchStatement(db, branch)])
  return { id: branch.id, name: branch.name }
}

/** Active branches (id and name), for pickers such as the staff form's. Step 5.1 adds the rest. */
export async function listBranchOptions(db: Db): Promise<repo.BranchOptionRow[]> {
  return repo.listActiveBranches(db)
}
