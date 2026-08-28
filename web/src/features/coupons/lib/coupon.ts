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
import type { TFunction } from 'i18next'

import type { Coupon, CouponEffectiveStatus } from '../types'

export function getCouponRuntimeStatus(
  coupon: Coupon,
  nowSeconds: number
): CouponEffectiveStatus {
  if (
    coupon.effective_status === 'active' &&
    coupon.active_until <= nowSeconds
  ) {
    return 'ended'
  }
  if (
    coupon.effective_status === 'available' &&
    coupon.activate_before <= nowSeconds
  ) {
    return 'expired'
  }
  return coupon.effective_status
}

export function formatCouponRatio(ratioPPM: number): string {
  return (ratioPPM / 1_000_000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

export function couponRemainingSeconds(
  coupon: Coupon,
  nowSeconds: number
): number {
  return Math.max(
    0,
    Math.min(coupon.active_until - nowSeconds, coupon.active_duration_seconds)
  )
}

export function formatCouponDuration(seconds: number, t: TFunction): string {
  if (seconds < 60 * 60) {
    return t('{{count}} minutes', {
      count: Math.max(1, Math.round(seconds / 60)),
    })
  }
  if (seconds < 24 * 60 * 60) {
    return t('{{count}} hours', {
      count: Math.max(1, Math.round(seconds / (60 * 60))),
    })
  }
  return t('{{count}} days', {
    count: Math.max(1, Math.round(seconds / (24 * 60 * 60))),
  })
}

export function formatCouponCountdown(seconds: number, t: TFunction): string {
  const remaining = Math.max(0, Math.floor(seconds))
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  const secs = remaining % 60
  if (days > 0) {
    return t('{{days}}d {{hours}}h {{minutes}}m', { days, hours, minutes })
  }
  return t('{{hours}}h {{minutes}}m {{seconds}}s', {
    hours,
    minutes,
    seconds: secs,
  })
}

export function couponErrorKey(code?: string): string {
  const keys: Record<string, string> = {
    coupon_not_found: 'Coupon not found',
    coupon_expired: 'This coupon can no longer be activated',
    coupon_already_activated: 'This coupon has already been activated',
    coupon_active_conflict: 'Another coupon is already active for this group',
    coupon_revoked: 'This coupon has been revoked',
    coupon_idempotency_conflict: 'The coupon issuance request is incomplete',
  }
  return keys[code || ''] || 'Coupon operation failed'
}

export function couponStatusLabel(status: CouponEffectiveStatus): string {
  const labels: Record<CouponEffectiveStatus, string> = {
    available: 'Available',
    active: 'Active',
    expired: 'Expired',
    ended: 'Ended',
    revoked: 'Revoked',
  }
  return labels[status]
}
