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
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'

import { adjustUserQuota } from '../api'

interface UserQuotaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: number
  onSuccess: () => void
}

export function UserQuotaDialog(props: UserQuotaDialogProps) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const amountValue = Number(amount)
  const quotaValue = parseQuotaFromDollars(amountValue)
  const validAmount =
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    Number.isSafeInteger(quotaValue) &&
    quotaValue > 0 &&
    quotaValue <= 2147483647

  const handleConfirm = async () => {
    if (!validAmount || loading) return
    setLoading(true)
    try {
      const result = await adjustUserQuota({
        id: props.userId,
        action: 'add_quota',
        mode: 'add',
        value: quotaValue,
      })
      if (result.success) {
        toast.success(t('Subscription quota granted'))
        setAmount('')
        props.onOpenChange(false)
        props.onSuccess()
      } else {
        toast.error(result.message || t('Failed to grant subscription quota'))
      }
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : t('Failed to grant subscription quota')
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (loading) return
        if (!open) setAmount('')
        props.onOpenChange(open)
      }}
      title={t('Grant subscription quota')}
      description={t(
        'Valid for one year from issuance. Quota does not reset and wallet balance is unchanged.'
      )}
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            disabled={loading}
            onClick={() => {
              setAmount('')
              props.onOpenChange(false)
            }}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !validAmount}>
            {loading ? t('Processing...') : t('Confirm')}
          </Button>
        </>
      }
    >
      <div className='text-muted-foreground text-sm'>
        {t('Subscription quota')}: {formatQuota(validAmount ? quotaValue : 0)}
      </div>
      <Field data-disabled={loading}>
        <FieldLabel htmlFor='subscription-grant-amount'>
          {t('Amount')} ({currencyLabel})
        </FieldLabel>
        <Input
          id='subscription-grant-amount'
          type='number'
          step={tokensOnly ? 1 : 0.000001}
          min={0}
          disabled={loading}
          placeholder={
            tokensOnly
              ? t('Enter amount in tokens')
              : t('Enter amount in {{currency}}', { currency: currencyLabel })
          }
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleConfirm()
            }
          }}
        />
      </Field>
    </Dialog>
  )
}
