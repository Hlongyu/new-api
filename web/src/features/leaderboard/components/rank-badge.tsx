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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { resolveTierBadge } from '../lib/rank-badge'

/**
 * Badge heights per context, matching the standalone site's fixed sizes.
 * Widths follow from the artwork's 8:3 aspect ratio.
 */
const SIZE_CLASS = {
  /** Inline in a table row — 72x27 originally. */
  row: 'h-[27px]',
  /** Podium identity line — 78x29. */
  podium: 'h-[29px]',
  /** The tier board's own tier column — 86x32. */
  metric: 'h-8',
  /** Personal panel hero badge — 116x44. */
  panel: 'h-11',
} as const

export type RankBadgeProps = {
  /** Localised label from a board row, e.g. "黄金 I". */
  label?: string | null
  /** Structured tier from the personal payload; wins over `label`. */
  tierKey?: string | null
  division?: string | null
  size?: keyof typeof SIZE_CLASS
  /** Adds the promotion-series glow. */
  promotion?: boolean
  className?: string
}

/**
 * Tier artwork with a text fallback.
 *
 * The badge is decorative but the tier itself is information, so an unknown
 * tier or a missing image still renders the label rather than disappearing.
 */
export function RankBadge(props: RankBadgeProps) {
  const { t } = useTranslation()
  const [imageFailed, setImageFailed] = useState(false)

  const resolved = resolveTierBadge({
    label: props.label,
    tierKey: props.tierKey,
    division: props.division,
  })

  if (!resolved || imageFailed) {
    if (!props.label) return null
    return (
      <Badge variant='outline' className={cn('font-normal', props.className)}>
        {props.label}
      </Badge>
    )
  }

  const tierName = t(resolved.tierLabelKey)
  const accessibleLabel = `${tierName} ${resolved.division}`

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <img
            src={resolved.src}
            alt={accessibleLabel}
            loading='lazy'
            draggable={false}
            onError={() => setImageFailed(true)}
            className={cn(
              'w-auto shrink-0 select-none',
              SIZE_CLASS[props.size ?? 'row'],
              props.promotion &&
                'drop-shadow-[0_0_8px_oklch(0.72_0.13_75_/_0.45)]',
              props.className
            )}
          />
        }
      />
      <TooltipContent>
        {props.promotion
          ? `${accessibleLabel} · ${t('Promotion Series')}`
          : accessibleLabel}
      </TooltipContent>
    </Tooltip>
  )
}
