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
import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { RankBadge } from './rank-badge'
import type { RankProgress } from '../types'

function ScoreRow(props: { label: string; value: number }) {
  return (
    <div className='flex items-center justify-between text-xs'>
      <span className='text-muted-foreground'>{props.label}</span>
      <span className='text-foreground font-mono tabular-nums'>
        {props.value}
      </span>
    </div>
  )
}

/**
 * How the tier system works, on hover.
 *
 * The card shows three bare score numbers whose multipliers appear nowhere
 * else, so without this the figures are unreadable. It is a tooltip rather
 * than a panel because it is reference material, not something to act on.
 */
function RankRulesTooltip() {
  const { t } = useTranslation()

  const sections = [
    {
      title: t('Score sources'),
      body: t(
        'Token spend ×1, rename card ×2, sponsorship ×5, on the floored amount.'
      ),
    },
    {
      title: t('Tiers'),
      body: t(
        'Iron through Challenger, each split into divisions IV–I. A full division promotes immediately.'
      ),
    },
    {
      title: t('Promotion Series'),
      body: t(
        'Starts at a full division I. Qualify on enough days inside the window to advance; points earned meanwhile stay pending, and failing drops you to half of division I.'
      ),
    },
  ]

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type='button'
              aria-label={t('How tiers are calculated')}
              className='text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none'
            />
          }
        >
          <HelpCircle className='size-4' />
        </TooltipTrigger>
        <TooltipContent
          side='left'
          className='max-w-[260px] flex-col items-start gap-2 text-left'
        >
          {sections.map((section) => (
            <div key={section.title}>
              <p className='font-medium'>{section.title}</p>
              <p className='opacity-80'>{section.body}</p>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type ProfileRankCardProps = {
  rankProgress: RankProgress
}

export function ProfileRankCard(props: ProfileRankCardProps) {
  const { t } = useTranslation()
  const progress = props.rankProgress
  const promotion = progress.promotion
  const segmentPercent =
    progress.segmentScore > 0
      ? Math.min(100, (progress.score / progress.segmentScore) * 100)
      : 0

  const todayLine = () => {
    if (!promotion) return null
    // The series began today, so today's activity is what triggered it rather
    // than a qualifying day of its own; the count starts tomorrow. Reporting a
    // shortfall here would send the user grinding for points that cannot land.
    if (!promotion.todayCounts) {
      return t('Just entered — day 1 starts tomorrow')
    }
    if (promotion.todayRequiredRemaining > 0) {
      return t("Today's score {{score}}, {{remaining}} more needed", {
        score: promotion.todayScore,
        remaining: promotion.todayRequiredRemaining,
      })
    }
    return t("Today's score already qualifies")
  }

  return (
    <div className='bg-card space-y-4 rounded-xl border p-4'>
      <div className='flex items-center justify-between gap-3'>
        <RankBadge
          tierKey={progress.tierKey}
          division={progress.division}
          label={progress.label}
          size='panel'
          promotion={Boolean(promotion)}
        />
        <div className='flex items-center gap-2'>
          {promotion && (
            <Badge variant='secondary'>{t('Promotion Series')}</Badge>
          )}
          <RankRulesTooltip />
        </div>
      </div>

      {/* During a promotion series the division bar is pinned at full, so the
          qualifying-day counter is what actually communicates progress. */}
      {promotion ? (
        <div className='space-y-2'>
          <p className='text-foreground text-sm font-medium'>
            {t('Promoting to {{tier}}', { tier: promotion.targetTierName })}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              '{{active}}/{{required}} qualifying days · day {{checked}} of {{window}}',
              {
                active: promotion.activeDays,
                required: promotion.requiredDays,
                checked: promotion.checkedDays,
                window: promotion.windowDays,
              }
            )}
          </p>
          <p className='text-muted-foreground text-xs'>{todayLine()}</p>
        </div>
      ) : (
        <div className='space-y-2'>
          <div className='flex items-center justify-between text-xs'>
            <span className='text-muted-foreground'>
              {t('Current division {{score}}/{{total}}', {
                score: progress.score,
                total: progress.segmentScore,
              })}
            </span>
            <span className='text-foreground font-mono tabular-nums'>
              {Math.round(segmentPercent)}%
            </span>
          </div>
          <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
            <div
              className='bg-primary h-full rounded-full'
              style={{ width: `${segmentPercent}%` }}
            />
          </div>
        </div>
      )}

      <div className='space-y-1.5 border-t pt-3'>
        <p className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
          {t('Score sources')}
        </p>
        <ScoreRow label={t('Token score')} value={progress.tokenScore} />
        <ScoreRow
          label={t('Rename card score')}
          value={progress.renameScore}
        />
        <ScoreRow
          label={t('Sponsorship score')}
          value={progress.sponsorScore}
        />
        {progress.pendingScore > 0 && (
          <ScoreRow
            label={t('Pending score')}
            value={progress.pendingScore}
          />
        )}
      </div>
    </div>
  )
}
