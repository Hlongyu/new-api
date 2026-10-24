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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { handleServerError } from '@/lib/handle-server-error'

import {
  cancelGroupRatioSchedule,
  getGroupRatioSchedules,
  scheduleQueryKey,
  type GroupRatioSchedule,
} from './group-ratio-schedule-api'
import { GroupRatioScheduleForm } from './group-ratio-schedule-form'
import { formatBeijingTime } from './group-ratio-schedule-time'

export function GroupRatioSchedules(props: { groups: string[] }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [status, setStatus] = useState<'pending' | 'history'>('pending')
  const [page, setPage] = useState(1)
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null)
  const plans = useQuery({
    queryKey: [...scheduleQueryKey, status, page],
    queryFn: () => getGroupRatioSchedules(status, page),
    refetchInterval: 10000,
  })
  const cancel = useMutation({
    mutationFn: cancelGroupRatioSchedule,
    onSuccess: () => {
      setConfirmCancel(null)
      void client.invalidateQueries({ queryKey: scheduleQueryKey })
      toast.success(t('Scheduled change cancelled.'))
    },
    onError: handleServerError,
  })
  function statusLabel(plan: GroupRatioSchedule) {
    if (plan.status === 'succeeded') return t('Executed')
    if (plan.status === 'cancelled') return t('Cancelled')
    if (plan.status === 'failed') return t('Failed')
    return t('Pending')
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Scheduled group ratio changes')}</CardTitle>
        <CardDescription>
          {t(
            'Change a base group ratio once at a Beijing time. It stays in effect until changed again; group-specific overrides still take precedence.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <GroupRatioScheduleForm groups={props.groups} />
        <p className='text-muted-foreground text-sm'>
          {t(
            'Schedules survive restarts. Overdue changes run when the service resumes, in time order.'
          )}
        </p>
        <div
          className='flex gap-2'
          role='group'
          aria-label={t('Schedule records')}
        >
          <Button
            variant={status === 'pending' ? 'default' : 'outline'}
            aria-pressed={status === 'pending'}
            onClick={() => {
              setStatus('pending')
              setPage(1)
              setConfirmCancel(null)
            }}
          >
            {t('Pending')}
          </Button>
          <Button
            variant={status === 'history' ? 'default' : 'outline'}
            aria-pressed={status === 'history'}
            onClick={() => {
              setStatus('history')
              setPage(1)
              setConfirmCancel(null)
            }}
          >
            {t('History')}
          </Button>
        </div>
        {plans.isPending && <p role='status'>{t('Loading...')}</p>}
        {plans.isError && (
          <div role='alert'>
            <p>{t('Unable to load scheduled changes.')}</p>
            <Button variant='outline' onClick={() => void plans.refetch()}>
              {t('Retry')}
            </Button>
          </div>
        )}
        {plans.data && plans.data.items.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('No scheduled changes in this view.')}
          </p>
        )}
        {plans.data && plans.data.items.length > 0 && (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <caption className='sr-only'>
                {t('Scheduled group ratio changes')}
              </caption>
              <thead>
                <tr className='border-b'>
                  {[
                    t('Group'),
                    t('Target group ratio'),
                    t('Execution time (Beijing, UTC+8)'),
                    t('Status'),
                    t('Actions'),
                  ].map((label) => (
                    <th key={label} scope='col' className='p-2'>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.data.items.map((plan) => (
                  <tr key={plan.id} className='border-b'>
                    <td className='max-w-64 p-2 break-all'>{plan.group}</td>
                    <td className='p-2'>
                      {plan.previous_ratio !== null && (
                        <span className='text-muted-foreground'>
                          {plan.previous_ratio} →{' '}
                        </span>
                      )}
                      {plan.ratio}
                    </td>
                    <td className='p-2 whitespace-nowrap'>
                      {formatBeijingTime(plan.execute_at)}
                      {plan.finished_at > 0 && (
                        <p className='text-muted-foreground text-xs'>
                          {t('Finished at {{time}}', {
                            time: formatBeijingTime(plan.finished_at),
                          })}
                        </p>
                      )}
                    </td>
                    <td className='p-2'>
                      {statusLabel(plan)}
                      {plan.status === 'failed' && (
                        <p className='text-destructive'>
                          {plan.error === 'group no longer exists'
                            ? t('The group no longer exists.')
                            : plan.error}
                        </p>
                      )}
                    </td>
                    <td className='p-2'>
                      {plan.status === 'pending' &&
                        (confirmCancel === plan.id ? (
                          <div className='flex flex-wrap gap-2'>
                            <Button
                              variant='destructive'
                              size='sm'
                              disabled={cancel.isPending}
                              onClick={() => cancel.mutate(plan.id)}
                            >
                              {t('Confirm cancellation')}
                            </Button>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={cancel.isPending}
                              onClick={() => setConfirmCancel(null)}
                            >
                              {t('Keep schedule')}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant='outline'
                            size='sm'
                            disabled={cancel.isPending}
                            aria-label={t(
                              'Cancel scheduled change for {{group}}',
                              { group: plan.group }
                            )}
                            onClick={() => setConfirmCancel(plan.id)}
                          >
                            {t('Cancel')}
                          </Button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className='flex items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page === 1 || plans.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('Previous')}
          </Button>
          <span>{page}</span>
          <Button
            variant='outline'
            size='sm'
            disabled={
              !plans.data || page * 20 >= plans.data.total || plans.isFetching
            }
            onClick={() => setPage(page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
