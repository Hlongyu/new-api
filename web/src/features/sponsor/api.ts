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
  SponsorAdminView,
  SponsorContext,
  SponsorOrder,
  SponsorOrderRequest,
  SponsorOrderResult,
} from './types'

/** Shape of GET /api/leaderboard/app/status for the sponsorship slice. */
type AppStatusPayload = {
  sponsorRules: {
    minAmount: number
    maxAmount: number
    quotaPerUnit: number
  }
  user: {
    id: number
    isRoot: boolean
    balanceUsd: number
    sponsorships?: SponsorOrder[]
  }
}

/**
 * Load the sponsorship rules together with the caller's own context.
 *
 * The amount bounds live on /api/leaderboard/app/status rather than /me, and that
 * endpoint returns the full personal payload too, so one request covers the
 * rules, the balance and the order history.
 */
export async function getSponsorContext(): Promise<SponsorContext> {
  const res = await api.get<LeaderboardResponse<AppStatusPayload>>(
    `${LEADERBOARD_BASE}/app/status`
  )
  const data = res.data.data
  return {
    rules: data.sponsorRules,
    userId: data.user.id,
    isRoot: data.user.isRoot,
    balanceUsd: data.user.balanceUsd,
    history: data.user.sponsorships ?? [],
  }
}

/**
 * Submit a sponsorship.
 *
 * Interceptors remain bypassed so callers retain the existing status-specific
 * handling and localized error mapping during the Core transition.
 */
export async function createSponsorOrder(
  body: SponsorOrderRequest
): Promise<SponsorOrderResult> {
  const res = await api.post<LeaderboardResponse<SponsorOrder>>(
    `${LEADERBOARD_BASE}/sponsors`,
    body,
    {
      headers: MUTATION_HEADERS,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return { order: res.data.data, pending: res.status === 202 }
}

/** Root only. Every sponsorship plus a rollup of the settled ones. */
export async function getSponsorAdminView(): Promise<SponsorAdminView> {
  const res = await api.get<LeaderboardResponse<SponsorAdminView>>(
    `${LEADERBOARD_BASE}/admin/sponsors`
  )
  return res.data.data
}
