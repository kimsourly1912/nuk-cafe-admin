import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as authSchema from '#auth/schema'
import { customerProfiles } from '#server/features/customers/customers.schema'
import { normalizeMemberCode } from '#server/features/customers/customers.rules'
import { ensureProfile } from '#server/features/customers/customers.service'
import { outboxMessages } from '#server/features/platform/platform.schema'
import { deliverOutbox } from '#server/features/platform/platform.service'
import { accountMailHandlers, cloudflareEmailSender, consoleSender, MAIL_KINDS } from '#server/features/identity/identity.mail'
import type { EmailBinding, MailMessage } from '#server/features/identity/identity.mail'
import { authorizeCustomer } from '#server/features/identity/identity.service'
import type { SessionUser } from '#server/features/identity/identity.types'
import { createStaff, seedFirstOwner } from '#server/features/identity/staff.service'
import { createTestAuth, sessionHeaders, signIn } from '#server/tests/support/auth'
import type { TestAuth } from '#server/tests/support/auth'
import { createTestDb, ensureTenant, insertBranch, TEST_TENANT } from '#server/tests/support/db'
import type { Db } from '#server/utils/batch'
import { newId } from '#server/utils/ids'

let db: Db
let auth: TestAuth

beforeEach(async () => {
  db = await createTestDb()
  await ensureTenant(db)
  auth = createTestAuth(db)
})

const PASSWORD = 'the customer password'

async function signUp(email = 'dara@example.com') {
  const { headers, response } = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Dara' }, returnHeaders: true })
  return { userId: response.user.id, headers: sessionHeaders(headers) }
}

async function queued(kind: string) {
  return db.select().from(outboxMessages).where(eq(outboxMessages.kind, kind))
}

/** The token in a queued account email's link. */
async function tokenFrom(kind: string) {
  const [message] = await queued(kind)
  const url = new URL((message!.payload as { url: string }).url)
  return url.searchParams.get('token') ?? url.pathname.split('/').pop()!
}

async function sessionUser(headers: Headers) {
  return (await auth.api.getSession({ headers }))?.user as SessionUser | undefined
}

describe('sign-up', () => {
  it('queues one verification email and makes no customer profile in any cafe (D220)', async () => {
    // Two cafes: the account must not become a member of the oldest one, or of either.
    await ensureTenant(db, 'tenant-2')
    const { userId } = await signUp()
    const mails = await queued(MAIL_KINDS.verifyEmail)
    expect(mails).toHaveLength(1)
    expect(mails[0]!.payload).toMatchObject({ to: 'dara@example.com', url: expect.stringContaining('/api/auth/verify-email?token=') })
    expect(await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))).toEqual([])
  })

  it('works on a platform with no cafe at all', async () => {
    const empty = createTestAuth(await createTestDb())
    const { response } = await empty.api.signUpEmail({ body: { email: 'first@example.com', password: PASSWORD, name: 'First' }, returnHeaders: true })
    expect(response.user.email).toBe('first@example.com')
  })

  it('lets an unverified customer sign in and order (D156: verification no longer gates ordering)', async () => {
    const { headers } = await signUp()
    const user = await sessionUser(headers)
    expect(user).toMatchObject({ emailVerified: false })
    expect(await authorizeCustomer(db, user, TEST_TENANT)).toMatchObject({ role: 'customer' })
  })

  it('verifies the email from the link', async () => {
    const { headers } = await signUp()
    await auth.api.verifyEmail({ query: { token: await tokenFrom(MAIL_KINDS.verifyEmail) } })
    const user = await sessionUser(headers)
    expect(user).toMatchObject({ emailVerified: true })
    expect(await authorizeCustomer(db, user, TEST_TENANT)).toMatchObject({ role: 'customer' })
  })
})

