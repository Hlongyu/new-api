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
import { beforeEach, describe, test } from 'node:test'

import {
  clearPendingCharge,
  createRequestKey,
  isValidRequestKey,
  readPendingCharge,
  resolveRequestKey,
  writePendingCharge,
} from '../request-key'

function installMemoryStorage(): void {
  const items = new Map<string, string>()
  const memoryStorage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value)
    },
    removeItem: (key: string) => {
      items.delete(key)
    },
    clear: () => items.clear(),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size
    },
  }
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
}

describe('createRequestKey', () => {
  test('produces keys the service will accept', () => {
    for (const userId of [1, 42, 1_000_000]) {
      const key = createRequestKey('rename-card', userId)
      assert.ok(isValidRequestKey(key), `${key} should be valid`)
      assert.ok(key.startsWith(`rc-${userId}-`))
    }
  })

  test('prefixes each flow distinctly', () => {
    assert.ok(createRequestKey('sponsor', 7).startsWith('sp-7-'))
    assert.ok(createRequestKey('rename-card', 7).startsWith('rc-7-'))
    assert.ok(createRequestKey('postpaid', 7).startsWith('pp-7-'))
  })

  test('clears the 16-character floor sponsorships require', () => {
    assert.ok(createRequestKey('sponsor', 1).length >= 16)
  })

  test('produces a distinct key per call', () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => createRequestKey('sponsor', 7))
    )
    assert.equal(keys.size, 50)
  })
})

describe('isValidRequestKey', () => {
  test('rejects keys outside the service constraints', () => {
    assert.equal(isValidRequestKey('short'), false)
    assert.equal(isValidRequestKey('has spaces here'), false)
    assert.equal(isValidRequestKey('has/slash/chars'), false)
    assert.equal(isValidRequestKey('a'.repeat(81)), false)
  })

  test('accepts the boundary lengths', () => {
    assert.equal(isValidRequestKey('a'.repeat(8)), true)
    assert.equal(isValidRequestKey('a'.repeat(80)), true)
  })
})

describe('resolveRequestKey', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  test('persists a new key so an interrupted charge can resume', () => {
    const first = resolveRequestKey('rename-card', 9, 3, 1000)
    assert.equal(first.amount, 3)
    assert.deepEqual(readPendingCharge('rename-card'), first)
  })

  test('replays the stored key for the same amount', () => {
    const first = resolveRequestKey('rename-card', 9, 3, 1000)
    const second = resolveRequestKey('rename-card', 9, 3, 2000)
    assert.equal(second.requestKey, first.requestKey)
    assert.equal(second.createdAt, first.createdAt)
  })

  test('issues a fresh key when the amount changes', () => {
    const first = resolveRequestKey('rename-card', 9, 3, 1000)
    const second = resolveRequestKey('rename-card', 9, 5, 2000)
    assert.notEqual(second.requestKey, first.requestKey)
    assert.equal(second.amount, 5)
  })

  test('issues a fresh key after the pending charge is cleared', () => {
    const first = resolveRequestKey('rename-card', 9, 3, 1000)
    clearPendingCharge('rename-card')
    const second = resolveRequestKey('rename-card', 9, 3, 2000)
    assert.notEqual(second.requestKey, first.requestKey)
  })

  test('keeps the two flows in separate slots', () => {
    // A pending sponsorship must not be mistaken for a pending rename card,
    // or replaying one would send the other's key.
    const rename = resolveRequestKey('rename-card', 9, 5, 1000)
    const sponsor = resolveRequestKey('sponsor', 9, 5, 1000)
    assert.notEqual(rename.requestKey, sponsor.requestKey)
    assert.equal(readPendingCharge('rename-card')?.requestKey, rename.requestKey)
    assert.equal(readPendingCharge('sponsor')?.requestKey, sponsor.requestKey)

    clearPendingCharge('sponsor')
    assert.equal(readPendingCharge('rename-card')?.requestKey, rename.requestKey)
    assert.equal(readPendingCharge('sponsor'), null)
  })
})

describe('readPendingCharge', () => {
  beforeEach(() => {
    installMemoryStorage()
  })

  test('returns null and drops entries that are not valid JSON', () => {
    globalThis.sessionStorage.setItem(
      'leaderboard:rename-card:pending',
      'not json'
    )
    assert.equal(readPendingCharge('rename-card'), null)
    assert.equal(
      globalThis.sessionStorage.getItem('leaderboard:rename-card:pending'),
      null
    )
  })

  test('drops entries whose key would be rejected by the service', () => {
    writePendingCharge('sponsor', {
      requestKey: 'bad key',
      amount: 1,
      createdAt: 1,
    })
    assert.equal(readPendingCharge('sponsor'), null)
  })

  test('drops entries with a nonsensical amount', () => {
    writePendingCharge('sponsor', {
      requestKey: createRequestKey('sponsor', 1),
      amount: 0,
      createdAt: 1,
    })
    assert.equal(readPendingCharge('sponsor'), null)
  })
})
