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

import { parseQuotaFromDollars } from '@/lib/format'

import {
  createCustomSubscriptionFormDefaults,
  customSubscriptionFormToPayload,
  getCustomSubscriptionFormSchema,
  parseCustomSubscriptionTimestamp,
} from '../custom-subscription-form'

const t = ((key: string) => key) as TFunction

describe('custom subscription form', () => {
  test('interprets an entered time in the selected IANA time zone', () => {
    const timestamp = parseCustomSubscriptionTimestamp(
      '2099-09-10T09:00',
      'Asia/Shanghai'
    )

    assert.equal(timestamp, Date.UTC(2099, 8, 10, 1, 0) / 1000)
  })

  test('rejects a refresh anchor outside the entitlement window', () => {
    const result = getCustomSubscriptionFormSchema(t).safeParse({
      ...createCustomSubscriptionFormDefaults(),
      start_time: '2099-09-10T09:00',
      end_time: '2099-10-10T09:00',
      reset_anchor_time: '2099-10-10T09:00',
      reset_timezone: 'Asia/Shanghai',
    })

    assert.equal(result.success, false)
    if (result.success) return
    assert.ok(
      result.error.issues.some((issue) => issue.path[0] === 'reset_anchor_time')
    )
  })

  test('clears refresh-only fields when refresh is disabled', () => {
    const payload = customSubscriptionFormToPayload({
      ...createCustomSubscriptionFormDefaults(),
      start_time: '2099-09-10T09:00',
      end_time: '2099-10-10T09:00',
      reset_interval_unit: 'never',
      reset_timezone: 'Asia/Shanghai',
      amount_total_dollars: 12.5,
    })

    assert.equal(payload.reset_interval_value, 0)
    assert.equal(payload.reset_anchor_time, 0)
    assert.equal(payload.reset_timezone, '')
    assert.equal(payload.amount_total, parseQuotaFromDollars(12.5))
  })
})
