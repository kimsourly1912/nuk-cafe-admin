import * as v from 'valibot'
import type { WeeklyWindow } from './common'
import { MAX_WEEKLY_WINDOWS, nameSchema, textSchema, versionSchema, weeklyWindowSchema } from './common'

/**
 * Branch settings and dining tables (`/api/admin/branches/{branchId}`, step 5.1, D91). A branch is
 * edited, never created or archived here (the seed task creates branches). Its hours are weekly
 * windows in its own timezone, like availability rules; a branch with none is never open. Each
 * active table has a QR URL the admin can show at any time; rotating it makes the printed one stop
 * working. docs/plans/branch-settings.md
 */

export const BRANCH_NAME_MAX = 60
export const BRANCH_ADDRESS_MAX = 200
export const BRANCH_PHONE_MAX = 30
export const TABLE_LABEL_MAX = 20
export const TABLE_AREA_MAX = 40
/** Tables per branch, archived ones included. */
export const MAX_BRANCH_TABLES = 200

export interface BranchSettings {
  id: string
  name: string
  /** IANA zone of the branch's wall clock ("Asia/Phnom_Penh"): its hours and the menu's rules use it. */
  timezone: string
  address: string | null
  phone: string | null
  status: 'active' | 'archived'
  /** By weekday, then start time. None: never open. */
  hours: WeeklyWindow[]
  /** Open at the moment of the request, by its hours in its timezone. */
  openNow: boolean
  /** Today's ISO weekday (1 = Monday) in the branch's timezone, for "today's hours". */
  today: number
  version: number
}

const optionalText = (max: number) => v.nullable(v.pipe(textSchema(max), v.transform(text => text || null)))

/** Only the fields to change: absent keeps, `null` (or blank) clears address and phone. `hours` replaces the week. */
export const updateBranchSettingsSchema = v.strictObject({
  version: versionSchema,
  name: v.optional(nameSchema(BRANCH_NAME_MAX)),
  timezone: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1, 'Required'), v.maxLength(64, 'Not a time zone'))),
  address: v.optional(optionalText(BRANCH_ADDRESS_MAX)),
  phone: v.optional(optionalText(BRANCH_PHONE_MAX)),
  hours: v.optional(v.pipe(
    v.array(weeklyWindowSchema),
    v.maxLength(MAX_WEEKLY_WINDOWS, `At most ${MAX_WEEKLY_WINDOWS} opening windows`),
  )),
})
export type UpdateBranchSettingsInput = v.InferOutput<typeof updateBranchSettingsSchema>

// --- Dining tables ---

export const DINING_TABLE_STATUSES = ['active', 'archived'] as const
export type DiningTableStatus = typeof DINING_TABLE_STATUSES[number]

export interface DiningTable {
  id: string
  branchId: string
  label: string
  /** Where it is ("Main floor", "Patio"); `null`: not set. */
  area: string | null
  status: DiningTableStatus
  /** The link printed as its QR code; `null` while archived (the QR doesn't work then). */
  qrUrl: string | null
  qrRotatedAt: string
  version: number
  createdAt: string
  updatedAt: string
}

export const tableListQuerySchema = v.object({
  status: v.optional(v.picklist(['active', 'archived', 'all']), 'active'),
})
export type TableListQuery = v.InferOutput<typeof tableListQuerySchema>

const tableLabel = nameSchema(TABLE_LABEL_MAX)
const tableArea = optionalText(TABLE_AREA_MAX)

export const createTableSchema = v.strictObject({
  label: tableLabel,
  area: v.optional(tableArea, null),
})
export type CreateTableInput = v.InferOutput<typeof createTableSchema>

/** Only the fields to change: absent keeps, `null` (or blank) clears the area. */
export const updateTableSchema = v.strictObject({
  version: versionSchema,
  label: v.optional(tableLabel),
  area: v.optional(tableArea),
})
export type UpdateTableInput = v.InferOutput<typeof updateTableSchema>

/** Archive, restore or rotate the QR: the version read. */
export const tableVersionSchema = v.strictObject({ version: versionSchema })
export type TableVersionInput = v.InferOutput<typeof tableVersionSchema>

/** `GET /api/public/tables/{token}`: the table a scanned QR code names. */
export interface PublicTable {
  branch: { id: string, name: string }
  table: { id: string, label: string }
}

/** When a closed branch opens next, on its own clock. */
export interface NextOpening {
  /** 0: later today, 1: tomorrow, up to 7 (the same weekday next week). */
  inDays: number
  /** ISO: 1 = Monday … 7 = Sunday. */
  weekday: number
  /** Minutes after midnight. */
  startMinute: number
}

/**
 * A branch as customers see it (`GET /api/public/branches`, and the menu's `branch`, D93): its
 * details and whether it takes orders now. Orders are accepted only while it's open (D45).
 */
export interface PublicBranch {
  id: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
  openNow: boolean
  /**
   * While open: minutes until it closes (through back-to-back windows); `null` while closed. Online
   * orders stop `LAST_ORDERS_MINUTES` before (D99).
   */
  closesInMinutes: number | null
  /** While closed: when it opens next; `null` while open, or with no opening hours at all. */
  nextOpening: NextOpening | null
}
