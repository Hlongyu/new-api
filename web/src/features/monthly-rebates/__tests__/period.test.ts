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

import { previousBeijingMonth, rebateUSD } from '../lib/format'

test('default month rolls over at Beijing midnight across year boundaries', () => {
  assert.equal(
    previousBeijingMonth(new Date('2026-12-31T15:59:59Z')),
    '2026-11'
  )
  assert.equal(
    previousBeijingMonth(new Date('2026-12-31T16:00:00Z')),
    '2026-12'
  )
})

test('rebate amounts use the recorded USD conversion rather than display-currency settings', () => {
  assert.equal(rebateUSD(25000000, 500000), '$50.00')
  assert.equal(rebateUSD(-25000000, 500000), '-$50.00')
})

test('review timestamps accept the application Chinese locale aliases', async () => {
  const { rebateTime } = await import('../lib/format')
  const timestamp = Date.parse('2026-08-31T16:00:00Z') / 1000
  assert.equal(rebateTime(timestamp, 'zhCN'), rebateTime(timestamp, 'zh-CN'))
  assert.equal(rebateTime(timestamp, 'zhTW'), rebateTime(timestamp, 'zh-TW'))
})
