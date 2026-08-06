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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'

import { useLeaderboardMe } from '../hooks'
import { ProfileAdminSection } from './profile-admin-section'
import { ProfileNameForm } from './profile-name-form'
import { ProfileRankCard } from './profile-rank-card'
import { ProfileVisibility } from './profile-visibility'
import { RenameCardAdminPanel } from './rename-card-admin-panel'
import { RenameCardPurchase } from './rename-card-purchase'

export type ProfileSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileSheet(props: ProfileSheetProps) {
  const { t } = useTranslation()
  const [purchaseBusy, setPurchaseBusy] = useState(false)
  const meQuery = useLeaderboardMe(props.open)

  const renderBody = () => {
    if (meQuery.isLoading) {
      return (
        <div className='space-y-4'>
          <Skeleton className='h-[180px] rounded-xl' />
          <Skeleton className='h-[120px] rounded-xl' />
          <Skeleton className='h-[240px] rounded-xl' />
        </div>
      )
    }

    if (meQuery.error || !meQuery.data) {
      return (
        <ErrorState
          title={t('Unable to load your leaderboard profile')}
          onRetry={() => void meQuery.refetch()}
        />
      )
    }

    const me = meQuery.data

    return (
      <>
        <SideDrawerSection>
          <div className='flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <p className='text-foreground truncate text-sm font-semibold'>
                {me.identityName}
              </p>
              <p className='text-muted-foreground text-xs'>@{me.username}</p>
            </div>
            <Badge variant='outline' className='font-mono'>
              ${me.balanceUsd.toFixed(2)}
            </Badge>
          </div>
          <ProfileRankCard rankProgress={me.rankProgress} />
        </SideDrawerSection>

        <SideDrawerSection>
          <ProfileNameForm me={me} />
        </SideDrawerSection>

        <SideDrawerSection>
          <RenameCardPurchase me={me} onBusyChange={setPurchaseBusy} />
        </SideDrawerSection>

        <SideDrawerSection>
          <p className='text-foreground text-sm font-medium'>
            {t('Ranking Visibility')}
          </p>
          <ProfileVisibility me={me} />
        </SideDrawerSection>

        {me.isRoot && (
          <SideDrawerSection>
            <ProfileAdminSection enabled={props.open && me.isRoot} />
          </SideDrawerSection>
        )}

        {me.isRoot && (
          <SideDrawerSection>
            <RenameCardAdminPanel enabled={props.open && me.isRoot} />
          </SideDrawerSection>
        )}
      </>
    )
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        // Closing mid-charge would discard the only place the unresolved
        // result is reported, so hold the drawer open until it settles.
        if (purchaseBusy && !open) return
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-lg lg:max-w-xl')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('My Leaderboard Profile')}</SheetTitle>
          <SheetDescription>
            {t(
              'Manage your display name, ranking visibility, and rename cards.'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className={sideDrawerFormClassName()}>{renderBody()}</div>
      </SheetContent>
    </Sheet>
  )
}
