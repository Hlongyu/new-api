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
// ----------------------------------------------------------------------------
// Sponsorship types
// ----------------------------------------------------------------------------
//
// Sponsorships are served by the same companion service as the leaderboard,
// but they surface on the wallet page because they are a spend of New API
// quota, not a ranking concern.

export type SponsorOrderStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unknown'

export type SponsorOrder = {
  id: string
  amountCny: number
  quotaAmount: number
  message: string
  status: SponsorOrderStatus
  createdAt: number
  updatedAt: number
  completedAt: number
  errorMessage?: string
}

export type SponsorOrderRequest = {
  requestKey: string
  amountCny: number
  message: string
}

/**
 * Wraps the order with how the service answered.
 *
 * Unlike rename cards, a replayed sponsorship key answers 200 when the original
 * order settled and 202 when it is still in flight, so both are "already
 * submitted" rather than "charged again".
 */
export type SponsorOrderResult = {
  order: SponsorOrder
  /** True when the service is still resolving the charge (202). */
  pending: boolean
}

export type SponsorRules = {
  minAmount: number
  maxAmount: number
  quotaPerUnit: number
}

/** Any sponsorship seen from the root view, with its owner attached. */
export type SponsorAdminOrder = SponsorOrder & {
  userId: number
  displayName: string
}

export type SponsorAdminSummary = {
  totalAmountCny: number
  completedCount: number
  orderCount: number
}

export type SponsorAdminView = {
  summary: SponsorAdminSummary
  orders: SponsorAdminOrder[]
}

/** Slice of GET /api/app/status the wallet page needs. */
export type SponsorContext = {
  rules: SponsorRules
  userId: number
  isRoot: boolean
  balanceUsd: number
  history: SponsorOrder[]
}
