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
import { formatDateTimeObject } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

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

  const closeAnnouncement = () => {
    if (!dismissal.isPending) dismissal.mutate(announcement.revision)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeAnnouncement()
      }}
      title={t('Must-read announcement')}
      description={t(
        'Closing this announcement stops reminders for your account.'
      )}
      contentClassName='sm:max-w-lg'
      bodyClassName='space-y-4 break-words'
      footer={
        <Button disabled={dismissal.isPending} onClick={closeAnnouncement}>
          {dismissal.isPending ? t('Saving...') : t('Close')}
        </Button>
      }
    >
      <p className='text-muted-foreground text-sm'>
        {t('Published:')}{' '}
        {formatDateTimeObject(new Date(announcement.publishDate))}
      </p>
      <RichContent breaks content={announcement.content} />
      {announcement.extra ? (
        <RichContent
          breaks
          content={announcement.extra}
          className='text-muted-foreground'
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
