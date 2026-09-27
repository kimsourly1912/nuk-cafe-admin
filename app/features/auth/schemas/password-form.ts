import * as v from 'valibot'
import { newPasswordSchema } from '#shared/contracts/identity'

/**
 * Change password (D52). The server checks the current password, the length and breached
 * passwords (Have I Been Pwned); here: the length, and that the two new entries match and differ
 * from the current one.
 */
export const passwordFormSchema = v.pipe(
  v.object({
    currentPassword: v.pipe(v.string(), v.minLength(1, 'Current password is required')),
    newPassword: v.pipe(v.string(), v.minLength(1, 'New password is required'), newPasswordSchema),
    confirmPassword: v.pipe(v.string(), v.minLength(1, 'Repeat the new password')),
  }),
  v.forward(v.partialCheck(
    [['newPassword'], ['confirmPassword']],
    form => !form.confirmPassword || form.newPassword === form.confirmPassword,
    'The passwords don\'t match',
  ), ['confirmPassword']),
  v.forward(v.partialCheck(
    [['currentPassword'], ['newPassword']],
    form => !form.newPassword || form.newPassword !== form.currentPassword,
    'Choose a password different from the current one',
  ), ['newPassword']),
)

export type PasswordForm = v.InferOutput<typeof passwordFormSchema>

export const emptyPasswordForm = (): PasswordForm => ({ currentPassword: '', newPassword: '', confirmPassword: '' })
