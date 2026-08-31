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
import { CalendarClock, Send } from 'lucide-react'
import { useMemo } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { createCustomUserSubscription } from '../../api'
import {
  createCustomSubscriptionFormDefaults,
  customSubscriptionFormToPayload,
  formatCustomSubscriptionTimestamp,
  getCustomSubscriptionFormSchema,
  getCustomSubscriptionPreviewBoundaries,
  type CustomSubscriptionFormValues,
} from '../../lib/custom-subscription-form'

interface Props {
  open: boolean
  userId: number
  username?: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => Promise<void> | void
}

export function CustomSubscriptionDialog(props: Props) {
  const { t } = useTranslation()
  const schema = useMemo(() => getCustomSubscriptionFormSchema(t), [t])
  const form = useForm<CustomSubscriptionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: createCustomSubscriptionFormDefaults(),
  })
  const values = form.watch()
  const resetEnabled = values.reset_interval_unit !== 'never'
  const previewBoundaries = getCustomSubscriptionPreviewBoundaries(values)
  const resetUnitItems = useMemo(
    () => [
      { value: 'never', label: t('Never refresh') },
      { value: 'hour', label: t('Hour') },
      { value: 'day', label: t('Day') },
      { value: 'week', label: t('Week') },
      { value: 'month', label: t('Month') },
    ],
    [t]
  )

  const handleSubmit = form.handleSubmit(async (formValues) => {
    try {
      const response = await createCustomUserSubscription(
        props.userId,
        customSubscriptionFormToPayload(formValues)
      )
      if (!response.success) return
      toast.success(t('Custom subscription issued'))
      props.onOpenChange(false)
      await props.onSuccess()
    } catch {
      toast.error(t('Request failed'))
    }
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('Issue custom subscription')}</DialogTitle>
          <DialogDescription>
            {props.username || '-'} (ID: {props.userId})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>{t('Contract')}</FieldLegend>
              <FieldGroup className='grid gap-4 md:grid-cols-2'>
                <Field
                  data-invalid={!!form.formState.errors.title}
                  className='md:col-span-2'
                >
                  <FieldLabel htmlFor='custom-subscription-title'>
                    {t('Subscription name')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-title'
                    aria-invalid={!!form.formState.errors.title}
                    {...form.register('title')}
                  />
                  <FieldError errors={[form.formState.errors.title]} />
                </Field>

                <Field data-invalid={!!form.formState.errors.price_amount}>
                  <FieldLabel htmlFor='custom-subscription-price'>
                    {t('Agreed price')} (USD)
                  </FieldLabel>
                  <Input
                    id='custom-subscription-price'
                    type='number'
                    min={0}
                    max={999999}
                    step='0.01'
                    aria-invalid={!!form.formState.errors.price_amount}
                    {...form.register('price_amount', { valueAsNumber: true })}
                  />
                  <FieldError errors={[form.formState.errors.price_amount]} />
                </Field>

                <Field
                  data-invalid={!!form.formState.errors.amount_total_dollars}
                >
                  <FieldLabel htmlFor='custom-subscription-quota'>
                    {t('Quota per refresh period')} (USD)
                  </FieldLabel>
                  <Input
                    id='custom-subscription-quota'
                    type='number'
                    min={0}
                    step='0.01'
                    aria-invalid={!!form.formState.errors.amount_total_dollars}
                    {...form.register('amount_total_dollars', {
                      valueAsNumber: true,
                    })}
                  />
                  <FieldDescription>
                    {t('Zero means unlimited quota')}
                  </FieldDescription>
                  <FieldError
                    errors={[form.formState.errors.amount_total_dollars]}
                  />
                </Field>

                <Controller
                  control={form.control}
                  name='allow_wallet_overflow'
                  render={({ field }) => (
                    <Field orientation='horizontal'>
                      <FieldContent>
                        <FieldLabel htmlFor='custom-subscription-overflow'>
                          {t('Allow wallet overflow')}
                        </FieldLabel>
                        <FieldDescription>
                          {t(
                            'Use wallet balance after subscription quota is exhausted'
                          )}
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        id='custom-subscription-overflow'
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('Validity')}</FieldLegend>
              <FieldGroup className='grid gap-4 md:grid-cols-2'>
                <Field data-invalid={!!form.formState.errors.start_time}>
                  <FieldLabel htmlFor='custom-subscription-start'>
                    {t('Start time')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-start'
                    type='datetime-local'
                    aria-invalid={!!form.formState.errors.start_time}
                    {...form.register('start_time')}
                  />
                  <FieldError errors={[form.formState.errors.start_time]} />
                </Field>

                <Field data-invalid={!!form.formState.errors.end_time}>
                  <FieldLabel htmlFor='custom-subscription-end'>
                    {t('End time')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-end'
                    type='datetime-local'
                    aria-invalid={!!form.formState.errors.end_time}
                    {...form.register('end_time')}
                  />
                  <FieldError errors={[form.formState.errors.end_time]} />
                </Field>

                <Field
                  data-invalid={!!form.formState.errors.reset_timezone}
                  className='md:col-span-2'
                >
                  <FieldLabel htmlFor='custom-subscription-timezone'>
                    {t('Time zone')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-timezone'
                    aria-invalid={!!form.formState.errors.reset_timezone}
                    {...form.register('reset_timezone')}
                  />
                  <FieldError errors={[form.formState.errors.reset_timezone]} />
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>{t('Quota refresh')}</FieldLegend>
              <FieldGroup className='grid gap-4 md:grid-cols-2'>
                <Controller
                  control={form.control}
                  name='reset_interval_unit'
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>{t('Refresh unit')}</FieldLabel>
                      <Select
                        items={resetUnitItems}
                        value={field.value}
                        onValueChange={(value) =>
                          value && field.onChange(value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {resetUnitItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />

                <Field
                  data-disabled={!resetEnabled}
                  data-invalid={!!form.formState.errors.reset_interval_value}
                >
                  <FieldLabel htmlFor='custom-subscription-interval'>
                    {t('Refresh interval')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-interval'
                    type='number'
                    min={1}
                    max={10000}
                    step={1}
                    disabled={!resetEnabled}
                    aria-invalid={!!form.formState.errors.reset_interval_value}
                    {...form.register('reset_interval_value', {
                      valueAsNumber: true,
                    })}
                  />
                  <FieldError
                    errors={[form.formState.errors.reset_interval_value]}
                  />
                </Field>

                <Field
                  data-disabled={!resetEnabled}
                  data-invalid={!!form.formState.errors.reset_anchor_time}
                  className='md:col-span-2'
                >
                  <FieldLabel htmlFor='custom-subscription-anchor'>
                    {t('Refresh anchor')}
                  </FieldLabel>
                  <Input
                    id='custom-subscription-anchor'
                    type='datetime-local'
                    disabled={!resetEnabled}
                    aria-invalid={!!form.formState.errors.reset_anchor_time}
                    {...form.register('reset_anchor_time')}
                  />
                  <FieldDescription>
                    {t('All quota windows are calculated from this boundary')}
                  </FieldDescription>
                  <FieldError
                    errors={[form.formState.errors.reset_anchor_time]}
                  />
                </Field>
              </FieldGroup>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor='custom-subscription-note'>
                {t('Internal note')}
              </FieldLabel>
              <Textarea
                id='custom-subscription-note'
                rows={3}
                {...form.register('note')}
              />
              <FieldError errors={[form.formState.errors.note]} />
            </Field>

            <Alert>
              <CalendarClock />
              <AlertTitle>{t('Schedule preview')}</AlertTitle>
              <AlertDescription className='space-y-1'>
                <div>
                  {t('Effective window')}: {values.start_time || '-'} -{' '}
                  {values.end_time || '-'} ({values.reset_timezone})
                </div>
                <div>
                  {t('Upcoming refreshes')}:{' '}
                  {previewBoundaries.length > 0
                    ? previewBoundaries
                        .map((timestamp) =>
                          formatCustomSubscriptionTimestamp(
                            timestamp,
                            values.reset_timezone
                          )
                        )
                        .join(', ')
                    : t('No refresh')}
                </div>
              </AlertDescription>
            </Alert>
          </FieldGroup>

          <DialogFooter className='mt-6'>
            <Button
              type='button'
              variant='outline'
              onClick={() => props.onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <Send data-icon='inline-start' />
              )}
              {t('Issue subscription')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
