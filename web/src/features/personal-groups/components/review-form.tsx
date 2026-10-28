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

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { reviewChannel } from '../api'
import type { PersonalChannel } from '../types'

export function ReviewForm(props: {
  channel: PersonalChannel
  canReview: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: (approve: boolean) =>
      reviewChannel({ channel: props.channel, approve, reason }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personal-channel-reviews'] })
      await client.invalidateQueries({ queryKey: ['personal-channels'] })
      toast.success(t('Review completed'))
      props.onSaved()
    },
    onError: handleServerError,
  })
  const fields = [
    ['name', t('Name')],
    ['type', t('Provider')],
    ['base_url', t('Base URL')],
    ['models', t('Models')],
    ['priority', t('Priority')],
    ['weight', t('Weight')],
    ['enabled', t('Enabled')],
  ] as const
  return (
    <div className='flex flex-col gap-4'>
      <p className='text-sm break-all'>
        {props.channel.group_name} · {t('User ID')}:{' '}
        {props.channel.owner_user_id} · {t('Revision')}:{' '}
        {props.channel.revision.id}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Field')}</TableHead>
            <TableHead>{t('Published Version')}</TableHead>
            <TableHead>{t('Submitted Version')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map(([key, label]) => (
            <TableRow key={key}>
              <TableCell>{label}</TableCell>
              <TableCell className='max-w-64 break-all whitespace-pre-wrap'>
                {String(props.channel.published_config?.[key] ?? '—')}
              </TableCell>
              <TableCell className='max-w-64 break-all whitespace-pre-wrap'>
                {String(props.channel.config[key])}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className='text-sm'>
        {props.channel.key_changed
          ? t('API key changed')
          : t('API key unchanged')}
      </p>
      <Field>
        <FieldLabel htmlFor='channel-review-reason'>
          {t('Review Reason')}
        </FieldLabel>
        <Textarea
          id='channel-review-reason'
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          placeholder={t('A reason is required when rejecting a channel.')}
        />
      </Field>
      {mutation.error instanceof Error && (
        <p role='alert'>{mutation.error.message}</p>
      )}
      <div className='flex justify-end gap-2'>
        <Button
          variant='destructive'
          disabled={!props.canReview || mutation.isPending || !reason.trim()}
          onClick={() => mutation.mutate(false)}
        >
          {t('Reject')}
        </Button>
        <Button
          disabled={!props.canReview || mutation.isPending}
          onClick={() => mutation.mutate(true)}
        >
          {t('Approve and Publish')}
        </Button>
      </div>
    </div>
  )
}
