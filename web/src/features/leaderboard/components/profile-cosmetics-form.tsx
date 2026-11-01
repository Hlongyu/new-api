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
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useUpdateLeaderboardMe } from '../hooks/use-leaderboard-me'
import type { LeaderboardMe } from '../types'

const titleSchema = z.object({
  title: z
    .string()
    .trim()
    .refine((value) => {
      const length = [...value].length
      return length >= 1 && length <= 10
    }),
})

export function ProfileCosmeticsForm(props: { me: LeaderboardMe }) {
  const { t } = useTranslation()
  const update = useUpdateLeaderboardMe()
  const avatarInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const form = useForm({
    resolver: zodResolver(titleSchema),
    defaultValues: { title: props.me.entry.customTitle ?? '' },
    mode: 'onChange',
  })
  const storedTitle = props.me.entry.customTitle ?? ''
  useEffect(() => {
    form.reset({ title: storedTitle })
  }, [form, storedTitle])
  useEffect(() => {
    if (!file) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const canEdit = props.me.rankProgress.tierKey === 'challenger'
  const disabled =
    !canEdit || props.me.rename.cardBalance < 1 || update.isPending
  const validFile =
    file &&
    file.size > 0 &&
    file.size <= 2 * 1024 * 1024 &&
    ['image/png', 'image/jpeg'].includes(file.type)

  return (
    <div className='space-y-4'>
      <p className='text-sm font-medium'>{t('Custom title and avatar')}</p>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Challenger only. Each change costs 1 rename card. Saved customizations remain after demotion.'
        )}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t('Rename cards: {{count}}', { count: props.me.rename.cardBalance })}
      </p>
      <form
        className='space-y-2'
        onSubmit={form.handleSubmit((values) =>
          update.mutate({ customTitle: values.title })
        )}
      >
        <Label htmlFor='leaderboard-custom-title'>{t('Custom title')}</Label>
        <Input
          id='leaderboard-custom-title'
          {...form.register('title')}
          disabled={disabled}
          aria-invalid={!!form.formState.errors.title}
          aria-describedby='leaderboard-title-help'
        />
        <p
          id='leaderboard-title-help'
          className='text-muted-foreground text-xs'
        >
          {t('Use 1–10 characters.')}
        </p>
        <Button
          type='submit'
          size='sm'
          disabled={
            disabled ||
            !form.formState.isValid ||
            form.watch('title').trim() === storedTitle
          }
        >
          {t('Save title (1 card)')}
        </Button>
      </form>
      <div className='space-y-2'>
        <Label htmlFor='leaderboard-avatar'>{t('Custom avatar')}</Label>
        {(preview || props.me.entry.avatarImage) && (
          <img
            src={preview || props.me.entry.avatarImage}
            alt={t('Avatar preview')}
            className='size-16 rounded-full object-cover'
          />
        )}
        <Input
          id='leaderboard-avatar'
          ref={avatarInput}
          type='file'
          accept='image/png,image/jpeg'
          disabled={disabled}
          aria-describedby='leaderboard-avatar-help'
          aria-invalid={!!file && !validFile}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <p
          id='leaderboard-avatar-help'
          className='text-muted-foreground text-xs'
        >
          {t('PNG or JPEG, up to 2 MB and 4 megapixels. Cropped to a square.')}
        </p>
        <Button
          size='sm'
          disabled={disabled || !validFile}
          onClick={() => {
            if (file) {
              update.mutate(file, {
                onSuccess: () => {
                  setFile(null)
                  if (avatarInput.current) avatarInput.current.value = ''
                },
              })
            }
          }}
        >
          {t('Save avatar (1 card)')}
        </Button>
      </div>
      {update.isError && (
        <p role='alert' className='text-destructive text-xs'>
          {t(
            'Unable to save. Check your rank, rename cards, and input, then try again.'
          )}
        </p>
      )}
    </div>
  )
}
