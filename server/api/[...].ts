/**
 * Unknown `/api/**` paths answer 404 in the API's error format instead of falling through to the
 * app's HTML page. More specific routes (Better Auth's `/api/auth/**`, feature routes) win.
 */
export default defineEventHandler(() => {
  throw apiError(404, 'NOT_FOUND', 'No such API endpoint.')
})
