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

import { getLeaderboardMe, updateLeaderboardMe } from '../api'
import { LEADERBOARD_ME_STALE_TIME } from '../constants'
import type { LeaderboardMe, UpdateMeRequest } from '../types'

const ME_KEY = ['leaderboard', 'me'] as const

/** Personal panel data. Only fetched while the drawer is open. */
export function useLeaderboardMe(enabled: boolean) {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: getLeaderboardMe,
    staleTime: LEADERBOARD_ME_STALE_TIME,
    enabled,
  })
}

/**
 * Apply a personal settings change.
 *
 * Visibility switches are updated optimistically so toggling feels immediate;
 * renames are not, because they consume a free rename or a card and a rejected
 * rename must not leave the UI claiming the new name stuck.
 */
export function useUpdateLeaderboardMe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: UpdateMeRequest) => updateLeaderboardMe(body),
    onMutate: async (body) => {
      if (!body.visibility) return { previous: undefined }

      await queryClient.cancelQueries({ queryKey: ME_KEY })
      const previous = queryClient.getQueryData<LeaderboardMe>(ME_KEY)
      if (previous) {
        queryClient.setQueryData<LeaderboardMe>(ME_KEY, {
          ...previous,
          entry: {
            ...previous.entry,
            visibility: { ...previous.entry.visibility, ...body.visibility },
          },
        })
      }
      return { previous }
    },
    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(ME_KEY, context.previous)
      }
    },
    onSuccess: (data) => {
      // The service answers with the full personal payload, so trust it over
      // whatever the optimistic patch guessed.
      queryClient.setQueryData(ME_KEY, data)
      // A rename or a visibility change alters how this user appears on every
      // board, so drop the cached boards too.
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'usage'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'ranks'] })
    },
  })
}
