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
import { AlertTriangle, CheckCircle2, CreditCard } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

import { usePostpaidApply, usePostpaidContext } from '../hooks'
import type { PostpaidContext } from '../types'
import { formatDate } from '../lib/format'
import { PostpaidAdminPanel } from './postpaid-admin-panel'
import { PostpaidHistory } from './postpaid-history'

function StatTile(props: { label: string; value: string; hint?: string }) {
  return (
    <div className='bg-muted/40 rounded-lg px-2.5 py-2'>
      <p className='text-muted-foreground text-[11px]'>{props.label}</p>
      <p className='font-mono text-sm tabular-nums'>{props.value}</p>
      {props.hint && (
        <p className='text-muted-foreground truncate text-[11px]'>
          {props.hint}
        </p>
      )}
    </div>
  )
}

function CardShell(props: { children: React.ReactNode }) {
  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='space-y-4 p-3 sm:p-4'>
        {props.children}
      </CardContent>
    </Card>
  )
}

type ApplyFormProps = {
  context: PostpaidContext
  onGranted?: () => void
}

function ApplyForm(props: ApplyFormProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const postpaid = usePostpaidApply(props.context.userId, props.onGranted)

  const max = props.context.availableCredit
  const parsed = Number(amount)
  const amountValid =
    Number.isInteger(parsed) && parsed > 0 && parsed <= max && amount !== ''

  const submit = (value: number) => {
    setConfirmOpen(false)
    postpaid.apply(value)
  }

  const renderOutcome = () => {
    if (postpaid.outcome.kind === 'completed') {
      return (
        <p className='inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400'>
          <CheckCircle2 className='size-3.5' />
          {t('{{amount}} credit added to your balance', {
            amount: postpaid.outcome.grant.creditAmount,
          })}
        </p>
      )
    }

    // 202: the quota increase is unresolved upstream. Resubmitting would
    // collide with the one-open-grant rule and could double-credit.
    if (postpaid.outcome.kind === 'unverified') {
      return (
        <div className='space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
          <p className='inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
            <AlertTriangle className='size-3.5' />
            {t('The result is being verified. Do not resubmit.')}
          </p>
        </div>
      )
    }

    if (postpaid.outcome.kind === 'retryable') {
      return (
        <div className='space-y-2'>
          <p className='text-destructive text-xs'>
            {t(postpaid.outcome.messageKey)}
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={() => submit(parsed)}
            disabled={postpaid.isApplying || !amountValid}
          >
            {t('Retry')}
          </Button>
        </div>
      )
    }

    if (postpaid.outcome.kind === 'terminal') {
      return (
        <p className='text-destructive text-xs'>
          {t(postpaid.outcome.messageKey)}
        </p>
      )
    }

    return null
  }

  if (props.context.applicationPending) {
    return (
      <p className='inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
        <AlertTriangle className='size-3.5' />
        {t('A credit request is still being processed.')}
      </p>
    )
  }

  if (props.context.creditLimit <= 0) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('Your current tier has no credit limit. Rank up to unlock it.')}
      </p>
    )
  }

  if (!props.context.canApply) {
    return (
      <p className='text-muted-foreground text-xs'>
        {t('Your credit limit is fully drawn. Repay with a redemption code to free it up.')}
      </p>
    )
  }

  return (
    <>
      {/* An interrupted attempt can still be resolved with its original key. */}
      {postpaid.pendingCharge && postpaid.outcome.kind === 'idle' && (
        <div className='space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
          <p className='text-xs text-amber-600 dark:text-amber-400'>
            {t(
              'A previous credit request did not complete. Check its result before retrying.'
            )}
          </p>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={postpaid.isApplying}
              onClick={() => submit(postpaid.pendingCharge?.amount ?? 1)}
            >
              {t('Check result')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={postpaid.isApplying}
              onClick={postpaid.discardPending}
            >
              {t('Dismiss')}
            </Button>
          </div>
        </div>
      )}

      <div className='grid gap-3 sm:grid-cols-[minmax(0,160px)_auto] sm:items-end'>
        <div className='space-y-1.5'>
          <Label htmlFor='postpaid-amount' className='text-xs'>
            {t('Amount (1-{{max}})', { max })}
          </Label>
          <Input
            id='postpaid-amount'
            inputMode='numeric'
            value={amount}
            placeholder='10'
            disabled={postpaid.isApplying}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!amountValid || postpaid.isApplying}
        >
          {t('Draw credit')}
        </Button>
      </div>

      {renderOutcome()}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Draw credit')}
        desc={
          <>
            <p>
              {t('Add {{amount}} credit to your balance now?', {
                amount: parsed,
              })}
            </p>
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                'It is repaid automatically out of your next redemption code, not billed separately.'
              )}
            </p>
          </>
        }
        handleConfirm={() => submit(parsed)}
        isLoading={postpaid.isApplying}
      />
    </>
  )
}

export type PostpaidCardProps = {
  /** Called after credit lands, so the wallet can refresh its balance. */
  onGranted?: () => void
}

/**
 * Postpaid credit, on the wallet page directly under the redemption code.
 *
 * The adjacency is the point: drawing credit raises the New API balance
 * immediately, and the debt is collected back out of that balance the next
 * time a redemption code is redeemed. Users who miss that connection read the
 * clawback as their top-up going missing, so it is stated in the card body
 * rather than tucked into the confirm dialog.
 */
export function PostpaidCard(props: PostpaidCardProps) {
  const { t } = useTranslation()
  const contextQuery = usePostpaidContext()

  if (contextQuery.isLoading) {
    return (
      <CardShell>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-16 rounded-lg' />
        <Skeleton className='h-10 rounded-lg' />
      </CardShell>
    )
  }

  // The Core deployment may disable quota loans; the wallet still renders the
  // rest of its content when the feature is unavailable.
  const context = contextQuery.data
  if (contextQuery.error || !context || !context.configured) return null

  const owed = context.outstandingAmount

  return (
    <CardShell>
      <div className='flex items-start gap-3'>
        <IconBadge tone='chart-1'>
          <CreditCard className='size-4' />
        </IconBadge>
        <div className='min-w-0'>
          <p className='text-foreground text-sm font-semibold'>
            {t('Postpaid Credit')}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Credit lands in your balance right away. It is repaid automatically from your next redemption code, so that top-up will be reduced by what you owe.'
            )}
          </p>
        </div>
      </div>

      <div className='grid grid-cols-3 gap-2'>
        <StatTile
          label={t('Credit limit')}
          value={String(context.creditLimit)}
          hint={context.activeGrant?.tierName}
        />
        <StatTile
          label={t('Available')}
          value={String(context.availableCredit)}
        />
        <StatTile
          label={t('Owed')}
          value={String(owed)}
          hint={
            owed > 0 && context.nextDueAt > 0
              ? t('Due {{date}}', { date: formatDate(context.nextDueAt) })
              : undefined
          }
        />
      </div>

      <ApplyForm context={context} onGranted={props.onGranted} />

      {owed > 0 && (
        <p className='text-muted-foreground text-[11px]'>
          {t('Repayment is deducted immediately when you redeem a code.')}
        </p>
      )}

      <PostpaidHistory grants={context.grants} events={context.events} />

      {context.isRoot && <PostpaidAdminPanel enabled={context.isRoot} />}
    </CardShell>
  )
}
