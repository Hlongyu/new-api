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
import type {
  LeaderboardBoard,
  LeaderboardPeriod,
  RenameCostType,
  TierKey,
} from './types'

// ----------------------------------------------------------------------------
// Leaderboard constants
// ----------------------------------------------------------------------------

export const LEADERBOARD_BASE = '/leaderboard/api'

/**
 * The leaderboard service rejects writes that lack this header, and separately
 * requires the browser Origin to match its configured PUBLIC_URL.
 */
export const MUTATION_HEADERS = { 'X-Leaderboard-Request': '1' } as const

export const LEADERBOARD_BOARDS = {
  USAGE: 'usage',
  RANK: 'rank',
} as const

export const LEADERBOARD_PERIODS = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  ALL: 'all',
} as const

/** Board tabs. `labelKey` values are registered in i18n/static-keys.ts. */
export const BOARD_OPTIONS: { value: LeaderboardBoard; labelKey: string }[] = [
  { value: LEADERBOARD_BOARDS.USAGE, labelKey: 'Usage Board' },
  { value: LEADERBOARD_BOARDS.RANK, labelKey: 'Tier Board' },
]

export const PERIOD_OPTIONS: {
  value: LeaderboardPeriod
  labelKey: string
}[] = [
  { value: LEADERBOARD_PERIODS.DAY, labelKey: 'Today' },
  { value: LEADERBOARD_PERIODS.WEEK, labelKey: 'Week' },
  { value: LEADERBOARD_PERIODS.MONTH, labelKey: 'Month' },
  { value: LEADERBOARD_PERIODS.ALL, labelKey: 'All Time' },
]

/**
 * Badge filename prefix per tier. The asset files are named with pinyin while
 * the service reports tiers in Chinese, so this table is the bridge.
 */
export const TIER_BADGE_PREFIX: Record<TierKey, string> = {
  iron: '01-heitie',
  bronze: '02-qingtong',
  silver: '03-baiyin',
  gold: '04-huangjin',
  platinum: '05-bojin',
  diamond: '06-zuanshi',
  master: '07-dashi',
  grandmaster: '08-zongshi',
  challenger: '09-wangzhe',
}

/**
 * Board rows only carry the localised label (for example "黄金 I"), never a
 * `tierKey`. This maps the service's Chinese tier names back onto our keys.
 * It is data interchange, not UI copy, so it must not go through i18n.
 */
export const TIER_NAME_TO_KEY: Record<string, TierKey> = {
  黑铁: 'iron',
  青铜: 'bronze',
  白银: 'silver',
  黄金: 'gold',
  铂金: 'platinum',
  钻石: 'diamond',
  大师: 'master',
  宗师: 'grandmaster',
  王者: 'challenger',
}

/** Display names for tiers. Registered in i18n/static-keys.ts. */
export const TIER_LABEL_KEY: Record<TierKey, string> = {
  iron: 'Iron',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  master: 'Master',
  grandmaster: 'Grandmaster',
  challenger: 'Challenger',
}

export const DIVISION_SUFFIX: Record<string, string> = {
  IV: 'iv',
  III: 'iii',
  II: 'ii',
  I: 'i',
}

export const RENAME_CARD_MIN_QUANTITY = 1
export const RENAME_CARD_MAX_QUANTITY = 100
export const DISPLAY_NAME_MAX_LENGTH = 36

/** How many rows the podium lifts out of the table. */
export const PODIUM_SIZE = 3

export const LEADERBOARD_STALE_TIME = 60 * 1000
export const LEADERBOARD_ME_STALE_TIME = 30 * 1000

/**
 * Purchase failures mapped to i18n keys. Values are looked up dynamically via
 * `t(...)`, so every one of them is registered in i18n/static-keys.ts.
 */
export const RENAME_CARD_ERROR_KEY: Record<number, string> = {
  400: 'Insufficient balance',
  409: 'An order is already being processed. Please try again later.',
  429: 'Too many requests. Please try again later.',
  502: 'Charge failed',
  503: 'Automatic charging is not configured.',
}

/** Status codes after which retrying the same request key is pointless. */
export const RENAME_CARD_TERMINAL_STATUSES = [400, 403, 503] as const

/** Rows the root rename card panel shows before offering to expand. */
export const RENAME_ADMIN_PAGE_SIZE = 10

/** How a rename was paid for. Values are i18n keys. */
export const RENAME_COST_LABEL_KEY: Record<RenameCostType, string> = {
  free: 'Free rename',
  card: 'Rename card',
  unlimited: 'Unlimited',
}
