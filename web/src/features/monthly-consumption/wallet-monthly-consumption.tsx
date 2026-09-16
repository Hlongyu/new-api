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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { rebateTime, rebateUSD } from '@/features/monthly-rebates/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { getMonthlyConsumption } from './api'

export function WalletMonthlyConsumption() {
  const { t, i18n } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: ['monthly-consumption', 'self', userId],
    queryFn: () => getMonthlyConsumption(),
    refetchInterval: 60000,
  })
  const data = query.data
  const row = data?.items[0]
  return (
    <section
      className='space-y-3 rounded-lg border p-4'
      aria-label={t('This month consumption')}
    >
      <div className='flex items-center justify-between gap-2'>
        <h3 className='font-medium'>
          {t('This month consumption')} {data?.period}
        </h3>
        <Button
          variant='ghost'
          size='sm'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      {query.isLoading && <Skeleton className='h-16 w-full' />}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load monthly consumption')}
          </AlertDescription>
        </Alert>
      )}
      {data && row && (
        <dl className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
          <div>
            <dt className='text-muted-foreground text-sm'>
              {t('Wallet consumption')}
            </dt>
            <dd className='mt-1 text-xl font-semibold tabular-nums'>
              {rebateUSD(row.wallet_quota, data.quota_per_usd)}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-sm'>
              {t('Subscription consumption')}
            </dt>
            <dd className='mt-1 text-xl font-semibold tabular-nums'>
              {rebateUSD(row.subscription_quota, data.quota_per_usd)}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground text-sm'>
              {t('Total consumption')}
            </dt>
            <dd className='mt-1 text-xl font-semibold tabular-nums'>
              {rebateUSD(row.total_quota, data.quota_per_usd)}
            </dd>
          </div>
        </dl>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Beijing calendar month, net API consumption after refunds. Violation fees excluded. Only wallet consumption counts toward rebates.'
        )}
      </p>
      {data && (
        <p className='text-muted-foreground text-xs'>
          {t('Updated at')}: {rebateTime(data.as_of, i18n.language)}
        </p>
      )}
    </section>
  )
}
