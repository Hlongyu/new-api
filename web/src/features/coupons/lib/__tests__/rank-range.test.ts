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

import {
  COUPON_RANK_OPTIONS,
  couponRankKeyFromStoredValue,
  couponRankPosition,
  isCouponRankKey,
} from '../rank-range'

describe('coupon rank range options', () => {
  test('orders major ranks from Iron through Challenger', () => {
    assert.equal(COUPON_RANK_OPTIONS.length, 9)
    assert.equal(COUPON_RANK_OPTIONS[0]?.value, 'iron')
    assert.equal(COUPON_RANK_OPTIONS.at(-1)?.value, 'challenger')
    assert.equal(couponRankPosition('gold'), 3)
  })

  test('rejects malformed rank keys', () => {
    assert.equal(isCouponRankKey('gold'), true)
    assert.equal(isCouponRankKey('gold:II'), false)
  })

  test('normalizes legacy division values for history display', () => {
    assert.equal(couponRankKeyFromStoredValue('iron:IV'), 'iron')
    assert.equal(couponRankKeyFromStoredValue('challenger'), 'challenger')
    assert.equal(couponRankKeyFromStoredValue('unknown:I'), undefined)
    assert.equal(couponRankKeyFromStoredValue(undefined), undefined)
  })
})
