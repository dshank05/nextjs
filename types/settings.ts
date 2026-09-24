import type {
  staff,
  mechanic,
  warehouse,
  warehouse_racks,
  States,
  gst_tax_rate,
  bank_details,
  business_details,
  financial_year,
  user,
} from '@prisma/client'

import type { Pagination } from '../lib/api/list-query'

/**
 * One home for the shapes the settings screens exchange with the API.
 *
 * These are derived from Prisma's generated types rather than written out by
 * hand, because hand-written copies drift and this audit found three that had:
 *
 * - `states.tsx` declared `interface State { name, code: string, gstStateCode,
 *   capital, region, status }`. The real row is `{id, state_name, code: number}`
 *   and the table has no `status` column at all. The interface was unused, and
 *   the real shape was re-declared inline four times in the same file (S-31).
 * - `users.tsx` declared `auth_key`, `password_hash` and `password_reset_token`.
 *   The API's `select` deliberately excludes all three. Nothing leaked, but the
 *   type said it did, which cost this audit a wrong finding before the handler
 *   was read (S-27).
 * - `financialyear.tsx` exports a `status` column that the model does not have,
 *   so the export emits a permanently blank column (S-60).
 *
 * Deriving from `@prisma/client` makes all three impossible: if a column is
 * renamed or dropped, the build fails here instead of the screen quietly
 * showing nothing.
 */

/** What a list endpoint returns. `data` is canonical; see `listResponse`. */
export interface Paginated<T> {
  data: T[]
  pagination: Pagination
}

/** What a create or update returns. */
export interface Mutated<T> {
  status: 'success'
  message: string
  data: T
}

export interface ApiError {
  message: string
}

/* ------------------------------------------------------------------ rows */

export type StaffRow = staff
export type MechanicRow = mechanic
export type WarehouseRow = warehouse
export type StateRow = States
export type GstRateRow = gst_tax_rate
export type BankAccountRow = bank_details
export type BusinessDetailsRow = business_details
export type FinancialYearRow = financial_year

/** A rack as the list endpoint returns it, with its warehouse joined in. */
export type RackRow = warehouse_racks & {
  warehouse?: Pick<warehouse, 'name' | 'location'> | null
}

/**
 * A user as the API actually returns it.
 *
 * `Omit` rather than a hand-written interface, so that if a credential column is
 * ever added to the model it is excluded here by construction rather than by
 * somebody remembering to leave it out of a `select`.
 */
export type UserRow = Omit<user, 'auth_key' | 'password_hash' | 'password_reset_token'>

/* -------------------------------------------------------------- statuses */

/**
 * `Active` / `Inactive` for every settings resource that has a status column -
 * except `user`, which stores 10 and 0.
 *
 * That difference is why a user could not be deactivated: `parseInt("0") || 10`
 * treats the falsy 0 as "not supplied" and writes 10 (S-25). The constants are
 * named here so the next person meets the oddity instead of the literal.
 */
export type RecordStatus = 'Active' | 'Inactive'

export const USER_STATUS_ACTIVE = 10
export const USER_STATUS_INACTIVE = 0

export function isRecordStatus(value: unknown): value is RecordStatus {
  return value === 'Active' || value === 'Inactive'
}

export function userStatusLabel(status: number): RecordStatus {
  return status === USER_STATUS_ACTIVE ? 'Active' : 'Inactive'
}
