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
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

import {
  POSTPAID_EVENT_LABEL_KEY,
  POSTPAID_GRANT_LABEL_KEY,
  POSTPAID_HISTORY_LIMIT,
} from '../constants'
import type {
  PostpaidEvent,
  PostpaidEventStatus,
  PostpaidGrant,
  PostpaidGrantStatus,
} from '../types'
import { formatDate } from '../lib/format'

const GRANT_VARIANT: Record<
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

const EVENT_VARIANT: Record<
  PostpaidEventStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  processing: 'outline',
  completed: 'secondary',
  failed: 'destructive',
  unknown: 'outline',
}

export type PostpaidHistoryProps = {
  grants: PostpaidGrant[]
  events: PostpaidEvent[]
}

/**
 * Drawdowns and repayments, collapsed by default.
 *
 * The card's headline numbers answer "what do I owe"; this answers "how did I
 * get here", which only matters when something looks wrong.
 */
export function PostpaidHistory(props: PostpaidHistoryProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const grants = props.grants.slice(0, POSTPAID_HISTORY_LIMIT)
  const events = props.events.slice(0, POSTPAID_HISTORY_LIMIT)

  if (grants.length === 0 && events.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-t pt-3'>
      <CollapsibleTrigger className='group text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium tracking-wider uppercase transition-colors'>
        {t('Credit and repayment history')}
        <ChevronDown className='size-3.5 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className='space-y-3 pt-3'>
          {grants.length > 0 && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-[10px]'>
                {t('Credit drawn')}
              </p>
              <ul className='divide-border/60 divide-y'>
                {grants.map((grant) => (
                  <li
                    key={grant.id}
                    className='flex items-center gap-2 py-1.5 text-xs'
                  >
                    <span className='font-mono tabular-nums'>
                      +{grant.creditAmount}
                    </span>
                    <span className='text-muted-foreground min-w-0 flex-1 truncate'>
                      {t('Due {{date}}', { date: formatDate(grant.dueAt) })}
                    </span>
                    <span className='text-muted-foreground shrink-0 tabular-nums'>
                      {formatDate(grant.createdAt)}
                    </span>
                    <Badge
                      variant={GRANT_VARIANT[grant.status]}
                      className='shrink-0 text-[10px]'
                    >
                      {t(POSTPAID_GRANT_LABEL_KEY[grant.status])}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {events.length > 0 && (
            <div className='space-y-1'>
              <p className='text-muted-foreground text-[10px]'>
                {t('Repaid by redemption')}
              </p>
              <ul className='divide-border/60 divide-y'>
                {events.map((event) => (
                  <li
                    key={event.id}
                    className='flex items-center gap-2 py-1.5 text-xs'
                  >
                    <span className='font-mono tabular-nums'>
                      −{event.amount}
                    </span>
                    <span className='text-muted-foreground min-w-0 flex-1 truncate'>
                      {t('Remaining {{amount}}', {
                        amount: event.outstandingAfter,
                      })}
                    </span>
                    <span className='text-muted-foreground shrink-0 tabular-nums'>
                      {formatDate(event.createdAt)}
                    </span>
                    <Badge
                      variant={EVENT_VARIANT[event.status]}
                      className='shrink-0 text-[10px]'
                    >
                      {t(POSTPAID_EVENT_LABEL_KEY[event.status])}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
