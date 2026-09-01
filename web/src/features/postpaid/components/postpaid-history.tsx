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
import { useMemo, useState } from 'react'
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
} from '../constants'
import { formatDate, formatDateTime } from '../lib/format'
import { buildPostpaidTimeline } from '../lib/timeline'
import type {
  PostpaidEvent,
  PostpaidEventStatus,
  PostpaidGrant,
  PostpaidGrantStatus,
} from '../types'

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
  const timeline = useMemo(
    () => buildPostpaidTimeline(props.grants, props.events),
    [props.grants, props.events]
  )

  if (props.grants.length === 0 && props.events.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-t pt-3'>
      <CollapsibleTrigger className='group text-muted-foreground hover:text-foreground flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium tracking-wider uppercase transition-colors'>
        {t('Credit and repayment history')}
        <ChevronDown className='size-3.5 transition-transform group-data-[panel-open]:rotate-180' />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ul className='divide-border/60 max-h-96 divide-y overflow-y-auto pt-3 pr-1'>
          {timeline.map((item) => {
            const exceptional =
              item.kind === 'drawdown'
                ? item.status === 'processing' ||
                  item.status === 'failed' ||
                  item.status === 'unknown'
                : item.status !== 'completed'
            return (
              <li
                key={item.id}
                className='grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0.5 py-2 text-xs'
              >
                <span className='row-span-2 font-mono font-medium tabular-nums'>
                  {item.kind === 'drawdown' ? '+' : '−'}
                  {item.amount}
                </span>
                <span className='min-w-0 font-medium break-words'>
                  {item.kind === 'drawdown'
                    ? t('Credit drawn')
                    : t('Repaid by redemption')}
                </span>
                {exceptional && (
                  <Badge
                    variant={
                      item.kind === 'drawdown'
                        ? GRANT_VARIANT[item.status]
                        : EVENT_VARIANT[item.status]
                    }
                    className='row-span-2 shrink-0 text-[10px]'
                  >
                    {t(
                      item.kind === 'drawdown'
                        ? POSTPAID_GRANT_LABEL_KEY[item.status]
                        : POSTPAID_EVENT_LABEL_KEY[item.status]
                    )}
                  </Badge>
                )}
                <span className='text-muted-foreground min-w-0 break-words'>
                  {item.kind === 'drawdown'
                    ? `${t('Borrowed at {{date}}', {
                        date: formatDateTime(item.timestamp),
                      })} · ${t('Due {{date}}', {
                        date: formatDate(item.dueAt),
                      })}`
                    : t('Repaid at {{date}}', {
                        date: formatDateTime(item.timestamp),
                      })}
                </span>
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
