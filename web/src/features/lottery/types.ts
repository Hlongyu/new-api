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
export type LotteryDrawStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unknown'

export type LotteryPrize = {
  amountUsd: number
  weight: number
}

export type LotteryDraw = {
  id?: string
  ruleVersion?: number
  periodKey?: string
  rank?: number
  amountUsd: number
  quotaAmount?: number
  status: LotteryDrawStatus
  displayName?: string
  createdAt?: number
  updatedAt?: number
  completedAt: number
  errorMessage?: string
}

export type LotteryOpportunity = {
  periodKey: string
  weekStart: number
  weekEnd: number
  rank: number
  displayName: string
  tokenUsed?: number
  quota?: number
  amountUsd?: number
  requestCount?: number
  isMe: boolean
  draw: Pick<LotteryDraw, 'status' | 'amountUsd' | 'completedAt'> | null
}

export type LotteryNextDraw = {
  periodKey: string
  weekStart: number
  weekEnd: number
  rank: number
  prizes: LotteryPrize[]
  draw: LotteryDraw | null
}

export type LotteryAdminIssue = LotteryDraw & {
  id: string
  userId: number
  userName: string
}

export type LotteryWeeklyHistory = {
  periodKey: string
  weekStart: number
  weekEnd: number
  winners: LotteryOpportunity[]
}

export type LotteryPayload = {
  enabled: boolean
  configured: boolean
  isRoot: boolean
  ruleVersion: number
  periodKey: string
  weekStart: number
  weekEnd: number
  timeZone: string
  prizesByRank: LotteryPrize[][]
  winners: LotteryOpportunity[]
  opportunities: LotteryOpportunity[]
  pendingOpportunities: number
  me: {
    periodKey: string
    rank: number
    prizes: LotteryPrize[]
    canDraw: boolean
    draw: LotteryDraw | null
  } | null
  nextDraw: LotteryNextDraw | null
  canDraw: boolean
  weeklyHistory: LotteryWeeklyHistory[]
  adminIssues?: LotteryAdminIssue[]
}

export type LotteryDrawResult = {
  draw: LotteryDraw
  pending: boolean
}

export type LotteryResolution = 'completed' | 'failed'
