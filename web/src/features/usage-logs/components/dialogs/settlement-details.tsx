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

import { Label } from '@/components/ui/label'
import { formatLogQuota } from '@/lib/format'

import type { LogOtherData } from '../../types'

type SettlementDetailsProps = {
  quota: number
  other: LogOtherData
}

export function SettlementDetails(props: SettlementDetailsProps) {
  const { t } = useTranslation()
  const subscriptionQuota = props.other.subscription_consumed ?? 0
  const walletQuota = props.other.wallet_quota_deducted ?? 0
  const hasBreakdown =
    props.other.subscription_consumed != null ||
    props.other.wallet_quota_deducted != null

  if (!hasBreakdown) return null

  let sourceLabel = t('Wallet')
  if (
    props.other.billing_source === 'hybrid' ||
    (subscriptionQuota > 0 && walletQuota > 0)
  ) {
    sourceLabel = t('Subscription + Wallet')
  } else if (
    props.other.billing_source === 'subscription' ||
    subscriptionQuota > 0
  ) {
    sourceLabel = t('Subscription')
  }

  const rows = [
    { label: t('Funding Source'), value: sourceLabel },
    { label: t('Total Cost'), value: formatLogQuota(props.quota) },
    {
      label: t('Deducted by subscription'),
      value: formatLogQuota(subscriptionQuota),
    },
    {
      label: t('Deducted from wallet'),
      value: formatLogQuota(walletQuota),
    },
  ]

  return (
    <section
      aria-labelledby='settlement-details-title'
      className='flex min-w-0 flex-col gap-1.5'
      data-settlement-details='true'
    >
      <Label id='settlement-details-title' className='text-xs font-semibold'>
        {t('Settlement Details')}
      </Label>
      <div className='bg-muted/30 flex min-w-0 flex-col gap-1 overflow-hidden rounded-md border p-2.5 max-sm:p-2'>
        {rows.map((row) => (
          <div
            key={row.label}
            className='grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3'
          >
            <span className='text-muted-foreground min-w-0 text-xs'>
              {row.label}
            </span>
            <span className='max-w-full min-w-0 font-mono text-xs break-all sm:wrap-break-word'>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
