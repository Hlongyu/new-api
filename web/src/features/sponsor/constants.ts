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
import type { SponsorOrderStatus } from './types'

export const SPONSOR_MESSAGE_MAX_LENGTH = 80

/** Rows shown before the history collapses. */
export const SPONSOR_HISTORY_LIMIT = 8

/** Rows the root panel shows before offering to expand. */
export const SPONSOR_ADMIN_PAGE_SIZE = 10

/**
 * Charge failures mapped to i18n keys. Looked up dynamically via `t(...)`, so
 * every value is registered in i18n/static-keys.ts.
 */
export const SPONSOR_ERROR_KEY: Record<number, string> = {
  400: 'Insufficient balance or amount out of range',
  403: 'Sponsorship request was rejected',
  409: 'That request number is already in use',
  429: 'Too many requests. Please try again later.',
  502: 'Sponsorship failed',
  503: 'Automatic charging is not configured.',
}

/** Codes after which replaying the same request key is pointless. */
export const SPONSOR_TERMINAL_STATUSES = [400, 403, 409, 503] as const

/** Status pill tone per order state. Values are i18n keys. */
export const SPONSOR_STATUS_LABEL_KEY: Record<SponsorOrderStatus, string> = {
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  unknown: 'Needs review',
}
