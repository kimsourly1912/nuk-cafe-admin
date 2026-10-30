import type { DeleteAccountInput } from '#shared/contracts/account'
import type { Db, Statement } from '#server/utils/batch'
import { requireOneChange, runBatch } from '#server/utils/batch'
import { anonymizeProfilesStatement } from '#server/features/customers'
import { auditStatement, outboxStatement } from '#server/features/platform'
import { accountChanged, accountHasCafeAccess, guestCannotDelete, orderInProgress, platformAccountCannotDelete, unauthenticated, wrongPassword } from './identity.errors'
import { MAIL_KINDS } from './identity.mail'
import { signedIn } from './identity.service'
import type { SessionUser } from './identity.types'
import * as repo from './erasure.repository'

export interface DeleteAccountOptions {
  /** Better Auth's check of the password against the signed-in session (`verifyPassword`). */
  verifyPassword: (password: string) => Promise<boolean>
  /**
   * The orders feature's: whether the account has an order in progress in any cafe, and the guard
   * statement that repeats it in the batch. Passed in by the route: orders already imports identity.
   */
  hasOrderInProgress: () => Promise<boolean>
  noOrderInProgress: Statement
  requestId?: string
  now?: Date
}

/**
 * The signed-in account deletes itself, in every cafe (D229, D237). It is emptied, never removed:
 * orders and payments reference it, and the cafes keep them. Refused, writing nothing: a guest (the
 * 90-day cleanup empties those, D236), a wrong password, a platform account, an account that still
 * works at a cafe (its owner removes the access first, so a cafe never loses its last owner), an
 * order in progress. One batch: who the account was replaced, every way back in deleted, each cafe's
 * profile anonymised, the "account deleted" email (to a verified address only, so a bot's fake
 * addresses cost no mail), the audit entry (the id only). The write repeats every check.
 */
export async function deleteAccount(db: Db, sessionUser: SessionUser | null | undefined, input: DeleteAccountInput, options: DeleteAccountOptions): Promise<void> {
  const { verifyPassword, hasOrderInProgress, noOrderInProgress, requestId, now = new Date() } = options
  const me = signedIn(sessionUser)
  if (me.isAnonymous) throw guestCannotDelete()
  if (!(await verifyPassword(input.password))) throw wrongPassword()

  const facts = await repo.erasureFacts(db, me.id)
  if (!facts || facts.anonymized) throw unauthenticated()
  if (facts.superadmin) throw platformAccountCannotDelete()
  if (facts.cafeAccess) throw accountHasCafeAccess()
  if (await hasOrderInProgress()) throw orderInProgress()

  await runBatch(db, [
    repo.eraseAccountStatement(db, me.id, facts.email, now),
    requireOneChange(db),
    noOrderInProgress,
    ...repo.deleteSignInStatements(db, me.id),
    anonymizeProfilesStatement(db, me.id, now),
    ...(facts.emailVerified ? [outboxStatement(db, null, MAIL_KINDS.accountDeleted, { to: facts.email })] : []),
    auditStatement(db, { userId: me.id, tenantId: null, requestId }, { action: 'identity.account.delete', targetType: 'user', targetId: me.id }),
  ], accountChanged)
}
