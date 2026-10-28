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
import { test } from 'node:test'

import { channelSchema, groupSchema } from '../lib/schema'

test('group names accept the reserved prefix and reject separators or excessive length', () => {
  for (const name of ['example', 'custom-example']) {
    assert.equal(
      groupSchema.safeParse({ name, description: '', ratio: 0 }).success,
      true
    )
  }
  for (const name of [
    '',
    'other,group',
    'custom-',
    'custom--example',
    '../default',
    'X',
    'a'.repeat(58),
  ]) {
    assert.equal(
      groupSchema.safeParse({ name, description: '', ratio: 1 }).success,
      false
    )
  }
})

test('group ratios reject nonfinite, negative and oversized values', () => {
  for (const ratio of [-1, Number.NaN, Infinity, 1000001]) {
    assert.equal(
      groupSchema.safeParse({ name: 'example', description: '', ratio })
        .success,
      false
    )
  }
})

test('channel drafts reject unsafe URLs, unsupported providers and invalid model lists', () => {
  const config = {
    group_id: 1,
    name: 'Channel',
    type: 1,
    base_url: 'https://example.com',
    key: 'key',
    models: 'model-a',
    priority: 0,
    weight: 10,
    enabled: true,
  }
  assert.equal(channelSchema.safeParse(config).success, true)
  for (const patch of [
    { base_url: 'http://example.com' },
    { base_url: 'https://user:password@example.com' },
    { type: 999 },
    { models: 'a,,b' },
    { priority: -1 },
    { key: 'key\r\ninjected' },
  ]) {
    assert.equal(
      channelSchema.safeParse({ ...config, ...patch }).success,
      false
    )
  }
  assert.equal(channelSchema.safeParse({ ...config, type: 60 }).success, true)
})
