import * as v from 'valibot'
import { newPasswordSchema } from '#shared/contracts/identity'

/**
 * The customer's account forms (step 5.2, D97). The server checks the rest: an existing email, the
 * password against known breaches (Have I Been Pwned), the reset link.
 */
const emailSchema = v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter a valid email address'))

export const signInSchema = v.object({
  email: emailSchema,
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
})
export type SignInForm = v.InferOutput<typeof signInSchema>

export const NAME_MAX = 100

export const signUpSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required'), v.maxLength(NAME_MAX, `At most ${NAME_MAX} characters`)),
  email: emailSchema,
  password: v.pipe(v.string(), v.minLength(1, 'Password is required'), newPasswordSchema),
})
export type SignUpForm = v.InferOutput<typeof signUpSchema>

export const forgotPasswordSchema = v.object({ email: emailSchema })
export type ForgotPasswordForm = v.InferOutput<typeof forgotPasswordSchema>

export const resetPasswordSchema = v.object({
  password: v.pipe(v.string(), v.minLength(1, 'Password is required'), newPasswordSchema),
})
export type ResetPasswordForm = v.InferOutput<typeof resetPasswordSchema>
