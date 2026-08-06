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
import { api } from '@/lib/api'

import { LEADERBOARD_BASE, MUTATION_HEADERS } from './constants'
import type {
  ExcludedUsers,
  LeaderboardMe,
  LeaderboardPeriod,
  LeaderboardResponse,
  RenameCardAdminView,
  RenameCardPurchaseRequest,
  RenameCardPurchaseResult,
  TierBoardPayload,
  UpdateMeRequest,
  UsageBoardPayload,
} from './types'

// ----------------------------------------------------------------------------
// Leaderboard APIs
// ----------------------------------------------------------------------------
//
// These hit the companion leaderboard service, not New API itself. Requests go
// through the shared `api` instance so they inherit the bearer token and the
// 401 refresh-and-retry behaviour; the service validates that token against
// New API's /api/user/self.

export async function getUsageBoard(
  period: LeaderboardPeriod
): Promise<UsageBoardPayload> {
  const res = await api.get<LeaderboardResponse<UsageBoardPayload>>(
    `${LEADERBOARD_BASE}/leaderboard`,
    { params: { period } }
  )
  return res.data.data
}

export async function getTierBoard(): Promise<TierBoardPayload> {
  const res = await api.get<LeaderboardResponse<TierBoardPayload>>(
    `${LEADERBOARD_BASE}/ranks`
  )
  return res.data.data
}

export async function getLeaderboardMe(): Promise<LeaderboardMe> {
  const res = await api.get<LeaderboardResponse<LeaderboardMe>>(
    `${LEADERBOARD_BASE}/me`
  )
  return res.data.data
}

export async function updateLeaderboardMe(
  body: UpdateMeRequest
): Promise<LeaderboardMe> {
  const res = await api.patch<LeaderboardResponse<LeaderboardMe>>(
    `${LEADERBOARD_BASE}/me`,
    body,
    { headers: MUTATION_HEADERS }
  )
  return res.data.data
}

/**
 * Buy rename cards.
 *
 * Error handling is deliberately opted out of the shared interceptors: the
 * service answers 202 with `success: true` when a charge is in flight but its
 * outcome is unknown, which the default handler would surface as success, and
 * its failure messages are Chinese strings that bypass i18n. Callers inspect
 * the thrown AxiosError's status and map it themselves.
 */
export async function buyRenameCards(
  body: RenameCardPurchaseRequest
): Promise<RenameCardPurchaseResult> {
  const res = await api.post<LeaderboardResponse<RenameCardPurchaseResult['order']>>(
    `${LEADERBOARD_BASE}/rename-cards`,
    body,
    {
      headers: MUTATION_HEADERS,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return { order: res.data.data, pending: res.status === 202 }
}

// ----------------------------------------------------------------------------
// Admin
// ----------------------------------------------------------------------------

export async function getExcludedUsers(): Promise<ExcludedUsers> {
  const res = await api.get<LeaderboardResponse<ExcludedUsers>>(
    `${LEADERBOARD_BASE}/admin/excluded-users`
  )
  return res.data.data
}

export async function updateExcludedUsers(
  userIds: number[]
): Promise<ExcludedUsers> {
  const res = await api.put<LeaderboardResponse<ExcludedUsers>>(
    `${LEADERBOARD_BASE}/admin/excluded-users`,
    { userIds },
    { headers: MUTATION_HEADERS }
  )
  return res.data.data
}

/** Root only. Every rename card order plus every rename it paid for. */
export async function getRenameCardAdminView(): Promise<RenameCardAdminView> {
  const res = await api.get<LeaderboardResponse<RenameCardAdminView>>(
    `${LEADERBOARD_BASE}/admin/rename-cards`
  )
  return res.data.data
}
