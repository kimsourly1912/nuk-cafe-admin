import { bootstrapAdminBody } from '#shared/contracts/identity'
import { bootstrapAdmin } from '../../../features/identity/service'

/**
 * Makes an existing account the first admin (docs/reference/api.md → Bootstrap). Enabled only
 * while `NUXT_BOOTSTRAP_TOKEN` is set; refused once an admin exists.
 */
export default defineEventHandler(async (event) => {
  const input = await readBodyAs(event, bootstrapAdminBody)
  return bootstrapAdmin(useDb(), useRuntimeConfig(event).bootstrapToken, input)
})
