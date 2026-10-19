import * as v from 'valibot'
import type { OwnerKind, TenantDetail, TenantNotes, TenantOwner, UpdateTenantNotesInput } from '#shared/contracts/tenants'
import { addOwnerSchema, NOTES_CONTACT_MAX, NOTES_TEXT_MAX } from '#shared/contracts/tenants'
import type { PhoneCountry } from '#shared/contracts/phone'
import { DEFAULT_PHONE_COUNTRY, parsePhone, PHONE_COUNTRIES } from '#shared/contracts/phone'

/**
 * A cafe's owners and notes in the console (step P2, D189). The owner dialogs (Add owner, Transfer
 * ownership) take the contract's schema, so they refuse exactly what the server would; the server
 * also checks who can own the cafe and keeps an owner who can sign in.
 */
export const ownerFormSchema = v.pick(addOwnerSchema, ['owner', 'reason'])

/** Both choices' fields stay, so switching between them loses nothing; the schema keeps the chosen one's. */
export interface OwnerForm {
  owner: { kind: OwnerKind, userId: string, name: string, email: string }
  reason: string
}

export const emptyOwnerForm = (): OwnerForm => ({ owner: { kind: 'existing', userId: '', name: '', email: '' }, reason: '' })

/** Owners other than this one who can sign in: without one, removing it would leave the cafe with none. */
export const othersCanSignIn = (cafe: Pick<TenantDetail, 'owners'>, owner: Pick<TenantOwner, 'id'>) =>
  cafe.owners.some(other => other.id !== owner.id && !other.banned)

/** What removing this owner leaves them here. */
export function removalLine(owner: Pick<TenantOwner, 'name' | 'staffAccess'>): string {
  return owner.staffAccess
    ? `${owner.name} keeps their branch roles here, without the owner's access.`
    : `${owner.name} has no access to this cafe afterwards.`
}

// --- Internal notes ---

export interface NotesForm {
  contactName: string
  /** As typed, for `contactPhoneCountry` (D127); sent as E.164. */
  contactPhone: string
  contactPhoneCountry: PhoneCountry
  notes: string
}

/** What's wrong with the phone, if anything: blank is fine (no phone). */
function phoneProblem(form: Pick<NotesForm, 'contactPhone' | 'contactPhoneCountry'>): string | undefined {
  if (!form.contactPhone.trim()) return undefined
  const result = parsePhone(form.contactPhone, form.contactPhoneCountry)
  return result.ok ? undefined : result.message
}

export const notesFormSchema = v.pipe(v.object({
  contactName: v.pipe(v.string(), v.trim(), v.maxLength(NOTES_CONTACT_MAX, `Max ${NOTES_CONTACT_MAX} characters`)),
  contactPhone: v.string(),
  contactPhoneCountry: v.picklist(PHONE_COUNTRIES.map(country => country.code)),
  notes: v.pipe(v.string(), v.trim(), v.maxLength(NOTES_TEXT_MAX, `Max ${NOTES_TEXT_MAX} characters`)),
}), v.forward(
  v.partialCheck([['contactPhone'], ['contactPhoneCountry']], form => !phoneProblem(form), issue => phoneProblem(issue.input as NotesForm) ?? ''),
  ['contactPhone'],
))

export function toNotesForm(notes: TenantNotes): NotesForm {
  const saved = notes.contactPhone ? parsePhone(notes.contactPhone) : undefined
  return {
    contactName: notes.contactName ?? '',
    contactPhone: saved?.ok ? saved.local : notes.contactPhone ?? '',
    contactPhoneCountry: saved?.ok ? saved.country : DEFAULT_PHONE_COUNTRY,
    notes: notes.notes ?? '',
  }
}

/** The notes as the API takes them, from the version they were based on: blanks are no value. */
export function toNotesBody(form: NotesForm, version: number): UpdateTenantNotesInput {
  const phone = form.contactPhone.trim()
  const parsed = phone ? parsePhone(phone, form.contactPhoneCountry) : undefined
  return {
    version,
    contactName: form.contactName.trim() || null,
    contactPhone: parsed ? (parsed.ok ? parsed.e164 : phone) : null,
    notes: form.notes.trim() || null,
  }
}
