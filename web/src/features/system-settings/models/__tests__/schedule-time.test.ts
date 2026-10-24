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

import {
  formatBeijingTime,
  nextBeijingSunday,
  parseBeijingTime,
} from '../group-ratio-schedule-time'

test('Sunday Beijing midnight is Saturday 16:00 UTC regardless of browser timezone', () => {
  assert.equal(
    parseBeijingTime('2026-10-25T00:00'),
    Date.UTC(2026, 9, 24, 16) / 1000
  )
  assert.equal(
    formatBeijingTime(Date.UTC(2026, 9, 24, 16) / 1000),
    '2026-10-25 00:00'
  )
})

test('next Sunday is strictly in the future even when today is Sunday in Beijing', () => {
  assert.equal(nextBeijingSunday(Date.UTC(2026, 9, 24, 15)), '2026-10-25T00:00')
  assert.equal(nextBeijingSunday(Date.UTC(2026, 9, 24, 16)), '2026-11-01T00:00')
})

test('invalid dates and timezone-bearing wall clock input are rejected', () => {
  for (const value of [
    '',
    '2026-02-30T00:00',
    '2026-13-01T00:00',
    '2026-10-25T24:00',
    '2026-10-25T00:00Z',
    '2026-10-25',
  ]) {
    assert.ok(Number.isNaN(parseBeijingTime(value)), value)
  }
})
