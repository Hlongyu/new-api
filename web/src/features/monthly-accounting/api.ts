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

export interface AccountingSnapshot {
  period: string
  scheduled_at: number
  captured_at: number
  status: 'captured' | 'late' | 'batch_pending' | 'negative_balance'
  quota_per_cny: number
  balance_quota: number
  redeemed_quota: number
  user_count: number
}

export interface AccountingMonth {
  period: string
  status: 'scheduled' | 'in_progress' | 'missing' | 'complete' | 'review'
  opening: AccountingSnapshot | null
  closing: AccountingSnapshot | null
  receipts_quota: number | null
  revenue_quota: number | null
  transition_adjustment_quota: number | null
  bookkeeping_revenue_quota: number | null
}

export interface AccountingData {
  start_period: string
  year: number
  items: AccountingMonth[]
}

export interface SnapshotUsersData {
  snapshot: AccountingSnapshot
  total: number
  items: {
    user_id: number
    username: string
    quota: number
    deleted: boolean
  }[]
}

export async function getMonthlyAccounting(
  year: number
): Promise<AccountingData> {
  const result = await api.get<{
    success: boolean
    message: string
    data: AccountingData
  }>('/api/data/monthly-accounting', { params: { year } })
  if (!result.data.success) throw new Error(result.data.message)
  return result.data.data
}

export async function getSnapshotUsers(
  period: string,
  page: number
): Promise<SnapshotUsersData> {
  const result = await api.get<{
    success: boolean
    message: string
    data: SnapshotUsersData
  }>('/api/data/monthly-accounting/users', {
    params: { period, p: page, page_size: 20 },
  })
  if (!result.data.success) throw new Error(result.data.message)
  return result.data.data
}

// Historical accounting always uses the captured conversion, not today's site settings.
export function accountingCNY(
  quota: number | null | undefined,
  snapshot: AccountingSnapshot | null
): string {
  if (quota == null || !snapshot) return '—'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(quota / snapshot.quota_per_cny)
}
