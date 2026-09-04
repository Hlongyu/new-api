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
import type { TFunction } from 'i18next'
import { z } from 'zod'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const MAX_ACTIVATION_PERIOD_MILLISECONDS = 10 * 365 * DAY_MILLISECONDS

export function toCouponActivationDeadline(date: Date): Date {
  const deadline = new Date(date)
  deadline.setHours(23, 59, 59, 999)
  return deadline
}

export function createCouponFormDefaults(now = new Date()) {
  const activationDeadline = new Date(now)
  activationDeadline.setDate(activationDeadline.getDate() + 7)
  return {
    name: '',
    applicableGroup: '',
    ratio: 0.1,
    rpmLimit: 0,
    activationDeadline: toCouponActivationDeadline(activationDeadline),
    activeDurationMinutes: 60,
  }
}

export function getCouponFormSchema(t: TFunction, now = Date.now()) {
  return z.object({
    name: z.string().trim().min(1, t('Coupon name is required')).max(64),
    applicableGroup: z.string().min(1, t('Applicable group is required')),
    ratio: z
      .number()
      .positive(t('Ratio cap must be greater than 0'))
      .max(1, t('Ratio cap cannot exceed 1')),
    rpmLimit: z
      .number()
      .int(t('RPM must be an integer'))
      .min(0, t('RPM must be zero or greater'))
      .max(60_000, t('RPM cannot exceed 60000')),
    activationDeadline: z
      .date()
      .refine(
        (deadline) => deadline.getTime() > now,
        t('Activation deadline must be in the future')
      )
      .refine(
        (deadline) =>
          deadline.getTime() <= now + MAX_ACTIVATION_PERIOD_MILLISECONDS,
        t('Activation deadline cannot exceed 10 years')
      ),
    activeDurationMinutes: z
      .number()
      .int(t('Active duration must be an integer number of minutes'))
      .min(1, t('Active duration must be at least 1 minute'))
      .max(365 * 24 * 60),
  })
}

export type CouponFormValues = z.infer<ReturnType<typeof getCouponFormSchema>>
