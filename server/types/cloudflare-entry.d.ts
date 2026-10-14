/** Alias points to the preset entry captured by nuxt.config.ts, before our bounded wrapper. */
declare module '#nitro-cloudflare-entry' {
  const worker: Record<string, unknown> & { fetch: (request: Request, ...args: unknown[]) => Promise<Response> }
  export default worker
}
