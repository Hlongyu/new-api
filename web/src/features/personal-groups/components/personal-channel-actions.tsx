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
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import {
  requestPersonalChannelDeletion,
  setPersonalChannelEnabled,
} from '../api'
import type { PersonalChannel } from '../types'

export function PersonalChannelActions(props: { channel: PersonalChannel }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [deletionOpen, setDeletionOpen] = useState(false)
  const status = useMutation({
    mutationFn: (enabled: boolean) =>
      setPersonalChannelEnabled({ channel: props.channel, enabled }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personal-channels'] })
      toast.success(t('Channel status updated'))
    },
    onError: handleServerError,
  })
  const deletion = useMutation({
    mutationFn: () => requestPersonalChannelDeletion(props.channel),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['personal-channels'] }),
        client.invalidateQueries({ queryKey: ['personal-channel-reviews'] }),
      ])
      setDeletionOpen(false)
      toast.success(t('Deletion submitted for review'))
    },
    onError: handleServerError,
  })
  const pending = status.isPending || deletion.isPending
  return (
    <>
      {props.channel.published_config && (
        <Button
          variant='outline'
          size='sm'
          disabled={pending}
          aria-label={`${props.channel.published_config.enabled ? t('Disable') : t('Enable')} ${props.channel.config.name}`}
          onClick={() =>
            status.mutate(!props.channel.published_config?.enabled)
          }
        >
          {props.channel.published_config.enabled ? t('Disable') : t('Enable')}
        </Button>
      )}
      <Button
        variant='outline'
        size='sm'
        disabled={pending || props.channel.revision.status === 'delete_pending'}
        onClick={() => setDeletionOpen(true)}
        aria-label={`${t('Request deletion')} ${props.channel.config.name}`}
      >
        {t('Request deletion')}
      </Button>
      {status.error instanceof Error && (
        <p role='alert'>{t(status.error.message)}</p>
      )}
      <AlertDialog
        open={deletionOpen}
        onOpenChange={(open) => {
          if (!deletion.isPending) setDeletionOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Request deletion of {{name}}?', {
                name: props.channel.config.name,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Deletion requires administrator approval. The published channel stays available until approval; you can disable it immediately.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletion.error instanceof Error && (
            <p role='alert'>{t(deletion.error.message)}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletion.isPending}>
              {t('Cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={deletion.isPending}
              onClick={() => deletion.mutate()}
            >
              {t('Submit for Review')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
