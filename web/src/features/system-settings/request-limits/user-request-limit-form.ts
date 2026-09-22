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
import { z } from 'zod'

export const LIMIT_MAX = 2147483647
export const WINDOW_MAX = 10080
const integer = z
  .number({ error: 'Please enter a valid number' })
  .int({ error: 'Please enter a valid number' })
  .min(0, { error: 'Please enter a valid number' })
  .max(LIMIT_MAX, { error: 'Please enter a valid number' })
const name = z.string().trim().min(1, 'Group name is required')

export const requestLimitRuleSchema = z
  .object({
    concurrencyEnabled: z.boolean(),
    maxConcurrent: integer,
    rateEnabled: z.boolean(),
    rateCount: integer,
    windowMinutes: integer.max(WINDOW_MAX, {
      error: 'Please enter a valid number',
    }),
  })
  .superRefine((rule, ctx) => {
    for (const field of [
      'maxConcurrent',
      'rateCount',
      'windowMinutes',
    ] as const) {
      const enabled =
        field === 'maxConcurrent' ? rule.concurrencyEnabled : rule.rateEnabled
      if (enabled && rule[field] < 1) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Enter a positive integer',
        })
      }
    }
  })

export const userRequestLimitFormSchema = z
  .object({
    groups: z.array(
      z.object({
        name,
        default: requestLimitRuleSchema,
        keyGroups: z.array(
          z.object({
            name: name.refine(
              (value) => value !== 'auto',
              'Auto is not supported for request limits'
            ),
            rule: requestLimitRuleSchema,
          })
        ),
      })
    ),
  })
  .superRefine((value, ctx) => {
    const groups = new Set<string>()
    value.groups.forEach((group, index) => {
      if (groups.has(group.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', index, 'name'],
          message: 'Duplicate group name',
        })
      }
      groups.add(group.name)
      const keys = new Set<string>()
      group.keyGroups.forEach((key, keyIndex) => {
        if (keys.has(key.name)) {
          ctx.addIssue({
            code: 'custom',
            path: ['groups', index, 'keyGroups', keyIndex, 'name'],
            message: 'Duplicate group name',
          })
        }
        keys.add(key.name)
      })
    })
  })

export type RequestLimitRuleForm = z.infer<typeof requestLimitRuleSchema>
export type UserRequestLimitForm = z.infer<typeof userRequestLimitFormSchema>
export const emptyRequestLimitRule = (): RequestLimitRuleForm => ({
  concurrencyEnabled: false,
  maxConcurrent: 1,
  rateEnabled: false,
  rateCount: 60,
  windowMinutes: 1,
})

const storedRuleSchema = z.object({
  max_concurrent: integer.default(0),
  rate_count: integer.default(0),
  rate_window_minutes: integer
    .max(WINDOW_MAX, { error: 'Please enter a valid number' })
    .default(0),
})
const storedConfigSchema = z.record(
  z.string(),
  z.object({
    default: storedRuleSchema.default({
      max_concurrent: 0,
      rate_count: 0,
      rate_window_minutes: 0,
    }),
    key_groups: z.record(z.string(), storedRuleSchema).nullish(),
  })
)

function decodeRule(
  rule: z.infer<typeof storedRuleSchema>
): RequestLimitRuleForm {
  return {
    concurrencyEnabled: rule.max_concurrent > 0,
    maxConcurrent: rule.max_concurrent || 1,
    rateEnabled: rule.rate_count > 0,
    rateCount: rule.rate_count || 60,
    windowMinutes:
      rule.rate_count > 0
        ? rule.rate_window_minutes
        : rule.rate_window_minutes || 1,
  }
}

export function parseUserRequestLimitForm(raw: string): UserRequestLimitForm {
  const config = storedConfigSchema.parse(JSON.parse(raw || '{}'))
  return userRequestLimitFormSchema.parse({
    groups: Object.entries(config).map(([name, group]) => ({
      name,
      default: decodeRule(group.default),
      keyGroups: Object.entries(group.key_groups || {}).map(([name, rule]) => ({
        name,
        rule: decodeRule(rule),
      })),
    })),
  })
}

function encodeRule(rule: RequestLimitRuleForm) {
  return {
    max_concurrent: rule.concurrencyEnabled ? rule.maxConcurrent : 0,
    rate_count: rule.rateEnabled ? rule.rateCount : 0,
    rate_window_minutes: rule.rateEnabled ? rule.windowMinutes : 0,
  }
}

export function serializeUserRequestLimitForm(
  value: UserRequestLimitForm
): string {
  const form = userRequestLimitFormSchema.parse(value)
  return JSON.stringify(
    Object.fromEntries(
      form.groups.map((group) => [
        group.name,
        {
          default: encodeRule(group.default),
          key_groups: Object.fromEntries(
            group.keyGroups.map((key) => [key.name, encodeRule(key.rule)])
          ),
        },
      ])
    )
  )
}
