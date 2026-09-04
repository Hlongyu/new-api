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
import { TIER_LABEL_KEY } from '@/features/leaderboard/constants'
import type { TierKey } from '@/features/leaderboard/types'

export type CouponRankKey = TierKey

const TIER_ORDER: TierKey[] = [
  'iron',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'master',
  'grandmaster',
  'challenger',
]
export const COUPON_RANK_OPTIONS = TIER_ORDER.map((tierKey) => ({
  value: tierKey,
  tierLabelKey: TIER_LABEL_KEY[tierKey],
}))

const COUPON_RANK_POSITIONS = new Map(
  COUPON_RANK_OPTIONS.map((option, index) => [option.value, index])
)

export function isCouponRankKey(value: string): value is CouponRankKey {
  return COUPON_RANK_POSITIONS.has(value as CouponRankKey)
}

export function couponRankPosition(value: CouponRankKey): number {
  return COUPON_RANK_POSITIONS.get(value) ?? -1
}
