import { recoverKhqrPayments, tenantBakongClient } from '#server/features/orders'

/**
 * Every minute (nuxt.config.ts → scheduled tasks): asks Bakong about QRs the counter stopped
 * checking (D266). A payment for an order still waiting is recorded; one the order can't take
 * becomes a review case for the cafe's owners. Each cafe's own token, opened for its QRs only.
 */
export default defineTask({
  meta: { name: 'orders:recover-khqr', description: 'Check KHQR payments with Bakong after the counter stops' },
  async run() {
    return runJob('orders:recover-khqr', async () => {
      const db = useDb()
      const setup = bakongSetup()
      const report = await recoverKhqrPayments(db, tenantId => tenantBakongClient(db, tenantId, setup))
      if (report.paid || report.reviews) log('info', 'KHQR payments recovered', { ...report })
      return { result: report }
    })
  },
})