describe('customer profile', () => {
  it('is created on first use in a cafe, once', async () => {
    const { userId } = await signUp()
    const profile = await ensureProfile(db, TEST_TENANT, userId)
    expect(profile.memberCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(profile.memberCode).toMatch(/^.{4}-.{4}$/)
    expect(await ensureProfile(db, TEST_TENANT, userId)).toEqual(profile)
  })

  it('is created with a staff account, in the same batch', async () => {
    const seeded = await seedFirstOwner(db, await ensureTenant(db), { name: 'Owner', email: 'owner@example.com' })
    const branchId = newId()
    await insertBranch(db, { id: branchId, name: 'Riverside', timezone: 'Asia/Phnom_Penh' })
    const created = await createStaff(db, { userId: seeded!.staff.id, tenantId: TEST_TENANT, role: 'owner' }, { name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId, role: 'staff' }] })
    for (const userId of [seeded!.staff.id, created.staff.id]) {
      expect(await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))).toHaveLength(1)
    }
  })

  it('is one per cafe: the same account gets its own profile in another cafe, on first use there', async () => {
    const { userId } = await signUp()
    const ours = await ensureProfile(db, TEST_TENANT, userId)
    const theirs = await ensureProfile(db, await ensureTenant(db, 'tenant-2'), userId)
    expect(theirs.memberCode).not.toBe(ours.memberCode)
    expect((await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))).map(p => p.tenantId).sort()).toEqual([TEST_TENANT, 'tenant-2'])
    // Each cafe reads its own.
    expect(await ensureProfile(db, TEST_TENANT, userId)).toEqual(ours)
    expect(await ensureProfile(db, 'tenant-2', userId)).toEqual(theirs)
  })

  it('is created when an existing account joins another cafe\'s staff', async () => {
    const { userId } = await signUp('sophea@example.com')
    const other = await ensureTenant(db, 'tenant-2')
    const branchId = newId()
    await insertBranch(db, { id: branchId, name: 'Their branch', timezone: 'Asia/Phnom_Penh', tenantId: other })
    await createStaff(db, { userId: 'their-owner', tenantId: other, role: 'owner' }, { name: 'Sophea', email: 'sophea@example.com', admin: false, memberships: [{ branchId, role: 'staff' }] })
    expect((await db.select().from(customerProfiles).where(eq(customerProfiles.userId, userId))).map(p => p.tenantId)).toEqual([other])
  })

  it('reads member codes the way people type them', () => {
    expect(normalizeMemberCode(' 7k2m qx9p ')).toBe('7K2M-QX9P')
    expect(normalizeMemberCode('7K2M-QXOL')).toBe('7K2M-QX01')
  })
})

describe('password reset', () => {
  it('sends a link only to an existing account, answering the same either way', async () => {
    await signUp()
    const unknown = await auth.api.requestPasswordReset({ body: { email: 'nobody@example.com' } })
    const known = await auth.api.requestPasswordReset({ body: { email: 'dara@example.com' } })
    expect(unknown).toEqual(known)
    const mails = await queued(MAIL_KINDS.resetPassword)
    expect(mails.map(m => (m.payload as { to: string }).to)).toEqual(['dara@example.com'])
  })

  it('sets the new password once, and signs the account out everywhere', async () => {
    const { headers } = await signUp()
    await auth.api.requestPasswordReset({ body: { email: 'dara@example.com' } })
    const token = await tokenFrom(MAIL_KINDS.resetPassword)

    await auth.api.resetPassword({ body: { token, newPassword: 'a brand new password' } })
    expect(await auth.api.getSession({ headers })).toBeNull()
    await expect(signIn(auth, 'dara@example.com', PASSWORD)).rejects.toThrow()
    await expect(signIn(auth, 'dara@example.com', 'a brand new password')).resolves.toBeDefined()
    // Single use.
    await expect(auth.api.resetPassword({ body: { token, newPassword: 'yet another password' } })).rejects.toThrow()
  })

  it('clears a temporary password, like changing it does', async () => {
    const seeded = await seedFirstOwner(db, await ensureTenant(db), { name: 'Owner', email: 'owner@example.com' })
    await auth.api.requestPasswordReset({ body: { email: 'owner@example.com' } })
    await auth.api.resetPassword({ body: { token: await tokenFrom(MAIL_KINDS.resetPassword), newPassword: 'the owner\'s own password' } })
    const [row] = await db.select({ flag: authSchema.user.mustChangePassword }).from(authSchema.user).where(eq(authSchema.user.id, seeded!.staff.id))
    expect(row!.flag).toBe(false)
  })

  it('keeps a temporary password when the reset fails', async () => {
    const seeded = await seedFirstOwner(db, await ensureTenant(db), { name: 'Owner', email: 'owner@example.com' })
    await expect(auth.api.resetPassword({ body: { token: 'not-a-token', newPassword: 'the owner\'s own password' } })).rejects.toThrow()
    const [row] = await db.select({ flag: authSchema.user.mustChangePassword }).from(authSchema.user).where(eq(authSchema.user.id, seeded!.staff.id))
    expect(row!.flag).toBe(true)
  })
})

