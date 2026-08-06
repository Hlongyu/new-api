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
import type { PostpaidSyncState } from '../types'

/**
 * How long without a completed pass before the worker is presumed dead.
 *
 * The service syncs every 30s by default but the interval is configurable, so
 * this is deliberately far looser than the default rather than tuned to it.
 */
const STALE_AFTER_MS = 5 * 60 * 1000

export type SyncTrouble = 'error' | 'stale' | null

/**
 * Decide whether repayment collection has stopped.
 *
 * Do NOT use `state.running` for this. It is a re-entrancy guard held only for
 * the duration of one sync pass, so a healthy worker reads `false` almost
 * every time it is polled — treating that as "not running" fires a false
 * alarm on every render. Staleness of `lastSyncAt` is the real liveness
 * signal.
 */
export function syncTrouble(
  state: PostpaidSyncState,
  nowMs: number
): SyncTrouble {
  if (state.lastSyncError) return 'error'
  if (!Number.isFinite(state.lastSyncAt) || state.lastSyncAt <= 0) return 'stale'
  if (nowMs - state.lastSyncAt * 1000 > STALE_AFTER_MS) return 'stale'
  return null
}
