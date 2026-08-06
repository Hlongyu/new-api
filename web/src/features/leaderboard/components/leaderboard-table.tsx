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

import {
  StaticDataTable,
  staticDataTableClassNames as tableStyles,
  type StaticDataTableColumn,
} from '@/components/data-table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { formatCount, formatTokens } from '../lib/format'
import { showsTierBadge } from '../lib/rank-badge'
import type { LeaderboardBoard, LeaderboardEntry } from '../types'
import { RankBadge } from './rank-badge'

function NameCell(props: { entry: LeaderboardEntry }) {
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <span className='truncate' title={props.entry.displayName}>
        {props.entry.displayName}
      </span>
      {showsTierBadge(props.entry.showRankBadge) && (
        <RankBadge label={props.entry.rankLabel} size='row' />
      )}
    </div>
  )
}

export type LeaderboardTableProps = {
  board: LeaderboardBoard
  entries: LeaderboardEntry[]
  emptyMessage: string
}

export function LeaderboardTable(props: LeaderboardTableProps) {
  const { t } = useTranslation()
  const isUsage = props.board === 'usage'

  const columns: StaticDataTableColumn<LeaderboardEntry>[] = []

  {
    columns.push({
      id: 'rank',
      header: t('Rank'),
      // Left-aligned in a fixed column: right-aligning a two-digit number in a
      // narrow column parks it against the name and reads as one field.
      className: cn(tableStyles.compactHeaderCell, 'w-[74px] pl-1'),
      cellClassName: 'py-2.5 pl-1',
      cell: (entry, index) => (
        <span className='text-muted-foreground inline-grid size-[30px] place-items-center font-mono text-[13px] tabular-nums'>
          {entry.rank ?? index + 1}
        </span>
      ),
    })
  }

  columns.push({
    id: 'name',
    header: t('Name'),
    className: cn(tableStyles.compactHeaderCell, 'w-[44%]'),
    cellClassName: tableStyles.compactCell,
    cell: (entry) => <NameCell entry={entry} />,
  })

  if (isUsage) {
    columns.push(
      {
        id: 'tokens',
        header: t('Tokens'),
        className: tableStyles.compactHeaderCellRight,
        cellClassName: tableStyles.compactNumericCell,
        cell: (entry) => (
          <Tooltip>
            <TooltipTrigger
              render={<span>{formatTokens(entry.tokenUsed ?? 0)}</span>}
            />
            <TooltipContent>
              {(entry.tokenUsed ?? 0).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        ),
      },
      {
        id: 'requests',
        header: t('Requests'),
        className: tableStyles.compactHeaderCellRight,
        cellClassName: tableStyles.compactMutedNumericCell,
        cell: (entry) => formatCount(entry.requestCount ?? 0),
      }
    )
  } else {
    columns.push({
      id: 'tier',
      header: t('Tier'),
      className: tableStyles.compactHeaderCellRight,
      cellClassName: tableStyles.compactCell,
      cell: (entry) => (
        <span className='flex justify-end'>
          <RankBadge label={entry.rankLabel} size='metric' />
        </span>
      ),
    })
  }

  return (
    <StaticDataTable
      className='rounded-lg'
      tableClassName='text-sm'
      headerRowClassName={tableStyles.compactHeaderRow}
      data={props.entries}
      columns={columns}
      getRowKey={(entry) => entry.id}
      empty={props.entries.length === 0}
      emptyContent={props.emptyMessage}
    />
  )
}
