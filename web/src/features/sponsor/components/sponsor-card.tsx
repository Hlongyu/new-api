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
import { AlertTriangle, CheckCircle2, Heart } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

import { SPONSOR_MESSAGE_MAX_LENGTH } from '../constants'
import { useSponsorContext, useSponsorOrder } from '../hooks'
import { SponsorAdminPanel } from './sponsor-admin-panel'
import { SponsorHistory } from './sponsor-history'

function SponsorOutcomeNotice(props: { children: React.ReactNode; tone: 'ok' | 'warn' | 'error' }) {
  if (props.tone === 'ok') {
    return (
      <p className='inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400'>
        <CheckCircle2 className='size-3.5' />
        {props.children}
      </p>
    )
  }
  if (props.tone === 'warn') {
    return (
      <div className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
        <p className='inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
          <AlertTriangle className='size-3.5' />
          {props.children}
        </p>
      </div>
    )
  }
  return <p className='text-destructive text-xs'>{props.children}</p>
}

/**
 * Sponsorship lives on the wallet page because it spends New API quota, the
 * same as a top-up or a subscription — the balance it draws down is right
 * above it on this page.
 */
export function SponsorCard() {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const contextQuery = useSponsorContext()
  const sponsor = useSponsorOrder(contextQuery.data?.userId ?? 0)

  if (contextQuery.isLoading) {
    return (
      <Card data-card-hover='false' className='bg-muted/20 py-0'>
        <CardContent className='space-y-3 p-3 sm:p-4'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='h-10 rounded-lg' />
          <Skeleton className='h-24 rounded-lg' />
        </CardContent>
      </Card>
    )
  }

  // The Core feature may be disabled; if it is unreachable the
  // wallet page should still render everything else.
  if (contextQuery.error || !contextQuery.data) return null

  const context = contextQuery.data
  const parsedAmount = Number(amount)
  const amountValid =
    Number.isInteger(parsedAmount) &&
    parsedAmount >= context.rules.minAmount &&
    parsedAmount <= context.rules.maxAmount

  const handleConfirm = () => {
    setConfirmOpen(false)
    sponsor.submit(
      { amountCny: parsedAmount, message: message.trim() },
      {
        onSuccess: () => {
          setAmount('')
          setMessage('')
        },
      }
    )
  }

  const renderOutcome = () => {
    if (sponsor.outcome.kind === 'completed') {
      return (
        <SponsorOutcomeNotice tone='ok'>
          {t('Thank you for sponsoring ¥{{amount}}', {
            amount: sponsor.outcome.order.amountCny,
          })}
        </SponsorOutcomeNotice>
      )
    }
    if (sponsor.outcome.kind === 'unverified') {
      return (
        <SponsorOutcomeNotice tone='warn'>
          {t('Charge result is being verified. Do not resubmit.')}
        </SponsorOutcomeNotice>
      )
    }
    if (sponsor.outcome.kind === 'retryable') {
      return (
        <div className='space-y-2'>
          <SponsorOutcomeNotice tone='error'>
            {t(sponsor.outcome.messageKey)}
          </SponsorOutcomeNotice>
          <Button
            size='sm'
            variant='outline'
            onClick={handleConfirm}
            disabled={sponsor.isSubmitting || !amountValid}
          >
            {t('Retry')}
          </Button>
        </div>
      )
    }
    if (sponsor.outcome.kind === 'terminal') {
      return (
        <SponsorOutcomeNotice tone='error'>
          {t(sponsor.outcome.messageKey)}
        </SponsorOutcomeNotice>
      )
    }
    return null
  }

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='space-y-4 p-3 sm:p-4'>
        <div className='flex items-start gap-3'>
          <IconBadge tone='chart-1'>
            <Heart className='size-4' />
          </IconBadge>
          <div className='min-w-0'>
            <p className='text-foreground text-sm font-semibold'>
              {t('Sponsor')}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Sponsorships are deducted from your New API balance at ¥1 = $1 and cannot be refunded.'
              )}
            </p>
          </div>
        </div>

        {/* An interrupted attempt can still be resolved with its original key. */}
        {sponsor.pendingCharge && sponsor.outcome.kind === 'idle' && (
          <div className='space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              {t(
                'A previous sponsorship did not complete. Check its result before retrying.'
              )}
            </p>
            <div className='flex gap-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={sponsor.isSubmitting}
                onClick={() =>
                  sponsor.submit({
                    amountCny: sponsor.pendingCharge?.amount ?? 0,
                    message: '',
                  })
                }
              >
                {t('Check result')}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                onClick={sponsor.discardPending}
                disabled={sponsor.isSubmitting}
              >
                {t('Dismiss')}
              </Button>
            </div>
          </div>
        )}

        <div className='grid gap-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] sm:items-end'>
          <div className='space-y-1.5'>
            <Label htmlFor='sponsor-amount' className='text-xs'>
              {t('Amount (¥{{min}}-{{max}})', {
                min: context.rules.minAmount,
                max: context.rules.maxAmount,
              })}
            </Label>
            <Input
              id='sponsor-amount'
              inputMode='numeric'
              value={amount}
              placeholder={String(context.rules.minAmount)}
              disabled={sponsor.isSubmitting}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='sponsor-message' className='text-xs'>
              {t('Message (optional)')}
            </Label>
            <Input
              id='sponsor-message'
              value={message}
              maxLength={SPONSOR_MESSAGE_MAX_LENGTH}
              disabled={sponsor.isSubmitting}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!amountValid || sponsor.isSubmitting}
          >
            {t('Sponsor')}
          </Button>
        </div>

        {renderOutcome()}

        <div className='border-t pt-3'>
          <p className='text-muted-foreground mb-2 text-[10px] font-medium tracking-wider uppercase'>
            {t('My Sponsorships')}
          </p>
          <SponsorHistory orders={context.history} />
        </div>

        {context.isRoot && <SponsorAdminPanel enabled={context.isRoot} />}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Sponsor')}
        desc={
          <>
            <p>{t('Confirm a sponsorship of ¥{{amount}}?', { amount: parsedAmount })}</p>
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                'This will deduct quota from your New API balance immediately and cannot be refunded.'
              )}
            </p>
          </>
        }
        handleConfirm={handleConfirm}
        isLoading={sponsor.isSubmitting}
      />
    </Card>
  )
}
