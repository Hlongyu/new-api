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

export interface MonthlyConsumptionRow {
  user_id: number
  username: string
  wallet_quota: number
  subscription_quota: number
  total_quota: number
}

export interface MonthlyConsumptionData {
  period: string
  as_of: number
  quota_per_usd: number
  items: MonthlyConsumptionRow[]
  total: number
}

export async function getMonthlyConsumption(filters?: {
  p: number
  keyword: string
}): Promise<MonthlyConsumptionData> {
  const url = filters
    ? '/api/data/monthly-consumption'
    : '/api/data/monthly-consumption/self'
  const result = await api.get<{
    success: boolean
    message: string
    data: MonthlyConsumptionData
  }>(url, { params: filters ? { ...filters, page_size: 20 } : undefined })
  if (!result.data.success) throw new Error(result.data.message)
  return result.data.data
}
