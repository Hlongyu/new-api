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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import {
  buildXXSwitchURL,
  getXXSwitchImportSchema,
  type XXSwitchImportInput,
} from '../../lib/xx-switch-import'

interface Props {
  tokenKey: string
  name: string
  serverAddress: string
  onOpenChange: (open: boolean) => void
}

export function XXSwitchDialog(props: Props) {
  const { t } = useTranslation()
  const form = useForm<XXSwitchImportInput>({
    defaultValues: {
      name: props.name || 'New API',
      baseUrl: props.serverAddress,
      apiFormat: 'openai_responses',
      models: '',
    },
  })
  const errors = form.formState.errors

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('Import to XXSwitch')}
      description={t(
        'Install XXSwitch first. Review and confirm the provider in the app; it is disabled by default.'
      )}
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button type='submit' form='xx-switch-import'>
            {t('Open XXSwitch')}
          </Button>
        </>
      }
    >
      <form
        id='xx-switch-import'
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          form.clearErrors()
          const result = getXXSwitchImportSchema(t).safeParse({
            ...form.getValues(),
            apiKey: props.tokenKey,
          })
          if (!result.success) {
            for (const issue of result.error.issues) {
              form.setError(issue.path[0] as keyof XXSwitchImportInput, {
                message: issue.message,
              })
            }
            const firstField = result.error.issues[0]?.path[0]
            if (firstField && firstField !== 'apiKey') {
              form.setFocus(firstField as keyof XXSwitchImportInput)
            }
            return
          }
          // Keep protocol navigation synchronous with the user's submit gesture.
          // The complete token was fetched before mounting this dialog.
          window.location.assign(buildXXSwitchURL(result.data))
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='xx-switch-format'>
              {t('Application')}
            </FieldLabel>
            <NativeSelect id='xx-switch-format' {...form.register('apiFormat')}>
              <NativeSelectOption value='openai_responses'>
                Codex (Responses)
              </NativeSelectOption>
              <NativeSelectOption value='openai_chat'>
                Codex (Chat Completions)
              </NativeSelectOption>
              <NativeSelectOption value='anthropic'>
                Claude (Anthropic)
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor='xx-switch-name'>{t('Name')}</FieldLabel>
            <Input
              id='xx-switch-name'
              autoComplete='off'
              aria-invalid={!!errors.name}
              aria-describedby='xx-switch-name-error'
              {...form.register('name')}
            />
            <FieldError id='xx-switch-name-error' errors={[errors.name]} />
          </Field>
          <Field data-invalid={!!errors.baseUrl}>
            <FieldLabel htmlFor='xx-switch-address'>
              {t('Server Address')}
            </FieldLabel>
            <Input
              id='xx-switch-address'
              autoComplete='off'
              aria-invalid={!!errors.baseUrl}
              aria-describedby='xx-switch-address-hint xx-switch-address-error'
              {...form.register('baseUrl')}
            />
            <FieldDescription id='xx-switch-address-hint'>
              {t(
                'The /v1 suffix is adjusted automatically for the selected application.'
              )}
            </FieldDescription>
            <FieldError
              id='xx-switch-address-error'
              errors={[errors.baseUrl]}
            />
          </Field>
          <Field data-invalid={!!errors.models}>
            <FieldLabel htmlFor='xx-switch-models'>{t('Models')}</FieldLabel>
            <Input
              id='xx-switch-models'
              autoComplete='off'
              aria-invalid={!!errors.models}
              aria-describedby='xx-switch-models-hint xx-switch-models-error'
              {...form.register('models')}
            />
            <FieldDescription id='xx-switch-models-hint'>
              {t(
                'Optional: separate models with commas, up to 100. Leave empty for no additional model restriction.'
              )}
            </FieldDescription>
            <FieldError id='xx-switch-models-error' errors={[errors.models]} />
          </Field>
          <FieldDescription>
            {t(
              'The import link contains your complete API key. Do not share it.'
            )}
          </FieldDescription>
          <FieldError errors={[errors.apiKey]} />
        </FieldGroup>
      </form>
    </Dialog>
  )
}
