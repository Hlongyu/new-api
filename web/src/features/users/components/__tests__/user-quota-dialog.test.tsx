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
const { api } = await import('@/lib/api')
const { UserQuotaDialog } = await import('../user-quota-dialog')
const { parseQuotaFromDollars } = await import('@/lib/format')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => domWindow.close())

test('grants a one-year subscription with no subtract or override operation', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const originalAdapter = api.defaults.adapter
  const requests: unknown[] = []
  let succeeded = false
  api.defaults.adapter = async (config) => {
    requests.push(JSON.parse(config.data as string))
    return {
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <UserQuotaDialog
            open
            onOpenChange={() => {}}
            userId={42}
            onSuccess={() => {
              succeeded = true
            }}
          />
        </I18nextProvider>
      )
    })
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent || '', /Valid for one year from issuance/)
    const buttons = [...dialog.querySelectorAll('button')]
    assert.ok(
      !buttons.some((b) =>
        ['Subtract', 'Override', 'Add'].includes(b.textContent || '')
      )
    )
    const confirm = buttons.find((b) => b.textContent === 'Confirm')
    assert.ok(confirm)
    assert.equal(confirm.disabled, true)
    const input = dialog.querySelector('input')
    assert.ok(input)
    assert.equal(dialog.querySelector('label')?.htmlFor, input.id)
    const setValue = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setValue)
    for (const value of ['-1', '0', '999999999999999']) {
      await act(async () => {
        setValue.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      assert.equal(confirm.disabled, true)
    }
    await act(async () => {
      setValue.call(input, '2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal(confirm.disabled, false)
    await act(async () => {
      confirm.click()
    })
    assert.deepEqual(requests, [
      {
        id: 42,
        action: 'add_quota',
        mode: 'add',
        value: parseQuotaFromDollars(2),
      },
    ])
    assert.equal(succeeded, true)
  } finally {
    api.defaults.adapter = originalAdapter
    await act(async () => root.unmount())
    container.remove()
  }
})
