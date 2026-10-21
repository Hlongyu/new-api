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
import type { TFunction } from 'i18next'
import { z } from 'zod'

export function getXXSwitchImportSchema(t: TFunction) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .refine(
          (value) => value.length > 0 && [...value].length <= 100,
          t('Provider name must contain 1–100 characters')
        ),
      baseUrl: z
        .string()
        .trim()
        .refine((value) => {
          try {
            const url = new URL(value)
            return (
              /^https?:\/\//i.test(value) &&
              ['http:', 'https:'].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              !/[\s,?#\\]/.test(value)
            )
          } catch {
            return false
          }
        }, t('Enter a single HTTP(S) server address without credentials, query parameters or fragments')),
      apiKey: z
        .string()
        .refine(
          (value) =>
            value.trim().length > 0 &&
            new TextEncoder().encode(value).length <= 4096,
          t('A complete API key of at most 4096 bytes is required')
        ),
      apiFormat: z.enum(['openai_responses', 'openai_chat', 'anthropic']),
      models: z
        .string()
        .trim()
        .refine(
          (value) =>
            value.split(',').filter((model) => model.trim()).length <= 100,
          t('Select at most 100 models')
        ),
    })
    .superRefine((value, ctx) => {
      if (ctx.issues.length > 0) return
      if (buildXXSwitchURL(value).length > 16 * 1024) {
        ctx.addIssue({
          code: 'custom',
          path: ['models'],
          message: t(
            'Import link exceeds 16 KiB; shorten the name, address or model list'
          ),
        })
      }
    })
}

export type XXSwitchImportInput = z.infer<
  ReturnType<typeof getXXSwitchImportSchema>
>

export function buildXXSwitchURL(input: XXSwitchImportInput): string {
  const app = input.apiFormat === 'anthropic' ? 'claude' : 'codex'
  const address = new URL(input.baseUrl)
  const basePath = address.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  address.pathname = app === 'codex' ? `${basePath}/v1` : basePath
  const endpoint = address.toString().replace(/\/$/, '')
  const params = new URLSearchParams({
    resource: 'provider',
    app,
    name: input.name,
    endpoint,
    apiKey: input.apiKey,
    apiFormat: input.apiFormat,
    enabled: 'false',
  })
  const models = input.models
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  if (models.length > 0) params.set('model', models.join(','))
  return `xxswitch://v1/import?${params.toString()}`
}
