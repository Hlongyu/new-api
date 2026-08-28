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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Coupon } from '../../types'
import {
  couponRemainingSeconds,
  formatCouponRatio,
  getCouponRuntimeStatus,
} from '../coupon'

function couponFixture(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 1,
    user_id: 10,
    name: 'GPT Pro trial',
    applicable_group: 'gpt-pro',
    ratio_ppm: 100_000,
    issued_at: 100,
    activate_before: 200,
    active_duration_seconds: 3600,
    activated_at: 0,
    active_until: 0,
    status: 1,
    issuer_id: 20,
    revoker_id: 0,
    revoked_at: 0,
    issue_batch_id: 'batch',
    effective_status: 'available',
    ...overrides,
  }
}

describe('coupon presentation rules', () => {
  test('formats the persisted millionth ratio as an absolute multiplier', () => {
    assert.equal(formatCouponRatio(100_000), '0.1')
    assert.equal(formatCouponRatio(1_000_000), '1')
  })

  test('changes available and active coupons at their exact time boundaries', () => {
    const available = couponFixture()
    const active = couponFixture({
      effective_status: 'active',
      activated_at: 150,
      active_until: 250,
      status: 2,
    })

    assert.equal(getCouponRuntimeStatus(available, 199), 'available')
    assert.equal(getCouponRuntimeStatus(available, 200), 'expired')
    assert.equal(getCouponRuntimeStatus(active, 249), 'active')
    assert.equal(getCouponRuntimeStatus(active, 250), 'ended')
  })

  test('never displays a countdown longer than the coupon active duration', () => {
    const coupon = couponFixture({
      effective_status: 'active',
      active_duration_seconds: 3600,
      active_until: 5000,
    })

    assert.equal(couponRemainingSeconds(coupon, 1385), 3600)
    assert.equal(couponRemainingSeconds(coupon, 5000), 0)
  })
})
