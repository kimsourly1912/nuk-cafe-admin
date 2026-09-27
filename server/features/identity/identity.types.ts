import type { BranchRole, PlatformRole } from './identity.permissions'

/** The signed-in user as Better Auth's session returns it (the fields access checks read). */
export interface SessionUser {
  id: string
  email?: string
  name?: string
  emailVerified: boolean
  /** Better Auth stores several roles comma-separated; ours only ever set one. */
  role?: string | null
  banned?: boolean | null
  mustChangePassword?: boolean | null
}

/**
 * Who is acting, as the access helpers return it. Services receive it and write it to the audit
 * log; they never read the session themselves.
 */
export interface Actor {
  userId: string
  role: PlatformRole
  /** The request this actor made, for the audit trail (set by the access helpers). */
  requestId?: string
}

/** An actor on the counter surface: acting in one branch. */
export interface BranchActor extends Actor {
  branchId: string
  /** The member's role in that branch; absent for a platform admin who isn't a member. */
  branchRole?: BranchRole
}
