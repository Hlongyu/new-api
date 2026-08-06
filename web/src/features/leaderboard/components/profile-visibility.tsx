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

import { sideDrawerSwitchItemClassName } from '@/components/drawer-layout'
import { Switch } from '@/components/ui/switch'

import { useUpdateLeaderboardMe } from '../hooks'
import type { LeaderboardMe, LeaderboardVisibility } from '../types'

const SWITCHES: {
  key: keyof LeaderboardVisibility
  labelKey: string
  hintKey: string
}[] = [
  {
    key: 'participateDay',
    labelKey: 'Join Daily Board',
    hintKey: "Hidden from today's usage board when off",
  },
  {
    key: 'participateWeek',
    labelKey: 'Join Weekly Board',
    hintKey: 'Hidden from the weekly board when off',
  },
  {
    key: 'participateMonth',
    labelKey: 'Join Monthly Board',
    hintKey: "Hidden from this month's usage board when off",
  },
  {
    key: 'participateAll',
    labelKey: 'Join All-Time Board',
    hintKey: 'Hidden from the all-time board when off',
  },
  {
    key: 'participateRank',
    labelKey: 'Join Tier Board',
    hintKey: 'Hidden from the tier board when off',
  },
  {
    key: 'showRankBadge',
    labelKey: 'Show Tier Badge',
    hintKey: 'Show next to your anonymous name',
  },
]

export type ProfileVisibilityProps = {
  me: LeaderboardMe
}

/**
 * Per-board participation switches.
 *
 * Each toggle saves on its own. The service also accepts a batch
 * `participating` flag, but that one overwrites every switch at once and would
 * quietly undo the user's individual choices, so it is never sent.
 */
export function ProfileVisibility(props: ProfileVisibilityProps) {
  const { t } = useTranslation()
  const updateMe = useUpdateLeaderboardMe()
  const visibility = props.me.entry.visibility

  return (
    <div className='space-y-1'>
      {SWITCHES.map((item) => (
        <div key={item.key} className={sideDrawerSwitchItemClassName()}>
          <div className='min-w-0 space-y-0.5'>
            <p className='text-foreground text-sm font-medium'>
              {t(item.labelKey)}
            </p>
            <p className='text-muted-foreground text-xs'>{t(item.hintKey)}</p>
          </div>
          <Switch
            checked={visibility[item.key]}
            onCheckedChange={(checked) =>
              updateMe.mutate({ visibility: { [item.key]: checked } })
            }
            disabled={updateMe.isPending}
          />
        </div>
      ))}
    </div>
  )
}
