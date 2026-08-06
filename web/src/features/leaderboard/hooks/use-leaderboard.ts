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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getTierBoard, getUsageBoard } from '../api'
import { LEADERBOARD_BOARDS, LEADERBOARD_STALE_TIME } from '../constants'
import type {
  LeaderboardBoard,
  LeaderboardPeriod,
  LeaderboardView,
} from '../types'

/**
 * Load whichever board is active.
 *
 * Both boards stay mounted as queries so switching tabs reads from cache, but
 * only the active one fetches. The two payloads disagree on where the member
 * count lives — top level for usage, nested under `totals` for tiers — so this
 * flattens them into a single view model rather than leaking that to the UI.
 */
export function useLeaderboard(
  board: LeaderboardBoard,
  period: LeaderboardPeriod
) {
  const isUsage = board === LEADERBOARD_BOARDS.USAGE

  const usageQuery = useQuery({
    queryKey: ['leaderboard', 'usage', period],
    queryFn: () => getUsageBoard(period),
    staleTime: LEADERBOARD_STALE_TIME,
    enabled: isUsage,
  })

  const tierQuery = useQuery({
    queryKey: ['leaderboard', 'ranks'],
    queryFn: getTierBoard,
    staleTime: LEADERBOARD_STALE_TIME,
    enabled: !isUsage,
  })

  const activeQuery = isUsage ? usageQuery : tierQuery

  const view = useMemo<LeaderboardView | null>(() => {
    if (isUsage) {
      const data = usageQuery.data
      if (!data) return null
      return {
        board: LEADERBOARD_BOARDS.USAGE,
        entries: data.entries,
        memberCount: data.memberCount,
        tokenUsed: data.totals.tokenUsed,
        requestCount: data.totals.requestCount,
        timeZone: data.timeZone,
        lastSyncAt: data.lastSyncAt,
      }
    }

    const data = tierQuery.data
    if (!data) return null
    return {
      board: LEADERBOARD_BOARDS.RANK,
      entries: data.entries,
      memberCount: data.totals.memberCount,
      tokenUsed: null,
      requestCount: null,
      timeZone: data.timeZone,
      lastSyncAt: data.lastSyncAt,
    }
  }, [isUsage, usageQuery.data, tierQuery.data])

  return {
    view,
    isLoading: activeQuery.isLoading,
    isFetching: activeQuery.isFetching,
    error: activeQuery.error,
    refetch: activeQuery.refetch,
  }
}
