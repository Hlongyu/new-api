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

import type { User } from '../../types'
import {
  transformFormDataToPayload,
  transformUserToFormDefaults,
  userFormSchema,
} from '../user-form'

for (const quota of [-500000, 0, 500000]) {
  test(`editing a user's group with quota ${quota} succeeds without submitting the balance`, () => {
    const user: User = {
      id: 2,
      username: 'test-user',
      display_name: 'Test user',
      role: 1,
      status: 1,
      quota,
      used_quota: 0,
      request_count: 0,
      group: 'default',
    }
    const values = transformUserToFormDefaults(user)
    const parsed = userFormSchema.safeParse({ ...values, group: 'vip' })

    assert.equal(parsed.success, true)
    if (!parsed.success) return

    assert.equal(parsed.data.quota_dollars, values.quota_dollars)
    assert.deepEqual(transformFormDataToPayload(parsed.data, user.id), {
      id: 2,
      username: 'test-user',
      display_name: 'Test user',
      password: undefined,
      group: 'vip',
      remark: undefined,
    })
  })
}
