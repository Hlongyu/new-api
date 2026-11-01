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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { parseExcludedUserIDs } from './api'

export function GroupUserExclusions(props: {
  group: string
  userIDs: number[]
  disabled: boolean
  onApply: (ids: number[]) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [value, setValue] = useState(props.userIDs.join(', '))
  const [invalid, setInvalid] = useState(false)
  return (
    <form
      className='min-w-64'
      onSubmit={(event) => {
        event.preventDefault()
        const ids = parseExcludedUserIDs(value)
        if (ids === null) {
          setInvalid(true)
          return
        }
        setInvalid(false)
        props.onApply(ids)
      }}
    >
      <FieldGroup className='grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-2'>
        <Field data-invalid={invalid}>
          <FieldLabel className='sr-only' htmlFor={id}>
            {t('Excluded user IDs')} · {props.group}
          </FieldLabel>
          <Input
            id={id}
            value={value}
            disabled={props.disabled}
            aria-invalid={invalid}
            placeholder={t('User IDs separated by commas')}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
          />
        </Field>
        <Button type='submit' variant='outline' disabled={props.disabled}>
          {t('Confirm')}
        </Button>
      </FieldGroup>
      {invalid && <p role='alert'>{t('Enter up to 500 positive user IDs.')}</p>}
    </form>
  )
}
