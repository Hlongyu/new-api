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
import { useWatch, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FieldGroup } from '@/components/ui/field'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  LIMIT_MAX,
  WINDOW_MAX,
  type UserRequestLimitForm,
} from './user-request-limit-form'

type RulePath =
  | `groups.${number}.default`
  | `groups.${number}.keyGroups.${number}.rule`
type Props = { control: Control<UserRequestLimitForm>; path: RulePath }

export function UserRequestLimitRuleFields(props: Props) {
  const { t } = useTranslation()
  const rule = useWatch({ control: props.control, name: props.path })
  return (
    <FieldGroup className='grid gap-4 md:grid-cols-2'>
      <FormField
        control={props.control}
        name={`${props.path}.concurrencyEnabled`}
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-4'>
            <FormLabel>{t('Enable concurrency limit')}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={props.control}
        name={`${props.path}.rateEnabled`}
        render={({ field }) => (
          <FormItem className='flex items-center justify-between gap-4'>
            <FormLabel>{t('Enable rate limiting')}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={props.control}
        name={`${props.path}.maxConcurrent`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Maximum concurrent requests')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                type='number'
                min={1}
                max={LIMIT_MAX}
                step={1}
                disabled={!rule?.concurrencyEnabled}
                onChange={(event) => field.onChange(Number(event.target.value))}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FieldGroup className='grid grid-cols-2 gap-3'>
        <FormField
          control={props.control}
          name={`${props.path}.rateCount`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Max requests per period')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={1}
                  max={LIMIT_MAX}
                  step={1}
                  disabled={!rule?.rateEnabled}
                  onChange={(event) =>
                    field.onChange(Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={props.control}
          name={`${props.path}.windowMinutes`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Window (minutes)')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={1}
                  max={WINDOW_MAX}
                  step={1}
                  disabled={!rule?.rateEnabled}
                  onChange={(event) =>
                    field.onChange(Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </FieldGroup>
    </FieldGroup>
  )
}
