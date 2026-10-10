/**
 * Whether a newer build of the app was deployed since this page loaded (D149). Set by
 * `plugins/new-version.client.ts` from Nuxt's check; `<NewVersionBanner>` offers the reload.
 */
export const useNewVersion = () => useState('app:new-version', () => false)
