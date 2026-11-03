// Loaded only by the local e2e server, never by a deployed app. Keep fixture password hashes
// inside the test process and make recovery flows independent of the external breach service.
// Negative/failed breach-check cases have their own unit and browser mocks.
const originalFetch = globalThis.fetch

globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.hostname === 'api.pwnedpasswords.com') {
    if (!/^\/range\/[0-9a-f]{5}$/i.test(url.pathname)) throw new Error('Unexpected password-range fixture request')
    return Promise.resolve(new Response('00000000000000000000000000000000000:0\r\n', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }))
  }
  return originalFetch(input, init)
}
