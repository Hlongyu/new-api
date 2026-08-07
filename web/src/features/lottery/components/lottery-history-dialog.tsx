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
import { Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { ScrollArea } from '@/components/ui/scroll-area'

import { formatAmount, formatWeek } from '../lib/format'
import type { LotteryWeeklyHistory } from '../types'

type LotteryHistoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  periods: LotteryWeeklyHistory[]
  isRoot: boolean
}

export function LotteryHistoryDialog(props: LotteryHistoryDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('Weekly Top 3 History')}</DialogTitle>
        </DialogHeader>

        {props.periods.length === 0 ? (
          <Empty className='min-h-56'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>{t('No weekly ranking history yet.')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className='max-h-[min(65vh,34rem)] pr-3'>
            <div className='space-y-5'>
              {props.periods.map((period) => (
                <section key={period.periodKey} className='space-y-2'>
                  <div className='flex items-center justify-between gap-3'>
                    <h3 className='text-sm font-medium'>
                      {formatWeek(period.weekStart, period.weekEnd)}
                    </h3>
                    <Badge variant='outline'>{t('Top 3')}</Badge>
                  </div>
                  <ol className='divide-border/60 divide-y rounded-lg border px-3'>
                    {period.winners.map((winner) => (
                      <li
                        key={`${period.periodKey}:${winner.rank}`}
                        className='flex min-w-0 items-center gap-2 py-2.5 text-xs'
                      >
                        <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md font-mono font-medium'>
                          {winner.rank}
                        </span>
                        <span className='min-w-0 flex-1 truncate font-medium'>
                          {winner.displayName}
                        </span>
                        {props.isRoot &&
                          typeof winner.amountUsd === 'number' && (
                            <span className='text-muted-foreground shrink-0 font-mono tabular-nums'>
                              {t('Spent ${{amount}}', {
                                amount: formatAmount(winner.amountUsd),
                              })}
                            </span>
                          )}
                        {winner.draw?.status === 'completed' && (
                          <Badge variant='secondary' className='shrink-0'>
                            {t('Claimed ${{amount}}', {
                              amount: formatAmount(winner.draw.amountUsd),
                            })}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
