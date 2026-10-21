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
import { after, afterEach, beforeEach, test } from 'node:test'

import { Window } from 'happy-dom'

const dom = new Window()
const globals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const
const originalGlobals = new Map(
  globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
)
for (const key of globals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider } = await import('react-i18next')
const { XXSwitchDialog } = await import('../xx-switch-dialog')
const i18n = createInstance()
await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
})
const testGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const originalActEnvironment = testGlobals.IS_REACT_ACT_ENVIRONMENT
testGlobals.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let opened: string[]
let closed: boolean[]
const originalAssign = window.location.assign

beforeEach(async () => {
  opened = []
  closed = []
  window.location.assign = (url) => {
    opened.push(String(url))
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <XXSwitchDialog
          tokenKey='sk-private+&='
          name='My provider'
          serverAddress='https://api.example.com/v1/'
          onOpenChange={(value) => {
            closed.push(value)
          }}
        />
      </I18nextProvider>
    )
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.location.assign = originalAssign
})

after(() => {
  dom.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
  testGlobals.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = [...document.querySelectorAll('label')].find(
    (item) => item.textContent === label
  )
  assert.ok(element)
  const control = document.querySelector(`[id="${element.htmlFor}"]`)
  assert.ok(
    control instanceof HTMLInputElement || control instanceof HTMLSelectElement
  )
  return control
}

function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === label
  )
  assert.ok(element)
  return element
}

test('opens only after an explicit submit and keeps the complete key out of the page', async () => {
  assert.equal(opened.length, 0)
  assert.equal(document.body.innerHTML.includes('sk-private'), false)
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  const titleId = dialog.getAttribute('aria-labelledby')
  assert.ok(titleId)
  assert.equal(
    document.querySelector(`[id="${titleId}"]`)?.textContent,
    'Import to XXSwitch'
  )
  await act(async () => button('Open XXSwitch').click())
  assert.equal(opened.length, 1)
  assert.ok(opened[0])
  const params = new URL(opened[0]).searchParams
  assert.equal(params.get('apiKey'), 'sk-private+&=')
  assert.equal(params.get('endpoint'), 'https://api.example.com/v1')
  assert.equal(params.get('enabled'), 'false')
  assert.equal(params.has('model'), false)
})

test('changing application to Claude sends anthropic and removes the v1 suffix', async () => {
  await act(async () => {
    field('Application').value = 'anthropic'
    field('Application').dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => button('Open XXSwitch').click())
  assert.ok(opened[0])
  const params = new URL(opened[0]).searchParams
  assert.equal(params.get('app'), 'claude')
  assert.equal(params.get('apiFormat'), 'anthropic')
  assert.equal(params.get('endpoint'), 'https://api.example.com')
})

test('invalid name shows an accessible error, focuses the field and does not open the app', async () => {
  await act(async () => {
    const input = field('Name')
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setValue)
    setValue.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('Open XXSwitch').click())
  assert.equal(opened.length, 0)
  assert.equal(field('Name').getAttribute('aria-invalid'), 'true')
  assert.equal(document.activeElement, field('Name'))
  assert.ok(
    document.querySelector('[role="alert"]')?.textContent?.includes('1–100')
  )
})

test('cancel closes the dialog without opening XXSwitch', async () => {
  await act(async () => button('Cancel').click())
  assert.deepEqual(closed, [false])
  assert.deepEqual(opened, [])
})

test('Escape cancels from the keyboard without opening XXSwitch', async () => {
  await act(async () => {
    button('Cancel').focus()
    button('Cancel').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
  })
  assert.deepEqual(closed, [false])
  assert.deepEqual(opened, [])
})
