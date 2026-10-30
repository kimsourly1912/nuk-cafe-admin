import { WorkflowEntrypoint } from 'cloudflare:workers'
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import { NonRetryableError } from 'cloudflare:workflows'
import { AwsClient } from 'aws4fetch'
import { backupKeys, cambodiaDate, downloadDump, encryptDump, exportedDump, failureText, missingSettings, PermanentError, sendOps, startExport, storeCopy, successText } from './backup'
import type { BackupEnv, StoredBackup } from './backup'

/**
 * The backup Worker (D225), deployed separately from the app as `angder-backup`. Its Workflow runs
 * every night at 03:17 Cambodia time (cafes are closed) from the binding's schedule, so nothing
 * depends on GitHub. Each step retries on its own, except on a failure no retry can fix (a
 * `PermanentError`, D227: a refused token or key, a missing bucket), which ends it at once; either way
 * the ops chat is told and the run ends failed (Workers & Pages → Workflows → angder-backup). A run started with
 * `{"report": true}` (the deploy workflow's test run) also says when it succeeds; scheduled runs
 * only do on Mondays. No public address: its own answers 404.
 */

interface Params {
  report?: boolean
}

/**
 * A step's work; a `PermanentError` becomes the Workflow's `NonRetryableError`, which skips the
 * step's remaining retries (D227). Its message reaches the ops chat through the
 * `workflows_preserve_non_retryable_error_message` flag in wrangler.jsonc.
 */
async function failFastOnPermanent<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  }
  catch (error) {
    // No name argument: the engine recognises the error by its name, `NonRetryableError`.
    if (error instanceof PermanentError) throw new NonRetryableError(error.message)
    throw error
  }
}

export class BackupWorkflow extends WorkflowEntrypoint<BackupEnv, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<StoredBackup> {
    const env = this.env
    const startedAt = event.timestamp.getTime()
    let backup: StoredBackup
    try {
      const missing = missingSettings(env)
      if (missing.length > 0) throw new Error(`Settings not set: ${missing.join(', ')}`)

      const bookmark = await step.do('start the export', { retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, () => failFastOnPermanent(() => startExport(fetch, env)))

      // One step from download to upload: the dump never leaves memory unencrypted, and a step
      // can't hand a dump to the next one (its result is kept, and limited to 1 MiB). A retry
      // repeats it all and keeps whatever copy was already stored.
      backup = await step.do('store the encrypted copy', { retries: { limit: 10, delay: '30 seconds', backoff: 'exponential' }, timeout: '10 minutes' }, () => failFastOnPermanent(async () => {
        const url = await exportedDump(fetch, env, bookmark)
        if (!url) throw new Error('The export isn\'t ready yet')
        const encrypted = await encryptDump(await downloadDump(fetch, url), env.BACKUP_AGE_RECIPIENTS!)
        const r2 = new AwsClient({ accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID!, secretAccessKey: env.BACKUP_R2_SECRET_ACCESS_KEY!, service: 's3', region: 'auto' })
        const keys = backupKeys(startedAt)
        const results: StoredBackup['results'] = []
        for (const key of keys) results.push(await storeCopy((url, init) => r2.fetch(url, init), env, key, encrypted))
        return { keys, bytes: encrypted.byteLength, results }
      }))
    }
    catch (error) {
      console.error('Backup: failed', { error: String(error) })
      if (env.OPS_TELEGRAM_BOT_TOKEN && env.OPS_TELEGRAM_CHAT_ID) {
        await step.do('tell the ops chat it failed', { retries: { limit: 5, delay: '1 minute', backoff: 'exponential' } }, () => sendOps(fetch, env, failureText(error, startedAt)))
      }
      throw error
    }
    console.log('Backup: stored', backup)

    // After the try: the copy is stored, so a message Telegram won't take must not read as a failed backup.
    const weekly = cambodiaDate(startedAt).weekday === 1
    if (event.payload?.report || weekly) {
      await step.do('tell the ops chat it worked', { retries: { limit: 5, delay: '1 minute', backoff: 'exponential' } }, () => sendOps(fetch, env, successText(backup, weekly && !event.payload?.report)))
    }
    return backup
  }
}

export default {
  fetch: (): Response => new Response('Not found', { status: 404 }),
}
