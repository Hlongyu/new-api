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
const beijingOffset = 8 * 60 * 60 * 1000

// datetime-local is a wall clock value, not the browser's local timezone.
export function parseBeijingTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return Number.NaN
  const milliseconds = Date.parse(`${value}:00+08:00`)
  if (!Number.isFinite(milliseconds)) return Number.NaN
  // Date.parse normalizes some invalid calendar dates, such as February 30.
  if (
    new Date(milliseconds + beijingOffset).toISOString().slice(0, 16) !== value
  ) {
    return Number.NaN
  }
  return milliseconds / 1000
}

export function nextBeijingSunday(now = Date.now()): string {
  const date = new Date(now + beijingOffset)
  const days = (7 - date.getUTCDay()) % 7 || 7
  date.setUTCDate(date.getUTCDate() + days)
  date.setUTCHours(0, 0, 0, 0)
  return date.toISOString().slice(0, 16)
}

export function formatBeijingTime(timestamp: number): string {
  return new Date(timestamp * 1000 + beijingOffset)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
}
