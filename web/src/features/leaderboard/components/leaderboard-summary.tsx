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
import { Clock, Coins, Send, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { describeSyncAge, formatCount, formatTokens } from '../lib/format'
import type { LeaderboardView } from '../types'

function SummaryTile(props: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  hint: string
}) {
  const Icon = props.icon
  return (
    <div className='bg-card/60 flex flex-col gap-1 rounded-lg border p-4'>
      <span className='text-muted-foreground inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase'>
        <Icon className='size-3' />
        {props.label}
      </span>
      <span className='text-foreground font-mono text-2xl font-semibold tabular-nums'>
        {props.value}
      </span>
      <span className='text-muted-foreground/70 text-[11px]'>{props.hint}</span>
    </div>
  )
}

function useSyncLabel(lastSyncAt: number): string {
  const { t } = useTranslation()
  const age = describeSyncAge(lastSyncAt, Date.now())

  if (age.kind === 'never') return t('Waiting for first sync')
  if (age.kind === 'just-now') return t('Just updated')
  if (age.kind === 'minutes') {
    return t('Updated {{count}} minutes ago', { count: age.value })
  }
  if (age.kind === 'hours') {
    return t('Updated {{count}} hours ago', { count: age.value })
  }
  return t('Updated {{count}} days ago', { count: age.value })
}

export type LeaderboardSummaryProps = {
  view: LeaderboardView | null
  isLoading: boolean
}

export function LeaderboardSummary(props: LeaderboardSummaryProps) {
  const { t } = useTranslation()
  const syncLabel = useSyncLabel(props.view?.lastSyncAt ?? 0)

  if (props.isLoading || !props.view) {
    return (
      <div className='grid gap-3 sm:grid-cols-3'>
        <Skeleton className='h-[104px] rounded-lg' />
        <Skeleton className='h-[104px] rounded-lg' />
        <Skeleton className='h-[104px] rounded-lg' />
      </div>
    )
  }

  const view = props.view

  // The tier board reports no usage totals, so it shows standings instead.
  if (view.tokenUsed === null) {
    return (
      <div className='grid gap-3 sm:grid-cols-2'>
        <SummaryTile
          icon={Users}
          label={t('Tier Members')}
          value={formatCount(view.memberCount)}
          hint={t('With usage or sponsorship records')}
        />
        <SummaryTile
          icon={Clock}
          label={t('Last Sync')}
          value={syncLabel}
          hint={view.timeZone}
        />
      </div>
    )
  }

  return (
    <div className='grid gap-3 sm:grid-cols-3'>
      <Tooltip>
        <TooltipTrigger
          render={
            <div>
              <SummaryTile
                icon={Coins}
                label={t('Total Tokens')}
                value={formatTokens(view.tokenUsed)}
                hint={t('Input and output combined')}
              />
            </div>
          }
        />
        <TooltipContent>{view.tokenUsed.toLocaleString()}</TooltipContent>
      </Tooltip>
      <SummaryTile
        icon={Send}
        label={t('Total Requests')}
        value={formatCount(view.requestCount ?? 0)}
        hint={t('All model requests')}
      />
      <SummaryTile
        icon={Users}
        label={t('Participants')}
        value={formatCount(view.memberCount)}
        hint={syncLabel}
      />
    </div>
  )
}
