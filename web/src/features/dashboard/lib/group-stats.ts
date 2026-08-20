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
import type {
  GroupCallStats,
  GroupQuotaDataItem,
} from '@/features/dashboard/types'

export function buildGroupCallStats(
  rows: GroupQuotaDataItem[]
): GroupCallStats[] {
  const groups = new Map<string, GroupQuotaDataItem>()

  for (const row of rows) {
    const group = row.use_group.trim()
    if (!group) continue
    const current = groups.get(group) ?? {
      use_group: group,
      count: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      quota: 0,
    }
    current.count += Number(row.count) || 0
    current.input_tokens += Number(row.input_tokens) || 0
    current.output_tokens += Number(row.output_tokens) || 0
    current.cache_read_tokens += Number(row.cache_read_tokens) || 0
    current.quota += Number(row.quota) || 0
    groups.set(group, current)
  }

  return [...groups.values()]
    .map((row) => ({
      ...row,
      cache_rate:
        row.input_tokens > 0
          ? Math.max(
              0,
              Math.min(100, (row.cache_read_tokens / row.input_tokens) * 100)
            )
          : 0,
    }))
    .sort((a, b) => b.quota - a.quota || b.count - a.count)
}
