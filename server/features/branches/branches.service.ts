import type { Db } from '../../utils/batch'
import { newId } from '../../utils/ids'
import { notFound } from '../../utils/errors'
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

export interface OpenBranch {
  id: string
  name: string
  /** IANA zone of its wall clock ("Asia/Phnom_Penh"): opening hours and availability use it. */
  timezone: string
}

/** An active branch for the public surface; unknown and archived ones are 404. */
export async function getActiveBranch(db: Db, id: string): Promise<OpenBranch> {
  const branch = await repo.findBranch(db, id)
  if (!branch || branch.status !== 'active') throw notFound('This branch')
  return { id: branch.id, name: branch.name, timezone: branch.timezone }
}
