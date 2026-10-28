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
export type PersonalGroup = {
  id: number
  owner_user_id: number
  name: string
  description: string
  ratio: number
}

export type ChannelConfig = {
  name: string
  type: number
  base_url: string
  key?: string
  models: string
  priority: number
  weight: number
  enabled: boolean
}

export type PersonalChannel = {
  id: number
  owner_user_id: number
  group_id: number
  group_name: string
  published_channel_id: number
  latest_revision_id: number
  revision: {
    id: number
    status: 'draft' | 'pending' | 'approved' | 'rejected' | 'superseded'
    reason: string
    reviewer_id: number
    reviewed_at: number
  }
  config: ChannelConfig
  has_key: boolean
  key_changed: boolean
  published_config?: ChannelConfig
}

export type ChannelDraft = {
  id: number
  group_id: number
  expected_revision_id: number
  config: ChannelConfig
}

export type Page<T> = { items: T[]; total: number }
