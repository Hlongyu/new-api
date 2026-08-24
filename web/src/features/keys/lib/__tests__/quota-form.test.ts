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

import { apiKeySchema } from '../../types'
import {
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from '../api-key-form'

const t = ((key: string) => key) as TFunction

describe('API key rate-limit form', () => {
  test('submits disabled rate limits as zero', () => {
    const payload = transformFormDataToPayload(
      getApiKeyFormDefaultValues(false)
    )

    assert.equal(payload.five_hour_quota, 0)
    assert.equal(payload.daily_quota, 0)
    assert.equal(payload.weekly_quota, 0)
  })

  test('rejects a negative periodic limit', () => {
    const result = getApiKeyFormSchema(t).safeParse({
      ...getApiKeyFormDefaultValues(false),
      name: 'limited key',
      daily_quota_dollars: -1,
    })

    assert.equal(result.success, false)
    if (result.success) return
    assert.deepEqual(result.error.issues[0]?.path, ['daily_quota_dollars'])
  })

  test('maps legacy responses to disabled rate limits', () => {
    const apiKey = apiKeySchema.parse({
      id: 1,
      name: 'legacy',
      key: 'sk-legacy',
      status: 1,
      remain_quota: 0,
      used_quota: 0,
      unlimited_quota: true,
      expired_time: -1,
      created_time: 1,
      accessed_time: 1,
      group: 'default',
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
    })

    const defaults = transformApiKeyToFormDefaults(apiKey)
    assert.equal(defaults.five_hour_quota_dollars, 0)
    assert.equal(defaults.daily_quota_dollars, 0)
    assert.equal(defaults.weekly_quota_dollars, 0)
  })
})
