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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { rebateTime } from '@/features/monthly-rebates/lib/format'

import { accountingCNY, getSnapshotUsers } from './api'

export function SnapshotUsers(props: { period: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['monthly-accounting', 'users', props.period, page],
    queryFn: () => getSnapshotUsers(props.period, page),
    staleTime: Infinity,
  })
  const data = query.data
  return (
    <section className='space-y-3' aria-label={t('Snapshot balances')}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4 className='font-medium'>
          {t('Snapshot balances')} · {props.period}
        </h4>
        <Button variant='ghost' onClick={props.onClose}>
          {t('Close')}
        </Button>
      </div>
      {query.isPending && <Skeleton className='h-32 w-full' />}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load accounting data')}{' '}
            <Button variant='outline' onClick={() => void query.refetch()}>
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && (
        <>
          <p className='text-muted-foreground text-sm'>
            {t('Captured at')}:{' '}
            {rebateTime(data.snapshot.captured_at, i18n.language)} ·{' '}
            {t('Total')}: {data.total} ·{' '}
            {accountingCNY(data.snapshot.balance_quota, data.snapshot)}
          </p>
          {data.snapshot.status !== 'captured' && (
            <Alert>
              <AlertDescription>
                {t(
                  'This snapshot needs reconciliation; it is not an exact month-opening balance.'
                )}
              </AlertDescription>
            </Alert>
          )}
          <Table aria-label={t('Snapshot balances')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('User ID')}</TableHead>
                <TableHead>{t('Username')}</TableHead>
                <TableHead>{t('Balance (CNY)')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>{t('No users found')}</TableCell>
                </TableRow>
              )}
              {data.items.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>#{user.user_id}</TableCell>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>
                    {accountingCNY(user.quota, data.snapshot)}
                  </TableCell>
                  <TableCell>{user.deleted ? t('Deleted') : '—'}</TableCell>
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
              {page} / {Math.max(1, Math.ceil(data.total / 20))}
            </span>
            <Button
              variant='outline'
              disabled={page * 20 >= data.total || query.isFetching}
              onClick={() => setPage(page + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
