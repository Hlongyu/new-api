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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { FieldGroup } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getWebhookConfig,
  getWebhookDeliveries,
  retryWebhookDelivery,
  saveWebhookConfig,
  webhookQueryKey,
  type WebhookConfig,
} from './group-ratio-webhook-api'

export function GroupRatioWebhook() {
  const { t } = useTranslation()
  const config = useQuery({
    queryKey: [...webhookQueryKey, 'config'],
    queryFn: getWebhookConfig,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Group ratio webhook')}</CardTitle>
        <CardDescription>
          {t(
            'Notify when selected groups change their base ratio. Additions, deletions and overrides are excluded.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        {config.isPending && <Skeleton className='h-32' />}
        {config.isError && (
          <Button variant='outline' onClick={() => void config.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {config.data && <WebhookForm config={config.data} />}
        <WebhookDeliveries />
      </CardContent>
    </Card>
  )
}

function WebhookForm(props: { config: WebhookConfig }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const schema = z
    .object({
      enabled: z.boolean(),
      url: z.string().max(2048),
      groups: z.string(),
      secret: z.string().max(512),
    })
    .superRefine((value, ctx) => {
      if (value.url || value.enabled) {
        try {
          const url = new URL(value.url)
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.hash ||
            (url.port && url.port !== '443')
          ) {
            throw new Error()
          }
        } catch {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: t('Use a public HTTPS URL on port 443.'),
          })
        }
      }
      if (
        value.enabled &&
        !value.groups.split(',').some((group) => group.trim())
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups'],
          message: t('Select at least one group.'),
        })
      }
      if (value.secret && value.secret.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['secret'],
          message: t('Signing secret must contain at least 32 characters.'),
        })
      }
    })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      enabled: props.config.enabled,
      url: props.config.url,
      groups: props.config.groups.join(', '),
      secret: '',
    },
  })
  const save = useMutation({
    mutationFn: saveWebhookConfig,
    onError: handleServerError,
    onSuccess: async () => {
      form.setValue('secret', '')
      await client.invalidateQueries({
        queryKey: [...webhookQueryKey, 'config'],
      })
      toast.success(t('Saved successfully'))
    },
  })
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          save.mutate({
            ...values,
            groups: [
              ...new Set(
                values.groups
                  .split(',')
                  .map((group) => group.trim())
                  .filter(Boolean)
              ),
            ],
          })
        )}
      >
        <fieldset disabled={save.isPending}>
          <FieldGroup>
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Enable webhook')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Webhook URL')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='url'
                      placeholder='https://example.com/webhook'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='groups'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Watched groups (comma-separated)')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='default, vip' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='secret'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Signing secret (optional)')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='password'
                      autoComplete='new-password'
                      placeholder={
                        props.config.has_secret
                          ? t('Leave blank to keep the existing secret')
                          : ''
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t('Use a public HTTPS URL on port 443.')}
            </p>
            <Button type='submit' disabled={save.isPending}>
              {save.isPending ? t('Saving...') : t('Save webhook')}
            </Button>
          </FieldGroup>
        </fieldset>
      </form>
    </Form>
  )
}

function WebhookDeliveries() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const statusLabels = {
    delivered: t('Delivered'),
    failed: t('Failed'),
    pending: t('Pending'),
  }
  const client = useQueryClient()
  const deliveries = useQuery({
    queryKey: [...webhookQueryKey, 'deliveries', page],
    queryFn: () => getWebhookDeliveries(page),
    refetchInterval: 10000,
  })
  const retry = useMutation({
    mutationFn: retryWebhookDelivery,
    onError: handleServerError,
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: [...webhookQueryKey, 'deliveries'],
      }),
  })
  return (
    <section className='space-y-3' aria-label={t('Webhook deliveries')}>
      <h3 className='font-medium'>{t('Webhook deliveries')}</h3>
      {deliveries.isPending && <Skeleton className='h-16' />}
      {deliveries.isError && (
        <Button variant='outline' onClick={() => void deliveries.refetch()}>
          {t('Retry')}
        </Button>
      )}
      {deliveries.data?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('No webhook deliveries yet')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {deliveries.data?.map((delivery) => (
        <div key={delivery.id} className='space-y-2 rounded-md border p-3'>
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
            <span>
              {new Date(delivery.created_at * 1000).toLocaleString()} ·{' '}
              {statusLabels[delivery.status]}
            </span>
            <span>
              {t('Attempts')}: {delivery.attempts} · HTTP:{' '}
              {delivery.last_status || '—'}
            </span>
            {delivery.status === 'failed' && (
              <Button
                size='sm'
                variant='outline'
                disabled={retry.isPending}
                onClick={() => retry.mutate(delivery.id)}
              >
                {t('Retry')}
              </Button>
            )}
          </div>
          <details>
            <summary className='cursor-pointer text-sm'>{t('Payload')}</summary>
            <pre className='mt-2 max-h-48 overflow-auto text-xs break-all whitespace-pre-wrap'>
              {delivery.payload}
            </pre>
          </details>
        </div>
      ))}
      <div className='flex gap-2'>
        <Button
          variant='outline'
          disabled={page === 1 || deliveries.isFetching}
          onClick={() => setPage((value) => value - 1)}
        >
          {t('Previous')}
        </Button>
        <Button
          variant='outline'
          disabled={
            !deliveries.data ||
            deliveries.data.length < 20 ||
            deliveries.isFetching
          }
          onClick={() => setPage((value) => value + 1)}
        >
          {t('Next')}
        </Button>
      </div>
    </section>
  )
}
