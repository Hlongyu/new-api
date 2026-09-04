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
import { Search } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { CouponEffectiveStatus } from '../types'

export type CouponHistoryStatusFilter = CouponEffectiveStatus | 'all'

const STATUS_FILTERS: Array<{
  value: CouponHistoryStatusFilter
  labelKey: string
}> = [
  { value: 'all', labelKey: 'All Status' },
  { value: 'available', labelKey: 'Available' },
  { value: 'active', labelKey: 'Active' },
  { value: 'expired', labelKey: 'Expired' },
  { value: 'ended', labelKey: 'Ended' },
  { value: 'revoked', labelKey: 'Revoked' },
]

interface CouponHistoryFiltersProps {
  search: string
  status: CouponHistoryStatusFilter
  onSearchChange: (value: string) => void
  onStatusChange: (value: CouponHistoryStatusFilter) => void
}

export function CouponHistoryFilters(props: CouponHistoryFiltersProps) {
  const { t } = useTranslation()
  const statusItems = useMemo(
    () =>
      STATUS_FILTERS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t]
  )

  return (
    <div className='grid w-full gap-3 sm:w-auto sm:grid-cols-[10rem_minmax(16rem,20rem)]'>
      <Field>
        <FieldLabel htmlFor='coupon-history-status' className='sr-only'>
          {t('Status')}
        </FieldLabel>
        <Select<CouponHistoryStatusFilter>
          items={statusItems}
          value={props.status}
          onValueChange={(value) => {
            if (value) props.onStatusChange(value)
          }}
        >
          <SelectTrigger id='coupon-history-status' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {statusItems.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor='coupon-history-search' className='sr-only'>
          {t('Search coupon history')}
        </FieldLabel>
        <div className='relative'>
          <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            id='coupon-history-search'
            className='pl-8'
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder={t('Search recipient, coupon, or batch')}
          />
        </div>
      </Field>
    </div>
  )
}
