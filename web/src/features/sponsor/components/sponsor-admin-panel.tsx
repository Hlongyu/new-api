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
import { ChevronDown, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { SPONSOR_ADMIN_PAGE_SIZE, SPONSOR_STATUS_LABEL_KEY } from '../constants'
import { useSponsorAdminView } from '../hooks'
import type { SponsorAdminOrder, SponsorOrderStatus } from '../types'

const STATUS_VARIANT: Record<
  SponsorOrderStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  completed: 'secondary',
  processing: 'outline',
  failed: 'destructive',
  unknown: 'outline',
}

function needsAttention(status: SponsorOrderStatus): boolean {
  return status === 'failed' || status === 'unknown'
}

function formatDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return new Date(seconds * 1000).toLocaleDateString()
}

function OrderRow(props: { order: SponsorAdminOrder }) {
  const { t } = useTranslation()
  const attention = needsAttention(props.order.status)

  return (
    <li
      className={cn(
        'flex items-center gap-3 py-2',
        attention && 'bg-destructive/[0.04]'
      )}
    >
      <span className='text-muted-foreground w-12 shrink-0 font-mono text-xs'>
        #{props.order.userId}
      </span>
      <span className='min-w-0 flex-1 truncate text-xs'>
        {props.order.displayName}
      </span>
      <span className='text-muted-foreground hidden min-w-0 flex-1 truncate text-xs sm:block'>
        {props.order.message || '—'}
      </span>
      <span className='shrink-0 font-mono text-sm tabular-nums'>
        ¥{props.order.amountCny}
      </span>
      <span className='text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:block'>
        {formatDate(props.order.createdAt)}
      </span>
      <Badge
        variant={STATUS_VARIANT[props.order.status]}
        className='shrink-0 text-[10px]'
      >
        {t(SPONSOR_STATUS_LABEL_KEY[props.order.status])}
      </Badge>
    </li>
  )
}

export type SponsorAdminPanelProps = {
  enabled: boolean
}

/**
 * Root view of every sponsorship.
 *
 * Collapsed by default and fetched lazily: this is other people's payment
 * history sitting on an operator's own wallet page, so it stays out of both
 * the layout and the network until it is actually asked for.
 *
 * Once open, orders needing attention are hoisted to the top — an `unknown`
 * order may or may not have charged the user, and burying it under settled
 * rows is how it gets missed.
 */
export function SponsorAdminPanel(props: SponsorAdminPanelProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const adminQuery = useSponsorAdminView(props.enabled && open)

  const orders = useMemo(() => {
    const all = adminQuery.data?.orders ?? []
    const attention = all.filter((order) => needsAttention(order.status))
    const settled = all.filter((order) => !needsAttention(order.status))
    return [...attention, ...settled]
  }, [adminQuery.data])

  const visible = expanded ? orders : orders.slice(0, SPONSOR_ADMIN_PAGE_SIZE)
  const summary = adminQuery.data?.summary

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-t pt-4'>
      <CollapsibleTrigger className='group flex w-full items-center justify-between gap-2 text-left'>
        <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
          <ShieldCheck className='size-4' />
          {t('All Sponsorships')}
        </span>
        <span className='flex items-center gap-2'>
          {/* Only known once opened; the query does not run before that. */}
          {summary && (
            <span className='text-muted-foreground font-mono text-xs tabular-nums'>
              {t('¥{{total}} from {{completed}} of {{count}} orders', {
                total: summary.totalAmountCny,
                completed: summary.completedCount,
                count: summary.orderCount,
              })}
            </span>
          )}
          <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className='pt-2'>
          {adminQuery.isLoading && <Skeleton className='h-20 rounded-lg' />}

          {!adminQuery.isLoading && orders.length === 0 && (
            <p className='text-muted-foreground text-xs'>
              {t('No sponsorships yet')}
            </p>
          )}

          {orders.length > 0 && (
            <>
              <ul className='divide-border/60 divide-y'>
                {visible.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </ul>
              {orders.length > SPONSOR_ADMIN_PAGE_SIZE && (
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded
                    ? t('Show less')
                    : t('Show all {{count}} orders', { count: orders.length })}
                </Button>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
