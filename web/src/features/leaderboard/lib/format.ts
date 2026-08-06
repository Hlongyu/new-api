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
// Leaderboard formatting
// ----------------------------------------------------------------------------

const TOKEN_UNITS = [
  { limit: 1_000_000_000, suffix: 'B' },
  { limit: 1_000_000, suffix: 'M' },
  { limit: 1_000, suffix: 'K' },
] as const

/**
 * Compact token counts for table cells, e.g. 842866545 becomes "842.9M".
 *
 * Callers pair this with the exact figure in a tooltip, so readability wins
 * over precision here.
 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'

  for (const unit of TOKEN_UNITS) {
    if (value >= unit.limit) {
      const scaled = value / unit.limit
      const digits = scaled >= 100 ? 0 : 1
      return `${scaled.toFixed(digits)}${unit.suffix}`
    }
  }
  return String(Math.round(value))
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString()
}

/**
 * Bar width for a podium row, as a percentage of the leader.
 *
 * A non-zero value never renders as a hairline: it floors at 3% so third place
 * still reads as a bar rather than a rounding artefact.
 */
export function podiumBarWidth(value: number, top: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const max = Math.max(1, Number.isFinite(top) ? top : 1)
  return Math.max(3, Math.min(100, (value / max) * 100))
}

export type SyncAge =
  | { kind: 'never' }
  | { kind: 'just-now' }
  | { kind: 'minutes'; value: number }
  | { kind: 'hours'; value: number }
  | { kind: 'days'; value: number }

/**
 * Bucket the last sync timestamp for display.
 *
 * The service reports 0 when it has never synced, which must not render as
 * "56 years ago".
 */
export function describeSyncAge(lastSyncAt: number, nowMs: number): SyncAge {
  if (!Number.isFinite(lastSyncAt) || lastSyncAt <= 0) return { kind: 'never' }

  const elapsedSeconds = Math.floor(nowMs / 1000) - lastSyncAt
  if (elapsedSeconds < 60) return { kind: 'just-now' }

  const minutes = Math.floor(elapsedSeconds / 60)
  if (minutes < 60) return { kind: 'minutes', value: minutes }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { kind: 'hours', value: hours }

  return { kind: 'days', value: Math.floor(hours / 24) }
}
