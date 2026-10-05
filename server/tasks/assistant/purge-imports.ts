import { purgeImportSources } from '#server/features/assistant'

/** Runs even with imports disabled: expired/discarded bytes must still be removed. */
export default defineTask({
  meta: { name: 'assistant:purge-imports', description: 'Delete expired private import sources and retry storage cleanup' },
  async run() {
    const result = await purgeImportSources(useDb(), blob)
    if (result.deleted || result.pending) log(result.pending ? 'warn' : 'info', 'Private import cleanup', result)
    return { result }
  },
})
