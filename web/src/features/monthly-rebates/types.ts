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
export type RebateStatus =
  | 'pending'
  | 'ineligible'
  | 'issued'
  | 'failed'
  | 'needs_review'

export interface MonthlyRebate {
  id: number
  period: string
  user_id: number
  username: string
  quota_per_usd: number
  wallet_quota: number
  rate_percent: number
  rebate_quota: number
  revision: number
  status: RebateStatus
  last_error: string
  issued_wallet_quota: number
  issued_rate_percent: number
  issued_quota: number
  subscription_id: number
  subscription_expires_at: number
  subscription_status: string
  subscription_amount_used: number
  issued_by: number
  issued_at: number
  checked_at: number
}

export interface MonthlyRebateList {
  items: MonthlyRebate[]
  total: number
  page: number
  page_size: number
  summary: {
    users: number
    pending: number
    issued: number
    needs_review: number
    failed: number
    issued_quota: number
  }
}

export interface MonthlyRebateFilters {
  period: string
  status: RebateStatus | ''
  user_id: string
  p: number
}
