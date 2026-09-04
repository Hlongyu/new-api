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

export type CouponEffectiveStatus =
  | 'available'
  | 'active'
  | 'expired'
  | 'ended'
  | 'revoked'

export type CouponRecipientScope = 'selected' | 'all' | 'rank'

export interface Coupon {
  id: number
  user_id: number
  name: string
  applicable_group: string
  ratio_ppm: number
  issued_at: number
  activate_before: number
  active_duration_seconds: number
  activated_at: number
  active_until: number
  status: number
  issuer_id: number
  revoker_id: number
  revoked_at: number
  issue_batch_id: string
  recipient_scope: CouponRecipientScope | ''
  rank_min: string
  rank_max: string
  rpm_limit: number
  username?: string
  effective_status: CouponEffectiveStatus
}

export interface CouponApiResponse<T = unknown> {
  success: boolean
  message?: string
  code?: string
  data?: T
}

export interface IssueCouponsPayload {
  scope: CouponRecipientScope
  user_ids?: number[]
  rank_min?: string
  rank_max?: string
  name: string
  applicable_group: string
  ratio_ppm: number
  rpm_limit: number
  activate_before: number
  valid_for_seconds?: number
  active_duration_seconds: number
  idempotency_key: string
}

export interface CouponRankRecipientPreview {
  count: number
}

export interface IssueCouponsResult {
  items: Coupon[]
  issued_count: number
  issue_batch_id: string
}

export interface CouponPageData {
  items: Coupon[]
  total: number
  page: number
  page_size: number
}
