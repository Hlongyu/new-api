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
  emptyRequestLimitRule,
  parseUserRequestLimitForm,
  serializeUserRequestLimitForm,
  userRequestLimitFormSchema,
} from '../user-request-limit-form'

describe('user request limit configuration', () => {
  test('round trips separate pools and disabled dedicated dimensions without inheritance', () => {
    const raw = {
      default: {
        default: { max_concurrent: 5, rate_count: 60, rate_window_minutes: 1 },
        key_groups: {
          ds: { max_concurrent: 0, rate_count: 120, rate_window_minutes: 2 },
          free: { max_concurrent: 0, rate_count: 0, rate_window_minutes: 0 },
        },
      },
    }
    assert.deepEqual(
      JSON.parse(
        serializeUserRequestLimitForm(
          parseUserRequestLimitForm(JSON.stringify(raw))
        )
      ),
      raw
    )
  })
  test('retains an explicit unlimited dedicated pool and allows an empty policy', () => {
    assert.equal(serializeUserRequestLimitForm({ groups: [] }), '{}')
    const encoded = JSON.parse(
      serializeUserRequestLimitForm({
        groups: [
          {
            name: 'default',
            default: emptyRequestLimitRule(),
            keyGroups: [{ name: 'ds', rule: emptyRequestLimitRule() }],
          },
        ],
      })
    )
    assert.deepEqual(encoded.default.key_groups.ds, {
      max_concurrent: 0,
      rate_count: 0,
      rate_window_minutes: 0,
    })
  })
  test('rejects duplicate groups, duplicate key groups and auto before saving', () => {
    const group = {
      name: 'default',
      default: emptyRequestLimitRule(),
      keyGroups: [],
    }
    assert.equal(
      userRequestLimitFormSchema.safeParse({ groups: [group, group] }).success,
      false
    )
    const key = { name: 'ds', rule: emptyRequestLimitRule() }
    assert.equal(
      userRequestLimitFormSchema.safeParse({
        groups: [{ ...group, keyGroups: [key, key] }],
      }).success,
      false
    )
    assert.equal(
      userRequestLimitFormSchema.safeParse({
        groups: [{ ...group, keyGroups: [{ ...key, name: 'auto' }] }],
      }).success,
      false
    )
  })
  test('rejects invalid enabled limits and does not repair malformed saved policies silently', () => {
    for (const maxConcurrent of [0, -1, 1.5, 2147483648]) {
      const group = {
        name: 'default',
        default: {
          ...emptyRequestLimitRule(),
          concurrencyEnabled: true,
          maxConcurrent,
        },
        keyGroups: [],
      }
      assert.equal(
        userRequestLimitFormSchema.safeParse({ groups: [group] }).success,
        false
      )
    }
    assert.throws(() => parseUserRequestLimitForm('null'))
    assert.throws(() =>
      parseUserRequestLimitForm(
        '{"default":{"default":{"rate_count":1,"rate_window_minutes":0}}}'
      )
    )
  })
})
