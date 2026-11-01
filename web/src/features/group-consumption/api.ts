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
import { api } from '@/lib/api'

export interface ConsumptionQuery {
  month: string
  group: string
  user_id: string
  dimension: 'group' | 'user'
  source: 'all' | 'wallet' | 'subscription'
}

export interface GroupConsumptionData {
  dimension: 'group' | 'user'
  source: 'all' | 'wallet' | 'subscription'
  groups: { group: string; owner_user_id: number }[]

  period: string
  quota_per_usd: number
  unattributed_requests: number
  items: {
    user_id?: number
    group: string
    owner_user_id: number
    wallet_quota: number
    subscription_quota: number
    total_quota: number
    requests: number
  }[]
}

export function parseExcludedUserIDs(value: string): number[] | null {
  const parts = value.trim() ? value.trim().split(/[,，\s]+/) : []
  const ids = [...new Set(parts.map(Number))].sort((a, b) => a - b)
  if (
    parts.some((part) => !/^\d+$/.test(part)) ||
    ids.length > 500 ||
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)
  ) {
    return null
  }
  return ids
}

export async function getGroupConsumption(
  filters: ConsumptionQuery,
  groupExclusions: Record<string, number[]>
): Promise<GroupConsumptionData> {
  const response = await api.get<{
    success: boolean
    message: string
    data: GroupConsumptionData
  }>('/api/data/group-consumption', {
    params: { ...filters, group_exclusions: JSON.stringify(groupExclusions) },
  })
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}
