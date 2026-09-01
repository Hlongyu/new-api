/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { PostpaidEventStatus, PostpaidGrantStatus } from './types'

/** Rows the root panel shows before offering to expand. */
export const POSTPAID_ADMIN_PAGE_SIZE = 10

/** Matches the service's own sync cadence; polling faster learns nothing. */
export const POSTPAID_POLL_INTERVAL_MS = 20 * 1000
export const POSTPAID_STALE_TIME_MS = 20 * 1000

/**
 * Apply failures mapped to i18n keys. Looked up dynamically via `t(...)`, so
 * every value is registered in i18n/static-keys.ts.
 *
 * 409 covers aggregate overdue credit, a pending request, changed available
 * credit, and request-key conflicts. The shared wording covers the actionable
 * cases without exposing backend messages that bypass i18n.
 */
export const POSTPAID_ERROR_KEY: Record<number, string> = {
  400: 'Requested amount is invalid or above your available credit',
  403: 'Credit request was rejected',
  409: 'Repay overdue credit in full before drawing again, or reload if another request is pending or your available credit changed.',
  429: 'Too many requests. Please try again later.',
  502: 'Credit could not be granted',
  503: 'Postpaid credit is not configured.',
}

/** Codes after which replaying the same request key is pointless. */
export const POSTPAID_TERMINAL_STATUSES = [400, 403, 409, 502, 503] as const

/**
 * Status pill copy per grant state. Values are i18n keys.
 *
 * `settled` says "Settled" rather than reusing the admin summary's "Repaid":
 * that tile is a running total of money returned, this is one grant's final
 * state, and a shared key would put "cumulative repaid" on a status badge.
 */
export const POSTPAID_GRANT_LABEL_KEY: Record<PostpaidGrantStatus, string> = {
  processing: 'Processing',
  active: 'In use',
  settled: 'Settled',
  overdue: 'Overdue',
  failed: 'Failed',
  unknown: 'Needs review',
}

/** Status pill copy per repayment state. Values are i18n keys. */
export const POSTPAID_EVENT_LABEL_KEY: Record<PostpaidEventStatus, string> = {
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  unknown: 'Needs review',
}
