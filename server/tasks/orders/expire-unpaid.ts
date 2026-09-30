import { expireUnpaidOrders } from '~~/server/features/orders'

/** Every minute (nuxt.config.ts → scheduled tasks): cancels orders still unpaid after 30 minutes (D104). */
export default defineTask({
  meta: { name: 'orders:expire-unpaid', description: 'Cancel orders unpaid after 30 minutes' },
  async run() {
    const report = await expireUnpaidOrders(useDb())
    if (report.expired || report.skipped) log('info', 'Unpaid orders expired', { ...report })
    return { result: report }
  },
})
