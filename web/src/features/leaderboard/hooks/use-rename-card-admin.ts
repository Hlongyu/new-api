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

import { getRenameCardAdminView } from '../api'
import { LEADERBOARD_ME_STALE_TIME } from '../constants'

/** Root-only. Guard the call site on `me.isRoot` to avoid a certain 403. */
export function useRenameCardAdminView(enabled: boolean) {
  return useQuery({
    queryKey: ['leaderboard', 'rename-card-admin'],
    queryFn: getRenameCardAdminView,
    staleTime: LEADERBOARD_ME_STALE_TIME,
    enabled,
    retry: false,
  })
}
