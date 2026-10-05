import type { CloudflareAiBinding } from '#server/features/assistant'

/** Nitro 2 exposes platform bindings on the request context; Node/local requests may omit them. */
declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      env?: { AI?: CloudflareAiBinding }
    }
  }
}
