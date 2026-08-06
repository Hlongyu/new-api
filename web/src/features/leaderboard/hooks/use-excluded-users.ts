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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getExcludedUsers, updateExcludedUsers } from '../api'
import { LEADERBOARD_ME_STALE_TIME } from '../constants'

const EXCLUDED_KEY = ['leaderboard', 'excluded-users'] as const

/** Root-only. Guard the call site on `me.isRoot` to avoid a certain 403. */
export function useExcludedUsers(enabled: boolean) {
  return useQuery({
    queryKey: EXCLUDED_KEY,
    queryFn: getExcludedUsers,
    staleTime: LEADERBOARD_ME_STALE_TIME,
    enabled,
    retry: false,
  })
}

export function useUpdateExcludedUsers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userIds: number[]) => updateExcludedUsers(userIds),
    onSuccess: (data) => {
      queryClient.setQueryData(EXCLUDED_KEY, data)
      // Blocking a member removes them from every board and shifts the ranks
      // and totals of everyone below them, so no cached board survives this.
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'usage'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'ranks'] })
    },
  })
}
