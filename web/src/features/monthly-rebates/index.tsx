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

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'

import {
  issueMonthlyRebate,
  listMonthlyRebates,
  recalculateMonthlyRebates,
} from './api'
import { RebateReviewDialog } from './components/rebate-review-dialog'
import { RebateTable } from './components/rebate-table'
import { previousBeijingMonth } from './lib/format'
import type { MonthlyRebate, MonthlyRebateFilters } from './types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MonthlyRebatesDialog(props: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<MonthlyRebateFilters>(() => ({
    period: previousBeijingMonth(),
    status: '',
    user_id: '',
    p: 1,
  }))
  const [selected, setSelected] = useState<MonthlyRebate | null>(null)
  const validFilters =
    /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.period) &&
    filters.period <= previousBeijingMonth() &&
    (filters.user_id === '' || /^[1-9]\d*$/.test(filters.user_id))
  const records = useQuery({
    queryKey: ['monthly-rebates', filters],
    queryFn: () => listMonthlyRebates(filters),
    enabled: props.open && validFilters,
  })
  const recalculate = useMutation({
    mutationFn: () => recalculateMonthlyRebates(filters.period),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['monthly-rebates'] })
      toast.success(t('Rebate calculations updated'))
    },
    onError: async (error: Error) => {
      await queryClient.invalidateQueries({ queryKey: ['monthly-rebates'] })
      toast.error(error.message || t('Failed to calculate rebates'))
    },
  })
  const issue = useMutation({
    mutationFn: issueMonthlyRebate,
    onSuccess: async () => {
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['monthly-rebates'] })
      toast.success(t('Rebate issued'))
    },
    onError: async () => {
      setSelected(null)
      await queryClient.invalidateQueries({ queryKey: ['monthly-rebates'] })
      toast.error(
        t(
          'Issuance failed or the calculation changed. Refresh the record and review again.'
        )
      )
    },
  })
  const busy = recalculate.isPending || issue.isPending
  const summary = records.data?.summary
  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!busy) {
            setSelected(null)
            props.onOpenChange(open)
          }
        }}
        title={t('Monthly rebates')}
        description={t(
          'Beijing calendar months. Wallet API consumption above 700 earns 5%; above 1,400 earns 10% on the whole month. Subscription consumption and violation fees are excluded.'
        )}
        contentClassName='sm:max-w-6xl'
        bodyClassName='space-y-4'
        contentHeight='min(70vh, 760px)'
      >
        <div className='flex flex-wrap items-end gap-3'>
          <Field className='w-44'>
            <FieldLabel htmlFor='rebate-month'>{t('Month')}</FieldLabel>
            <Input
              id='rebate-month'
              type='month'
              max={previousBeijingMonth()}
              value={filters.period}
              disabled={busy}
              onChange={(event) =>
                setFilters({ ...filters, period: event.target.value, p: 1 })
              }
            />
          </Field>
          <Field className='w-44'>
            <FieldLabel htmlFor='rebate-status'>{t('Status')}</FieldLabel>
            <NativeSelect
              id='rebate-status'
              value={filters.status}
              disabled={busy}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  status: event.target.value as MonthlyRebateFilters['status'],
                  p: 1,
                })
              }
            >
              <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
              <NativeSelectOption value='pending'>
                {t('Pending review')}
              </NativeSelectOption>
              <NativeSelectOption value='issued'>
                {t('Rebate issued')}
              </NativeSelectOption>
              <NativeSelectOption value='ineligible'>
                {t('Below rebate threshold')}
              </NativeSelectOption>
              <NativeSelectOption value='needs_review'>
                {t('Needs reconciliation')}
              </NativeSelectOption>
              <NativeSelectOption value='failed'>
                {t('Failed')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field className='w-32'>
            <FieldLabel htmlFor='rebate-user'>{t('User ID')}</FieldLabel>
            <Input
              id='rebate-user'
              type='number'
              min={1}
              value={filters.user_id}
              disabled={busy}
              onChange={(event) =>
                setFilters({ ...filters, user_id: event.target.value, p: 1 })
              }
            />
          </Field>
          <Button
            variant='outline'
            disabled={busy || !validFilters || records.isFetching}
            onClick={() => void records.refetch()}
          >
            {t('Refresh')}
          </Button>
          <Button
            disabled={busy || !validFilters}
            onClick={() => recalculate.mutate()}
          >
            {recalculate.isPending ? t('Processing...') : t('Calculate month')}
          </Button>
        </div>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Calculation does not issue rewards. Review each record before approval. All times are Beijing time.'
          )}
        </p>
        {!validFilters && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Select a completed month and a valid user ID.')}
            </AlertDescription>
          </Alert>
        )}
        {summary && (
          <p className='text-sm'>
            {t(
              'Records: {{total}} · Pending: {{pending}} · Issued: {{issued}} · Needs review: {{review}} · Failed: {{failed}}',
              {
                total: summary.users,
                pending: summary.pending,
                issued: summary.issued,
                review: summary.needs_review,
                failed: summary.failed,
              }
            )}
          </p>
        )}
        {records.isError && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Failed to load rebate records')}
            </AlertDescription>
          </Alert>
        )}
        {records.isLoading && <Skeleton className='h-48 w-full' />}
        {records.data && validFilters && (
          <RebateTable bills={records.data.items} onSelect={setSelected} />
        )}
        {records.data && validFilters && (
          <div className='flex items-center justify-end gap-3'>
            <Button
              variant='outline'
              disabled={filters.p <= 1 || records.isFetching || busy}
              onClick={() => setFilters({ ...filters, p: filters.p - 1 })}
            >
              {t('Previous')}
            </Button>
            <span className='text-sm'>
              {filters.p} / {Math.max(1, Math.ceil(records.data.total / 20))}
            </span>
            <Button
              variant='outline'
              disabled={
                filters.p * 20 >= records.data.total ||
                records.isFetching ||
                busy
              }
              onClick={() => setFilters({ ...filters, p: filters.p + 1 })}
            >
              {t('Next')}
            </Button>
          </div>
        )}
      </Dialog>
      <RebateReviewDialog
        bill={selected}
        pending={issue.isPending}
        onClose={() => setSelected(null)}
        onIssue={(bill) => issue.mutate(bill)}
      />
    </>
  )
}
