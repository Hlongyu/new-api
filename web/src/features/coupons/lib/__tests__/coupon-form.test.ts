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

import type { TFunction } from 'i18next'

import {
  createCouponFormDefaults,
  getCouponFormSchema,
  toCouponActivationDeadline,
} from '../coupon-form'

const t = ((key: string) => key) as TFunction

describe('coupon form validation', () => {
  test('accepts unlimited RPM and rejects values above the supported limit', () => {
    const now = new Date(2026, 8, 4, 10, 30)
    const schema = getCouponFormSchema(t, now.getTime())
    const validValues = {
      ...createCouponFormDefaults(now),
      name: 'Trial',
      applicableGroup: 'default',
    }
    assert.equal(schema.safeParse(validValues).success, true)
    assert.equal(
      schema.safeParse({ ...validValues, rpmLimit: 60_001 }).success,
      false
    )
  })

  test('normalizes the activation deadline to the end of the selected day', () => {
    const deadline = toCouponActivationDeadline(
      new Date(2026, 8, 10, 8, 15, 30)
    )

    assert.equal(deadline.getHours(), 23)
    assert.equal(deadline.getMinutes(), 59)
    assert.equal(deadline.getSeconds(), 59)
  })

  test('rejects past deadlines and fractional active minutes', () => {
    const now = new Date(2026, 8, 4, 10, 30)
    const schema = getCouponFormSchema(t, now.getTime())
    const validValues = {
      ...createCouponFormDefaults(now),
      name: 'Trial',
      applicableGroup: 'default',
    }

    assert.equal(
      schema.safeParse({
        ...validValues,
        activationDeadline: new Date(now.getTime() - 1),
      }).success,
      false
    )
    assert.equal(
      schema.safeParse({ ...validValues, activeDurationMinutes: 1.5 }).success,
      false
    )
  })
})
