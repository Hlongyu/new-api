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
  beijingMonth,
  recapCSV,
  recapPoster,
  recapRatio,
  shiftMonth,
} from '../lib'
import { recapFixture } from './fixture'

test('month selection uses Beijing boundaries and shifts across calendar years', () => {
  assert.equal(beijingMonth(new Date('2026-09-30T16:00:00Z')), '2026-10')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
})
test('multiplier is unavailable for incomplete pricing or missing history', () => {
  assert.equal(recapRatio(recapFixture), 0.25)
  assert.equal(recapRatio({ ...recapFixture, priced_requests: 2 }), null)
  assert.equal(recapRatio({ ...recapFixture, history_incomplete: true }), null)
  assert.equal(recapRatio({ ...recapFixture, original_quota: 0 }), null)
})
test('CSV exports exact counts and protects model names against formula execution', () => {
  const csv = recapCSV({
    ...recapFixture,
    models: [{ ...recapFixture.models[0], name: '=HYPERLINK("bad")' }],
  })
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"100","20","60","0","0.002","0.008","3"'))
})
test('keepsake escapes names and excludes billing data', () => {
  const poster = recapPoster(recapFixture, '<script>alert(1)</script>', {
    title: 'Recap',
    honor: '<Value Connoisseur>',
    requests: 'Requests',
    days: 'Days',
    favorite: 'Favorite',
    scope: 'gpt-pro + gpt优惠',
  })
  assert.ok(!poster.includes('<script>'))
  assert.ok(poster.includes('&lt;script&gt;'))
  assert.ok(poster.includes('gpt-test'))
  assert.ok(poster.includes('&lt;Value Connoisseur&gt;'))
  assert.ok(!poster.includes('original_quota'))
  assert.ok(!poster.includes('$'))
})
