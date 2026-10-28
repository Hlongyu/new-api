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

export const groupSchema = z.object({
  name: z
    .string()
    .trim()
    .max(64)
    .refine((name) =>
      /^custom-[a-z0-9][a-z0-9-]{0,56}$/.test(
        name.startsWith('custom-') ? name : `custom-${name}`
      )
    ),
  description: z.string().max(255),
  ratio: z.number().finite().min(0).max(1000000),
})

export const channelSchema = z.object({
  group_id: z.number().int().positive(),
  name: z.string().trim().min(1).max(128),
  type: z.number().refine((type) => [1, 14, 24, 60].includes(type)),
  base_url: z.url().refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  }),
  key: z
    .string()
    .max(16384)
    .refine((value) => !/[\r\n]/.test(value)),
  models: z
    .string()
    .min(1)
    .refine((value) => {
      const models = value.split(',')
      return (
        models.length <= 200 &&
        models.every(
          (model) =>
            model.trim().length > 0 &&
            model.trim().length <= 255 &&
            !/[\r\n]/.test(model)
        )
      )
    }),
  priority: z.number().int().min(0).max(1000000),
  weight: z.number().int().min(0).max(1000000),
  enabled: z.boolean(),
})

export type GroupValues = z.infer<typeof groupSchema>
export type ChannelValues = z.infer<typeof channelSchema>
