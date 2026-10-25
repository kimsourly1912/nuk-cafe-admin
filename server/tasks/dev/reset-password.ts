import { DEV_PASSWORD, resetDevSignIn } from '#server/features/identity'

/**
 * Gets any account signed in again with the test password (D209), keeping its roles: no forced
 * change, no two-step sign-in, not banned, signed out everywhere. Dev server only:
 * `pnpm dev:reset <email>`.
 */
export default defineTask({
  meta: { name: 'dev:reset-password', description: 'Reset one account to the test password (payload: email)' },
  async run({ payload }) {
    if (!import.meta.dev) throw new Error('Test accounts exist on the dev server only.')
    if (typeof payload.email !== 'string' || !payload.email) throw new Error('Name the account: ?email=…')
    const password = useRuntimeConfig().devAccounts.password || DEV_PASSWORD
    const account = await resetDevSignIn(useDb(), payload.email, { dev: import.meta.dev, password })
    return { result: { email: account.email, password } }
  },
})
