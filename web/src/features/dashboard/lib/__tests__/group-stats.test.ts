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

import { buildGroupCallStats } from '../group-stats'

describe('dashboard group call statistics', () => {
  test('merges duplicate groups and calculates cache hit rate from total input', () => {
    const result = buildGroupCallStats([
      {
        use_group: 'vip',
        count: 2,
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 40,
        quota: 200,
      },
      {
        use_group: ' vip ',
        count: 1,
        input_tokens: 50,
        output_tokens: 10,
        cache_read_tokens: 20,
        quota: 100,
      },
    ])

    assert.deepEqual(result, [
      {
        use_group: 'vip',
        count: 3,
        input_tokens: 150,
        output_tokens: 30,
        cache_read_tokens: 60,
        quota: 300,
        cache_rate: 40,
      },
    ])
  })

  test('drops unnamed groups and clamps invalid cache ratios', () => {
    const result = buildGroupCallStats([
      {
        use_group: '',
        count: 9,
        input_tokens: 90,
        output_tokens: 9,
        cache_read_tokens: 9,
        quota: 900,
      },
      {
        use_group: 'default',
        count: 1,
        input_tokens: 10,
        output_tokens: 2,
        cache_read_tokens: 20,
        quota: 10,
      },
      {
        use_group: 'free',
        count: 5,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        quota: 0,
      },
    ])

    assert.deepEqual(
      result.map((row) => [row.use_group, row.cache_rate]),
      [
        ['default', 100],
        ['free', 0],
      ]
    )
  })
})
