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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'

import { saveChannelDraft } from '../api'
import { channelSchema, type ChannelValues } from '../lib/schema'
import type { PersonalChannel, PersonalGroup } from '../types'
import { PersonalModelPicker } from './model-picker'

export function ChannelForm(props: {
  channel?: PersonalChannel
  groups: PersonalGroup[]
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const channel = props.channel
  const form = useForm<ChannelValues>({
    resolver: zodResolver(channelSchema),
    defaultValues: {
      group_id: channel?.group_id ?? props.groups[0]?.id ?? 0,
      name: '',
      type: 1,
      base_url: 'https://api.openai.com',
      models: '',
      priority: 0,
      weight: 10,
      enabled: true,
      ...channel?.config,
      key: '',
    },
  })
  const providerType = useWatch({ control: form.control, name: 'type' })
  const baseURL = useWatch({ control: form.control, name: 'base_url' })
  const apiKey = useWatch({ control: form.control, name: 'key' })
  const hasVersionSuffix = /\/v1\/?$/.test(baseURL.trim())
  useEffect(() => {
    if (!hasVersionSuffix) return
    const timer = setTimeout(() => {
      toast.warning(
        t(
          'Warning: Base URL should not end with /v1. New API will handle it automatically. This may cause request failures.'
        ),
        { duration: 5000 }
      )
    }, 500)
    return () => clearTimeout(timer)
  }, [baseURL, hasVersionSuffix, t])
  const mutation = useMutation({
    mutationFn: (values: ChannelValues) => {
      const { group_id, ...config } = values
      return saveChannelDraft({
        id: channel?.id ?? 0,
        group_id,
        expected_revision_id: channel?.revision.id ?? 0,
        config,
      })
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personal-channels'] })
      toast.success(t('Draft saved. Submit it for administrator approval.'))
      props.onSaved()
    },
    onError: handleServerError,
  })
  const textFields = [
    { name: 'name', label: t('Name'), type: 'text' },
    { name: 'base_url', label: t('Base URL'), type: 'url' },
    { name: 'key', label: t('API Key'), type: 'password' },
  ] as const
  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        if (!values.key && !channel?.has_key) {
          form.setError('key', { message: t('API Key is required') })
          return
        }
        mutation.mutate(values)
      })}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='personal-channel-group'>{t('Group')}</FieldLabel>
          <NativeSelect
            id='personal-channel-group'
            {...form.register('group_id', { valueAsNumber: true })}
            disabled={!!channel}
          >
            {props.groups.map((group) => (
              <NativeSelectOption key={group.id} value={group.id}>
                {group.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='personal-channel-type'>
            {t('Provider')}
          </FieldLabel>
          <NativeSelect
            id='personal-channel-type'
            {...form.register('type', { valueAsNumber: true })}
            onChange={(event) => {
              const nextType = Number(event.target.value)
              form.setValue('type', nextType)
              const defaults: Record<number, string> = {
                1: 'https://api.openai.com',
                14: 'https://api.anthropic.com',
                24: 'https://generativelanguage.googleapis.com',
                60: '',
              }
              if (!baseURL || Object.values(defaults).includes(baseURL)) {
                form.setValue('base_url', defaults[nextType] ?? '')
              }
            }}
          >
            <NativeSelectOption value={1}>OpenAI</NativeSelectOption>
            <NativeSelectOption value={14}>Anthropic</NativeSelectOption>
            <NativeSelectOption value={24}>Gemini</NativeSelectOption>
            <NativeSelectOption value={60}>New API</NativeSelectOption>
          </NativeSelect>
        </Field>
        {textFields.map((field) => (
          <Field
            key={field.name}
            data-invalid={!!form.formState.errors[field.name]}
          >
            <FieldLabel htmlFor={`personal-channel-${field.name}`}>
              {field.label}
            </FieldLabel>
            <Input
              id={`personal-channel-${field.name}`}
              type={field.type}
              {...form.register(field.name)}
              aria-invalid={!!form.formState.errors[field.name]}
              autoComplete={field.name === 'key' ? 'new-password' : 'off'}
            />
            {field.name === 'base_url' && hasVersionSuffix && (
              <FieldDescription
                role='alert'
                className='text-amber-600 dark:text-amber-400'
              >
                {t(
                  'Warning: Base URL should not end with /v1. New API will handle it automatically. This may cause request failures.'
                )}
              </FieldDescription>
            )}
            {field.name === 'key' && channel?.has_key && (
              <FieldDescription>
                {t('Leave the key blank to keep the saved key.')}
              </FieldDescription>
            )}
          </Field>
        ))}
        <Controller
          control={form.control}
          name='models'
          render={({ field }) => (
            <PersonalModelPicker
              channelId={channel?.id ?? 0}
              type={providerType}
              baseURL={baseURL}
              apiKey={apiKey}
              hasSavedKey={!!channel?.has_key}
              value={field.value}
              onChange={field.onChange}
              invalid={!!form.formState.errors.models}
            />
          )}
        />
        <div className='grid grid-cols-2 gap-4'>
          <Field data-invalid={!!form.formState.errors.priority}>
            <FieldLabel htmlFor='personal-channel-priority'>
              {t('Priority')}
            </FieldLabel>
            <Input
              id='personal-channel-priority'
              type='number'
              min={0}
              max={1000000}
              {...form.register('priority', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.priority}
            />
          </Field>
          <Field data-invalid={!!form.formState.errors.weight}>
            <FieldLabel htmlFor='personal-channel-weight'>
              {t('Weight')}
            </FieldLabel>
            <Input
              id='personal-channel-weight'
              type='number'
              min={0}
              max={1000000}
              {...form.register('weight', { valueAsNumber: true })}
              aria-invalid={!!form.formState.errors.weight}
            />
          </Field>
        </div>
        <Field orientation='horizontal'>
          <Controller
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <Switch
                id='personal-channel-enabled'
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <FieldLabel htmlFor='personal-channel-enabled'>
            {t('Enabled after approval')}
          </FieldLabel>
        </Field>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert'>{t('Please check the highlighted fields.')}</p>
        )}
        {mutation.error instanceof Error && (
          <p role='alert'>{mutation.error.message}</p>
        )}
        <Button
          type='submit'
          disabled={mutation.isPending || props.groups.length === 0}
        >
          {t('Save Draft')}
        </Button>
      </FieldGroup>
    </form>
  )
}
