import worker from '#nitro-cloudflare-entry'
import { boundedWorkerRequest } from '#server/utils/worker-body'

/** Preserve Nitro's assets, scheduled, email, queue and websocket handlers. */
export default {
  ...worker,
  async fetch(request: Request, ...args: unknown[]) {
    const bounded = await boundedWorkerRequest(request)
    if (bounded instanceof Response) return bounded
    return worker.fetch(bounded, ...args)
  },
}
