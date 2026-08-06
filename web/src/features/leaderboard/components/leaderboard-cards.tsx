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

import { formatCount, formatTokens } from '../lib/format'
import { showsTierBadge } from '../lib/rank-badge'
import type { LeaderboardBoard, LeaderboardEntry } from '../types'
import { RankBadge } from './rank-badge'

export type LeaderboardCardsProps = {
  board: LeaderboardBoard
  entries: LeaderboardEntry[]
  emptyMessage: string
}

/**
 * Card layout for narrow screens.
 *
 * Hand-rolled rather than reusing MobileCardList: that component drives itself
 * from a TanStack Table instance, and these boards render through
 * StaticDataTable, which has none.
 */
export function LeaderboardCards(props: LeaderboardCardsProps) {
  const { t } = useTranslation()
  const isUsage = props.board === 'usage'

  if (props.entries.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
        {props.emptyMessage}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {props.entries.map((entry, index) => (
        <div
          key={entry.id}
          className='bg-card flex items-center gap-3 rounded-lg border p-3'
        >
          <span className='text-muted-foreground w-7 shrink-0 text-center font-mono text-sm tabular-nums'>
            {entry.rank ?? index + 1}
          </span>
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <span
                className='text-foreground truncate text-sm font-medium'
                title={entry.displayName}
              >
                {entry.displayName}
              </span>
              {showsTierBadge(entry.showRankBadge) && (
                <RankBadge label={entry.rankLabel} size='row' />
              )}
            </div>
            {isUsage ? (
              <p className='text-muted-foreground mt-0.5 font-mono text-xs tabular-nums'>
                {formatTokens(entry.tokenUsed ?? 0)} {t('Tokens')} ·{' '}
                {formatCount(entry.requestCount ?? 0)} {t('Requests')}
              </p>
            ) : (
              <p className='text-muted-foreground mt-0.5 text-xs'>
                {entry.rankLabel ?? '—'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
