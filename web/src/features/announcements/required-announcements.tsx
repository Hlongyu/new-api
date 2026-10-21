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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { AnnouncementCelebration } from './announcement-celebration'
import {
  dismissAnnouncement,
  getPendingAnnouncements,
  type RequiredAnnouncement,
} from './api'

export function RequiredAnnouncements() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  return userId ? <AccountAnnouncements key={userId} userId={userId} /> : null
}

function AccountAnnouncements(props: { userId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['required-announcements', props.userId]
  const pending = useQuery({
    queryKey,
    queryFn: getPendingAnnouncements,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
  })
  const dismissal = useMutation({
    mutationFn: dismissAnnouncement,
    onSuccess: async (_, revision) => {
      await queryClient.cancelQueries({ queryKey })
      queryClient.setQueryData<RequiredAnnouncement[]>(queryKey, (previous) =>
        previous?.filter((item) => item.revision !== revision)
      )
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response?.status === 409) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
  const announcement = pending.data?.[0]
  if (!announcement) return null
  const isShortAnnouncement =
    announcement.content.length <= 200 &&
    !announcement.content.includes('\n') &&
    !announcement.extra

  const closeAnnouncement = () => {
    if (!dismissal.isPending) dismissal.mutate(announcement.revision)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAnnouncement()
      }}
      title={t('Announcement Details')}
      headerClassName='sr-only'
      showCloseButton={false}
      contentClassName='gap-0 rounded-2xl px-6 py-8 shadow-xl shadow-black/10 sm:max-w-md sm:p-8'
      bodyClassName='space-y-4 break-words'
      footerClassName='mx-0 mb-0 flex-row justify-center border-0 bg-transparent p-0 pt-6 sm:mx-0 sm:mb-0 sm:justify-center sm:p-0 sm:pt-6'
      footer={
        <Button
          variant='outline'
          className='h-10 min-w-28 rounded-lg px-6 text-sm focus-visible:ring-2'
          disabled={dismissal.isPending}
          onClick={closeAnnouncement}
        >
          {dismissal.isPending ? t('Saving...') : t('Close')}
        </Button>
      }
    >
      {announcement.id === 'system:leaderboard-first-challenger' ? (
        <>
          <AnnouncementCelebration key={announcement.revision} />
          <div
            aria-hidden='true'
            className='mx-auto mb-5 flex justify-center drop-shadow-[0_4px_12px_rgb(202_151_64_/_0.18)]'
          >
            <img
              src='/rank-badges/challenger-crest.png'
              alt=''
              width={128}
              height={128}
              draggable={false}
              className='h-24 w-auto max-w-full select-none'
            />
          </div>
        </>
      ) : null}
      <RichContent
        breaks
        content={announcement.content}
        className={
          isShortAnnouncement
            ? 'text-foreground text-center text-lg font-medium text-balance [&_p]:leading-8'
            : 'text-foreground text-left text-base [&_h1]:text-xl [&_h2]:text-lg [&_p]:leading-7 [&_strong]:font-semibold'
        }
      />
      {announcement.extra ? (
        <RichContent
          breaks
          content={announcement.extra}
          className='text-muted-foreground text-sm [&_p]:leading-7'
        />
      ) : null}
      {dismissal.isError && dismissal.variables === announcement.revision ? (
        <p role='alert' className='text-destructive text-sm'>
          {t('Could not save your preference. Please try closing again.')}
        </p>
      ) : null}
    </Dialog>
  )
}
