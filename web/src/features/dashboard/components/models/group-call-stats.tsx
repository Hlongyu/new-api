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
import { useQuery } from '@tanstack/react-query'
import { Layers3 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getGroupQuotaDates } from '@/features/dashboard/api'
import {
  buildGroupCallStats,
  buildQueryParams,
  getDefaultDays,
} from '@/features/dashboard/lib'
import type { DashboardFilters } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatPercent, formatQuota } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { computeTimeRange } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

interface GroupCallStatsProps {
  filters?: DashboardFilters
}

const LOADING_ROW_KEYS = ['first', 'second', 'third'] as const

export function GroupCallStats(props: GroupCallStatsProps) {
  const { t, i18n } = useTranslation()
  const userRole = useAuthStore((state) => state.auth.user?.role)
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const timeRange = computeTimeRange(
    getDefaultDays(props.filters?.time_granularity),
    props.filters?.start_timestamp,
    props.filters?.end_timestamp
  )
  const queryParams = buildQueryParams(timeRange, props.filters)
  const groupStatsQuery = useQuery({
    queryKey: [
      'dashboard-group-call-stats',
      isAdmin,
      queryParams.start_timestamp,
      queryParams.end_timestamp,
      queryParams.default_time,
      queryParams.username ?? '',
    ],
    queryFn: async () => {
      const response = await getGroupQuotaDates(queryParams, isAdmin)
      if (!response.success || !Array.isArray(response.data)) {
        throw new Error(
          response.message || 'Failed to load group call statistics'
        )
      }
      return response.data
    },
    staleTime: 30 * 1000,
    retry: false,
  })
  const rows = useMemo(
    () => buildGroupCallStats(groupStatsQuery.data ?? []),
    [groupStatsQuery.data]
  )
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const totalRequests = rows.reduce((sum, row) => sum + row.count, 0)

  let content
  if (groupStatsQuery.isLoading) {
    content = (
      <Table className='min-w-[760px]'>
        <TableHeader>
          <GroupStatsTableHeader />
        </TableHeader>
        <TableBody>
          {LOADING_ROW_KEYS.map((key) => (
            <TableRow key={key}>
              {Array.from({ length: 6 }, (_, index) => (
                <TableCell key={index} className='h-14'>
                  <Skeleton className='h-4 w-20' />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  } else if (groupStatsQuery.isError || rows.length === 0) {
    content = (
      <Empty className='min-h-48 rounded-none border-0'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Layers3 />
          </EmptyMedia>
          <EmptyTitle>
            {groupStatsQuery.isError
              ? t('Failed to load')
              : t('No data available')}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  } else {
    content = (
      <Table className='min-w-[760px]'>
        <TableHeader>
          <GroupStatsTableHeader />
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.use_group}>
              <TableCell className='px-4 font-mono font-medium'>
                {row.use_group}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(row.count, locale)}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(row.input_tokens, locale)}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatNumber(row.output_tokens, locale)}
              </TableCell>
              <TableCell className='text-right font-mono'>
                {formatQuota(row.quota)}
              </TableCell>
              <TableCell className='pr-4'>
                <div className='ml-auto flex w-28 items-center gap-2'>
                  <Progress
                    value={row.cache_rate}
                    aria-label={t('Cache hit rate')}
                    className='w-16 shrink-0'
                  />
                  <span className='w-12 text-right font-mono text-xs'>
                    {formatPercent(row.cache_rate)}
                  </span>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex items-center gap-2 border-b px-4 py-3 sm:px-5'>
        <IconBadge tone='chart-3' size='sm'>
          <Layers3 />
        </IconBadge>
        <div className='text-sm font-semibold'>
          {t('Group Call Statistics')}
        </div>
        {!groupStatsQuery.isLoading && !groupStatsQuery.isError && (
          <span className='text-muted-foreground text-xs'>
            {t('Total:')} {formatNumber(totalRequests, locale)}
          </span>
        )}
      </div>
      {content}
    </div>
  )
}

function GroupStatsTableHeader() {
  const { t } = useTranslation()
  return (
    <TableRow className='bg-muted/40 hover:bg-muted/40'>
      <TableHead className='h-9 min-w-40 px-4 text-xs'>{t('Group')}</TableHead>
      <TableHead className='h-9 text-right text-xs'>{t('Requests')}</TableHead>
      <TableHead className='h-9 text-right text-xs'>
        {t('Input Tokens')}
      </TableHead>
      <TableHead className='h-9 text-right text-xs'>
        {t('Output Tokens')}
      </TableHead>
      <TableHead className='h-9 text-right text-xs'>{t('Quota')}</TableHead>
      <TableHead className='h-9 pr-4 text-right text-xs'>
        {t('Cache hit rate')}
      </TableHead>
    </TableRow>
  )
}
