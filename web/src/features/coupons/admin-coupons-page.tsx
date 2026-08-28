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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Search,
  Send,
  Users,
} from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { getGroups, getUsers, searchUsers } from '@/features/users/api'
import type { User } from '@/features/users/types'
import { formatTimestamp } from '@/lib/format'

import { getAdminCoupons, issueCoupons, revokeCoupon } from './api'
import { CouponIssueFields } from './components/coupon-issue-fields'
import {
  couponErrorKey,
  couponStatusLabel,
  formatCouponRatio,
  getCouponRuntimeStatus,
} from './lib/coupon'
import {
  COUPON_FORM_DEFAULTS,
  getCouponFormSchema,
  type CouponFormValues,
} from './lib/coupon-form'
import type { Coupon, CouponEffectiveStatus } from './types'

type RecipientScope = 'selected' | 'all'

function statusVariant(status: CouponEffectiveStatus): StatusVariant {
  if (status === 'active') return 'success'
  if (status === 'available') return 'info'
  if (status === 'revoked') return 'danger'
  return 'neutral'
}

export function AdminCouponsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<RecipientScope>('selected')
  const [userSearch, setUserSearch] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<User[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [pendingAllValues, setPendingAllValues] =
    useState<CouponFormValues | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Coupon | null>(null)
  const deferredUserSearch = useDeferredValue(userSearch.trim())
  const deferredHistorySearch = useDeferredValue(historySearch.trim())
  const schema = useMemo(() => getCouponFormSchema(t), [t])
  const form = useForm<CouponFormValues>({
    resolver: zodResolver(schema),
    defaultValues: COUPON_FORM_DEFAULTS,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups', 'coupon-options'],
    queryFn: getGroups,
  })
  const usersQuery = useQuery({
    queryKey: ['users', 'coupon-recipients', deferredUserSearch],
    queryFn: () =>
      deferredUserSearch
        ? searchUsers({ keyword: deferredUserSearch, p: 1, page_size: 20 })
        : getUsers({ p: 1, page_size: 20 }),
    enabled: scope === 'selected',
  })
  const allUsersQuery = useQuery({
    queryKey: ['users', 'coupon-recipient-count'],
    queryFn: () => getUsers({ p: 1, page_size: 1 }),
    enabled: scope === 'all',
  })
  const historyQueryKey = [
    'coupons',
    'admin',
    'list',
    historyPage,
    deferredHistorySearch,
  ] as const
  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: () =>
      getAdminCoupons({
        p: historyPage,
        page_size: 20,
        keyword: deferredHistorySearch || undefined,
      }),
    placeholderData: (previousData) => previousData,
  })

  const issueMutation = useMutation({
    mutationFn: ({
      values,
      recipientScope,
    }: {
      values: CouponFormValues
      recipientScope: RecipientScope
    }) =>
      issueCoupons({
        scope: recipientScope,
        user_ids:
          recipientScope === 'selected'
            ? selectedUsers.map((user) => user.id)
            : undefined,
        name: values.name.trim(),
        applicable_group: values.applicableGroup,
        ratio_ppm: Math.round(values.ratio * 1_000_000),
        valid_for_seconds: values.validityDays * 24 * 60 * 60,
        active_duration_seconds: Math.round(
          values.activeDurationHours * 60 * 60
        ),
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t(couponErrorKey(result.code)))
        return
      }
      toast.success(
        t('Issued {{count}} coupons', { count: result.data?.issued_count || 0 })
      )
      setSelectedUsers([])
      setPendingAllValues(null)
      setHistoryPage(1)
      await queryClient.invalidateQueries({
        queryKey: ['coupons', 'admin', 'list'],
      })
    },
    onError: () => toast.error(t('Coupon operation failed')),
  })
  const revokeMutation = useMutation({
    mutationFn: revokeCoupon,
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t(couponErrorKey(result.code)))
        return
      }
      toast.success(t('Coupon revoked'))
      setRevokeTarget(null)
      await queryClient.invalidateQueries({
        queryKey: ['coupons', 'admin', 'list'],
      })
    },
    onError: () => toast.error(t('Coupon operation failed')),
  })

  const groups = [...(groupsQuery.data?.data || [])].sort((left, right) =>
    left.localeCompare(right)
  )
  const userResults = usersQuery.data?.data?.items || []
  const selectedIds = new Set(selectedUsers.map((user) => user.id))
  const allUserCount = allUsersQuery.data?.data?.total || 0
  const history = historyQuery.data?.data
  const historyItems = history?.items || []
  const historyPages = Math.max(1, Math.ceil((history?.total || 0) / 20))
  const nowSeconds = Math.floor(Date.now() / 1000)

  const columns = useMemo<StaticDataTableColumn<Coupon>[]>(
    () => [
      {
        id: 'recipient',
        header: t('Recipient'),
        className: 'min-w-40',
        cell: (coupon) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{coupon.username || '-'}</div>
            <div className='text-muted-foreground text-xs'>
              ID: {coupon.user_id}
            </div>
          </div>
        ),
      },
      {
        id: 'coupon',
        header: t('Coupon'),
        className: 'min-w-44',
        cell: (coupon) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{coupon.name}</div>
            <div className='text-muted-foreground text-xs'>
              {coupon.applicable_group}
            </div>
          </div>
        ),
      },
      {
        id: 'ratio',
        header: t('Ratio cap'),
        cell: (coupon) => `${formatCouponRatio(coupon.ratio_ppm)}x`,
      },
      {
        id: 'issued',
        header: t('Issued at'),
        className: 'min-w-40',
        cell: (coupon) => formatTimestamp(coupon.issued_at),
      },
      {
        id: 'status',
        header: t('Status'),
        cell: (coupon) => {
          const status = getCouponRuntimeStatus(coupon, nowSeconds)
          return (
            <StatusBadge
              label={t(couponStatusLabel(status))}
              variant={statusVariant(status)}
              copyable={false}
            />
          )
        },
      },
      {
        id: 'actions',
        header: '',
        className: 'w-12',
        cellClassName: 'text-right',
        cell: (coupon) => {
          const status = getCouponRuntimeStatus(coupon, nowSeconds)
          if (status !== 'available' && status !== 'active') return null
          return (
            <Button
              type='button'
              variant='ghost'
              size='icon-sm'
              aria-label={t('Revoke')}
              title={t('Revoke')}
              onClick={() => setRevokeTarget(coupon)}
            >
              <Ban />
            </Button>
          )
        },
      },
    ],
    [nowSeconds, t]
  )

  function toggleUser(user: User) {
    setSelectedUsers((current) => {
      if (current.some((item) => item.id === user.id)) {
        return current.filter((item) => item.id !== user.id)
      }
      return [...current, user]
    })
  }

  function submitIssue(values: CouponFormValues) {
    if (scope === 'all') {
      setPendingAllValues(values)
      return
    }
    issueMutation.mutate({ values, recipientScope: 'selected' })
  }

  const selectedRecipientsMissing =
    scope === 'selected' && selectedUsers.length === 0
  const allRecipientsMissing = scope === 'all' && allUserCount === 0

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Coupons')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex flex-col gap-8'>
            <section className='grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]'>
              <form
                id='admin-issue-coupon-form'
                className='rounded-lg border p-4 sm:p-5'
                onSubmit={form.handleSubmit(submitIssue)}
              >
                <FieldSet>
                  <FieldLegend>{t('Coupon terms')}</FieldLegend>
                  <CouponIssueFields
                    form={form}
                    groups={groups}
                    idPrefix='admin-coupon'
                  />
                </FieldSet>
              </form>

              <section className='rounded-lg border p-4 sm:p-5'>
                <div className='flex flex-col gap-4'>
                  <div>
                    <h2 className='text-sm font-semibold'>{t('Recipients')}</h2>
                    <p className='text-muted-foreground mt-1 text-sm'>
                      {t(
                        'Choose specific users or issue this coupon to everyone.'
                      )}
                    </p>
                  </div>
                  <ToggleGroup
                    value={[scope]}
                    onValueChange={(values) => {
                      const next = values.find((value) => value !== scope)
                      if (next === 'selected' || next === 'all') setScope(next)
                    }}
                    variant='outline'
                    className='grid w-full grid-cols-2'
                    aria-label={t('Recipients')}
                  >
                    <ToggleGroupItem value='selected' className='w-full'>
                      <Users data-icon='inline-start' />
                      {t('Selected users')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value='all' className='w-full'>
                      <Globe2 data-icon='inline-start' />
                      {t('All users')}
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {scope === 'selected' && (
                    <div className='flex flex-col gap-3'>
                      <Field>
                        <FieldLabel htmlFor='coupon-user-search'>
                          {t('Search users')}
                        </FieldLabel>
                        <div className='relative'>
                          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
                          <Input
                            id='coupon-user-search'
                            className='pl-8'
                            value={userSearch}
                            onChange={(event) =>
                              setUserSearch(event.target.value)
                            }
                            placeholder={t('Search by username or ID')}
                          />
                        </div>
                      </Field>
                      <div className='text-muted-foreground text-xs'>
                        {t('{{count}} users selected', {
                          count: selectedUsers.length,
                        })}
                      </div>
                      <div className='max-h-64 overflow-y-auto rounded-lg border'>
                        {usersQuery.isLoading && (
                          <div className='flex flex-col gap-2 p-3'>
                            {[0, 1, 2].map((item) => (
                              <Skeleton key={item} className='h-9 w-full' />
                            ))}
                          </div>
                        )}
                        {!usersQuery.isLoading && userResults.length === 0 && (
                          <div className='text-muted-foreground px-4 py-8 text-center text-sm'>
                            {t('No users found')}
                          </div>
                        )}
                        {!usersQuery.isLoading &&
                          userResults.map((user) => (
                            <label
                              key={user.id}
                              className='hover:bg-muted/50 flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 last:border-b-0'
                            >
                              <Checkbox
                                checked={selectedIds.has(user.id)}
                                onCheckedChange={() => toggleUser(user)}
                              />
                              <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                                {user.username}
                              </span>
                              <span className='text-muted-foreground text-xs'>
                                ID: {user.id}
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}

                  {scope === 'all' && (
                    <Alert>
                      <Globe2 />
                      <AlertTitle>{t('Issue to all users')}</AlertTitle>
                      <AlertDescription>
                        {allUsersQuery.isLoading
                          ? t('Counting recipients...')
                          : t(
                              'This coupon will be issued to all {{count}} users.',
                              {
                                count: allUserCount,
                              }
                            )}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type='submit'
                    form='admin-issue-coupon-form'
                    size='lg'
                    disabled={
                      issueMutation.isPending ||
                      selectedRecipientsMissing ||
                      allRecipientsMissing
                    }
                    className='w-full'
                  >
                    {issueMutation.isPending ? (
                      <Spinner data-icon='inline-start' />
                    ) : (
                      <Send data-icon='inline-start' />
                    )}
                    {scope === 'all'
                      ? t('Issue to all users')
                      : t('Issue to selected users')}
                  </Button>
                </div>
              </section>
            </section>

            <section className='flex flex-col gap-4 border-t pt-6'>
              <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
                <div>
                  <h2 className='text-base font-semibold'>
                    {t('Coupon history')}
                  </h2>
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {t('Review issued coupons and revoke active grants.')}
                  </p>
                </div>
                <Field className='w-full sm:max-w-xs'>
                  <FieldLabel
                    htmlFor='coupon-history-search'
                    className='sr-only'
                  >
                    {t('Search coupon history')}
                  </FieldLabel>
                  <div className='relative'>
                    <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
                    <Input
                      id='coupon-history-search'
                      className='pl-8'
                      value={historySearch}
                      onChange={(event) => {
                        setHistorySearch(event.target.value)
                        setHistoryPage(1)
                      }}
                      placeholder={t('Search recipient, coupon, or batch')}
                    />
                  </div>
                </Field>
              </div>

              {historyQuery.isLoading ? (
                <Skeleton className='h-64 w-full' />
              ) : (
                <StaticDataTable
                  data={historyItems}
                  columns={columns}
                  getRowKey={(coupon) => coupon.id}
                  emptyContent={t('No coupon history found')}
                  tableClassName='text-sm'
                />
              )}

              <div className='flex items-center justify-between gap-3'>
                <span className='text-muted-foreground text-sm'>
                  {t('Page {{page}} of {{pages}}', {
                    page: historyPage,
                    pages: historyPages,
                  })}
                </span>
                <div className='flex items-center gap-1'>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-sm'
                    aria-label={t('Previous page')}
                    title={t('Previous page')}
                    disabled={historyPage <= 1}
                    onClick={() =>
                      setHistoryPage((page) => Math.max(1, page - 1))
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon-sm'
                    aria-label={t('Next page')}
                    title={t('Next page')}
                    disabled={historyPage >= historyPages}
                    onClick={() =>
                      setHistoryPage((page) => Math.min(historyPages, page + 1))
                    }
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ConfirmDialog
        open={pendingAllValues !== null}
        onOpenChange={(open) => !open && setPendingAllValues(null)}
        title={t('Issue coupon to all users?')}
        desc={t('This will create one coupon for each of {{count}} users.', {
          count: allUserCount,
        })}
        confirmText={t('Issue to all users')}
        isLoading={issueMutation.isPending}
        handleConfirm={() => {
          if (pendingAllValues) {
            issueMutation.mutate({
              values: pendingAllValues,
              recipientScope: 'all',
            })
          }
        }}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t('Revoke coupon?')}
        desc={t('This stops the coupon from applying to future requests.')}
        confirmText={t('Revoke')}
        destructive
        isLoading={revokeMutation.isPending}
        handleConfirm={() => {
          if (revokeTarget) revokeMutation.mutate(revokeTarget.id)
        }}
      />
    </>
  )
}
