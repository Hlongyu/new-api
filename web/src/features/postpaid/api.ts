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
import {
  LEADERBOARD_BASE,
  MUTATION_HEADERS,
} from '@/features/leaderboard/constants'
import type { LeaderboardResponse } from '@/features/leaderboard/types'
import { api } from '@/lib/api'

import type {
  PostpaidAdminView,
  PostpaidApplyRequest,
  PostpaidApplyResult,
  PostpaidContext,
  PostpaidEvent,
  PostpaidGrant,
} from './types'

/** Shape of GET /api/leaderboard/app/status for the quota-loan slice. */
type AppStatusPayload = {
  user: {
    id: number
    isRoot: boolean
    postpaid?: {
      configured: boolean
      creditLimit: number
      availableCredit: number
      outstandingAmount: number
      overdueAmount: number
      nextDueAt: number
      applicationPending: boolean
      canApply: boolean
      activeGrant: PostpaidGrant | null
      grants?: PostpaidGrant[]
      events?: PostpaidEvent[]
    }
  }
}

/**
 * Load the caller's credit standing.
 *
 * Shares an endpoint with sponsorship but not a query: the two cards mount
 * independently and a shared cache entry would couple their refetch cadences,
 * and postpaid polls while an application is in flight.
 */
export async function getPostpaidContext(): Promise<PostpaidContext | null> {
  const res = await api.get<LeaderboardResponse<AppStatusPayload>>(
    `${LEADERBOARD_BASE}/app/status`
  )
  const postpaid = res.data.data.user.postpaid
  // Older deployments omit the slice entirely.
  if (!postpaid) return null

  return {
    configured: postpaid.configured,
    userId: res.data.data.user.id,
    creditLimit: postpaid.creditLimit,
    availableCredit: postpaid.availableCredit,
    outstandingAmount: postpaid.outstandingAmount,
    overdueAmount: postpaid.overdueAmount ?? 0,
    nextDueAt: postpaid.nextDueAt,
    applicationPending: postpaid.applicationPending,
    canApply: postpaid.canApply,
    activeGrant: postpaid.activeGrant,
    grants: postpaid.grants ?? [],
    events: postpaid.events ?? [],
    isRoot: res.data.data.user.isRoot,
  }
}

/**
 * Draw down credit.
 *
 * Interceptors remain bypassed so callers retain the existing status-specific
 * handling and localized error mapping during the Core transition.
 */
export async function applyPostpaid(
  body: PostpaidApplyRequest
): Promise<PostpaidApplyResult> {
  const res = await api.post<LeaderboardResponse<PostpaidGrant>>(
    `${LEADERBOARD_BASE}/postpaid/apply`,
    body,
    {
      headers: MUTATION_HEADERS,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return { grant: res.data.data, pending: res.status === 202 }
}

/** Root only. Every grant and repayment, plus settlement health. */
export async function getPostpaidAdminView(): Promise<PostpaidAdminView> {
  const res = await api.get<LeaderboardResponse<PostpaidAdminView>>(
    `${LEADERBOARD_BASE}/admin/postpaid`
  )
  return res.data.data
}
