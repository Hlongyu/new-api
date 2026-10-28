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

import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'

import { savePersonalGroup } from '../api'
import { groupSchema, type GroupValues } from '../lib/schema'
import type { PersonalGroup } from '../types'

export function GroupForm(props: {
  group?: PersonalGroup
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<GroupValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: props.group ?? { name: '', description: '', ratio: 1 },
  })
  const mutation = useMutation({
    mutationFn: (values: GroupValues) =>
      savePersonalGroup({ ...values, id: props.group?.id }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['personal-groups'] })
      toast.success(t('Saved successfully'))
      props.onSaved()
    },
    onError: handleServerError,
  })
  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
      <FieldGroup>
        <Field data-invalid={!!form.formState.errors.name}>
          <FieldLabel htmlFor='personal-group-name'>
            {t('Group Name')}
          </FieldLabel>
          <Input
            id='personal-group-name'
            {...form.register('name')}
            readOnly={!!props.group}
            aria-invalid={!!form.formState.errors.name}
            placeholder='custom-example'
          />
          <FieldDescription>
            {t('Group names use the custom- prefix and cannot be changed.')}
          </FieldDescription>
        </Field>
        <Field data-invalid={!!form.formState.errors.description}>
          <FieldLabel htmlFor='personal-group-description'>
            {t('Description')}
          </FieldLabel>
          <Input
            id='personal-group-description'
            {...form.register('description')}
            maxLength={255}
            aria-invalid={!!form.formState.errors.description}
          />
        </Field>
        <Field data-invalid={!!form.formState.errors.ratio}>
          <FieldLabel htmlFor='personal-group-ratio'>
            {t('Group Ratio')}
          </FieldLabel>
          <Input
            id='personal-group-ratio'
            type='number'
            min={0}
            max={1000000}
            step='any'
            {...form.register('ratio', { valueAsNumber: true })}
            aria-invalid={!!form.formState.errors.ratio}
          />
          <FieldDescription>
            {t(
              'Ratio changes do not require approval. Existing billing rules apply.'
            )}
          </FieldDescription>
        </Field>
        {Object.keys(form.formState.errors).length > 0 && (
          <p role='alert'>{t('Please check the highlighted fields.')}</p>
        )}
        {mutation.error instanceof Error && (
          <p role='alert'>{mutation.error.message}</p>
        )}
        <Button type='submit' disabled={mutation.isPending}>
          {t('Save')}
        </Button>
      </FieldGroup>
    </form>
  )
}
