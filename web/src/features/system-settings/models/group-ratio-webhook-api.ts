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

export type WebhookConfig = {
  enabled: boolean
  url: string
  groups: string[]
  has_secret: boolean
}
export type WebhookDelivery = {
  id: string
  payload: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  last_status: number
  created_at: number
}
const endpoint = '/api/option/group-ratio-webhook'
export const webhookQueryKey = ['group-ratio-webhook'] as const

type Response<T> = { success: boolean; message?: string; data: T }

export async function getWebhookConfig() {
  const { data } = await api.get<Response<WebhookConfig>>(endpoint)
  if (!data.success) throw new Error(data.message)
  return data.data
}
export async function saveWebhookConfig(
  config: Omit<WebhookConfig, 'has_secret'> & { secret: string }
) {
  const { data } = await api.put<Response<never>>(endpoint, config)
  if (!data.success) throw new Error(data.message)
}
export async function getWebhookDeliveries(page: number) {
  const { data } = await api.get<Response<WebhookDelivery[]>>(
    `${endpoint}/deliveries`,
    { params: { page } }
  )
  if (!data.success) throw new Error(data.message)
  return data.data
}
export async function retryWebhookDelivery(id: string) {
  const { data } = await api.post<Response<never>>(
    `${endpoint}/deliveries/${encodeURIComponent(id)}/retry`
  )
  if (!data.success) throw new Error(data.message)
}
