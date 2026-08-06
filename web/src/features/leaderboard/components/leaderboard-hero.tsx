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
import { RefreshCw, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { BOARD_OPTIONS, LEADERBOARD_BOARDS, PERIOD_OPTIONS } from '../constants'
import type { LeaderboardBoard, LeaderboardPeriod } from '../types'

export type LeaderboardHeroProps = {
  board: LeaderboardBoard
  period: LeaderboardPeriod
  memberCount: number
  isRefreshing: boolean
  onBoardChange: (board: LeaderboardBoard) => void
  onPeriodChange: (period: LeaderboardPeriod) => void
  onOpenProfile: () => void
  onRefresh: () => void
}

/** Mirrors the Model Square header so the two public pages read as a set. */
export function LeaderboardHero(props: LeaderboardHeroProps) {
  const { t } = useTranslation()
  const isUsage = props.board === LEADERBOARD_BOARDS.USAGE

  return (
    <>
      <header className='mx-auto mb-5 max-w-3xl pt-5 text-center sm:mb-10 sm:pt-10'>
        <h1 className='text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight'>
          {t('Leaderboard')}
        </h1>
        <p className='text-muted-foreground/80 mt-3 text-sm sm:mt-4 sm:text-base'>
          {t('{{count}} members are on the board', {
            count: props.memberCount,
          })}
        </p>
      </header>

      <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <Tabs
            value={props.board}
            onValueChange={(value) =>
              props.onBoardChange(value as LeaderboardBoard)
            }
          >
            <TabsList>
              {BOARD_OPTIONS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* The tier board is a standing, not a windowed metric. */}
          {isUsage && (
            <Tabs
              value={props.period}
              onValueChange={(value) =>
                props.onPeriodChange(value as LeaderboardPeriod)
              }
            >
              <TabsList>
                {PERIOD_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={props.onRefresh}
            disabled={props.isRefreshing}
            className='gap-1.5'
          >
            <RefreshCw
              className={`size-4 ${props.isRefreshing ? 'animate-spin' : ''}`}
            />
            <span className='hidden sm:inline'>{t('Refresh')}</span>
          </Button>
          <Button size='sm' onClick={props.onOpenProfile} className='gap-1.5'>
            <UserRound className='size-4' />
            {t('My Profile')}
          </Button>
        </div>
      </div>
    </>
  )
}
