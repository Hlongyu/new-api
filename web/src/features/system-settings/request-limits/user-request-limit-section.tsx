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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { getGroups } from '@/features/users/api'

import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  emptyRequestLimitRule,
  parseUserRequestLimitForm,
  serializeUserRequestLimitForm,
  userRequestLimitFormSchema,
  type UserRequestLimitForm,
} from './user-request-limit-form'
import { UserRequestLimitGroup } from './user-request-limit-group'

type Props = {
  defaultValue: string
  legacyEnabled: boolean
  legacySettings: Record<string, unknown>
}

export function UserRequestLimitSection(props: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const groupQuery = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })
  const groupNames = useMemo(
    () =>
      [...new Set(groupQuery.data?.data ?? [])]
        .filter((name) => name !== 'auto')
        .sort((a, b) => a.localeCompare(b)),
    [groupQuery.data]
  )
  const groupError = groupQuery.isError || groupQuery.data?.success === false
  const groupSelectionDisabled =
    groupQuery.isPending || groupError || groupNames.length === 0
  const initial = useMemo(() => {
    try {
      return {
        value: parseUserRequestLimitForm(props.defaultValue),
        invalid: false,
      }
    } catch {
      return { value: { groups: [] }, invalid: true }
    }
  }, [props.defaultValue])
  const form = useForm<UserRequestLimitForm>({
    resolver: zodResolver(userRequestLimitFormSchema),
    defaultValues: initial.value,
    mode: 'onChange',
  })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  useEffect(() => {
    form.reset(initial.value)
  }, [initial, form])
  const save = form.handleSubmit(async (values) => {
    if (initial.invalid) return
    try {
      await updateOption.mutateAsync({
        key: 'UserRequestLimits',
        value: serializeUserRequestLimitForm(values),
      })
    } catch {
      // The shared mutation displays the failure; keep the draft available.
    }
  })
  const disabled =
    initial.invalid || !form.formState.isValid || updateOption.isPending
  return (
    <SettingsSection title={t('User request limits')}>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Each user has independent pools shared by all their keys. Dedicated Key group rules replace the default rule and never consume the default pool.'
        )}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Concurrency counts active requests until completion. Rate limits count admitted requests in a sliding window, including failures. Rejected requests consume neither limit.'
        )}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Unconfigured user groups are unlimited. Disabled limits do not inherit defaults. Other API throttles may still apply.'
        )}
      </p>
      {!props.defaultValue && props.legacyEnabled && (
        <Alert>
          <AlertDescription>
            {t(
              'Legacy request rate limits are still active. Saving these rules replaces them; old Key group rules are not migrated automatically.'
            )}
            <details className='mt-2'>
              <summary>{t('Legacy rate limit settings')}</summary>
              <pre className='mt-2 overflow-auto text-xs'>
                {JSON.stringify(props.legacySettings, null, 2)}
              </pre>
            </details>
          </AlertDescription>
        </Alert>
      )}
      {initial.invalid && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Invalid saved request limits. Fix the configuration before saving.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {groupQuery.isPending && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('Loading...')}
        </p>
      )}
      {groupError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Failed to load groups')}
            <Button
              type='button'
              variant='outline'
              disabled={groupQuery.isFetching}
              onClick={() => void groupQuery.refetch()}
            >
              {t('Retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {!groupQuery.isPending && !groupError && groupNames.length === 0 && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('No groups available')}
        </p>
      )}
      <Form {...form}>
        <form onSubmit={save} className='space-y-6'>
          <SettingsPageFormActions
            onSave={save}
            isSaving={updateOption.isPending}
            isSaveDisabled={disabled}
          />
          <fieldset
            disabled={initial.invalid || updateOption.isPending}
            className='min-w-0 space-y-6'
          >
            {groups.fields.map((group, index) => (
              <UserRequestLimitGroup
                key={group.id}
                control={form.control}
                groupNames={groupNames}
                groupSelectionDisabled={groupSelectionDisabled}
                index={index}
                onRemove={() => groups.remove(index)}
              />
            ))}
            {groups.fields.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                {t('No user group limits configured.')}
              </p>
            )}
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={
                  initial.invalid ||
                  updateOption.isPending ||
                  groupSelectionDisabled
                }
                onClick={() =>
                  groups.append({
                    name: '',
                    default: emptyRequestLimitRule(),
                    keyGroups: [],
                  })
                }
              >
                {t('Add user group rule')}
              </Button>
              <Button type='submit' disabled={disabled}>
                {t('Save Changes')}
              </Button>
            </div>
          </fieldset>
        </form>
      </Form>
    </SettingsSection>
  )
}
