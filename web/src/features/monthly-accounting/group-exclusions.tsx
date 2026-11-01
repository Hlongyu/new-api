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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { saveAccountingGroupExclusions } from './api'

export function GroupExclusions(props: { groups: string[] }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(props.groups.join(', '))
  const [invalid, setInvalid] = useState(false)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: saveAccountingGroupExclusions,
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['monthly-accounting'] }),
  })
  return (
    <form
      className='space-y-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (mutation.isPending) return
        const groups = [
          ...new Set(value.trim() ? value.trim().split(/[,，\s]+/) : []),
        ].sort()
        if (groups.length > 500 || groups.some((group) => group.length > 64)) {
          setInvalid(true)
          return
        }
        setInvalid(false)
        mutation.mutate(groups)
      }}
    >
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor='accounting-excluded-groups'>
            {t('Excluded accounting groups')}
          </FieldLabel>
          <p
            id='accounting-group-hint'
            className='text-muted-foreground text-sm'
          >
            {t(
              'Separate exact group names with commas. Only wallet consumption is deducted; excluded users are not deducted twice. Saved exclusions apply to all months.'
            )}
          </p>
          <Input
            id='accounting-excluded-groups'
            aria-describedby='accounting-group-hint'
            aria-invalid={invalid}
            value={value}
            disabled={mutation.isPending}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
              mutation.reset()
            }}
          />
        </Field>
      </FieldGroup>
      <Button type='submit' disabled={mutation.isPending}>
        {t('Save')}
      </Button>
      {(invalid || mutation.isError) && (
        <p role='alert'>
          {t(
            'Failed to save group exclusions. Use up to 500 group names, each at most 64 characters.'
          )}
        </p>
      )}
      {mutation.isSuccess && (
        <p role='status'>{t('Accounting exclusions saved.')}</p>
      )}
    </form>
  )
}
