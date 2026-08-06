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
// ----------------------------------------------------------------------------
// Leaderboard types
// ----------------------------------------------------------------------------
//
// Mirrors the payloads served by the companion leaderboard service mounted at
// /leaderboard. That service is deployed separately from New API, so these
// types are the only contract we hold — keep them in sync with its handlers.

/** Usage board periods. Note these differ from the built-in rankings page. */
export type LeaderboardPeriod = 'day' | 'week' | 'month' | 'all'

/** Which board is being shown. The tier board has no period dimension. */
export type LeaderboardBoard = 'usage' | 'rank'

export type TierKey =
  | 'iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'grandmaster'
  | 'challenger'

export type TierDivision = 'IV' | 'III' | 'II' | 'I'

/**
 * A single row of either board.
 *
 * `participating` and `excluded` are intentionally absent: the service deletes
 * both before serialising, so they are never present on the wire.
 */
export type LeaderboardEntry = {
  id: number
  displayName: string
  /** Localised tier text such as "黄金 I". Entries never carry `tierKey`. */
  rankLabel?: string | null
  /** Absent on legacy rows; treat only an explicit `false` as opt-out. */
  showRankBadge?: boolean
  updatedAt?: number
  /** Present on usage board rows. */
  tokenUsed?: number
  requestCount?: number
  /** Present on ranked rows only — excluded entries carry no rank. */
  rank?: number
  /** Sponsorship is out of scope for now but still arrives on the wire. */
  sponsorBadge?: { key: string; name: string } | null
  isSponsor?: boolean
}

export type UsageBoardPayload = {
  period: LeaderboardPeriod
  periodKey: string
  timeZone: string
  entries: LeaderboardEntry[]
  /** Top level here, unlike the tier board where it sits under `totals`. */
  memberCount: number
  totals: { tokenUsed: number; requestCount: number }
  /** 0 means the service has never completed a sync. */
  lastSyncAt: number
}

export type TierBoardPayload = {
  timeZone: string
  entries: LeaderboardEntry[]
  /** Nested, and there is no `tokenUsed`/`requestCount` on this board. */
  totals: { memberCount: number }
  lastSyncAt: number
}

/** Board data after both payload shapes are flattened into one view model. */
export type LeaderboardView = {
  board: LeaderboardBoard
  entries: LeaderboardEntry[]
  memberCount: number
  tokenUsed: number | null
  requestCount: number | null
  timeZone: string
  lastSyncAt: number
}

export type LeaderboardVisibility = {
  participateDay: boolean
  participateWeek: boolean
  participateMonth: boolean
  participateAll: boolean
  participateRank: boolean
  showRankBadge: boolean
}

export type LeaderboardMeEntry = {
  displayName: string
  currentName: string
  anonymousName: string
  isNamePublic: boolean
  visibility: LeaderboardVisibility
}

export type RenameInfo = {
  periodKey: string
  freeAvailable: boolean
  freeUsed: boolean
  cardBalance: number
  cardPriceCny: number
}

/** Only present while the user is inside a promotion series. */
export type TierPromotion = {
  targetTierKey: TierKey
  targetTierName: string
  windowDays: number
  requiredDays: number
  activeScoreRequired: number
  checkedDays: number
  activeDays: number
  todayScore: number
  todayRequiredRemaining: number
  todayCounts: boolean
}

export type RankProgress = {
  tierKey: TierKey
  tierName: string
  tierIndex: number
  division: TierDivision
  divisionIndex: number
  label: string
  score: number
  segmentScore: number
  pendingScore: number
  tokenScore: number
  renameScore: number
  sponsorScore: number
  totalScore: number
  rankValue: number
  /** `null` is the common case — only non-null during a promotion series. */
  promotion: TierPromotion | null
}

export type LeaderboardMe = {
  id: number
  username: string
  identityName: string
  quota: number
  balanceUsd: number
  isRoot: boolean
  entry: LeaderboardMeEntry
  rename: RenameInfo
  rankProgress: RankProgress
}

export type UpdateMeRequest = {
  displayName?: string
  isNamePublic?: boolean
  /**
   * Per-board switches. Never send the service's batch `participating` flag —
   * it overwrites every switch at once and would silently discard the user's
   * individual choices.
   */
  visibility?: Partial<LeaderboardVisibility>
}

export type RenameCardOrderStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'unknown'

export type RenameCardOrder = {
  id: string
  quantity: number
  amountCny: number
  quotaAmount: number
  status: RenameCardOrderStatus
  createdAt: number
  updatedAt: number
  completedAt: number
  errorMessage?: string
}

export type RenameCardPurchaseRequest = {
  requestKey: string
  quantity: number
}

/** Wraps the order with how the service answered, so the UI can react. */
export type RenameCardPurchaseResult = {
  order: RenameCardOrder
  /** 202 means the charge outcome is unresolved; never auto-retry it. */
  pending: boolean
}

/** Root-only blocklist of members kept off every board. */
export type ExcludedUsers = {
  userIds: number[]
}

/**
 * How a rename was paid for.
 *
 * `unlimited` is historical only: nobody is exempt any more, but events
 * recorded under the old root/blocked exemption still carry it.
 */
export type RenameCostType = 'free' | 'card' | 'unlimited'

/** A rename card order seen from the root view, with its buyer attached. */
export type RenameCardAdminOrder = RenameCardOrder & {
  userId: number
  displayName: string
}

/** One name change, and what it cost the member. */
export type RenameEvent = {
  id: string
  userId: number
  oldName: string
  newName: string
  costType: RenameCostType
  createdAt: number
}

/**
 * Sales and spends in one rollup.
 *
 * `cardsSold - cardRenameCount` should equal `outstandingCards`; a mismatch
 * means cards were granted or consumed outside the purchase flow.
 */
export type RenameCardAdminSummary = {
  orderCount: number
  completedCount: number
  cardsSold: number
  totalAmountCny: number
  /** Paid-for cards not yet spent — what the service still owes members. */
  outstandingCards: number
  renameCount: number
  cardRenameCount: number
  freeRenameCount: number
}

export type RenameCardAdminView = {
  summary: RenameCardAdminSummary
  orders: RenameCardAdminOrder[]
  events: RenameEvent[]
}

/** Standard response envelope used by the leaderboard service. */
export type LeaderboardResponse<T> = {
  success: boolean
  message?: string
  data: T
}
