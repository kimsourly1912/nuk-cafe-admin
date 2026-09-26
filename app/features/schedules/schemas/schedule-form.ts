import type { ScheduleListResponse, ScheduleResponse, ScheduleUpdateRequest } from '~/generated/api'
import * as v from 'valibot'
import { DAY_VALUES } from '../utils/days'
import { shiftWeekly } from '../utils/timezone'

/** `HH:mm`, the format the API returns; seconds are accepted in case a record has them (plan S1). */
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/

// Stops at the first failure, so an empty field says "required", not also "Use HH:mm".
const time = (label: string) => v.config(
  v.pipe(v.string(), v.minLength(1, `${label} is required`), v.regex(TIME, 'Use HH:mm, e.g. 08:30')),
  { abortPipeEarly: true },
)

/**
 * Form rules. Generated request schemas carry no validation, so the user-facing rules live here.
 * Days and times are required by choice (plan S10, S11); overnight ranges are left to the
 * backend (S3).
 */
export const scheduleFormSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
  description: v.pipe(v.string(), v.trim(), v.maxLength(500, 'Max 500 characters')),
  days: v.pipe(v.array(v.picklist(DAY_VALUES)), v.minLength(1, 'Pick at least one day')),
  startTime: time('Start time'),
  endTime: time('End time'),
  status: v.picklist(['ACTIVE', 'INACTIVE']),
})

export type ScheduleForm = v.InferOutput<typeof scheduleFormSchema>

/**
 * Initial form state, from an existing schedule (a list row is enough) or defaults for a new one.
 * `shift`: minutes from the record's timezone to the viewer's (`zoneShift`). Days and times are
 * shown in the viewer's zone, and days move when the start crosses midnight.
 */
export function toScheduleForm(schedule?: ScheduleListResponse | ScheduleResponse, shift = 0): ScheduleForm {
  const { days, startTime, endTime } = shiftWeekly(
    { days: schedule?.days ?? [], startTime: schedule?.startTime ?? '', endTime: schedule?.endTime ?? '' },
    shift,
  )
  return {
    name: schedule?.name ?? '',
    description: schedule?.description ?? '',
    days,
    startTime,
    endTime,
    status: schedule?.status ?? 'ACTIVE',
  }
}

/**
 * Request body for create/update (same shape). `existing` must be the **detail** record
 * (`GET /staff/schedules/{id}`), because only it has `items`:
 * - Days and times go back from the viewer's zone to the record's (`-shift`), as 24-hour `HH:mm`.
 * - `items` re-sends the linked product ids: keeps them whether PUT replaces or merges (plan S4).
 *   A new schedule sends `[]`.
 * - `nameI18n` / `descriptionI18n` are copied: the form edits English only (Q5).
 */
export function toScheduleRequest(form: ScheduleForm, existing?: ScheduleResponse, shift = 0): ScheduleUpdateRequest {
  const { days, startTime, endTime } = shiftWeekly(form, -shift)
  return {
    name: form.name,
    description: form.description,
    status: form.status,
    startTime,
    endTime,
    days,
    items: (existing?.items ?? []).flatMap(item => (item.productId === undefined ? [] : [item.productId])),
    nameI18n: existing?.nameI18n,
    descriptionI18n: existing?.descriptionI18n,
  }
}
