import type { CreateScheduleBody, Schedule, UpdateScheduleBody } from '#shared/contracts/menu'
import { SCHEDULE_END_AFTER_START, TIME_PATTERN } from '#shared/contracts/menu'
import * as v from 'valibot'
import { DAY_VALUES, sortDays } from '../utils/days'

// Stops at the first failure, so an empty field says "required", not also "Use HH:mm".
const time = (label: string) => v.config(
  v.pipe(v.string(), v.minLength(1, `${label} is required`), v.regex(TIME_PATTERN, 'Use HH:mm, e.g. 08:30')),
  { abortPipeEarly: true },
)

/**
 * Form rules, with user-facing messages (the server checks the same). Days and times are
 * required; a range must end after it starts: overnight ranges aren't accepted until their rule
 * is decided (D41).
 */
export const scheduleFormSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(100, 'Max 100 characters')),
    description: v.pipe(v.string(), v.trim(), v.maxLength(500, 'Max 500 characters')),
    days: v.pipe(v.array(v.picklist(DAY_VALUES)), v.minLength(1, 'Pick at least one day')),
    startTime: time('Start time'),
    endTime: time('End time'),
    status: v.picklist(['ACTIVE', 'INACTIVE']),
  }),
  // Only once both times are valid: a malformed or missing one already says so.
  v.forward(v.partialCheck(
    [['startTime'], ['endTime']],
    s => !TIME_PATTERN.test(s.startTime) || !TIME_PATTERN.test(s.endTime) || s.endTime > s.startTime,
    SCHEDULE_END_AFTER_START,
  ), ['endTime']),
)

export type ScheduleForm = v.InferOutput<typeof scheduleFormSchema>

/** Initial form state, from an existing schedule or defaults for a new one. */
export function toScheduleForm(schedule?: Schedule): ScheduleForm {
  return {
    name: schedule?.name ?? '',
    description: schedule?.description ?? '',
    days: sortDays(schedule?.days ?? []),
    startTime: schedule?.startTime ?? '',
    endTime: schedule?.endTime ?? '',
    status: schedule?.status ?? 'ACTIVE',
  }
}

export function toCreateScheduleBody(form: ScheduleForm): CreateScheduleBody {
  return { ...form, days: sortDays(form.days) }
}

/**
 * Update body: every field the form edits, from the version it was opened with. Menu items are
 * never sent: they're linked from the menu-item form, so saving a schedule can't drop a link.
 */
export function toUpdateScheduleBody(form: ScheduleForm, existing: Schedule): UpdateScheduleBody {
  return { version: existing.version, ...toCreateScheduleBody(form) }
}
