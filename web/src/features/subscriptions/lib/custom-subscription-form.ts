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
import dayjs from 'dayjs'
import timezonePlugin from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars } from '@/lib/format'

import type { CreateCustomSubscriptionRequest } from '../types'

dayjs.extend(utc)
dayjs.extend(timezonePlugin)

export const customSubscriptionResetUnits = [
  'never',
  'hour',
  'day',
  'week',
  'month',
] as const

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function parseCustomSubscriptionTimestamp(
  value: string,
  timezone: string
): number {
  if (!value || !isValidTimezone(timezone)) return Number.NaN
  const parsed = dayjs.tz(value, timezone)
  return parsed.isValid() ? parsed.unix() : Number.NaN
}

export function formatCustomSubscriptionTimestamp(
  timestamp: number,
  timezone: string
): string {
  if (!Number.isFinite(timestamp) || !isValidTimezone(timezone)) return '-'
  return dayjs.unix(timestamp).tz(timezone).format('YYYY-MM-DD HH:mm Z')
}

export function getCustomSubscriptionFormSchema(t: TFunction) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t('Subscription name is required'))
        .max(128),
      start_time: z.string().min(1, t('Start time is required')),
      end_time: z.string().min(1, t('End time is required')),
      amount_total_dollars: z
        .number()
        .min(0, t('Quota cannot be negative'))
        .max(Number.MAX_SAFE_INTEGER),
      reset_anchor_time: z.string(),
      reset_interval_value: z
        .number()
        .int(t('Refresh interval must be an integer'))
        .min(0)
        .max(10000),
      reset_interval_unit: z.enum(customSubscriptionResetUnits),
      reset_timezone: z.string().trim().min(1, t('Time zone is required')),
      price_amount: z
        .number()
        .min(0, t('Price cannot be negative'))
        .max(999999, t('Price is too large')),
      allow_wallet_overflow: z.boolean(),
      note: z.string().max(1000, t('Note is too long')),
    })
    .superRefine((values, ctx) => {
      if (!isValidTimezone(values.reset_timezone)) {
        ctx.addIssue({
          code: 'custom',
          path: ['reset_timezone'],
          message: t('Invalid IANA time zone'),
        })
        return
      }
      const start = parseCustomSubscriptionTimestamp(
        values.start_time,
        values.reset_timezone
      )
      const end = parseCustomSubscriptionTimestamp(
        values.end_time,
        values.reset_timezone
      )
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        ctx.addIssue({
          code: 'custom',
          path: ['end_time'],
          message: t('End time must be later than start time'),
        })
      } else if (end <= Math.floor(Date.now() / 1000)) {
        ctx.addIssue({
          code: 'custom',
          path: ['end_time'],
          message: t('End time must be in the future'),
        })
      }
      if (values.reset_interval_unit === 'never') return
      if (values.reset_interval_value < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['reset_interval_value'],
          message: t('Refresh interval must be at least 1'),
        })
      }
      const anchor = parseCustomSubscriptionTimestamp(
        values.reset_anchor_time,
        values.reset_timezone
      )
      if (!Number.isFinite(anchor) || anchor < start || anchor >= end) {
        ctx.addIssue({
          code: 'custom',
          path: ['reset_anchor_time'],
          message: t('Refresh anchor must be within the subscription period'),
        })
      }
    })
}

export type CustomSubscriptionFormValues = z.infer<
  ReturnType<typeof getCustomSubscriptionFormSchema>
>

export function createCustomSubscriptionFormDefaults(): CustomSubscriptionFormValues {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const start = dayjs().tz(timezone).second(0).millisecond(0)
  return {
    title: '',
    start_time: start.format('YYYY-MM-DDTHH:mm'),
    end_time: start.add(1, 'month').format('YYYY-MM-DDTHH:mm'),
    amount_total_dollars: 0,
    reset_anchor_time: start.format('YYYY-MM-DDTHH:mm'),
    reset_interval_value: 1,
    reset_interval_unit: 'month',
    reset_timezone: timezone,
    price_amount: 0,
    allow_wallet_overflow: false,
    note: '',
  }
}

export function customSubscriptionFormToPayload(
  values: CustomSubscriptionFormValues
): CreateCustomSubscriptionRequest {
  const startTime = parseCustomSubscriptionTimestamp(
    values.start_time,
    values.reset_timezone
  )
  const endTime = parseCustomSubscriptionTimestamp(
    values.end_time,
    values.reset_timezone
  )
  const resetEnabled = values.reset_interval_unit !== 'never'
  return {
    title: values.title.trim(),
    start_time: startTime,
    end_time: endTime,
    amount_total: parseQuotaFromDollars(values.amount_total_dollars),
    reset_anchor_time: resetEnabled
      ? parseCustomSubscriptionTimestamp(
          values.reset_anchor_time,
          values.reset_timezone
        )
      : 0,
    reset_interval_value: resetEnabled ? values.reset_interval_value : 0,
    reset_interval_unit: values.reset_interval_unit,
    reset_timezone: resetEnabled ? values.reset_timezone.trim() : '',
    price_amount: values.price_amount,
    allow_wallet_overflow: values.allow_wallet_overflow,
    note: values.note.trim(),
  }
}

export function getCustomSubscriptionPreviewBoundaries(
  values: CustomSubscriptionFormValues,
  limit = 4
): number[] {
  if (
    values.reset_interval_unit === 'never' ||
    values.reset_interval_value < 1 ||
    !isValidTimezone(values.reset_timezone)
  ) {
    return []
  }
  const anchor = dayjs.tz(values.reset_anchor_time, values.reset_timezone)
  const end = dayjs.tz(values.end_time, values.reset_timezone)
  if (!anchor.isValid() || !end.isValid()) return []
  const unit = values.reset_interval_unit
  const result: number[] = []
  for (let index = 1; index <= limit; index += 1) {
    const boundary = anchor.add(values.reset_interval_value * index, unit)
    if (!boundary.isBefore(end)) break
    result.push(boundary.unix())
  }
  return result
}
