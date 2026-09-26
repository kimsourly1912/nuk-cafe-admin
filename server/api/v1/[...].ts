/** Unknown `/api/v1` paths answer in the API's error format, not with an HTML page. */
export default defineEventHandler(() => {
  throw apiError(404, 'NOT_FOUND', 'No such API endpoint.')
})
