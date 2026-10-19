/**
 * Support access's rules (step P5, D193), no I/O. A support visit is read-only: only these
 * permissions, and only on GET (a GET route asking for `settings: ['manage']` reads settings; the
 * same name on a POST would change them). Report exports (bulk downloads), the AI assistant, uploads
 * and sample data are left out: support looks, it doesn't take data away or act.
 */
export const SUPPORT_READ_PERMISSIONS = {
  menu: ['read'],
  branch: ['read', 'update'],
  staff: ['read'],
  report: ['read'],
  settings: ['manage'],
  audit: ['read'],
} as const satisfies Record<string, readonly string[]>

const SAFE_METHODS = new Set(['GET', 'HEAD'])

export const isReadRequest = (method: string) => SAFE_METHODS.has(method.toUpperCase())

/** Whether every requested action is one a support visit may read. */
export function isSupportReadable(permissions: Record<string, readonly string[] | undefined>): boolean {
  return Object.entries(permissions).every(([resource, actions]) => {
    const allowed = (SUPPORT_READ_PERMISSIONS as Record<string, readonly string[]>)[resource]
    return !!allowed && (actions ?? []).every(action => allowed.includes(action))
  })
}

/** The permissions the admin app hides by (`resource:action`); the server checks every request itself. */
export const supportPermissionList = () => Object.entries(SUPPORT_READ_PERMISSIONS).flatMap(([resource, actions]) => actions.map(action => `${resource}:${action}`))

/** Failed codes allowed per super admin in `CODE_WINDOW_MS` before opening is refused for a while. */
export const MAX_CODE_FAILURES = 5
export const CODE_WINDOW_MS = 15 * 60_000
