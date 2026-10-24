import { getCafeProfile, webManifest } from '#server/features/tenants'

/**
 * `GET /c/<slug>/admin.webmanifest`: the cafe's admin as an installable app (D202). Public, like the
 * cafe's profile. The cafe-pages middleware already answered an unknown cafe (404), a paused one
 * (403) and a former address (302). `no-cache`: a renamed cafe's app picks up the new name.
 */
export default defineEventHandler(async (event) => {
  const profile = await getCafeProfile(useDb(), decodeURIComponent(getRouterParam(event, 'slug') ?? ''))
  setHeader(event, 'Content-Type', 'application/manifest+json')
  setHeader(event, 'Cache-Control', 'no-cache')
  return webManifest(profile, 'admin')
})
