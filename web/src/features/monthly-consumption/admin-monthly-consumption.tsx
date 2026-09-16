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

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { rebateTime, rebateUSD } from '@/features/monthly-rebates/lib/format'

import { getMonthlyConsumption } from './api'

export function AdminMonthlyConsumption() {
  const { t, i18n } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [filters, setFilters] = useState({ keyword: '', p: 1 })
  const query = useQuery({
    queryKey: ['monthly-consumption', 'admin', filters],
    queryFn: () => getMonthlyConsumption(filters),
    refetchInterval: 60000,
  })
  const data = query.data
  return (
    <section
      className='space-y-4'
      aria-label={t('Monthly consumption by user')}
    >
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h3 className='font-medium'>
            {t('This month consumption')} {data?.period}
          </h3>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Beijing calendar month, net API consumption after refunds. Violation fees excluded. Only wallet consumption counts toward rebates.'
            )}
          </p>
        </div>
        <Button
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      <form
        className='flex items-end gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          setFilters({ keyword: keyword.trim(), p: 1 })
        }}
      >
        <Field className='max-w-sm'>
          <FieldLabel htmlFor='monthly-consumption-search'>
            {t('Username')}
          </FieldLabel>
          <Input
            id='monthly-consumption-search'
            value={keyword}
            maxLength={128}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Field>
        <Button type='submit'>{t('Search')}</Button>
      </form>
      {query.isLoading && <Skeleton className='h-48 w-full' />}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load monthly consumption')}
          </AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          <p className='text-muted-foreground text-sm'>
            {t('Total')}: {data.total} · {t('Updated at')}:{' '}
            {rebateTime(data.as_of, i18n.language)}
          </p>
          {data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('No users found')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table aria-label={t('Monthly consumption by user')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('User ID')}</TableHead>
                  <TableHead>{t('Username')}</TableHead>
                  <TableHead>{t('Wallet consumption')}</TableHead>
                  <TableHead>{t('Subscription consumption')}</TableHead>
                  <TableHead>{t('Total consumption')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>#{row.user_id}</TableCell>
                    <TableCell>{row.username}</TableCell>
                    <TableCell>
                      {rebateUSD(row.wallet_quota, data.quota_per_usd)}
                    </TableCell>
                    <TableCell>
                      {rebateUSD(row.subscription_quota, data.quota_per_usd)}
                    </TableCell>
                    <TableCell>
                      {rebateUSD(row.total_quota, data.quota_per_usd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className='flex items-center justify-end gap-3'>
            <Button
              variant='outline'
              disabled={filters.p <= 1 || query.isFetching}
              onClick={() => setFilters({ ...filters, p: filters.p - 1 })}
            >
              {t('Previous')}
            </Button>
            <span>
              {filters.p} / {Math.max(1, Math.ceil(data.total / 20))}
            </span>
            <Button
              variant='outline'
              disabled={filters.p * 20 >= data.total || query.isFetching}
              onClick={() => setFilters({ ...filters, p: filters.p + 1 })}
            >
              {t('Next')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
