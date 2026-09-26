// Public API of the schedules feature: building blocks other features may use.
// Never export pages or forms from here. Route files import those directly.
// ScheduleSelect + useScheduleOptions are added with their first consumer, the menu-item form
// (docs/plans/schedules.md → Relationships).
export { schedulesNavigation } from './navigation'
