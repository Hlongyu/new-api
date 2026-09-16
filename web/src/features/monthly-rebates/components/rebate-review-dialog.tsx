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
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { rebateTime, rebateUSD } from '../lib/format'
import type { MonthlyRebate } from '../types'

interface Props {
  bill: MonthlyRebate | null
  pending: boolean
  onClose: () => void
  onIssue: (bill: MonthlyRebate) => void
}

export function RebateReviewDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const bill = props.bill
  if (!bill) return null
  let subscriptionStatus = '-'
  if (bill.subscription_status === 'active') {
    subscriptionStatus = t('Active')
  }
  if (bill.subscription_status === 'expired') {
    subscriptionStatus = t('Expired')
  }
  if (bill.subscription_status === 'cancelled') {
    subscriptionStatus = t('Cancelled')
  }
  if (bill.subscription_status === 'deleted') {
    subscriptionStatus = t('Deleted')
  }
  const canIssue =
    !bill.issued_at &&
    bill.rebate_quota > 0 &&
    (bill.status === 'pending' || bill.status === 'failed')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.pending) props.onClose()
      }}
      title={t('Review monthly rebate')}
      description={`${bill.period} · ${bill.username} (#${bill.user_id})`}
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            disabled={props.pending}
            onClick={props.onClose}
          >
            {t('Close')}
          </Button>
          {canIssue && (
            <Button
              disabled={props.pending}
              onClick={() => props.onIssue(bill)}
            >
              {props.pending ? t('Processing...') : t('Approve and issue')}
            </Button>
          )}
        </>
      }
    >
      <dl className='grid grid-cols-2 gap-3 text-sm'>
        <dt>{t('Wallet consumption')}</dt>
        <dd>{rebateUSD(bill.wallet_quota, bill.quota_per_usd)}</dd>
        <dt>{t('Rebate rate')}</dt>
        <dd>{bill.rate_percent}%</dd>
        <dt>{t('Calculated rebate')}</dt>
        <dd>{rebateUSD(bill.rebate_quota, bill.quota_per_usd)}</dd>
        <dt>{t('Last calculated')}</dt>
        <dd>{rebateTime(bill.checked_at, i18n.language)}</dd>
        {bill.issued_at > 0 && (
          <>
            <dt>{t('Consumption at approval')}</dt>
            <dd>{rebateUSD(bill.issued_wallet_quota, bill.quota_per_usd)}</dd>
            <dt>{t('Approved rate')}</dt>
            <dd>{bill.issued_rate_percent}%</dd>
            <dt>{t('Issued rebate')}</dt>
            <dd>{rebateUSD(bill.issued_quota, bill.quota_per_usd)}</dd>
            <dt>{t('Rebate difference')}</dt>
            <dd>
              {rebateUSD(
                bill.rebate_quota - bill.issued_quota,
                bill.quota_per_usd
              )}
            </dd>
            <dt>{t('Issued by')}</dt>
            <dd>#{bill.issued_by}</dd>
            <dt>{t('Issued at')}</dt>
            <dd>{rebateTime(bill.issued_at, i18n.language)}</dd>
            <dt>{t('Subscription ID')}</dt>
            <dd>#{bill.subscription_id}</dd>
            <dt>{t('Subscription status')}</dt>
            <dd>{subscriptionStatus}</dd>
            <dt>{t('Used subscription quota')}</dt>
            <dd>
              {rebateUSD(bill.subscription_amount_used, bill.quota_per_usd)}
            </dd>
            <dt>{t('Expires at')}</dt>
            <dd>{rebateTime(bill.subscription_expires_at, i18n.language)}</dd>
          </>
        )}
      </dl>
      {bill.last_error && (
        <Alert variant='destructive'>
          <AlertDescription>{bill.last_error}</AlertDescription>
        </Alert>
      )}
      {bill.status === 'needs_review' && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Consumption changed or requires review. Check the original issuance and linked subscription; no automatic adjustment is made.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {canIssue && (
        <Alert>
          <AlertDescription>
            {t(
              'Approval grants a subscription valid for one year without quota resets. Wallet balance is unchanged. Each user can receive this rebate only once per month.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </Dialog>
  )
}
