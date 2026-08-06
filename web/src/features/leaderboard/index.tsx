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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'

import {
  LeaderboardCards,
  LeaderboardHero,
  LeaderboardPodium,
  LeaderboardSummary,
  LeaderboardTable,
  type PodiumEntry,
} from './components'
import {
  LEADERBOARD_BOARDS,
  LEADERBOARD_PERIODS,
  PODIUM_SIZE,
} from './constants'
import { useLeaderboard } from './hooks'
import { ProfileSheet } from './components/profile-sheet'
import type { LeaderboardBoard, LeaderboardPeriod } from './types'

function LeaderboardLoading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-[104px] w-full rounded-lg' />
      <Skeleton className='h-[140px] w-full rounded-xl' />
      <Skeleton className='h-[420px] w-full rounded-xl' />
    </div>
  )
}

function LeaderboardError(props: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className='bg-card rounded-xl border border-dashed px-6 py-12 text-center'>
      <h2 className='text-foreground text-base font-semibold'>
        {t('Unable to load leaderboard')}
      </h2>
      <p className='text-muted-foreground mx-auto mt-2 max-w-md text-sm'>
        {props.message}
      </p>
    </div>
  )
}

export function Leaderboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = useSearch({ from: '/rankings/' })
  const [profileOpen, setProfileOpen] = useState(false)

  const board: LeaderboardBoard =
    search.board === LEADERBOARD_BOARDS.RANK
      ? LEADERBOARD_BOARDS.RANK
      : LEADERBOARD_BOARDS.USAGE
  const period: LeaderboardPeriod = search.period ?? LEADERBOARD_PERIODS.DAY

  const { view, isLoading, isFetching, error, refetch } = useLeaderboard(
    board,
    period
  )

  const handleBoardChange = useCallback(
    (next: LeaderboardBoard) => {
      // The tier board has no period, so drop the parameter rather than leave a
      // meaningless one in shared URLs.
      navigate({
        to: '/rankings',
        search:
          next === LEADERBOARD_BOARDS.RANK
            ? { board: next }
            : { board: next, period },
      })
    },
    [navigate, period]
  )

  const handlePeriodChange = useCallback(
    (next: LeaderboardPeriod) => {
      navigate({ to: '/rankings', search: { board, period: next } })
    },
    [navigate, board]
  )

  const isUsage = board === LEADERBOARD_BOARDS.USAGE

  const podiumEntries = useMemo<PodiumEntry[]>(() => {
    const entries = view?.entries ?? []
    const top = entries.slice(0, PODIUM_SIZE)
    if (isUsage) {
      return top.map((entry) => ({
        ...entry,
        podiumValue: entry.tokenUsed ?? 0,
      }))
    }
    // Tier rows carry no magnitude, so the bar reflects standing instead.
    return top.map((entry, index) => ({
      ...entry,
      podiumValue: top.length - index,
    }))
  }, [view?.entries, isUsage])

  const emptyMessage = isUsage ? t('No usage data yet') : t('No tier data yet')

  const renderBoard = () => {
    if (isLoading) return <LeaderboardLoading />
    if (error || !view) {
      return (
        <LeaderboardError
          message={t('Leaderboard data is temporarily unavailable.')}
        />
      )
    }

    return (
      <div className='space-y-6'>
        <LeaderboardSummary view={view} isLoading={false} />
        <LeaderboardPodium entries={podiumEntries} isRankProxy={!isUsage} />

        <section className='space-y-3'>
          <h2 className='text-foreground text-sm font-semibold'>
            {t('Full Ranking')}
          </h2>
          <div className='hidden sm:block'>
            <LeaderboardTable
              board={board}
              entries={view.entries}
              emptyMessage={emptyMessage}
            />
          </div>
          <div className='sm:hidden'>
            <LeaderboardCards
              board={board}
              entries={view.entries}
              emptyMessage={emptyMessage}
            />
          </div>
        </section>

      </div>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        {/* Narrower than Model Square: that page fills 1800px with a card
            grid, while a four-column board just stretches its name column. */}
        <PageTransition className='relative mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <LeaderboardHero
            board={board}
            period={period}
            memberCount={view?.memberCount ?? 0}
            isRefreshing={isFetching}
            onBoardChange={handleBoardChange}
            onPeriodChange={handlePeriodChange}
            onOpenProfile={() => setProfileOpen(true)}
            onRefresh={() => void refetch()}
          />
          {renderBoard()}
        </PageTransition>
      </div>

      <ProfileSheet open={profileOpen} onOpenChange={setProfileOpen} />
    </PublicLayout>
  )
}
