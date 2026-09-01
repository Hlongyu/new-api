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
// ----------------------------------------------------------------------------
// Charge idempotency keys
// ----------------------------------------------------------------------------
//
// Three Core flows move real quota: rename cards and sponsorships deduct it,
// postpaid credit grants it. All three dedupe on `requestKey`,
// answering a repeated key with the original order instead of moving quota
// twice, so a key has to survive a reload or a lost response and be replayed
// verbatim on retry.
//
// Keys live in sessionStorage: they must outlive a refresh but must not leak
// into another tab, where a concurrent order would collide with the service's
// one-open-order-per-user constraint. Each flow gets its own slot so a pending
// sponsorship never shadows a pending rename card.

export type ChargeScope = 'rename-card' | 'sponsor' | 'postpaid'

function storageKey(scope: ChargeScope): string {
  return `leaderboard:${scope}:pending`
}

/**
 * Service constraint. Rename cards accept 8+ characters and sponsorships and
 * postpaid 16+, so generated keys clear the stricter bar and validation uses
 * the loose one.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/

export type PendingCharge = {
  requestKey: string
  /** Cards for a rename purchase, CNY for a sponsorship, credit for postpaid. */
  amount: number
  createdAt: number
}

function randomSuffix(): string {
  const cryptoRef = globalThis.crypto
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID().replaceAll('-', '')
  }
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Last resort only; every browser we support provides Web Crypto.
  return Math.random().toString(36).slice(2).padEnd(16, '0')
}

const SCOPE_PREFIX: Record<ChargeScope, string> = {
  'rename-card': 'rc',
  sponsor: 'sp',
  postpaid: 'pp',
}

export function createRequestKey(
  scope: ChargeScope,
  userId: number
): string {
  return `${SCOPE_PREFIX[scope]}-${userId}-${randomSuffix()}`.slice(0, 80)
}

export function isValidRequestKey(value: string): boolean {
  return KEY_PATTERN.test(value)
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    // Private mode or a blocked storage partition; charges still work, they
    // just cannot be resumed after a reload.
    return null
  }
}

export function readPendingCharge(scope: ChargeScope): PendingCharge | null {
  const store = storage()
  if (!store) return null

  const raw = store.getItem(storageKey(scope))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PendingCharge>
    if (
      typeof parsed.requestKey !== 'string' ||
      !isValidRequestKey(parsed.requestKey) ||
      typeof parsed.amount !== 'number' ||
      !Number.isInteger(parsed.amount) ||
      parsed.amount <= 0
    ) {
      store.removeItem(storageKey(scope))
      return null
    }
    return {
      requestKey: parsed.requestKey,
      amount: parsed.amount,
      createdAt:
        typeof parsed.createdAt === 'number' && parsed.createdAt > 0
          ? parsed.createdAt
          : 0,
    }
  } catch {
    store.removeItem(storageKey(scope))
    return null
  }
}

export function writePendingCharge(
  scope: ChargeScope,
  pending: PendingCharge
): void {
  storage()?.setItem(storageKey(scope), JSON.stringify(pending))
}

export function clearPendingCharge(scope: ChargeScope): void {
  storage()?.removeItem(storageKey(scope))
}

/**
 * Pick the key to send for a charge of `amount`.
 *
 * An interrupted charge of the same amount is replayed with its original key so
 * the service can answer from the existing order. A different amount is a
 * different intent and gets a fresh key.
 */
export function resolveRequestKey(
  scope: ChargeScope,
  userId: number,
  amount: number,
  now: number
): PendingCharge {
  const pending = readPendingCharge(scope)
  if (pending && pending.amount === amount) return pending

  const next: PendingCharge = {
    requestKey: createRequestKey(scope, userId),
    amount,
    createdAt: now,
  }
  writePendingCharge(scope, next)
  return next
}
