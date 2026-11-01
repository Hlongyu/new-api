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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { useAuthStore } from '@/stores/auth-store'

import { getGroupConsumption, type ConsumptionQuery } from './api'
import { ConsumptionFilters } from './consumption-filters'
import { GroupUserExclusions } from './group-user-exclusions'

export function GroupConsumption() {
  const { t, i18n } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const currentMonth = new Date(Date.now() + 8 * 3600000)
    .toISOString()
    .slice(0, 7)
  const defaults: ConsumptionQuery = {
    month: currentMonth,
    group: '',
    user_id: '',
    source: 'all',
    dimension: 'group',
  }
  const [draft, setDraft] = useState(defaults)
  const [filters, setFilters] = useState(defaults)
  const [excluded, setExcluded] = useState<Record<string, number[]>>({})
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['group-consumption', userID, filters, excluded],
    placeholderData: keepPreviousData,
    queryFn: () => getGroupConsumption(filters, excluded),
  })
  const data = query.data
  const dimension = data?.dimension ?? filters.dimension
  const totals = data?.items.reduce(
    (sum, row) => ({
      wallet: sum.wallet + row.wallet_quota,
      subscription: sum.subscription + row.subscription_quota,
      total: sum.total + row.total_quota,
      requests: sum.requests + row.requests,
    }),
    { wallet: 0, subscription: 0, total: 0, requests: 0 }
  )
  const applyExclusions = (group: string, ids: number[]) => {
    if ((excluded[group] ?? []).join(',') === ids.join(',')) {
      void query.refetch()
      return
    }
    setExcluded((previous) => ({ ...previous, [group]: ids }))
    setPage(1)
  }
  return (
    <section
      className='space-y-4'
      aria-label={t('Consumption query')}
      aria-busy={query.isFetching}
    >
      <h3 className='font-medium'>
        {t('Consumption query')}{' '}
        <span className='text-muted-foreground tabular-nums'>
          {data?.period}
        </span>
      </h3>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Group usage is attributed to the request owner snapshot. Amounts are net of refunds and exclude violation fees. Missing logs cannot be attributed.'
        )}
      </p>
      <ConsumptionFilters
        value={draft}
        groups={data?.groups ?? []}
        currentMonth={currentMonth}
        disabled={query.isFetching}
        onChange={setDraft}
        onSubmit={() => {
          setPage(1)
          if (JSON.stringify(filters) === JSON.stringify(draft)) {
            void query.refetch()
          } else {
            setFilters(draft)
          }
        }}
        onReset={() => {
          setDraft(defaults)
          setFilters(defaults)
          setExcluded({})
          setPage(1)
        }}
      />
      {data?.generated_at && (
        <p className='text-muted-foreground text-sm'>
          {t('Updated at')}: {rebateTime(data.generated_at, i18n.language)}
        </p>
      )}
      {query.isPending && <Skeleton className='h-40 w-full' />}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load monthly consumption')}
          </AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          {data.unattributed_requests > 0 && (
            <Alert>
              <AlertDescription>
                {t(
                  'Some requests have no reliable group attribution. Reconcile missing logs before settlement.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {dimension === 'user' && (
            <details className='rounded-lg border p-3'>
              <summary className='cursor-pointer font-medium'>
                {t('Excluded user IDs')}
              </summary>
              <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                {(data.groups ?? []).map((row) => (
                  <div key={row.group} className='space-y-2'>
                    <p className='text-sm'>{row.group}</p>
                    <GroupUserExclusions
                      key={`${row.group}:${(excluded[row.group] ?? []).join(',')}`}
                      group={row.group}
                      userIDs={excluded[row.group] ?? []}
                      disabled={query.isFetching}
                      onApply={(ids) => applyExclusions(row.group, ids)}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}
          {totals && (
            <dl className='grid grid-cols-2 gap-3 rounded-lg border p-4 lg:grid-cols-4'>
              <div>
                <dt className='text-muted-foreground text-sm'>
                  {t('Wallet consumption')}
                </dt>
                <dd>{rebateUSD(totals.wallet, data.quota_per_usd)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-sm'>
                  {t('Subscription consumption')}
                </dt>
                <dd>{rebateUSD(totals.subscription, data.quota_per_usd)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-sm'>
                  {t('Total consumption')}
                </dt>
                <dd>{rebateUSD(totals.total, data.quota_per_usd)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground text-sm'>
                  {t('Requests')}
                </dt>
                <dd>{totals.requests}</dd>
              </div>
            </dl>
          )}
          {data.items.length === 0 ? (
            <p role='status'>{t('No data')}</p>
          ) : (
            <>
              <Table aria-label={t('Consumption query')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {dimension === 'group' ? t('Group') : t('User ID')}
                    </TableHead>
                    {dimension === 'group' && (
                      <TableHead>{t('Group owner ID')}</TableHead>
                    )}
                    <TableHead>{t('Wallet consumption')}</TableHead>
                    <TableHead>{t('Subscription consumption')}</TableHead>
                    <TableHead>{t('Total consumption')}</TableHead>
                    <TableHead>{t('Requests')}</TableHead>
                    {dimension === 'group' && (
                      <TableHead>{t('Excluded user IDs')}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.slice((page - 1) * 20, page * 20).map((row) => (
                    <TableRow
                      key={dimension === 'group' ? row.group : row.user_id}
                    >
                      <TableCell>
                        {dimension === 'group' ? (
                          <Button
                            variant='link'
                            className='h-auto p-0'
                            disabled={query.isFetching}
                            onClick={() => {
                              const next = {
                                ...filters,
                                group: row.group,
                                dimension: 'user' as const,
                              }
                              setDraft(next)
                              setFilters(next)
                              setPage(1)
                            }}
                          >
                            {row.group}
                          </Button>
                        ) : (
                          `#${row.user_id}`
                        )}
                      </TableCell>
                      {dimension === 'group' && (
                        <TableCell>
                          {row.owner_user_id > 0
                            ? `#${row.owner_user_id}`
                            : '—'}
                        </TableCell>
                      )}
                      <TableCell>
                        {rebateUSD(row.wallet_quota, data.quota_per_usd)}
                      </TableCell>
                      <TableCell>
                        {rebateUSD(row.subscription_quota, data.quota_per_usd)}
                      </TableCell>
                      <TableCell>
                        {rebateUSD(row.total_quota, data.quota_per_usd)}
                      </TableCell>
                      <TableCell>{row.requests}</TableCell>
                      {dimension === 'group' && (
                        <TableCell>
                          <GroupUserExclusions
                            key={`${row.group}:${(excluded[row.group] ?? []).join(',')}`}
                            group={row.group}
                            userIDs={excluded[row.group] ?? []}
                            disabled={query.isFetching}
                            onApply={(ids) => applyExclusions(row.group, ids)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className='flex items-center justify-end gap-3'>
                <Button
                  variant='outline'
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  {t('Previous')}
                </Button>
                <span>
                  {page} / {Math.max(1, Math.ceil(data.items.length / 20))}
                </span>
                <Button
                  variant='outline'
                  disabled={page * 20 >= data.items.length || query.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  {t('Next')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
