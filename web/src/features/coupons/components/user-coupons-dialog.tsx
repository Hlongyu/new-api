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
import { Ban, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { FieldSet, FieldLegend } from '@/components/ui/field'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { getGroups } from '@/features/users/api'
import { formatTimestamp } from '@/lib/format'

import { getAdminUserCoupons, issueCoupons, revokeCoupon } from '../api'
import {
  couponErrorKey,
  couponStatusLabel,
  formatCouponDuration,
  formatCouponRatio,
  getCouponRuntimeStatus,
} from '../lib/coupon'
import {
  createCouponFormDefaults,
  getCouponFormSchema,
  type CouponFormValues,
} from '../lib/coupon-form'
import type { Coupon, CouponEffectiveStatus } from '../types'
import { CouponIssueFields } from './coupon-issue-fields'

interface UserCouponsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username?: string } | null
}

function statusVariant(status: CouponEffectiveStatus): StatusVariant {
  if (status === 'active') return 'success'
  if (status === 'available') return 'info'
  if (status === 'revoked') return 'danger'
  return 'neutral'
}

export function UserCouponsDialog(props: UserCouponsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<Coupon | null>(null)
  const schema = useMemo(() => getCouponFormSchema(t), [t])
  const form = useForm<CouponFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createCouponFormDefaults(),
  })
  const userId = props.user?.id || 0
  const queryKey = ['coupons', 'admin', userId] as const
  const couponsQuery = useQuery({
    queryKey,
    queryFn: () => getAdminUserCoupons(userId),
    enabled: props.open && userId > 0,
  })
  const groupsQuery = useQuery({
    queryKey: ['groups', 'coupon-options'],
    queryFn: getGroups,
    enabled: props.open,
  })
  const issueMutation = useMutation({
    mutationFn: (values: CouponFormValues) =>
      issueCoupons({
        scope: 'selected',
        user_ids: [userId],
        name: values.name.trim(),
        applicable_group: values.applicableGroup,
        ratio_ppm: Math.round(values.ratio * 1_000_000),
        rpm_limit: values.rpmLimit,
        activate_before: Math.floor(values.activationDeadline.getTime() / 1000),
        active_duration_seconds: values.activeDurationMinutes * 60,
        idempotency_key: crypto.randomUUID(),
      }),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t(couponErrorKey(result.code)))
        return
      }
      toast.success(t('Coupon issued'))
      form.reset(createCouponFormDefaults())
      await queryClient.invalidateQueries({ queryKey })
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
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error(t('Coupon operation failed')),
  })

  const groups = [...(groupsQuery.data?.data || [])].sort((left, right) =>
    left.localeCompare(right)
  )
  const coupons = couponsQuery.data?.data || []
  const nowSeconds = Math.floor(Date.now() / 1000)

  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetContent className={sideDrawerContentClassName('sm:max-w-2xl')}>
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>{t('Manage Coupons')}</SheetTitle>
            <SheetDescription>
              {props.user?.username || '-'} (ID: {userId || '-'})
            </SheetDescription>
          </SheetHeader>

          <form
            id='issue-coupon-form'
            className={sideDrawerFormClassName()}
            onSubmit={form.handleSubmit((values) =>
              issueMutation.mutate(values)
            )}
          >
            <FieldSet>
              <FieldLegend>{t('Issue Coupon')}</FieldLegend>
              <CouponIssueFields
                form={form}
                groups={groups}
                idPrefix='user-coupon'
              />
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('Issued Coupons')}</FieldLegend>
              {couponsQuery.isLoading && (
                <div className='flex flex-col gap-2'>
                  {[0, 1].map((item) => (
                    <Skeleton key={item} className='h-20 w-full' />
                  ))}
                </div>
              )}
              {!couponsQuery.isLoading && coupons.length === 0 && (
                <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm'>
                  {t('No coupons issued to this user')}
                </div>
              )}
              {!couponsQuery.isLoading && coupons.length > 0 && (
                <div className='flex max-h-72 flex-col overflow-y-auto rounded-lg border px-3'>
                  {coupons.map((coupon) => {
                    const status = getCouponRuntimeStatus(coupon, nowSeconds)
                    return (
                      <div
                        key={coupon.id}
                        className='grid gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                      >
                        <div className='min-w-0'>
                          <div className='flex min-w-0 flex-wrap items-center gap-2'>
                            <span className='truncate font-medium'>
                              {coupon.name}
                            </span>
                            <StatusBadge
                              label={t(couponStatusLabel(status))}
                              variant={statusVariant(status)}
                              copyable={false}
                            />
                          </div>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {t('{{group}} at up to {{ratio}}x', {
                              group: coupon.applicable_group,
                              ratio: formatCouponRatio(coupon.ratio_ppm),
                            })}
                          </p>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {t('Requests per minute')}:{' '}
                            {coupon.rpm_limit > 0
                              ? coupon.rpm_limit
                              : t('Unlimited')}
                          </p>
                          <p className='text-muted-foreground mt-1 text-xs'>
                            {status === 'active'
                              ? t('Active until {{time}}', {
                                  time: formatTimestamp(coupon.active_until),
                                })
                              : t(
                                  'Activate by {{time}}, active for {{duration}}',
                                  {
                                    time: formatTimestamp(
                                      coupon.activate_before
                                    ),
                                    duration: formatCouponDuration(
                                      coupon.active_duration_seconds,
                                      t
                                    ),
                                  }
                                )}
                          </p>
                        </div>
                        {status === 'available' || status === 'active' ? (
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setRevokeTarget(coupon)}
                          >
                            <Ban data-icon='inline-start' />
                            {t('Revoke')}
                          </Button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </FieldSet>
          </form>

          <SheetFooter className={sideDrawerFooterClassName()}>
            <Button
              type='submit'
              form='issue-coupon-form'
              disabled={issueMutation.isPending || userId <= 0}
            >
              {issueMutation.isPending ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <Plus data-icon='inline-start' />
              )}
              {t('Issue Coupon')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

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
