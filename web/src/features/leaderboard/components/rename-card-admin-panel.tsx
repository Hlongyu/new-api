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
import { ArrowRight, ChevronDown, Ticket } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import {
  RENAME_ADMIN_PAGE_SIZE,
  RENAME_COST_LABEL_KEY,
} from '../constants'
import { useRenameCardAdminView } from '../hooks'
import type {
  RenameCardAdminOrder,
  RenameCardOrderStatus,
  RenameCostType,
  RenameEvent,
} from '../types'

const STATUS_VARIANT: Record<
  RenameCardOrderStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  completed: 'secondary',
  processing: 'outline',
  failed: 'destructive',
  unknown: 'outline',
}

const STATUS_LABEL_KEY: Record<RenameCardOrderStatus, string> = {
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  unknown: 'Needs review',
}

/** Only a card-paid rename draws down the balance, so it is the one to spot. */
const COST_VARIANT: Record<RenameCostType, 'secondary' | 'outline'> = {
  free: 'outline',
  card: 'secondary',
  unlimited: 'outline',
}

function needsAttention(status: RenameCardOrderStatus): boolean {
  return status === 'failed' || status === 'unknown'
}

function formatDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return new Date(seconds * 1000).toLocaleDateString()
}

function StatTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div className='bg-muted/40 rounded-lg px-2.5 py-2'>
      <p className='text-muted-foreground text-[11px]'>{props.label}</p>
      <p className='font-mono text-sm tabular-nums'>{props.value}</p>
      {props.hint && (
        <p className='text-muted-foreground text-[11px]'>{props.hint}</p>
      )}
    </div>
  )
}

function OrderRow(props: { order: RenameCardAdminOrder }) {
  const { t } = useTranslation()
  const attention = needsAttention(props.order.status)

  return (
    <li
      className={cn(
        'flex items-center gap-2 py-2',
        attention && 'bg-destructive/[0.04]'
      )}
    >
      <span className='text-muted-foreground w-10 shrink-0 font-mono text-xs'>
        #{props.order.userId}
      </span>
      <span className='min-w-0 flex-1 truncate text-xs'>
        {props.order.displayName}
      </span>
      <span className='shrink-0 font-mono text-xs tabular-nums'>
        ×{props.order.quantity}
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
        {t(STATUS_LABEL_KEY[props.order.status])}
      </Badge>
    </li>
  )
}

function EventRow(props: { event: RenameEvent }) {
  const { t } = useTranslation()

  return (
    <li className='flex items-center gap-2 py-2'>
      <span className='text-muted-foreground w-10 shrink-0 font-mono text-xs'>
        #{props.event.userId}
      </span>
      <span className='flex min-w-0 flex-1 items-center gap-1 text-xs'>
        <span className='text-muted-foreground min-w-0 truncate line-through'>
          {props.event.oldName}
        </span>
        <ArrowRight className='text-muted-foreground size-3 shrink-0' />
        <span className='min-w-0 truncate'>{props.event.newName}</span>
      </span>
      <span className='text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:block'>
        {formatDate(props.event.createdAt)}
      </span>
      <Badge
        variant={COST_VARIANT[props.event.costType]}
        className='shrink-0 text-[10px]'
      >
        {t(RENAME_COST_LABEL_KEY[props.event.costType])}
      </Badge>
    </li>
  )
}

export type RenameCardAdminPanelProps = {
  /** Only rendered for root; the endpoint answers 403 for anyone else. */
  enabled: boolean
}

/**
 * Root view of rename card sales and the renames they paid for.
 *
 * Collapsed by default and fetched lazily, for the same reason as the wallet's
 * sponsorship panel: this is other members' purchase history, so it stays out
 * of both the layout and the network until it is asked for.
 *
 * Orders needing attention are hoisted to the top — an `unknown` order may or
 * may not have charged the buyer, and burying it under settled rows is how it
 * gets missed.
 */
export function RenameCardAdminPanel(props: RenameCardAdminPanelProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const adminQuery = useRenameCardAdminView(props.enabled && open)

  const orders = useMemo(() => {
    const all = adminQuery.data?.orders ?? []
    const attention = all.filter((order) => needsAttention(order.status))
    const settled = all.filter((order) => !needsAttention(order.status))
    return [...attention, ...settled]
  }, [adminQuery.data])

  const events = adminQuery.data?.events ?? []
  const summary = adminQuery.data?.summary

  const renderMore = (total: number) => {
    if (total <= RENAME_ADMIN_PAGE_SIZE) return null
    return (
      <Button
        size='sm'
        variant='ghost'
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? t('Show less') : t('Show all {{count}} rows', { count: total })}
      </Button>
    )
  }

  const limit = expanded ? undefined : RENAME_ADMIN_PAGE_SIZE

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className='group flex w-full items-center justify-between gap-2 text-left'>
        <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
          <Ticket className='size-4' />
          {t('Rename Card Activity')}
        </span>
        <span className='flex items-center gap-2'>
          {/* Only known once opened; the query does not run before that. */}
          {summary && (
            <span className='text-muted-foreground font-mono text-xs tabular-nums'>
              {t('{{sold}} sold · {{unused}} unused', {
                sold: summary.cardsSold,
                unused: summary.outstandingCards,
              })}
            </span>
          )}
          <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className='space-y-3 pt-3'>
          {adminQuery.isLoading && <Skeleton className='h-32 rounded-lg' />}

          {summary && (
            <>
              <div className='grid grid-cols-3 gap-2'>
                <StatTile
                  label={t('Cards sold')}
                  value={String(summary.cardsSold)}
                  hint={`¥${summary.totalAmountCny}`}
                />
                <StatTile
                  label={t('Unused')}
                  value={String(summary.outstandingCards)}
                  hint={t('{{count}} spent', { count: summary.cardRenameCount })}
                />
                <StatTile
                  label={t('Renames')}
                  value={String(summary.renameCount)}
                  hint={t('{{count}} free', { count: summary.freeRenameCount })}
                />
              </div>

              <Tabs
                defaultValue='orders'
                onValueChange={() => setExpanded(false)}
              >
                <TabsList>
                  <TabsTrigger value='orders'>{t('Purchases')}</TabsTrigger>
                  <TabsTrigger value='renames'>{t('Renames')}</TabsTrigger>
                </TabsList>

                <TabsContent value='orders'>
                  {orders.length === 0 ? (
                    <p className='text-muted-foreground py-2 text-xs'>
                      {t('No rename cards have been purchased yet')}
                    </p>
                  ) : (
                    <>
                      <ul className='divide-border/60 divide-y'>
                        {orders.slice(0, limit).map((order) => (
                          <OrderRow key={order.id} order={order} />
                        ))}
                      </ul>
                      {renderMore(orders.length)}
                    </>
                  )}
                </TabsContent>

                <TabsContent value='renames'>
                  {events.length === 0 ? (
                    <p className='text-muted-foreground py-2 text-xs'>
                      {t('No renames yet')}
                    </p>
                  ) : (
                    <>
                      <ul className='divide-border/60 divide-y'>
                        {events.slice(0, limit).map((event) => (
                          <EventRow key={event.id} event={event} />
                        ))}
                      </ul>
                      {renderMore(events.length)}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
