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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { saveAccountingExclusions } from './api'

export function AccountingExclusions(props: { userIDs: number[] }) {
  const { t } = useTranslation()
  const id = useId()
  const [value, setValue] = useState(props.userIDs.join(', '))
  const [invalid, setInvalid] = useState(false)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: saveAccountingExclusions,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monthly-accounting'] })
    },
  })
  return (
    <form
      className='space-y-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (mutation.isPending) return
        const parts = value.trim() ? value.trim().split(/[,，\s]+/) : []
        const ids = [...new Set(parts.map(Number))].sort((a, b) => a - b)
        if (
          parts.some((part) => !/^\d+$/.test(part)) ||
          ids.some(
            (userID) =>
              !Number.isSafeInteger(userID) ||
              userID <= 0 ||
              userID > 2147483647
          ) ||
          ids.length > 500
        ) {
          setInvalid(true)
          return
        }
        setInvalid(false)
        mutation.mutate(ids)
      }}
    >
      <Label htmlFor={id}>{t('Excluded accounting user IDs')}</Label>
      <p id={`${id}-hint`} className='text-muted-foreground text-sm'>
        {t(
          'Separate user IDs with commas. Saved exclusions apply to all months; original snapshots remain unchanged. Clear to include everyone.'
        )}
      </p>
      <div className='flex items-center gap-2'>
        <Input
          id={id}
          value={value}
          aria-describedby={`${id}-hint`}
          aria-invalid={invalid}
          disabled={mutation.isPending}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
            mutation.reset()
          }}
        />
        <Button type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      </div>
      {(invalid || mutation.isError) && (
        <Alert variant='destructive'>
          <AlertDescription>
            {invalid
              ? t('Enter up to 500 positive user IDs.')
              : t(
                  'Failed to save accounting exclusions. Check that all user IDs exist.'
                )}
          </AlertDescription>
        </Alert>
      )}
      {mutation.isSuccess && (
        <p role='status'>{t('Accounting exclusions saved.')}</p>
      )}
    </form>
  )
}
