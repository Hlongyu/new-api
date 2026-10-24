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

export type GroupRatioSchedule = {
  id: number
  group: string
  ratio: number
  execute_at: number
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled'
  finished_at: number
  previous_ratio: number | null
  error: string
}
export type SchedulePage = { items: GroupRatioSchedule[]; total: number }
export type ScheduleInput = { group: string; ratio: number; execute_at: number }
export const scheduleQueryKey = ['group-ratio-schedules'] as const
const endpoint = '/api/option/group-ratio-schedules'
type Response<T> = { success: boolean; message?: string; data: T }

export async function getGroupRatioSchedules(
  status: 'pending' | 'history',
  page: number
) {
  const { data } = await api.get<Response<SchedulePage>>(endpoint, {
    params: { status, page },
  })
  if (!data.success) throw new Error(data.message)
  return data.data
}
export async function createGroupRatioSchedule(input: ScheduleInput) {
  const { data } = await api.post<Response<GroupRatioSchedule>>(endpoint, input)
  if (!data.success) throw new Error(data.message)
  return data.data
}
export async function cancelGroupRatioSchedule(id: number) {
  const { data } = await api.post<Response<never>>(`${endpoint}/${id}/cancel`)
  if (!data.success) throw new Error(data.message)
}
