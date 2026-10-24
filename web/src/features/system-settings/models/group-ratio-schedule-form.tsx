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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createGroupRatioSchedule,
  scheduleQueryKey,
} from './group-ratio-schedule-api'
import {
  nextBeijingSunday,
  parseBeijingTime,
} from './group-ratio-schedule-time'

export function GroupRatioScheduleForm(props: { groups: string[] }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const schema = z.object({
    group: z.string().min(1, t('Select an existing group.')),
    ratio: z
      .string()
      .trim()
      .min(1, t('Enter a non-negative ratio.'))
      .refine(
        (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
        t('Enter a non-negative ratio.')
      ),
    time: z
      .string()
      .refine(
        (value) => parseBeijingTime(value) * 1000 > Date.now(),
        t('Choose a future Beijing date and time.')
      ),
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { group: '', ratio: '', time: nextBeijingSunday() },
  })
  const create = useMutation({
    mutationFn: createGroupRatioSchedule,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: scheduleQueryKey })
      form.reset({ group: '', ratio: '', time: nextBeijingSunday() })
      toast.success(t('One-time ratio change scheduled.'))
    },
    onError: handleServerError,
  })
  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((values) =>
          create.mutate({
            group: values.group,
            ratio: Number(values.ratio),
            execute_at: parseBeijingTime(values.time),
          })
        )}
      >
        <div className='grid gap-4 md:grid-cols-3'>
          <FormField
            control={form.control}
            name='group'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Scheduled group')}</FormLabel>
                <FormControl>
                  <select
                    {...field}
                    disabled={create.isPending || props.groups.length === 0}
                    className='border-input bg-background h-9 w-full min-w-0 rounded-md border px-3 text-sm'
                  >
                    <option value=''>{t('Select an existing group.')}</option>
                    {props.groups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='ratio'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Target group ratio')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min='0'
                    step='any'
                    placeholder='0.1'
                    disabled={create.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='time'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Execution time (Beijing, UTC+8)')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='datetime-local'
                    disabled={create.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {props.groups.length === 0 && (
          <p className='text-muted-foreground text-sm'>
            {t('Save a group ratio before scheduling a change.')}
          </p>
        )}
        <Button
          type='submit'
          disabled={create.isPending || props.groups.length === 0}
        >
          {create.isPending ? t('Saving...') : t('Schedule one-time change')}
        </Button>
      </form>
    </Form>
  )
}
