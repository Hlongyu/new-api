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

import type {
  MonthlyRebate,
  MonthlyRebateFilters,
  MonthlyRebateList,
} from './types'

interface RebateResponse<T> {
  success: boolean
  message: string
  data: T
}

const base = '/api/subscription/admin/rebates'

export async function listMonthlyRebates(
  filters: MonthlyRebateFilters
): Promise<MonthlyRebateList> {
  const response = await api.get<RebateResponse<MonthlyRebateList>>(base, {
    params: { ...filters, page_size: 20 },
  })
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}

export async function recalculateMonthlyRebates(period: string): Promise<void> {
  const response = await api.post<RebateResponse<{ processed: number }>>(
    `${base}/recalculate`,
    { period }
  )
  if (!response.data.success) throw new Error(response.data.message)
}

export async function issueMonthlyRebate(
  bill: MonthlyRebate
): Promise<MonthlyRebate> {
  const response = await api.post<RebateResponse<MonthlyRebate>>(
    `${base}/${bill.id}/issue`,
    { revision: bill.revision }
  )
  if (!response.data.success) throw new Error(response.data.message)
  return response.data.data
}
