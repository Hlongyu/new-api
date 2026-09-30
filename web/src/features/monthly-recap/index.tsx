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
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { AdminRecapBrowser } from './components/admin-browser'
import { UsageStory } from './components/usage-story'
import { ValueStory } from './components/value-story'
import { beijingMonth, shiftMonth } from './lib'
import type { MonthlyRecap, RecapUser } from './types'

import '@/styles/monthly-recap.css'

export function MonthlyRecapPage() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const [selectedUser, setSelectedUser] = useState<RecapUser | null>(null)
  const targetId = isAdmin ? selectedUser?.id : undefined
  const currentMonth = beijingMonth()
  const [month, setMonth] = useState(currentMonth)
  const query = useQuery({
    queryKey: ['monthly-recap', user?.id, isAdmin, targetId ?? 'self', month],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await api.get<{
        success: boolean
        data: MonthlyRecap
        message?: string
      }>(
        targetId ? '/api/data/monthly-recap' : '/api/data/monthly-recap/self',
        {
          params: { month, ...(targetId ? { user_id: targetId } : {}) },
          signal,
        }
      )
      if (!response.data.success) {
        throw new Error(response.data.message || 'Monthly recap unavailable')
      }
      return response.data.data
    },
  })
  const data = query.data
  const subject = targetId ? data?.subject : user
  const name = subject?.display_name || subject?.username || ''
  const dateLabel = new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))
  return (
    <main id='main' className='monthly-recap' key={month}>
      <header className='recap-toolbar'>
        <span className='recap-wordmark'>
          new-api <span>/ {t('Monthly recap')}</span>
        </span>
        <div className='recap-month-control'>
          <Button
            variant='ghost'
            size='icon'
            aria-label={t('Previous month')}
            disabled={month <= '1970-02'}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ←
          </Button>
          <label className='sr-only' htmlFor='recap-month'>
            {t('Month')}
          </label>
          <Input
            id='recap-month'
            type='month'
            min='1970-02'
            max={currentMonth}
            value={month}
            onChange={(event) => {
              const value = event.target.value
              if (
                /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
                value >= '1970-02' &&
                value <= currentMonth
              ) {
                setMonth(value)
              }
            }}
          />
          <Button
            variant='ghost'
            size='icon'
            aria-label={t('Next month')}
            disabled={month >= currentMonth}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            →
          </Button>
        </div>
      </header>
      {isAdmin && user && (
        <AdminRecapBrowser
          viewerId={user.id}
          selected={selectedUser}
          onSelect={setSelectedUser}
        />
      )}
      {query.isPending && (
        <div className='recap-state' role='status'>
          <p>{t('Putting your month together…')}</p>
          <Skeleton className='mt-8 h-20 w-3/4' />
          <Skeleton className='mt-4 h-10 w-1/2' />
        </div>
      )}
      {query.isError && (
        <div className='recap-state' role='alert'>
          <h1>{t('Could not load your recap')}</h1>
          <p>{t('Please try again.')}</p>
          <Button onClick={() => void query.refetch()}>{t('Retry')}</Button>
        </div>
      )}
      {data && (data.history_incomplete || data.unreadable_usage > 0) && (
        <div className='recap-notice' role='status'>
          {t(
            'Some historical details are missing. This recap covers retained records only.'
          )}
        </div>
      )}
      {data && data.requests === 0 && (
        <Empty className='recap-state'>
          <EmptyHeader>
            <EmptyTitle>{t('A new chapter is waiting.')}</EmptyTitle>
            <EmptyDescription>
              {t(
                'No recorded usage in the selected groups this month. Try another month.'
              )}
            </EmptyDescription>
          </EmptyHeader>
          <p>
            {dateLabel} · {data.groups.join(' + ')}
          </p>
        </Empty>
      )}
      {data && data.requests > 0 && (
        <>
          <section className='recap-hero' aria-labelledby='recap-title'>
            <div className='recap-hero-copy'>
              <p className='recap-eyebrow'>
                {dateLabel}{' '}
                <span>
                  —{' '}
                  {data.in_progress
                    ? t('Month in progress')
                    : t('Monthly recap')}
                </span>
              </p>
              <p className='recap-greeting'>{t('For {{name}}', { name })}</p>
              <h1 id='recap-title'>{t('A month of possibilities.')}</h1>
              <p className='recap-hero-description'>
                {t('Your models. Your rhythm. Your story.')}
              </p>
              <a className='recap-start' href='#models'>
                {t('Play your month')} <span aria-hidden='true'>↗</span>
              </a>
            </div>
            <div className='recap-record recap-record-hero' aria-hidden='true'>
              <div>
                <span>{month.slice(0, 4)}</span>
                <strong>{month.slice(5)}</strong>
                <span>new-api</span>
              </div>
            </div>
            <div className='recap-hero-meta'>
              <span>{data.groups.join(' + ')}</span>
              <span>
                {t('Updated {{time}}', {
                  time: new Intl.DateTimeFormat(toIntlLocale(i18n.language), {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Shanghai',
                  }).format(new Date(data.as_of * 1000)),
                })}{' '}
                · {t('Beijing time')}
              </span>
            </div>
          </section>
          <nav className='recap-chapter-nav' aria-label={t('Recap chapters')}>
            <a href='#models'>{t('Models')}</a>
            <a href='#rhythm'>{t('Activity')}</a>
            <a href='#tokens'>{t('Tokens')}</a>
            <a href='#value'>{t('Consumption')}</a>
            <a href='#keepsake'>{t('Keepsake')}</a>
          </nav>
          <UsageStory data={data} />
          <ValueStory data={data} name={name} />
        </>
      )}
    </main>
  )
}
