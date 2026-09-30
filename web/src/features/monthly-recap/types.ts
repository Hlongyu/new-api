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
export interface RecapMetrics {
  requests: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  quota: number
  original_quota: number
  priced_requests: number
}
export interface RecapModel extends RecapMetrics {
  name: string
}
export interface RecapDay {
  date: string
  requests: number
  tokens: number
  quota: number
}
export interface RecapUser {
  id: number
  username: string
  display_name: string
}

export interface MonthlyRecap extends RecapMetrics {
  subject?: RecapUser
  period: string
  as_of: number
  in_progress: boolean
  groups: string[]
  quota_per_usd: number
  models: RecapModel[]
  days: RecapDay[]
  hours: number[]
  weekdays: number[]
  active_days: number
  longest_streak: number
  errors: number
  history_incomplete: boolean
  unreadable_usage: number
}
