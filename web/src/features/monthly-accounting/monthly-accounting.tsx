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
import { Badge } from '@/components/ui/badge'
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

import { accountingCNY, getMonthlyAccounting } from './api'
import { SnapshotUsers } from './snapshot-users'

export function MonthlyAccounting() {
  const { t } = useTranslation()
  const currentYear = Math.max(
    2026,
    new Date(Date.now() + 8 * 3600000).getUTCFullYear()
  )
  const [year, setYear] = useState(currentYear)
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['monthly-accounting', year],
    queryFn: () => getMonthlyAccounting(year),
    refetchInterval: 60000,
  })
  const statuses = {
    scheduled: t('Scheduled'),
    in_progress: t('In progress'),
    missing: t('Snapshot missing'),
    complete: t('Complete'),
    review: t('Needs reconciliation'),
  }
  return (
    <section className='space-y-4' aria-label={t('Monthly accounting')}>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h3 className='font-medium'>{t('Monthly accounting')}</h3>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            aria-label={t('Previous year')}
            disabled={year <= 2026}
            onClick={() => {
              setYear(year - 1)
              setSelectedPeriod(null)
            }}
          >
            {t('Previous')}
          </Button>
          <span>{year}</span>
          <Button
            variant='outline'
            aria-label={t('Next year')}
            disabled={year >= currentYear}
            onClick={() => {
              setYear(year + 1)
              setSelectedPeriod(null)
            }}
          >
            {t('Next')}
          </Button>
          <Button
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
      </div>
      {query.isPending && <Skeleton className='h-40 w-full' />}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load accounting data')}
          </AlertDescription>
        </Alert>
      )}
      {query.data && (
        <Table aria-label={t('Monthly accounting')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Month')}</TableHead>
              <TableHead>{t('Opening prepaid balance')}</TableHead>
              <TableHead>{t('Redemption receipts')}</TableHead>
              <TableHead>{t('Closing prepaid balance')}</TableHead>
              <TableHead>{t('Consumption revenue')}</TableHead>
              <TableHead>{t('Opening balance reversal')}</TableHead>
              <TableHead>{t('Bookkeeping revenue')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Snapshot balances')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.items.map((row) => (
              <TableRow key={row.period}>
                <TableCell>{row.period}</TableCell>
                <TableCell>
                  {accountingCNY(row.opening?.balance_quota, row.opening)}
                </TableCell>
                <TableCell>
                  {accountingCNY(row.receipts_quota, row.opening)}
                </TableCell>
                <TableCell>
                  {accountingCNY(row.closing?.balance_quota, row.closing)}
                </TableCell>
                <TableCell>
                  {accountingCNY(row.revenue_quota, row.opening)}
                </TableCell>
                <TableCell>
                  {accountingCNY(row.transition_adjustment_quota, row.opening)}
                </TableCell>
                <TableCell>
                  {accountingCNY(row.bookkeeping_revenue_quota, row.opening)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      ['missing', 'review'].includes(row.status)
                        ? 'destructive'
                        : 'secondary'
                    }
                  >
                    {statuses[row.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant='ghost'
                    disabled={!row.opening}
                    onClick={() => setSelectedPeriod(row.period)}
                    aria-label={t('View opening balances for {{period}}', {
                      period: row.period,
                    })}
                  >
                    {t('View')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {selectedPeriod && (
        <SnapshotUsers
          key={selectedPeriod}
          period={selectedPeriod}
          onClose={() => setSelectedPeriod(null)}
        />
      )}
    </section>
  )
}
