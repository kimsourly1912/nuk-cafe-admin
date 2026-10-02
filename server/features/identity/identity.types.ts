import type { BranchRole, TenantRole } from './identity.permissions'

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
 * Who is acting, and in which tenant (D134), as the access helpers return it. Services receive it,
 * scope their work to `tenantId` and write it to the audit log; they never read the session
 * themselves.
 */
export interface Actor {
  userId: string
  tenantId: string
  /** Their role in the tenant; `customer` when they're not a member (a shop customer). */
  role: TenantRole | 'customer'
  /** The request this actor made, for the audit trail (set by the access helpers). */
  requestId?: string
}

/** An actor on the counter surface: acting in one branch of the tenant. */
export interface BranchActor extends Actor {
  branchId: string
  /** Their role at that branch; absent for an owner who isn't on its staff. */
  branchRole?: BranchRole
}
