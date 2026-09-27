import { purgeExpiredUploads } from '~~/server/features/media'

/** Hourly (nuxt.config.ts → scheduled tasks): deletes uploads no record has used for 24 hours. */
export default defineTask({
  meta: { name: 'media:purge-temporary', description: 'Delete uploads unused for 24 hours' },
  async run() {
    const report = await purgeExpiredUploads(useDb(), blob)
    for (const failure of report.objectErrors) log('warn', 'Upload row deleted, object not removed', failure)
    if (report.deleted || report.kept) log('info', 'Unused uploads purged', { deleted: report.deleted, kept: report.kept })
    return { result: { deleted: report.deleted, kept: report.kept, objectErrors: report.objectErrors.length } }
  },
})
