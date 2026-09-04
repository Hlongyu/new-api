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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
await i18next.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})
const { CouponRow } = await import('../wallet-coupons-card')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const baseCoupon = {
  id: 1,
  user_id: 10,
  name: 'GPT Pro trial',
  applicable_group: 'gpt-pro',
  ratio_ppm: 100_000,
  issued_at: 100,
  activate_before: 300,
  active_duration_seconds: 3600,
  activated_at: 0,
  active_until: 0,
  status: 1,
  issuer_id: 20,
  revoker_id: 0,
  revoked_at: 0,
  issue_batch_id: 'batch',
  recipient_scope: 'selected' as const,
  rank_min: '',
  rank_max: '',
  rpm_limit: 10,
  effective_status: 'available' as const,
}

describe('wallet coupon item', () => {
  after(() => domWindow.close())

  test('offers activation only while the coupon is available', async () => {
    const selected: number[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CouponRow
          coupon={baseCoupon}
          nowSeconds={200}
          onActivate={(coupon) => selected.push(coupon.id)}
          activating={false}
        />
      )
    })
    const activateButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Activate')
    )
    assert.ok(activateButton)
    assert.match(container.textContent || '', /Active for/)
    assert.match(container.textContent || '', /Requests per minute:\s*10/)
    await act(async () => activateButton.click())
    assert.deepEqual(selected, [1])

    await act(async () => root.unmount())
    container.remove()
  })

  test('shows remaining time without another activation action when active', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CouponRow
          coupon={{
            ...baseCoupon,
            status: 2,
            effective_status: 'active',
            activated_at: 200,
            active_until: 3800,
          }}
          nowSeconds={200}
          onActivate={() => undefined}
          activating={false}
        />
      )
    })
    assert.match(container.textContent || '', /Ends in/)
    assert.doesNotMatch(container.textContent || '', /Active for/)
    assert.equal(container.querySelector('button'), null)

    await act(async () => root.unmount())
    container.remove()
  })
})
