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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { sideDrawerSwitchItemClassName } from '@/components/drawer-layout'

import { DISPLAY_NAME_MAX_LENGTH } from '../constants'
import { useUpdateLeaderboardMe } from '../hooks'
import type { LeaderboardMe } from '../types'

export type ProfileNameFormProps = {
  me: LeaderboardMe
}

export function ProfileNameForm(props: ProfileNameFormProps) {
  const { t } = useTranslation()
  const updateMe = useUpdateLeaderboardMe()
  const [draftName, setDraftName] = useState(props.me.entry.displayName)

  // The service normalises whitespace, so echo its stored value back rather
  // than whatever was typed; otherwise the next save looks like a rename.
  useEffect(() => {
    setDraftName(props.me.entry.displayName)
  }, [props.me.entry.displayName])

  const trimmedName = draftName.trim().replaceAll(/\s+/g, ' ')
  const nameChanged = trimmedName !== props.me.entry.displayName
  const canRename =
    props.me.rename.freeAvailable || props.me.rename.cardBalance > 0

  const renameHint = () => {
    if (props.me.rename.freeAvailable) {
      return t('Free rename available this week')
    }
    if (props.me.rename.cardBalance > 0) {
      return t('Rename cards will be used')
    }
    return t(
      'You have used your free rename this week. Purchase a rename card to continue.'
    )
  }

  const previewName = props.me.entry.isNamePublic
    ? trimmedName || props.me.entry.anonymousName
    : props.me.entry.anonymousName

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='leaderboard-display-name'>{t('Display Name')}</Label>
        <Input
          id='leaderboard-display-name'
          value={draftName}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={props.me.entry.anonymousName}
        />
        <p className='text-muted-foreground text-xs'>{renameHint()}</p>
      </div>

      <div className={sideDrawerSwitchItemClassName()}>
        <div className='min-w-0 space-y-0.5'>
          <p className='text-foreground text-sm font-medium'>
            {t('Public Name')}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t('Show your real display name on the leaderboard')}
          </p>
        </div>
        <Switch
          checked={props.me.entry.isNamePublic}
          onCheckedChange={(checked) =>
            updateMe.mutate({ isNamePublic: checked })
          }
          disabled={updateMe.isPending}
        />
      </div>

      <p className='text-muted-foreground text-xs'>
        {t('Displayed as')}{' '}
        <span className='text-foreground font-medium'>{previewName}</span>
      </p>

      <Button
        size='sm'
        // Sending an unchanged name would still be accepted, but the service
        // only charges when the value actually differs — keep them in sync so
        // the button never appears to burn a rename for nothing.
        disabled={!nameChanged || !canRename || updateMe.isPending}
        onClick={() => updateMe.mutate({ displayName: trimmedName })}
      >
        {t('Save')}
      </Button>
    </div>
  )
}
