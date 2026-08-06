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
  describeSyncAge,
  formatCount,
  podiumBarWidth,
  formatTokens,
} from '../format'

describe('formatTokens', () => {
  test('compacts each magnitude', () => {
    assert.equal(formatTokens(842_866_545), '843M')
    assert.equal(formatTokens(1_500_000_000), '1.5B')
    assert.equal(formatTokens(2_400), '2.4K')
    assert.equal(formatTokens(999), '999')
  })

  test('drops the decimal once the mantissa reaches three digits', () => {
    assert.equal(formatTokens(120_000_000), '120M')
    assert.equal(formatTokens(99_900_000), '99.9M')
  })

  test('renders unit boundaries without rolling over', () => {
    assert.equal(formatTokens(1_000), '1.0K')
    assert.equal(formatTokens(1_000_000), '1.0M')
    assert.equal(formatTokens(1_000_000_000), '1.0B')
  })

  test('treats missing or nonsensical values as zero', () => {
    assert.equal(formatTokens(0), '0')
    assert.equal(formatTokens(-5), '0')
    assert.equal(formatTokens(Number.NaN), '0')
  })
})

describe('formatCount', () => {
  test('groups thousands and floors invalid input', () => {
    assert.equal(formatCount(8_211), (8211).toLocaleString())
    assert.equal(formatCount(0), '0')
    assert.equal(formatCount(Number.NaN), '0')
  })
})

describe('podiumBarWidth', () => {
  test('expresses a value as a share of the leader', () => {
    assert.equal(podiumBarWidth(50, 100), 50)
    assert.equal(podiumBarWidth(100, 100), 100)
  })

  test('floors a non-zero value so it stays visible', () => {
    assert.equal(podiumBarWidth(1, 1000), 3)
  })

  test('renders nothing for a genuinely empty value', () => {
    assert.equal(podiumBarWidth(0, 100), 0)
    assert.equal(podiumBarWidth(-10, 100), 0)
  })

  test('clamps rather than overflowing the bar', () => {
    assert.equal(podiumBarWidth(150, 100), 100)
  })

  test('survives a missing or zero leader', () => {
    assert.equal(podiumBarWidth(10, 0), 100)
    assert.equal(podiumBarWidth(10, Number.NaN), 100)
  })
})

describe('describeSyncAge', () => {
  const now = 1_786_000_000_000

  test('reports a never-synced service instead of an epoch date', () => {
    assert.deepEqual(describeSyncAge(0, now), { kind: 'never' })
    assert.deepEqual(describeSyncAge(-1, now), { kind: 'never' })
  })

  test('buckets by the largest fitting unit', () => {
    const seconds = Math.floor(now / 1000)
    assert.deepEqual(describeSyncAge(seconds - 30, now), { kind: 'just-now' })
    assert.deepEqual(describeSyncAge(seconds - 300, now), {
      kind: 'minutes',
      value: 5,
    })
    assert.deepEqual(describeSyncAge(seconds - 7_200, now), {
      kind: 'hours',
      value: 2,
    })
    assert.deepEqual(describeSyncAge(seconds - 259_200, now), {
      kind: 'days',
      value: 3,
    })
  })

  test('treats a clock skewed into the future as just synced', () => {
    const seconds = Math.floor(now / 1000)
    assert.deepEqual(describeSyncAge(seconds + 120, now), { kind: 'just-now' })
  })
})
