import * as v from 'valibot'
import { idSchema } from './common'

/**
 * Sample data (D94): realistic test data loaded from the admin, only where the environment turns it
 * on (local and staging; never production). `/api/admin/sample-data` answers 404 elsewhere.
 */

export const SAMPLE_MENU_SIZES = ['small', 'standard', 'large'] as const
export type SampleMenuSize = (typeof SAMPLE_MENU_SIZES)[number]

/** Items per size; the categories, option sets, add-on groups and rules are the same for all. */
export const SAMPLE_MENU_ITEMS: Record<SampleMenuSize, number> = { small: 12, standard: 40, large: 150 }

export type SampleMenuStageKey = 'categories' | 'optionSets' | 'modifierGroups' | 'availabilityRules' | 'items'

/** One step of loading the sample menu: how many of its records exist. */
export interface SampleMenuStage {
  key: SampleMenuStageKey
  label: string
  done: number
  total: number
}

export interface SampleDataState {
  /** The environment's name ("Local", "Staging"). */
  environment: string
  menu: {
    /** Every menu record now (archived included), and the uploaded photos. */
    counts: {
      categories: number
      optionSets: number
      modifierGroups: number
      availabilityRules: number
      items: { draft: number, active: number, archived: number }
      photos: number
    }
    /** The sample menu load, if one was started since the last reset. */
    run: { size: SampleMenuSize, finished: boolean, stages: SampleMenuStage[] } | null
  }
  /** Active branches, by name. */
  branches: { id: string, name: string, hoursSet: boolean, tables: number }[]
}

/** After a branch step: the state, and how many sample tables are still to add. */
export interface SampleBranchResult {
  state: SampleDataState
  remainingTables: number
}

/** Start the sample menu, or continue an unfinished load (the same size). One step per call. */
export const loadSampleMenuSchema = v.strictObject({
  size: v.picklist(SAMPLE_MENU_SIZES),
})
export type LoadSampleMenuInput = v.InferOutput<typeof loadSampleMenuSchema>

/**
 * Sample hours and tables for one branch, a few tables per call: the first call sets the hours,
 * then `tablesOnly` calls add the rest until `remainingTables` is 0.
 */
export const loadSampleBranchSchema = v.strictObject({
  branchId: idSchema,
  tablesOnly: v.optional(v.boolean(), false),
})
export type LoadSampleBranchInput = v.InferOutput<typeof loadSampleBranchSchema>

/**
 * Delete every menu record and upload: the admin typed RESET. Uploads go a batch per call: call
 * again while `menu.counts.photos` isn't 0.
 */
export const resetSampleMenuSchema = v.strictObject({
  confirm: v.literal('RESET', 'Type RESET to confirm'),
})
export type ResetSampleMenuInput = v.InferOutput<typeof resetSampleMenuSchema>
