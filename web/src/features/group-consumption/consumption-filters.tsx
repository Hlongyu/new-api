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

import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { ConsumptionQuery } from './api'

export function ConsumptionFilters(props: {
  value: ConsumptionQuery
  groups: { group: string }[]
  currentMonth: string
  disabled: boolean
  onChange: (value: ConsumptionQuery) => void
  onSubmit: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      <FieldGroup className='grid w-full min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-5'>
        <Field>
          <FieldLabel htmlFor='group-month'>
            {t('Consumption month')}
          </FieldLabel>
          <Input
            id='group-month'
            type='month'
            required
            max={props.currentMonth}
            value={props.value.month}
            onChange={(event) =>
              props.onChange({ ...props.value, month: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='consumption-group'>{t('Group')}</FieldLabel>
          <NativeSelect
            id='consumption-group'
            value={props.value.group}
            onChange={(event) =>
              props.onChange({ ...props.value, group: event.target.value })
            }
          >
            <NativeSelectOption value=''>{t('All')}</NativeSelectOption>
            {props.groups.map((row) => (
              <NativeSelectOption key={row.group} value={row.group}>
                {row.group}
              </NativeSelectOption>
            ))}
            {props.value.group &&
              !props.groups.some((row) => row.group === props.value.group) && (
                <NativeSelectOption value={props.value.group}>
                  {props.value.group}
                </NativeSelectOption>
              )}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='consumption-user'>{t('User ID')}</FieldLabel>
          <Input
            id='consumption-user'
            type='number'
            min={1}
            max={2147483647}
            step={1}
            value={props.value.user_id}
            onChange={(event) =>
              props.onChange({ ...props.value, user_id: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='consumption-source'>
            {t('Consumption source')}
          </FieldLabel>
          <NativeSelect
            id='consumption-source'
            value={props.value.source}
            onChange={(event) =>
              props.onChange({
                ...props.value,
                source: event.target.value as ConsumptionQuery['source'],
              })
            }
          >
            <NativeSelectOption value='all'>{t('All')}</NativeSelectOption>
            <NativeSelectOption value='wallet'>
              {t('Wallet consumption')}
            </NativeSelectOption>
            <NativeSelectOption value='subscription'>
              {t('Subscription consumption')}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='consumption-dimension'>
            {t('Group by')}
          </FieldLabel>
          <NativeSelect
            id='consumption-dimension'
            value={props.value.dimension}
            onChange={(event) =>
              props.onChange({
                ...props.value,
                dimension: event.target.value as ConsumptionQuery['dimension'],
              })
            }
          >
            <NativeSelectOption value='group'>
              {t('By group')}
            </NativeSelectOption>
            <NativeSelectOption value='user'>{t('By user')}</NativeSelectOption>
          </NativeSelect>
        </Field>
      </FieldGroup>
      <div className='mt-3 flex gap-2'>
        <Button type='submit' disabled={props.disabled}>
          {t('Search')}
        </Button>
        <Button type='submit' variant='outline' disabled={props.disabled}>
          {t('Refresh')}
        </Button>
        <Button
          type='button'
          variant='ghost'
          disabled={props.disabled}
          onClick={props.onReset}
        >
          {t('Reset')}
        </Button>
      </div>
    </form>
  )
}
