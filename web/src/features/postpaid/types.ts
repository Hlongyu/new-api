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
// Postpaid credit types
// ----------------------------------------------------------------------------
//
// Served by the same Core API as the leaderboard, but surfaced on the
// wallet page: a grant adds quota to the New API balance immediately, and the
// debt is collected back out of that balance when the user later redeems a
// top-up code. Both halves are wallet events, not ranking events.

export type PostpaidGrantStatus =
  | 'processing'
  | 'active'
  | 'settled'
  | 'overdue'
  | 'failed'
  | 'unknown'

export type PostpaidEventStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unknown'

/** One drawdown of credit. Amounts are in credit units, not raw quota. */
export type PostpaidGrant = {
  id: string
  /** Tier at the time of the grant; the limit is recomputed per request. */
  tierKey: string
  tierName: string
  creditAmount: number
  quotaAmount: number
  outstandingAmount: number
  status: PostpaidGrantStatus
  createdAt: number
  updatedAt: number
  /** Repayment deadline: the 15th of the following month, 23:59:59 local. */
  dueAt: number
  completedAt: number
  errorMessage?: string
}

/**
 * One repayment, triggered by a redemption code rather than by the user.
 *
 * Core creates this row in the same transaction that redeems the code, before
 * any remainder is credited to the wallet.
 */
export type PostpaidEvent = {
  id: string
  grantId: string
  type: 'repayment'
  redemptionId: number
  redemptionTime: number
  amount: number
  outstandingBefore: number
  outstandingAfter: number
  status: PostpaidEventStatus
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

/** Slice of GET /api/leaderboard/app/status the wallet card needs. */
export type PostpaidContext = {
  /** False only when quota loans are disabled by the Core deployment. */
  configured: boolean
  /** Scopes the idempotency key, so a key never crosses accounts. */
  userId: number
  /** Ceiling for this user, derived from their leaderboard tier. */
  creditLimit: number
  availableCredit: number
  outstandingAmount: number
  /** 0 when nothing is owed. */
  nextDueAt: number
  /** A grant is mid-flight; block further applications until it settles. */
  applicationPending: boolean
  canApply: boolean
  activeGrant: PostpaidGrant | null
  grants: PostpaidGrant[]
  events: PostpaidEvent[]
  isRoot: boolean
}

export type PostpaidApplyRequest = {
  requestKey: string
  amount: number
}

/**
 * Wraps the grant with how the service answered.
 *
 * 202 means the quota increase timed out against New API with an unknown
 * result — the user may or may not have been credited, so it must never be
 * auto-retried.
 */
export type PostpaidApplyResult = {
  grant: PostpaidGrant
  pending: boolean
}

/** Compatibility health fields for the Core settlement path. Root only. */
export type PostpaidSyncState = {
  configured: boolean
  running: boolean
  lastSyncAt: number
  /** Non-empty means repayments have stopped being collected. */
  lastSyncError: string
}

export type PostpaidAdminSummary = {
  grantCount: number
  userCount: number
  outstandingAmount: number
  overdueAmount: number
  grantedAmount: number
  repaidAmount: number
}

export type PostpaidAdminGrant = PostpaidGrant & {
  userId: number
  displayName: string
}

export type PostpaidAdminEvent = PostpaidEvent & {
  userId: number
  displayName: string
  tierName: string
}

export type PostpaidAdminView = {
  state: PostpaidSyncState
  summary: PostpaidAdminSummary
  grants: PostpaidAdminGrant[]
  events: PostpaidAdminEvent[]
}
