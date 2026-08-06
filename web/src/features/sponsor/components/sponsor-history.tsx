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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import { SPONSOR_HISTORY_LIMIT, SPONSOR_STATUS_LABEL_KEY } from '../constants'
import type { SponsorOrder, SponsorOrderStatus } from '../types'

const STATUS_VARIANT: Record<
  SponsorOrderStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  completed: 'secondary',
  processing: 'outline',
  failed: 'destructive',
  unknown: 'outline',
}

function formatDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return new Date(seconds * 1000).toLocaleDateString()
}

export type SponsorHistoryProps = {
  orders: SponsorOrder[]
}

export function SponsorHistory(props: SponsorHistoryProps) {
  const { t } = useTranslation()

  if (props.orders.length === 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('No sponsorships yet')}
      </p>
    )
  }

  return (
    <ul className='divide-border/60 divide-y'>
      {props.orders.slice(0, SPONSOR_HISTORY_LIMIT).map((order) => (
        <li key={order.id} className='flex items-center gap-3 py-2'>
          <span className='text-foreground w-16 shrink-0 font-mono text-sm tabular-nums'>
            ¥{order.amountCny}
          </span>
          <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
            {order.message || '—'}
          </span>
          <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
            {formatDate(order.createdAt)}
          </span>
          <Badge
            variant={STATUS_VARIANT[order.status]}
            className='shrink-0 text-[10px]'
          >
            {t(SPONSOR_STATUS_LABEL_KEY[order.status])}
          </Badge>
        </li>
      ))}
    </ul>
  )
}
