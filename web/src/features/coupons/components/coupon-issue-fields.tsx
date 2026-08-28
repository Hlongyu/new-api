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
import { Controller, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { CouponFormValues } from '../lib/coupon-form'

export function CouponIssueFields(props: {
  form: UseFormReturn<CouponFormValues>
  groups: string[]
  idPrefix: string
}) {
  const { t } = useTranslation()
  const { form, groups, idPrefix } = props

  return (
    <FieldGroup className='grid gap-4 sm:grid-cols-2'>
      <Field
        data-invalid={Boolean(form.formState.errors.name)}
        className='sm:col-span-2'
      >
        <FieldLabel htmlFor={`${idPrefix}-name`}>{t('Coupon name')}</FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          aria-invalid={Boolean(form.formState.errors.name)}
          placeholder={t('For example: GPT Pro trial')}
          {...form.register('name')}
        />
        <FieldError errors={[form.formState.errors.name]} />
      </Field>

      <Controller
        control={form.control}
        name='applicableGroup'
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`${idPrefix}-group`}>
              {t('Applicable group')}
            </FieldLabel>
            <Select
              items={groups.map((group) => ({ value: group, label: group }))}
              value={field.value}
              onValueChange={(value) => field.onChange(value || '')}
            >
              <SelectTrigger
                id={`${idPrefix}-group`}
                aria-invalid={fieldState.invalid}
              >
                <SelectValue placeholder={t('Select a group')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {groups.map((group) => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />

      <Field data-invalid={Boolean(form.formState.errors.ratio)}>
        <FieldLabel htmlFor={`${idPrefix}-ratio`}>{t('Ratio cap')}</FieldLabel>
        <Input
          id={`${idPrefix}-ratio`}
          type='number'
          min='0.000001'
          max='1'
          step='any'
          aria-invalid={Boolean(form.formState.errors.ratio)}
          {...form.register('ratio', { valueAsNumber: true })}
        />
        <FieldError errors={[form.formState.errors.ratio]} />
      </Field>

      <Field data-invalid={Boolean(form.formState.errors.validityDays)}>
        <FieldLabel htmlFor={`${idPrefix}-validity`}>
          {t('Activation period (days)')}
        </FieldLabel>
        <Input
          id={`${idPrefix}-validity`}
          type='number'
          min='1'
          max='3650'
          step='1'
          aria-invalid={Boolean(form.formState.errors.validityDays)}
          {...form.register('validityDays', { valueAsNumber: true })}
        />
        <FieldError errors={[form.formState.errors.validityDays]} />
      </Field>

      <Field data-invalid={Boolean(form.formState.errors.activeDurationHours)}>
        <FieldLabel htmlFor={`${idPrefix}-duration`}>
          {t('Active duration (hours)')}
        </FieldLabel>
        <Input
          id={`${idPrefix}-duration`}
          type='number'
          min={1 / 60}
          max='8760'
          step='any'
          aria-invalid={Boolean(form.formState.errors.activeDurationHours)}
          {...form.register('activeDurationHours', { valueAsNumber: true })}
        />
        <FieldError errors={[form.formState.errors.activeDurationHours]} />
      </Field>
    </FieldGroup>
  )
}
