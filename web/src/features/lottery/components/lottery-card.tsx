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
import {
  Alert01Icon,
  ChampionIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  DiceIcon,
  GiftIcon,
  Refresh01Icon,
  ShieldUserIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

import { useLottery, useLotteryDraw, useLotteryResolution } from '../hooks'
import { formatAmount, formatWeek } from '../lib/format'
import type {
  LotteryAdminIssue,
  LotteryOpportunity,
  LotteryResolution,
} from '../types'
import { LotteryHistoryDialog } from './lottery-history-dialog'

function statusBadge(opportunity: LotteryOpportunity) {
  if (!opportunity.draw) return null
  if (opportunity.draw.status === 'completed') {
    return { variant: 'secondary' as const, key: 'Claimed ${{amount}}' }
  }
  if (opportunity.draw.status === 'unknown') {
    return { variant: 'warning' as const, key: 'Needs review' }
  }
  if (opportunity.draw.status === 'failed') {
    return { variant: 'destructive' as const, key: 'Ready to retry' }
  }
  return { variant: 'outline' as const, key: 'Processing' }
}

type PendingResolution = {
  issue: LotteryAdminIssue
  resolution: LotteryResolution
}

export type LotteryCardProps = {
  onAwarded?: () => void
}

export function LotteryCard({ onAwarded }: LotteryCardProps) {
  const { t } = useTranslation()
  const lottery = useLottery()
  const draw = useLotteryDraw(onAwarded)
  const resolution = useLotteryResolution()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingResolution, setPendingResolution] =
    useState<PendingResolution | null>(null)

  if (lottery.isLoading) {
    return (
      <Card data-card-hover='false' aria-label={t('Weekly Top 3 Draw')}>
        <CardHeader>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-4 w-56' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-28 w-full' />
        </CardContent>
      </Card>
    )
  }

  const data = lottery.data
  if (lottery.isError || !data?.enabled || !data.configured) {
    return (
      <Card data-card-hover='false' className='border-primary/20'>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg'>
              <HugeiconsIcon
                icon={GiftIcon}
                className='size-4.5'
                strokeWidth={2}
              />
            </span>
            <div className='min-w-0'>
              <CardTitle>{t('Weekly Top 3 Draw')}</CardTitle>
              <CardDescription className='text-xs'>
                {t('Leaderboard data is temporarily unavailable.')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <Alert>
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
            <AlertTitle>{t('No draw available')}</AlertTitle>
            <AlertDescription>
              {t('Leaderboard data is temporarily unavailable.')}
            </AlertDescription>
          </Alert>
          {lottery.isError && (
            <Button
              variant='outline'
              className='w-full'
              onClick={() => lottery.refetch()}
              disabled={lottery.isFetching}
            >
              {lottery.isFetching ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
              )}
              {t('Retry')}
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  const nextDraw = data.nextDraw
  const unresolved = data.opportunities.find(
    (opportunity) =>
      opportunity.draw?.status === 'unknown' ||
      opportunity.draw?.status === 'processing'
  )
  const totalWeight = nextDraw?.prizes.reduce(
    (total, prize) => total + prize.weight,
    0
  )
  const drawResult = draw.data?.draw
  const showCompleted = drawResult?.status === 'completed'
  const showUnknown = draw.data?.pending || Boolean(unresolved)
  const justCompletedCurrent = Boolean(
    showCompleted &&
    drawResult.periodKey === nextDraw?.periodKey &&
    drawResult.rank === nextDraw?.rank
  )
  const drawFailed = draw.isError || nextDraw?.draw?.status === 'failed'
  const adminIssues = data.adminIssues ?? []

  const submitResolution = () => {
    if (!pendingResolution) return
    resolution.mutate(
      {
        id: pendingResolution.issue.id,
        resolution: pendingResolution.resolution,
      },
      {
        onSuccess: () => {
          toast.success(
            t(
              pendingResolution.resolution === 'completed'
                ? 'Reward marked as paid'
                : 'Reward can be retried'
            )
          )
          setPendingResolution(null)
        },
        onError: () => toast.error(t('Could not update the reward')),
      }
    )
  }

  return (
    <Card data-card-hover='false' className='border-primary/20'>
      <CardHeader>
        <div className='flex items-center gap-2'>
          <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg'>
            <HugeiconsIcon
              icon={GiftIcon}
              className='size-4.5'
              strokeWidth={2}
            />
          </span>
          <div className='min-w-0'>
            <CardTitle>{t('Weekly Top 3 Draw')}</CardTitle>
            <CardDescription className='text-xs'>
              {t('Previous week: {{range}}', {
                range: formatWeek(data.weekStart, data.weekEnd),
              })}
            </CardDescription>
          </div>
        </div>
        {data.pendingOpportunities > 0 && (
          <CardAction>
            <Badge
              variant='warning'
              aria-label={t('{{count}} reward pending', {
                count: data.pendingOpportunities,
              })}
            >
              <HugeiconsIcon icon={GiftIcon} strokeWidth={2} />
              {data.pendingOpportunities}
            </Badge>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className='space-y-4'>
        {showCompleted && drawResult && (
          <Alert className='border-emerald-500/35 bg-emerald-500/5'>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            <AlertTitle>
              {t('You won ${{amount}}', {
                amount: formatAmount(drawResult.amountUsd),
              })}
            </AlertTitle>
            <AlertDescription>
              {t('Added to your account balance.')}
            </AlertDescription>
          </Alert>
        )}

        {showUnknown && (
          <Alert className='border-warning/40 bg-warning/5 text-warning'>
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
            <AlertTitle>{t('Reward verification pending')}</AlertTitle>
            <AlertDescription>
              {t('Do not retry while the credit result is being checked.')}
            </AlertDescription>
          </Alert>
        )}

        {nextDraw && (
          <section className='border-primary/20 bg-primary/[0.035] space-y-3 rounded-lg border p-3'>
            <div className='flex items-start gap-3'>
              <div className='bg-background ring-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg ring-1'>
                <HugeiconsIcon
                  icon={ChampionIcon}
                  className='size-5'
                  strokeWidth={2}
                />
              </div>
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium'>
                  {t('Rank {{rank}} reward', { rank: nextDraw.rank })}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {t('You finished #{{rank}} in the weekly spending chart.', {
                    rank: nextDraw.rank,
                  })}
                </p>
              </div>
            </div>

            {drawFailed && (
              <Alert variant='destructive'>
                <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} />
                <AlertTitle>{t('Draw failed')}</AlertTitle>
                <AlertDescription>
                  {t('The draw could not be completed. Please retry.')}
                </AlertDescription>
              </Alert>
            )}

            {!showUnknown && !justCompletedCurrent && (
              <Button
                className='w-full'
                onClick={() => draw.mutate()}
                disabled={draw.isPending || !data.canDraw}
              >
                {draw.isPending ? (
                  <Spinner aria-label={t('Drawing...')} />
                ) : (
                  <HugeiconsIcon
                    icon={drawFailed ? Refresh01Icon : DiceIcon}
                    strokeWidth={2}
                  />
                )}
                {draw.isPending
                  ? t('Drawing...')
                  : t(drawFailed ? 'Retry draw' : 'Draw now')}
              </Button>
            )}

            {!showUnknown && totalWeight && totalWeight > 0 && (
              <div className='space-y-1.5'>
                <p className='text-muted-foreground text-[11px] font-medium'>
                  {t('Prize odds')}
                </p>
                <div className='flex flex-wrap gap-1.5'>
                  {nextDraw.prizes.map((prize) => (
                    <Badge
                      key={`${prize.amountUsd}:${prize.weight}`}
                      variant='outline'
                      className='font-mono text-[10px] tabular-nums'
                    >
                      ${formatAmount(prize.amountUsd)}
                      <span className='text-muted-foreground'>
                        {formatAmount((prize.weight / totalWeight) * 100)}%
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {!nextDraw && !showUnknown && (
          <Alert>
            <HugeiconsIcon icon={ChampionIcon} strokeWidth={2} />
            <AlertTitle>
              {data.opportunities.length > 0
                ? t('All rewards claimed')
                : t('No draw available')}
            </AlertTitle>
            <AlertDescription>
              {data.opportunities.length > 0
                ? t('Your weekly rewards have all been added.')
                : t('Finish in the weekly top 3 to unlock a draw.')}
            </AlertDescription>
          </Alert>
        )}

        <section className='space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-sm font-medium'>{t("Last week's winners")}</h3>
            <Badge variant='outline'>{t('Top 3')}</Badge>
          </div>
          {data.winners.length > 0 ? (
            <ol className='divide-border/60 divide-y'>
              {data.winners.map((winner) => {
                const badge = statusBadge(winner)
                return (
                  <li
                    key={`${winner.periodKey}:${winner.rank}`}
                    className='flex min-w-0 items-start gap-2 py-2 text-xs'
                  >
                    <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md font-mono font-medium'>
                      {winner.rank}
                    </span>
                    <div className='min-w-0 flex-1 space-y-1'>
                      <span className='block truncate font-medium'>
                        {winner.displayName}
                      </span>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        {data.isRoot &&
                          typeof winner.amountUsd === 'number' && (
                            <span className='text-muted-foreground font-mono tabular-nums'>
                              ${formatAmount(winner.amountUsd)}
                            </span>
                          )}
                        {badge && (
                          <Badge
                            variant={badge.variant}
                            className='text-[10px]'
                          >
                            {t(badge.key, {
                              amount: formatAmount(winner.draw?.amountUsd ?? 0),
                            })}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className='text-muted-foreground py-2 text-xs'>
              {t('No qualifying usage was recorded last week.')}
            </p>
          )}
        </section>

        <Button
          variant='outline'
          className='w-full'
          onClick={() => setHistoryOpen(true)}
        >
          <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
          {t('View weekly history')}
        </Button>

        {adminIssues.length > 0 && (
          <section className='border-warning/40 bg-warning/5 space-y-3 rounded-lg border p-3'>
            <div className='flex items-start gap-2'>
              <HugeiconsIcon
                icon={ShieldUserIcon}
                className='text-warning mt-0.5 size-4 shrink-0'
                strokeWidth={2}
              />
              <div>
                <h3 className='text-sm font-medium'>
                  {t('Draw verification')}
                </h3>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Verify uncertain rewards before allowing another attempt.'
                  )}
                </p>
              </div>
            </div>
            <ul className='divide-warning/20 divide-y'>
              {adminIssues.map((issue) => (
                <li
                  key={issue.id}
                  className='space-y-2 py-2 first:pt-0 last:pb-0'
                >
                  <div className='flex items-center gap-2 text-xs'>
                    <span className='min-w-0 flex-1 truncate font-medium'>
                      {issue.userName}
                    </span>
                    <span className='text-muted-foreground font-mono'>
                      #{issue.userId}
                    </span>
                    <span className='font-mono tabular-nums'>
                      ${formatAmount(issue.amountUsd)}
                    </span>
                  </div>
                  <div className='grid gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      className='flex-1'
                      onClick={() =>
                        setPendingResolution({ issue, resolution: 'completed' })
                      }
                    >
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        strokeWidth={2}
                      />
                      {t('Mark paid')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      className='flex-1'
                      onClick={() =>
                        setPendingResolution({ issue, resolution: 'failed' })
                      }
                    >
                      <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
                      {t('Allow retry')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>

      <LotteryHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        periods={data.weeklyHistory}
        isRoot={data.isRoot}
      />

      <ConfirmDialog
        open={Boolean(pendingResolution)}
        onOpenChange={(open) => !open && setPendingResolution(null)}
        title={t(
          pendingResolution?.resolution === 'completed'
            ? 'Confirm reward payment'
            : 'Allow this reward to be retried?'
        )}
        desc={t(
          pendingResolution?.resolution === 'completed'
            ? 'Confirm the quota was added before marking this reward as paid.'
            : 'Only allow a retry after confirming that no quota was added.'
        )}
        confirmText={t(
          pendingResolution?.resolution === 'completed'
            ? 'Confirm paid'
            : 'Confirm retry'
        )}
        handleConfirm={submitResolution}
        isLoading={resolution.isPending}
      />
    </Card>
  )
}
