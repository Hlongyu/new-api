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
import { AlertTriangle, CheckCircle2, Ticket } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  RENAME_CARD_MAX_QUANTITY,
  RENAME_CARD_MIN_QUANTITY,
} from '../constants'
import { useRenameCardPurchase } from '../hooks'
import type { LeaderboardMe } from '../types'

export type RenameCardPurchaseProps = {
  me: LeaderboardMe
  onBusyChange: (busy: boolean) => void
}

export function RenameCardPurchase(props: RenameCardPurchaseProps) {
  const { t } = useTranslation()
  const [quantity, setQuantity] = useState(1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const purchase = useRenameCardPurchase(props.me.id)

  const amount = quantity * props.me.rename.cardPriceCny
  const clampedQuantity = Math.min(
    RENAME_CARD_MAX_QUANTITY,
    Math.max(RENAME_CARD_MIN_QUANTITY, quantity)
  )

  const handleConfirm = () => {
    setConfirmOpen(false)
    props.onBusyChange(true)
    purchase.purchase(clampedQuantity, {
      onSettled: () => props.onBusyChange(false),
    })
  }

  const renderOutcome = () => {
    if (purchase.outcome.kind === 'completed') {
      return (
        <p className='inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400'>
          <CheckCircle2 className='size-3.5' />
          {t('Purchased {{count}} rename card(s)', {
            count: purchase.outcome.order.quantity,
          })}
        </p>
      )
    }

    // 202: the charge is in flight with no confirmed result. Resubmitting
    // would collide with the service's one-open-order rule, so only offer a
    // re-read of the current balance.
    if (purchase.outcome.kind === 'unverified') {
      return (
        <div className='space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
          <p className='inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400'>
            <AlertTriangle className='size-3.5' />
            {t('Charge result is being verified. Do not resubmit.')}
          </p>
        </div>
      )
    }

    if (purchase.outcome.kind === 'retryable') {
      return (
        <div className='space-y-2'>
          <p className='text-destructive text-xs'>
            {t(purchase.outcome.messageKey)}
          </p>
          <Button
            size='sm'
            variant='outline'
            onClick={handleConfirm}
            disabled={purchase.isPurchasing}
          >
            {t('Retry')}
          </Button>
        </div>
      )
    }

    if (purchase.outcome.kind === 'terminal') {
      return (
        <p className='text-destructive text-xs'>
          {t(purchase.outcome.messageKey)}
        </p>
      )
    }

    return null
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-between'>
        <p className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
          <Ticket className='size-4' />
          {t('Rename Cards')}
        </p>
        <Badge variant='secondary'>
          {t('{{count}} cards', { count: props.me.rename.cardBalance })}
        </Badge>
      </div>

      {/* An interrupted attempt can still be resolved with its original key. */}
      {purchase.pendingPurchase && purchase.outcome.kind === 'idle' && (
        <div className='space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3'>
          <p className='text-xs text-amber-600 dark:text-amber-400'>
            {t(
              'A previous purchase did not complete. Check its result before retrying.'
            )}
          </p>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                purchase.purchase(purchase.pendingPurchase?.amount ?? 1)
              }
              disabled={purchase.isPurchasing}
            >
              {t('Check result')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={purchase.discardPending}
              disabled={purchase.isPurchasing}
            >
              {t('Dismiss')}
            </Button>
          </div>
        </div>
      )}

      <div className='flex items-end gap-2'>
        <div className='flex-1 space-y-1.5'>
          <Label htmlFor='rename-card-quantity' className='text-xs'>
            {t('Purchase quantity')}
          </Label>
          <Input
            id='rename-card-quantity'
            type='number'
            min={RENAME_CARD_MIN_QUANTITY}
            max={RENAME_CARD_MAX_QUANTITY}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value) || 1)}
          />
        </div>
        <Button
          size='sm'
          onClick={() => setConfirmOpen(true)}
          disabled={purchase.isPurchasing}
        >
          {t('Purchase Rename Cards')}
        </Button>
      </div>

      <p className='text-muted-foreground text-xs'>
        {t('Amount deducted from New API')}: ${amount.toFixed(2)}
      </p>

      {renderOutcome()}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('Purchase Rename Cards')}
        desc={
          <>
            <p>
              {t('Confirm the purchase of {{count}} rename card(s) for {{amount}}?', {
                count: clampedQuantity,
                amount: `$${amount.toFixed(2)}`,
              })}
            </p>
            <p className='text-muted-foreground mt-2 text-xs'>
              {t(
                'This will deduct quota from your New API balance immediately and cannot be refunded.'
              )}
            </p>
          </>
        }
        handleConfirm={handleConfirm}
        isLoading={purchase.isPurchasing}
      />
    </div>
  )
}
