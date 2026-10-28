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
  ChannelDraft,
  Page,
  PersonalChannel,
  PersonalGroup,
} from './types'

type Result<T> = { success: boolean; message?: string; data: T }

function unwrap<T>(result: Result<T>): T {
  if (!result.success) throw new Error(result.message || 'Operation failed')
  return result.data
}

export async function getPersonalGroups(): Promise<PersonalGroup[]> {
  const response = await api.get<Result<PersonalGroup[]>>(
    '/api/personal/groups'
  )
  return unwrap(response.data)
}

export async function savePersonalGroup(group: {
  id?: number
  name: string
  description: string
  ratio: number
}): Promise<unknown> {
  if (group.id) {
    const response = await api.put<Result<unknown>>(
      `/api/personal/groups/${group.id}`,
      group
    )
    return unwrap(response.data)
  }
  const response = await api.post<Result<unknown>>(
    '/api/personal/groups',
    group
  )
  return unwrap(response.data)
}

export async function getPersonalChannels(
  page: number,
  review = false
): Promise<Page<PersonalChannel>> {
  const path = review
    ? '/api/personal-channel-reviews'
    : '/api/personal/channels'
  const response = await api.get<Result<Page<PersonalChannel>>>(path, {
    params: { p: page, page_size: 20 },
  })
  return unwrap(response.data)
}

export async function saveChannelDraft(draft: ChannelDraft): Promise<unknown> {
  const response = await api.post<Result<unknown>>(
    '/api/personal/channels',
    draft
  )
  return unwrap(response.data)
}

export async function submitChannel(
  channel: PersonalChannel
): Promise<unknown> {
  const response = await api.post<Result<unknown>>(
    `/api/personal/channels/${channel.id}/submit`,
    { revision_id: channel.revision.id }
  )
  return unwrap(response.data)
}

export async function reviewChannel(input: {
  channel: PersonalChannel
  approve: boolean
  reason: string
}): Promise<unknown> {
  const response = await api.post<Result<unknown>>(
    `/api/personal-channel-reviews/${input.channel.id}`,
    {
      revision_id: input.channel.revision.id,
      approve: input.approve,
      reason: input.reason,
    }
  )
  return unwrap(response.data)
}

export async function fetchPersonalModels(input: {
  channel_id: number
  type: number
  base_url: string
  key: string
}): Promise<string[]> {
  const response = await api.post<Result<string[]>>(
    '/api/personal/channels/models',
    input
  )
  return unwrap(response.data)
}
