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
import { Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'
import { cn } from '@/lib/utils'

import { formatTokens, podiumBarWidth } from '../lib/format'
import { showsTierBadge } from '../lib/rank-badge'
import type { LeaderboardEntry } from '../types'
import { RankBadge } from './rank-badge'

// ----------------------------------------------------------------------------
// Podium
// ----------------------------------------------------------------------------
//
// Ports the standalone site's podium: three full-width bars stacked top to
// bottom, each laid out as rank / identity / progress / value. Tone is carried
// on CSS variables the way the original did, so a row's colour is set once and
// every tinted layer inside reads from it.

const TONES = [
  { color: '#b8862b', rgb: '184 134 43', trophy: 'size-[25px]' },
  { color: '#777d82', rgb: '119 125 130', trophy: 'size-[23px]' },
  { color: '#9a6038', rgb: '154 96 56', trophy: 'size-[22px]' },
] as const

const BADGE_LABEL_KEY = ['Champion', 'TOP 2', 'TOP 3'] as const

export type PodiumEntry = LeaderboardEntry & {
  /** Metric driving the bar. Tier rows have no usage, so callers pass a proxy. */
  podiumValue: number
}

export type LeaderboardPodiumProps = {
  entries: PodiumEntry[]
  /** True when `podiumValue` is a rank proxy rather than a token count. */
  isRankProxy: boolean
}

export function LeaderboardPodium(props: LeaderboardPodiumProps) {
  const { t } = useTranslation()

  if (props.entries.length === 0) return null

  const top = Math.max(...props.entries.map((entry) => entry.podiumValue))

  return (
    <div className='grid gap-[9px]'>
      {props.entries.map((entry, index) => {
        const tone = TONES[index] ?? TONES[2]
        const width = podiumBarWidth(entry.podiumValue, top)
        const rank = entry.rank ?? index + 1

        return (
          <AnimateInView key={entry.id} delay={index * 90} animation='fade-up'>
            <article
              className={cn(
                'relative isolate grid items-center gap-2 overflow-hidden rounded-lg py-2 pr-3 pl-1 sm:gap-4',
                'grid-cols-[34px_minmax(0,1fr)_minmax(82px,auto)]',
                'sm:grid-cols-[40px_minmax(180px,300px)_minmax(140px,1fr)_minmax(116px,auto)]',
                index === 0 ? 'min-h-[62px]' : 'min-h-14'
              )}
              style={
                {
                  '--tone': tone.color,
                  '--tone-rgb': tone.rgb,
                } as React.CSSProperties
              }
            >
              {/* Tinted border and left-weighted wash. */}
              <div
                aria-hidden
                className='absolute inset-0 -z-20 rounded-[inherit] border'
                style={{
                  borderColor: 'rgb(var(--tone-rgb) / 0.2)',
                  background:
                    'linear-gradient(90deg, rgb(var(--tone-rgb) / 0.14), rgb(var(--tone-rgb) / 0.035) 42%, rgb(var(--tone-rgb) / 0) 78%)',
                }}
              />
              <div
                aria-hidden
                className='pointer-events-none absolute -top-[90%] -left-[78px] -z-10 h-[280%] w-[190px]'
                style={{
                  background:
                    'radial-gradient(circle, rgb(var(--tone-rgb) / 0.16), transparent 66%)',
                }}
              />

              <span
                className='grid h-[42px] w-[34px] place-items-center sm:w-10'
                style={{ color: 'var(--tone)' }}
                aria-label={t('Rank {{rank}}', { rank })}
              >
                <Trophy
                  className={cn('shrink-0', tone.trophy)}
                  strokeWidth={2}
                />
              </span>

              <span className='flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-[9px]'>
                <span
                  className='w-full min-w-0 truncate text-sm font-extrabold sm:w-auto'
                  title={entry.displayName}
                >
                  {entry.displayName}
                </span>
                <span
                  className='shrink-0 rounded-full border px-[7px] py-[3px] text-[10px] leading-none font-extrabold whitespace-nowrap'
                  style={{
                    color: 'var(--tone)',
                    borderColor: 'rgb(var(--tone-rgb) / 0.24)',
                    background: 'rgb(var(--tone-rgb) / 0.07)',
                  }}
                >
                  {t(BADGE_LABEL_KEY[index] ?? BADGE_LABEL_KEY[2])}
                </span>
                {showsTierBadge(entry.showRankBadge) && (
                  <RankBadge label={entry.rankLabel} size='podium' />
                )}
              </span>

              <span
                className='bg-muted relative col-span-2 h-[11px] overflow-hidden rounded-full sm:col-span-1'
                role='img'
                aria-label={
                  props.isRankProxy
                    ? t('Rank {{rank}}', { rank })
                    : t('{{percent}}% of the top entry', {
                        percent: Math.round(width),
                      })
                }
              >
                <span
                  className='relative block h-full rounded-[inherit] transition-[width] duration-700 ease-out'
                  style={{
                    width: `${width}%`,
                    background:
                      'linear-gradient(90deg, rgb(var(--tone-rgb) / 0.72), var(--tone))',
                  }}
                >
                  {/* Endpoint marker sitting on the leading edge of the fill. */}
                  {width > 0 && (
                    <span
                      aria-hidden
                      className='absolute top-1/2 right-0 size-[10px] translate-x-px -translate-y-1/2 rounded-full border-2'
                      style={{
                        background: 'var(--tone)',
                        borderColor: 'rgb(244 242 236 / 0.82)',
                        boxShadow: '0 0 0 3px rgb(var(--tone-rgb) / 0.12)',
                      }}
                    />
                  )}
                </span>
              </span>

              <span className='text-foreground/80 truncate text-right font-mono text-[13px] font-bold tabular-nums'>
                {props.isRankProxy
                  ? entry.rankLabel
                  : formatTokens(entry.tokenUsed ?? 0)}
              </span>
            </article>
          </AnimateInView>
        )
      })}
    </div>
  )
}
