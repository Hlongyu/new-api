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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

import type { RecapUser } from '../types'

export function AdminRecapBrowser(props: {
  viewerId: number
  selected: RecapUser | null
  onSelect: (user: RecapUser | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState({ keyword: '', page: 1 })
  const query = useQuery({
    queryKey: ['monthly-recap-users', props.viewerId, filter],
    enabled: open,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await api.get<{
        success: boolean
        message?: string
        data: {
          items: RecapUser[]
          total: number
          page: number
          page_size: number
        }
      }>('/api/data/monthly-recap/users', { params: filter, signal })
      if (!res.data.success) {
        throw new Error(res.data.message || 'User list unavailable')
      }
      return res.data.data
    },
  })
  return (
    <aside className='recap-admin' aria-label={t('View user recaps')}>
      <div className='recap-admin-heading'>
        <Button
          variant='outline'
          aria-expanded={open}
          aria-controls='recap-user-browser'
          onClick={() => setOpen(!open)}
        >
          {t('View user recaps')}
        </Button>
        {props.selected && (
          <>
            <span>
              {t('Viewing {{name}}', { name: props.selected.username })}
            </span>
            <Button variant='ghost' onClick={() => props.onSelect(null)}>
              {t('My monthly recap')}
            </Button>
          </>
        )}
      </div>
      <div id='recap-user-browser' hidden={!open}>
        <form
          className='recap-admin-search'
          onSubmit={(event) => {
            event.preventDefault()
            setFilter({ keyword: draft.trim(), page: 1 })
          }}
        >
          <label className='sr-only' htmlFor='recap-user-search'>
            {t('Search users')}
          </label>
          <Input
            id='recap-user-search'
            type='search'
            maxLength={128}
            placeholder={t('Search users')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type='submit'>{t('Search')}</Button>
        </form>
        {query.isPending && <p role='status'>{t('Loading...')}</p>}
        {query.isError && (
          <div role='alert'>
            <p>{t('Please try again.')}</p>
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          </div>
        )}
        {query.data && (
          <>
            <ul className='recap-admin-users' aria-label={t('Users')}>
              {query.data.items.map((user) => (
                <li key={user.id}>
                  <Button
                    variant='ghost'
                    aria-pressed={props.selected?.id === user.id}
                    onClick={() => props.onSelect(user)}
                  >
                    <span>
                      {user.display_name || user.username}
                      <small>
                        @{user.username} · #{user.id}
                      </small>
                    </span>
                    <span aria-hidden='true'>↗</span>
                  </Button>
                </li>
              ))}
            </ul>
            {query.data.items.length === 0 && (
              <p role='status'>{t('No users found')}</p>
            )}
            <div className='recap-admin-pagination'>
              <span>
                {t('Total')}: {query.data.total}
              </span>
              <Button
                variant='outline'
                disabled={filter.page <= 1}
                onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
              >
                {t('Previous')}
              </Button>
              <span>
                {filter.page} /{' '}
                {Math.max(
                  1,
                  Math.ceil(query.data.total / query.data.page_size)
                )}
              </span>
              <Button
                variant='outline'
                disabled={
                  filter.page * query.data.page_size >= query.data.total
                }
                onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
              >
                {t('Next')}
              </Button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
