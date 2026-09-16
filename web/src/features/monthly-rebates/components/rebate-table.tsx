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

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { rebateUSD } from '../lib/format'
import type { MonthlyRebate } from '../types'

interface Props {
  bills: MonthlyRebate[]
  onSelect: (bill: MonthlyRebate) => void
}

export function RebateTable(props: Props) {
  const { t } = useTranslation()
  if (!props.bills.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('No rebate records')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Calculate a completed month to prepare rebate records for review.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Table aria-label={t('Monthly rebates')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('User')}</TableHead>
          <TableHead>{t('Wallet consumption')}</TableHead>
          <TableHead>{t('Rebate rate')}</TableHead>
          <TableHead>{t('Calculated rebate')}</TableHead>
          <TableHead>{t('Issued rebate')}</TableHead>
          <TableHead>{t('Status')}</TableHead>
          <TableHead>{t('Actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.bills.map((bill) => {
          let status = t('Pending review')
          if (bill.status === 'ineligible') status = t('Below rebate threshold')
          if (bill.status === 'issued') status = t('Rebate issued')
          if (bill.status === 'failed') status = t('Failed')
          if (bill.status === 'needs_review') status = t('Needs reconciliation')
          return (
            <TableRow key={bill.id}>
              <TableCell>
                <div>{bill.username}</div>
                <div className='text-muted-foreground'>#{bill.user_id}</div>
              </TableCell>
              <TableCell>
                {rebateUSD(bill.wallet_quota, bill.quota_per_usd)}
              </TableCell>
              <TableCell>{bill.rate_percent}%</TableCell>
              <TableCell>
                {rebateUSD(bill.rebate_quota, bill.quota_per_usd)}
              </TableCell>
              <TableCell>
                {rebateUSD(bill.issued_quota, bill.quota_per_usd)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    bill.status === 'needs_review' || bill.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {status}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => props.onSelect(bill)}
                >
                  {t('Review details')}
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
