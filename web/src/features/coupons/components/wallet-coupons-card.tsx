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
import { Clock3, TicketPercent } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTimestamp } from '@/lib/format'

import { activateCoupon, getSelfCoupons } from '../api'
import {
  couponErrorKey,
  couponRemainingSeconds,
  couponStatusLabel,
  formatCouponCountdown,
  formatCouponDuration,
  formatCouponRatio,
  getCouponRuntimeStatus,
} from '../lib/coupon'
import type { Coupon, CouponEffectiveStatus } from '../types'

const SELF_COUPONS_QUERY_KEY = ['coupons', 'self'] as const

function statusVariant(status: CouponEffectiveStatus): StatusVariant {
  if (status === 'active') return 'success'
  if (status === 'available') return 'info'
  if (status === 'revoked') return 'danger'
  return 'neutral'
}

export function CouponRow(props: {
  coupon: Coupon
  nowSeconds: number
  onActivate: (coupon: Coupon) => void
  activating: boolean
}) {
  const { t } = useTranslation()
  const status = getCouponRuntimeStatus(props.coupon, props.nowSeconds)
  const ratio = formatCouponRatio(props.coupon.ratio_ppm)

  return (
    <div className='grid min-w-0 gap-3 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'>
      <div className='min-w-0'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='truncate font-medium'>{props.coupon.name}</span>
          <StatusBadge
            label={t(couponStatusLabel(status))}
            variant={statusVariant(status)}
            copyable={false}
          />
        </div>
        <p className='text-muted-foreground mt-1 text-xs'>
          {t('Up to {{ratio}}x for {{group}}', {
            ratio,
            group: props.coupon.applicable_group,
          })}
        </p>
        <div className='text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span>
            {t('Requests per minute')}:{' '}
            {props.coupon.rpm_limit > 0
              ? props.coupon.rpm_limit
              : t('Unlimited')}
          </span>
          {status === 'active' ? (
            <span className='inline-flex items-center gap-1 tabular-nums'>
              <Clock3 aria-hidden='true' />
              {t('Ends in {{time}}', {
                time: formatCouponCountdown(
                  couponRemainingSeconds(props.coupon, props.nowSeconds),
                  t
                ),
              })}
            </span>
          ) : (
            <span>
              {t('Activate by {{time}}', {
                time: formatTimestamp(props.coupon.activate_before),
              })}
            </span>
          )}
          {props.coupon.activated_at === 0 ? (
            <span>
              {t('Active for {{duration}}', {
                duration: formatCouponDuration(
                  props.coupon.active_duration_seconds,
                  t
                ),
              })}
            </span>
          ) : null}
        </div>
      </div>

      {status === 'available' ? (
        <Button
          size='sm'
          onClick={() => props.onActivate(props.coupon)}
          disabled={props.activating}
        >
          <TicketPercent data-icon='inline-start' />
          {t('Activate')}
        </Button>
      ) : null}
    </div>
  )
}

export function WalletCouponsCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000)
  )
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null)
  const couponsQuery = useQuery({
    queryKey: SELF_COUPONS_QUERY_KEY,
    queryFn: getSelfCoupons,
  })
  const coupons = couponsQuery.data?.data || []
  const hasActiveWindow = coupons.some(
    (coupon) =>
      coupon.effective_status === 'active' && coupon.active_until > nowSeconds
  )
  const activateMutation = useMutation({
    mutationFn: activateCoupon,
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(t(couponErrorKey(result.code)))
        return
      }
      toast.success(t('Coupon activated'))
      setSelectedCoupon(null)
      await queryClient.invalidateQueries({ queryKey: SELF_COUPONS_QUERY_KEY })
    },
    onError: () => toast.error(t('Coupon operation failed')),
  })

  useEffect(() => {
    if (!hasActiveWindow) return undefined
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveWindow])

  const orderedCoupons = [...coupons].sort((left, right) => {
    const priority: Record<CouponEffectiveStatus, number> = {
      active: 0,
      available: 1,
      expired: 2,
      ended: 3,
      revoked: 4,
    }
    return (
      priority[getCouponRuntimeStatus(left, nowSeconds)] -
        priority[getCouponRuntimeStatus(right, nowSeconds)] ||
      right.issued_at - left.issued_at
    )
  })
  const activeCount = orderedCoupons.filter(
    (coupon) => getCouponRuntimeStatus(coupon, nowSeconds) === 'active'
  ).length

  return (
    <>
      <Card data-card-hover='false'>
        <CardHeader>
          <div className='flex min-w-0 items-center gap-2.5'>
            <IconBadge tone='chart-5'>
              <TicketPercent />
            </IconBadge>
            <div className='min-w-0'>
              <CardTitle>{t('Discount Coupons')}</CardTitle>
              <CardDescription>
                {t(
                  'Activate a coupon before use to cap billing for its group.'
                )}
              </CardDescription>
            </div>
          </div>
          {activeCount > 0 ? (
            <CardAction>
              <StatusBadge
                label={t('{{count}} active', { count: activeCount })}
                variant='success'
                copyable={false}
                pulse
              />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {couponsQuery.isLoading && (
            <div className='flex flex-col gap-3'>
              {[0, 1].map((item) => (
                <Skeleton key={item} className='h-20 w-full' />
              ))}
            </div>
          )}
          {!couponsQuery.isLoading && orderedCoupons.length === 0 && (
            <Empty className='min-h-36 border'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <TicketPercent />
                </EmptyMedia>
                <EmptyTitle>{t('No coupons yet')}</EmptyTitle>
                <EmptyDescription>
                  {t('Coupons issued by an administrator will appear here.')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!couponsQuery.isLoading && orderedCoupons.length > 0 && (
            <div className='max-h-80 overflow-y-auto pr-1'>
              {orderedCoupons.map((coupon) => (
                <CouponRow
                  key={coupon.id}
                  coupon={coupon}
                  nowSeconds={nowSeconds}
                  onActivate={setSelectedCoupon}
                  activating={activateMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={selectedCoupon !== null}
        onOpenChange={(open) => !open && setSelectedCoupon(null)}
        title={t('Activate coupon?')}
        desc={t(
          'Once activated, this coupon remains active for {{duration}} and cannot be paused.',
          {
            duration: selectedCoupon
              ? formatCouponDuration(selectedCoupon.active_duration_seconds, t)
              : '-',
          }
        )}
        confirmText={t('Activate')}
        isLoading={activateMutation.isPending}
        handleConfirm={() => {
          if (selectedCoupon) activateMutation.mutate(selectedCoupon.id)
        }}
      />
    </>
  )
}