describe('delivery', () => {
  it('sends queued account emails through the outbox, then forgets the link', async () => {
    await signUp()
    const sent: MailMessage[] = []
    // A second later: the row's due time comes from SQLite's clock, which can round 1 ms ahead of
    // a JavaScript Date taken right after the insert.
    const report = await deliverOutbox(db, accountMailHandlers(async (message) => {
      sent.push(message)
    }, { appName: 'Angder' }), { now: new Date(Date.now() + 1000) })
    expect(report).toMatchObject({ sent: 1 })
    const [row] = await queued(MAIL_KINDS.verifyEmail)
    expect(sent).toEqual([expect.objectContaining({ to: 'dara@example.com', subject: 'Confirm your email for Angder' })])
    expect(sent[0]!.text).toContain('/api/auth/verify-email?token=')
    expect(row).toMatchObject({ status: 'sent', payload: {} })
  })

  it('escapes what goes into the HTML', async () => {
    const sent: MailMessage[] = []
    await accountMailHandlers(async (m) => {
      sent.push(m)
    }, { appName: 'Angder' })[MAIL_KINDS.resetPassword]!({ id: 'm1', tenantId: null, kind: MAIL_KINDS.resetPassword, attempt: 1, payload: { to: 'a@example.com', url: 'https://cafe.example/x?a=1&b="2"' } })
    expect(sent[0]!.html).toContain('href="https://cafe.example/x?a=1&amp;b=&quot;2&quot;"')
  })

  it('names the configured platform, never a cafe, and escapes the name in the HTML', async () => {
    const sent: MailMessage[] = []
    const handlers = accountMailHandlers(async (m) => {
      sent.push(m)
    }, { appName: 'Brew & <Co>' })
    const base = { tenantId: null, attempt: 1, payload: { to: 'a@example.com', url: 'https://cafe.example/x' } }
    await handlers[MAIL_KINDS.verifyEmail]!({ ...base, id: 'm1', kind: MAIL_KINDS.verifyEmail })
    await handlers[MAIL_KINDS.resetPassword]!({ ...base, id: 'm2', kind: MAIL_KINDS.resetPassword })
    expect(sent.map(m => m.subject)).toEqual(['Confirm your email for Brew & <Co>', 'Reset your Brew & <Co> password'])
    for (const message of sent) {
      expect(message.text).toMatch(/\n\nBrew & <Co>$/)
      expect(message.html).toContain('<p>Brew &amp; &lt;Co&gt;</p>')
      expect(message.html).not.toContain('<Co>')
      expect(`${message.subject}${message.text}${message.html}`).not.toContain('NUK Cafe')
    }
  })

  it('sends through Cloudflare\'s binding from the configured sender, and throws on a refusal without the address', async () => {
    const calls: Parameters<EmailBinding['send']>[0][] = []
    let refusal: Error | null = null
    const binding: EmailBinding = {
      send: async (message) => {
        calls.push(message)
        if (refusal) throw refusal
        return { messageId: 'cf-1' }
      },
    }
    const send = cloudflareEmailSender({ binding, from: 'no-reply@mail.cafe.example', fromName: 'Cafe' })
    const message = { to: 'a@example.com', subject: 'S', text: 'T', html: '<p>T</p>' }

    await send(message)
    expect(calls[0]).toEqual({ to: 'a@example.com', from: { email: 'no-reply@mail.cafe.example', name: 'Cafe' }, subject: 'S', text: 'T', html: '<p>T</p>' })

    refusal = Object.assign(new Error('Recipient a@example.com is suppressed'), { code: 'E_RECIPIENT_SUPPRESSED' })
    const error = await send(message).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Email Sending refused the message: E_RECIPIENT_SUPPRESSED')
    expect((error as Error).message).not.toContain('a@example.com')
  })

  it('sends from the bare address when no sender name is set', async () => {
    const calls: Parameters<EmailBinding['send']>[0][] = []
    const binding: EmailBinding = {
      send: async (message) => {
        calls.push(message)
        return { messageId: 'cf-2' }
      },
    }
    const send = cloudflareEmailSender({ binding, from: 'no-reply@mail.cafe.example', fromName: '' })
    await send({ to: 'a@example.com', subject: 'S', text: 'T', html: '' })
    expect(calls[0]!.from).toBe('no-reply@mail.cafe.example')
  })

  it('gives up on a send that never answers', async () => {
    const binding: EmailBinding = { send: () => new Promise(() => {}) }
    const send = cloudflareEmailSender({ binding, from: 'no-reply@mail.cafe.example', fromName: '', timeoutMs: 20 })
    await expect(send({ to: 'a@example.com', subject: 'S', text: 'T', html: '' })).rejects.toThrow('Email Sending refused the message: TIMEOUT')
  })

  it('prints mail locally instead of sending it', async () => {
    const printed: string[] = []
    await consoleSender(text => printed.push(text))({ to: 'a@example.com', subject: 'S', text: 'Link: https://x', html: '' })
    expect(printed[0]).toContain('Link: https://x')
  })
})
