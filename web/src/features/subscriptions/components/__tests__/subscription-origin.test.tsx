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
import { after, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'FocusEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

Object.defineProperty(domWindow.Element.prototype, 'getAnimations', {
  configurable: true,
  value: () => [],
})

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { SubscriptionOrigin } = await import('../subscription-origin')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => domWindow.close())

for (const entry of [
  {
    source: 'admin_custom',
    title: '管理员赠送额度',
    expected: 'Administrator grant',
  },
  {
    source: 'monthly_rebate',
    title: '2026-08 月度消费返利',
    expected: 'Monthly consumption rebate',
  },
]) {
  test(`${entry.source} exposes the reason without relying on a plan`, async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <I18nextProvider i18n={i18n}>
            <SubscriptionOrigin
              subscription={{
                id: 1,
                user_id: 2,
                plan_id: 0,
                status: 'active',
                source: entry.source,
                title: entry.title,
                start_time: 1,
                end_time: 9999999999,
                amount_total: 100,
                amount_used: 0,
              }}
            />
          </I18nextProvider>
        )
      )
      assert.ok(container.textContent?.includes(entry.expected))
      assert.ok(container.textContent?.includes(entry.title))
      assert.ok(container.textContent?.includes('Grant reason'))
    } finally {
      await act(async () => root.unmount())
    }
  })
}
