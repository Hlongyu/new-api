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

import { drawLottery, getLottery, resolveLotteryDraw } from './api'
import type { LotteryResolution } from './types'

export const LOTTERY_QUERY_KEY = ['lottery', 'weekly-top-three'] as const

export function useLottery() {
  return useQuery({
    queryKey: LOTTERY_QUERY_KEY,
    queryFn: getLottery,
    staleTime: 30 * 1000,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data
      const processing = data?.opportunities.some(
        (opportunity) => opportunity.draw?.status === 'processing'
      )
      return processing ? 5 * 1000 : false
    },
  })
}

export function useLotteryDraw(onAwarded?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: drawLottery,
    onSuccess: (result) => {
      if (result.draw.status === 'completed') onAwarded?.()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: LOTTERY_QUERY_KEY })
    },
  })
}

export function useLotteryResolution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; resolution: LotteryResolution }) =>
      resolveLotteryDraw(input.id, input.resolution),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: LOTTERY_QUERY_KEY })
    },
  })
}
