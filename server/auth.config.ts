import { defineServerAuth } from '@nuxtjs/better-auth/config'

export default defineServerAuth({
  emailAndPassword: { enabled: true },
  // A Worker instance's memory is not shared with other instances.
  rateLimit: { storage: 'database' },
})
