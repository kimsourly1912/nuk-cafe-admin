import { counterSession, recordWorkspaceVisit } from '#server/features/identity'

/**
 * The counter app's session check (D102): who is signed in and the branches they work at. Answers
 * on a temporary password too, so the app can ask for a new one. A day from sign-in at most (D243).
 * Records the visit for the owner's Staff page, "Last active here" (D248); best effort.
 */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  const { user } = await workspaceSession(event)
  const db = useDb()
  const session = await counterSession(db, user, tenant.id)
  await recordWorkspaceVisit(db, tenant.id, user!.id).catch(error => log('warn', 'Workspace visit not recorded', { error: String(error) }, event))
  return session
})
