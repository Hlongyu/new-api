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
] as const) {
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
const { DatePicker } = await import('../date-picker')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

describe('date picker', () => {
  after(() => domWindow.close())

  test('exposes validation state and closes after a calendar selection', async () => {
    const selected: Date[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <DatePicker
            id='activation-deadline'
            selected={undefined}
            invalid
            onSelect={(date) => {
              if (date) selected.push(date)
            }}
            disabled={(date) => date.getDate() === 1}
          />
        </I18nextProvider>
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>(
      '#activation-deadline'
    )
    assert.ok(trigger)
    assert.equal(trigger.type, 'button')
    assert.equal(trigger.getAttribute('aria-invalid'), 'true')
    assert.match(trigger.textContent || '', /Pick a date/)

    await act(async () => trigger.click())
    const availableDay = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-day]'),
    ].find((button) => !button.disabled)
    assert.ok(availableDay)
    await act(async () => availableDay.click())

    assert.equal(selected.length, 1)
    assert.equal(document.querySelector('[data-slot="calendar"]'), null)

    await act(async () => root.unmount())
    container.remove()
  })
})
