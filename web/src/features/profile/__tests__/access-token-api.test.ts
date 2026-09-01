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
import { afterEach, describe, mock, test } from 'node:test'

import { api } from '@/lib/api'

import { generateAccessToken, getAccessToken } from '../api'

describe('profile access token API', () => {
  afterEach(() => mock.restoreAll())

  test('requests the existing token without rotating it', async () => {
    const get = mock.method(api, 'get', async () => ({
      data: { success: true, data: 'existing-token' },
    }))

    const response = await getAccessToken()

    assert.equal(response.data, 'existing-token')
    assert.deepEqual(get.mock.calls[0].arguments, [
      '/api/user/token',
      { params: { regenerate: false } },
    ])
  })

  test('requests an explicit token rotation', async () => {
    const get = mock.method(api, 'get', async () => ({
      data: { success: true, data: 'new-token' },
    }))

    const response = await generateAccessToken()

    assert.equal(response.data, 'new-token')
    assert.deepEqual(get.mock.calls[0].arguments, [
      '/api/user/token',
      { params: { regenerate: true } },
    ])
  })
})
