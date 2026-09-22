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
import type { ComponentProps } from 'react'
import { useFieldArray, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from '@/components/ui/field'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import {
  emptyRequestLimitRule,
  type UserRequestLimitForm,
} from './user-request-limit-form'
import { UserRequestLimitRuleFields } from './user-request-limit-rule'

type Props = {
  control: Control<UserRequestLimitForm>
  index: number
  onRemove: () => void
  groupNames: string[]
  groupSelectionDisabled: boolean
}

export function UserRequestLimitGroup(props: Props) {
  const { t } = useTranslation()
  const keys = useFieldArray({
    control: props.control,
    name: `groups.${props.index}.keyGroups`,
  })
  return (
    <FieldSet className='min-w-0 rounded-lg border p-4'>
      <FieldLegend>{t('User group limits')}</FieldLegend>
      <FieldGroup>
        <FormField
          control={props.control}
          name={`groups.${props.index}.name`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('User group name')}</FormLabel>
              <FormControl>
                <RequestLimitGroupSelect
                  {...field}
                  groupNames={props.groupNames}
                  disabled={props.groupSelectionDisabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FieldSet>
          <FieldLegend variant='label'>{t('Default pool')}</FieldLegend>
          <FieldDescription>
            {t(
              'Keys without a dedicated rule share this pool, including keys with no group selected.'
            )}
          </FieldDescription>
          <UserRequestLimitRuleFields
            control={props.control}
            path={`groups.${props.index}.default`}
          />
        </FieldSet>
        {keys.fields.map((key, index) => (
          <FieldSet key={key.id} className='border-t pt-4'>
            <FieldLegend variant='label'>
              {t('Dedicated Key group pool')}
            </FieldLegend>
            <FormField
              control={props.control}
              name={`groups.${props.index}.keyGroups.${index}.name`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Key group name')}</FormLabel>
                  <FormControl>
                    <RequestLimitGroupSelect
                      {...field}
                      groupNames={props.groupNames}
                      disabled={props.groupSelectionDisabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <UserRequestLimitRuleFields
              control={props.control}
              path={`groups.${props.index}.keyGroups.${index}.rule`}
            />
            <Button
              type='button'
              variant='outline'
              className='self-start'
              onClick={() => keys.remove(index)}
            >
              {t('Remove Key group rule')}
            </Button>
          </FieldSet>
        ))}
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={props.groupSelectionDisabled}
            onClick={() =>
              keys.append({ name: '', rule: emptyRequestLimitRule() })
            }
          >
            {t('Add Key group rule')}
          </Button>
          <Button type='button' variant='ghost' onClick={props.onRemove}>
            {t('Remove user group rule')}
          </Button>
        </div>
      </FieldGroup>
    </FieldSet>
  )
}

function RequestLimitGroupSelect(
  props: ComponentProps<typeof NativeSelect> & {
    value: string
    groupNames: string[]
  }
) {
  const { t } = useTranslation()
  const { groupNames, ...selectProps } = props
  return (
    <NativeSelect {...selectProps} className='w-full'>
      <NativeSelectOption value='' disabled>
        {t('Select a group')}
      </NativeSelectOption>
      {props.value && !groupNames.includes(props.value) && (
        <NativeSelectOption value={props.value} disabled>
          {t('{{group}} (unavailable)', { group: props.value })}
        </NativeSelectOption>
      )}
      {groupNames.map((name) => (
        <NativeSelectOption key={name} value={name}>
          {name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
