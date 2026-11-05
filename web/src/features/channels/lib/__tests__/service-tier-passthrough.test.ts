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
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { channelSchema } from '../../types'
import { CHANNEL_TYPE_ADVANCED_CUSTOM } from '../advanced-custom'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
  transformFormDataToUpdatePayload,
} from '../channel-form'

const advancedCustom = {
  advanced_routes: [
    {
      incoming_path: '/v1/responses',
      upstream_path: '/v1/responses',
      converter: 'none',
    },
  ],
}

test('creating an advanced custom channel persists the selected service tier passthrough setting', () => {
  for (const enabled of [false, true]) {
    const payload = transformFormDataToCreatePayload({
      ...CHANNEL_FORM_DEFAULT_VALUES,
      name: 'xxgate',
      type: CHANNEL_TYPE_ADVANCED_CUSTOM,
      base_url: 'https://gateway.example',
      key: 'test-key',
      models: 'gpt-5',
      advanced_custom: JSON.stringify(advancedCustom),
      allow_service_tier: enabled,
    })

    const settings = JSON.parse(payload.channel.settings || '{}')
    assert.equal(settings.allow_service_tier, enabled)
    assert.deepEqual(settings.advanced_custom, advancedCustom)
  }
})

test('editing an advanced custom channel retains service tier passthrough and allows disabling it', () => {
  const channel = channelSchema.parse({
    id: 58,
    name: 'xxgate',
    type: CHANNEL_TYPE_ADVANCED_CUSTOM,
    key: '',
    status: 1,
    created_time: 0,
    test_time: 0,
    response_time: 0,
    balance_updated_time: 0,
    models: 'gpt-5',
    settings: JSON.stringify({
      allow_service_tier: true,
      advanced_custom: advancedCustom,
    }),
  })
  const defaults = transformChannelToFormDefaults(channel)
  assert.equal(defaults.allow_service_tier, true)

  for (const enabled of [true, false]) {
    const payload = transformFormDataToUpdatePayload(
      { ...defaults, allow_service_tier: enabled },
      channel.id
    )
    const settings = JSON.parse(payload.settings || '{}')
    assert.equal(settings.allow_service_tier, enabled)
    assert.deepEqual(settings.advanced_custom, advancedCustom)
  }
})
