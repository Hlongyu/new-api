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
import { EyeOff, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

import { useExcludedUsers, useUpdateExcludedUsers } from '../hooks'

export type ProfileAdminSectionProps = {
  /** Only rendered for root; the endpoint answers 403 for anyone else. */
  enabled: boolean
}

export function ProfileAdminSection(props: ProfileAdminSectionProps) {
  const { t } = useTranslation()
  const [draftId, setDraftId] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const excludedQuery = useExcludedUsers(props.enabled)
  const updateExcluded = useUpdateExcludedUsers()

  const userIds = excludedQuery.data?.userIds ?? []
  const isBusy = updateExcluded.isPending

  const addId = () => {
    const parsed = Number(draftId.trim())
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setInputError(t('Enter a positive user ID'))
      return
    }
    if (userIds.includes(parsed)) {
      setInputError(t('This user is already blocked'))
      return
    }
    setInputError(null)
    setDraftId('')
    updateExcluded.mutate([...userIds, parsed])
  }

  const removeId = (id: number) => {
    updateExcluded.mutate(userIds.filter((value) => value !== id))
  }

  return (
    <div className='space-y-3'>
      <div className='space-y-1'>
        <p className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
          <EyeOff className='size-4' />
          {t('Blocked Members')}
        </p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Blocked members are hidden from every board and excluded from the totals.'
          )}
        </p>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='leaderboard-block-id' className='text-xs'>
          {t('New API user ID')}
        </Label>
        <div className='flex items-center gap-2'>
          <Input
            id='leaderboard-block-id'
            inputMode='numeric'
            value={draftId}
            placeholder='42'
            disabled={isBusy}
            onChange={(event) => {
              setDraftId(event.target.value)
              setInputError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addId()
              }
            }}
          />
          <Button size='sm' onClick={addId} disabled={isBusy} className='gap-1.5'>
            <Plus className='size-4' />
            {t('Block')}
          </Button>
        </div>
        {inputError && <p className='text-destructive text-xs'>{inputError}</p>}
      </div>

      {excludedQuery.isLoading ? (
        <Skeleton className='h-9 rounded-lg' />
      ) : (
        <div className='flex flex-wrap gap-2'>
          {userIds.length === 0 ? (
            <p className='text-muted-foreground text-xs'>
              {t('No members are blocked')}
            </p>
          ) : (
            userIds.map((id) => (
              <Badge key={id} variant='secondary' className='gap-1 pr-1'>
                <span className='font-mono'>#{id}</span>
                <button
                  type='button'
                  aria-label={t('Unblock user {{id}}', { id })}
                  disabled={isBusy}
                  onClick={() => removeId(id)}
                  className='hover:bg-background/80 rounded-full p-0.5 disabled:opacity-50'
                >
                  <X className='size-3' />
                </button>
              </Badge>
            ))
          )}
        </div>
      )}
    </div>
  )
}
