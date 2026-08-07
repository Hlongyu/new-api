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
  LotteryDraw,
  LotteryDrawResult,
  LotteryPayload,
  LotteryResolution,
} from './types'

export async function getLottery(): Promise<LotteryPayload> {
  const response = await api.get<LeaderboardResponse<LotteryPayload>>(
    `${LEADERBOARD_BASE}/lottery`,
    { skipErrorHandler: true }
  )
  return response.data.data
}

export async function drawLottery(): Promise<LotteryDrawResult> {
  const response = await api.post<LeaderboardResponse<LotteryDraw>>(
    `${LEADERBOARD_BASE}/lottery/draw`,
    {},
    {
      headers: MUTATION_HEADERS,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return { draw: response.data.data, pending: response.status === 202 }
}

export async function resolveLotteryDraw(
  id: string,
  resolution: LotteryResolution
): Promise<LotteryDraw> {
  const response = await api.patch<LeaderboardResponse<LotteryDraw>>(
    `${LEADERBOARD_BASE}/admin/lottery/${encodeURIComponent(id)}`,
    { resolution },
    {
      headers: MUTATION_HEADERS,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  return response.data.data
}
