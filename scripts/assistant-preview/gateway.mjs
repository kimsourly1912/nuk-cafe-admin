/** Temporary review gateway. The application behind APP has no public Worker/preview URL. */
export default {
  async fetch(request, env) {
    const denied = () => new Response('Preview access required.', { status: 401, headers: { 'www-authenticate': 'Basic realm="Assistant preview"', 'cache-control': 'no-store' } })
    if (!env.PREVIEW_AUTHORIZATION || !Number.isFinite(Number(env.PREVIEW_EXPIRES_AT)) || Date.now() >= Number(env.PREVIEW_EXPIRES_AT)) return denied()
    const supplied = request.headers.get('authorization') ?? ''
    // Hash first so comparison always has the same length; no credential appears in logs.
    const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    const [a, b] = await Promise.all([digest(supplied), digest(env.PREVIEW_AUTHORIZATION)])
    let mismatch = 0
    const actual = new Uint8Array(a)
    const expected = new Uint8Array(b)
    for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i]
    if (mismatch) return denied()
    const forwarded = new Request(request)
    forwarded.headers.delete('authorization')
    return env.APP.fetch(forwarded)
  },
}
