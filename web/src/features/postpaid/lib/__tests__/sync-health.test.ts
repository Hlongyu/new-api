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

import { syncTrouble } from '../sync-health'

const NOW_MS = 1_786_027_824_000
const NOW_S = NOW_MS / 1000

function state(overrides: Partial<Parameters<typeof syncTrouble>[0]> = {}) {
  return {
    configured: true,
    running: false,
    lastSyncAt: NOW_S - 20,
    lastSyncError: '',
    ...overrides,
  }
}

describe('syncTrouble', () => {
  // The whole point of this helper. `running` is a re-entrancy guard held only
  // during a pass, so a healthy worker polled between passes reports false.
  // Reading that as "stopped" alarms on every render.
  test('a healthy worker between passes is not trouble', () => {
    assert.equal(syncTrouble(state({ running: false }), NOW_MS), null)
  })

  test('a recent sync is healthy whether or not a pass is in flight', () => {
    assert.equal(syncTrouble(state({ running: true }), NOW_MS), null)
    assert.equal(syncTrouble(state({ running: false }), NOW_MS), null)
  })

  test('reports an error whenever the service recorded one', () => {
    assert.equal(
      syncTrouble(state({ lastSyncError: 'ECONNREFUSED' }), NOW_MS),
      'error'
    )
  })

  // An error outranks staleness: it names the cause, "stale" only names the
  // symptom.
  test('an error outranks staleness', () => {
    assert.equal(
      syncTrouble(
        state({ lastSyncError: 'boom', lastSyncAt: NOW_S - 86_400 }),
        NOW_MS
      ),
      'error'
    )
  })

  test('never having synced is stale, not healthy', () => {
    assert.equal(syncTrouble(state({ lastSyncAt: 0 }), NOW_MS), 'stale')
  })

  test('goes stale only well past the default 30s interval', () => {
    assert.equal(syncTrouble(state({ lastSyncAt: NOW_S - 120 }), NOW_MS), null)
    assert.equal(syncTrouble(state({ lastSyncAt: NOW_S - 600 }), NOW_MS), 'stale')
  })
})
