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
import { AlertTriangle, ChevronDown, ShieldCheck } from 'lucide-react'
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

import {
  POSTPAID_ADMIN_PAGE_SIZE,
  POSTPAID_GRANT_LABEL_KEY,
} from '../constants'
import { usePostpaidAdminView } from '../hooks'
import type { PostpaidAdminGrant, PostpaidGrantStatus } from '../types'
import { formatDate } from '../lib/format'
import { syncTrouble } from '../lib/sync-health'

const STATUS_VARIANT: Record<
  PostpaidGrantStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  processing: 'outline',
  active: 'default',
  settled: 'secondary',
  overdue: 'destructive',
  failed: 'destructive',
  unknown: 'outline',
}

function needsAttention(status: PostpaidGrantStatus): boolean {
  return status === 'overdue' || status === 'failed' || status === 'unknown'
}

function GrantRow(props: { grant: PostpaidAdminGrant }) {
  const { t } = useTranslation()
  const attention = needsAttention(props.grant.status)

  return (
    <li
      className={cn(
        'flex items-center gap-2 py-2 text-xs',
        attention && 'bg-destructive/[0.04]'
      )}
    >
      <span className='text-muted-foreground w-10 shrink-0 font-mono'>
        #{props.grant.userId}
      </span>
      <span className='min-w-0 flex-1 truncate'>{props.grant.displayName}</span>
      <span className='shrink-0 font-mono tabular-nums'>
        {props.grant.creditAmount}
      </span>
      <span
        className={cn(
          'w-14 shrink-0 text-right font-mono tabular-nums',
          props.grant.outstandingAmount > 0
            ? 'text-foreground'
            : 'text-muted-foreground'
        )}
      >
        {props.grant.outstandingAmount > 0
          ? `−${props.grant.outstandingAmount}`
          : '0'}
      </span>
      <span className='text-muted-foreground hidden shrink-0 tabular-nums sm:block'>
        {formatDate(props.grant.dueAt)}
      </span>
      <Badge
        variant={STATUS_VARIANT[props.grant.status]}
        className='shrink-0 text-[10px]'
      >
        {t(POSTPAID_GRANT_LABEL_KEY[props.grant.status])}
      </Badge>
    </li>
  )
}

export type PostpaidAdminPanelProps = {
  /** Only rendered for root; the endpoint answers 403 for anyone else. */
  enabled: boolean
}

/**
 * Root view of every credit grant, plus repayment settlement health.
 *
 * Collapsed by default and fetched lazily, matching the other operator panels:
 * this is other people's debt sitting on an operator's own wallet page.
 *
 * The sync state is the reason this panel exists. Repayment is entirely
 * automatic — if the worker stops, nobody's debt is ever collected and there
 * is no other signal anywhere in the product that it happened.
 */
export function PostpaidAdminPanel(props: PostpaidAdminPanelProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const adminQuery = usePostpaidAdminView(props.enabled && open)

  const grants = useMemo(() => {
    const all = adminQuery.data?.grants ?? []
    const attention = all.filter((grant) => needsAttention(grant.status))
    const settled = all.filter((grant) => !needsAttention(grant.status))
    return [...attention, ...settled]
  }, [adminQuery.data])

  const summary = adminQuery.data?.summary
  const state = adminQuery.data?.state
  const trouble = state ? syncTrouble(state, Date.now()) : null
  const visible = expanded ? grants : grants.slice(0, POSTPAID_ADMIN_PAGE_SIZE)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-t pt-3'>
      <CollapsibleTrigger className='group flex w-full items-center justify-between gap-2 text-left'>
        <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
          <ShieldCheck className='size-4' />
          {t('All Credit Grants')}
        </span>
        <span className='flex items-center gap-2'>
          {/* Only known once opened; the query does not run before that. */}
          {summary && (
            <span className='text-muted-foreground font-mono text-xs tabular-nums'>
              {t('{{outstanding}} outstanding · {{overdue}} overdue', {
                outstanding: summary.outstandingAmount,
                overdue: summary.overdueAmount,
              })}
            </span>
          )}
          <ChevronDown className='text-muted-foreground size-4 transition-transform group-data-[panel-open]:rotate-180' />
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className='space-y-3 pt-3'>
          {adminQuery.isLoading && <Skeleton className='h-32 rounded-lg' />}

          {state && trouble && (
            <div className='border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border p-3'>
              <p className='text-destructive inline-flex items-center gap-1.5 text-xs font-medium'>
                <AlertTriangle className='size-3.5' />
                {trouble === 'error'
                  ? t('Repayment sync is reporting errors')
                  : t('Repayment sync is not running')}
              </p>
              <p className='text-muted-foreground text-xs'>
                {t('No debt is being collected until this is resolved.')}
              </p>
              {state.lastSyncError && (
                <p className='text-muted-foreground font-mono text-[10px] break-all'>
                  {state.lastSyncError}
                </p>
              )}
            </div>
          )}

          {summary && state && (
            <>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {[
                  { label: t('Outstanding'), value: summary.outstandingAmount },
                  { label: t('Overdue'), value: summary.overdueAmount },
                  { label: t('Granted'), value: summary.grantedAmount },
                  { label: t('Repaid'), value: summary.repaidAmount },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    className='bg-muted/40 rounded-lg px-2.5 py-2'
                  >
                    <p className='text-muted-foreground text-[11px]'>
                      {tile.label}
                    </p>
                    <p className='font-mono text-sm tabular-nums'>
                      {tile.value}
                    </p>
                  </div>
                ))}
              </div>

              <p className='text-muted-foreground text-[11px]'>
                {t('{{grants}} grants across {{users}} users · last sync {{sync}}', {
                  grants: summary.grantCount,
                  users: summary.userCount,
                  sync:
                    state.lastSyncAt > 0
                      ? new Date(state.lastSyncAt * 1000).toLocaleString()
                      : t('never'),
                })}
              </p>

              {grants.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  {t('No credit has been drawn yet')}
                </p>
              ) : (
                <>
                  <ul className='divide-border/60 divide-y'>
                    {visible.map((grant) => (
                      <GrantRow key={grant.id} grant={grant} />
                    ))}
                  </ul>
                  {grants.length > POSTPAID_ADMIN_PAGE_SIZE && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setExpanded((value) => !value)}
                    >
                      {expanded
                        ? t('Show less')
                        : t('Show all {{count}} rows', {
                            count: grants.length,
                          })}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
