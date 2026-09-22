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
const domGlobals = [
  'window',
  'localStorage',
  'HTMLFormElement',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { UserRequestLimitSection } =
  await import('../user-request-limit-section')
const { api } = await import('@/lib/api')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Price ($/1K calls)': 'Price ($/1K calls)',
        'Please enter a valid number': 'Please enter a valid number',
        'Tool identifier': 'Tool identifier',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLInputElement.prototype,
    'value'
  )?.set
  assert.ok(valueSetter)
  valueSetter.call(input, value)
  input.dispatchEvent(
    new domWindow.Event('input', { bubbles: true }) as unknown as Event
  )
}

function labeledInput(
  container: HTMLElement,
  name: string,
  index = 0
): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].filter(
    (item) => item.textContent === name
  )[index]
  assert.ok(label, name)
  const input = container.querySelector<HTMLInputElement>(
    `[id="${label.htmlFor}"]`
  )
  assert.ok(input, name)
  return input
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const element = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === name
  )
  assert.ok(element, name)
  return element
}

function selectGroup(container: HTMLElement, name: string, value: string) {
  const select = labeledInput(container, name) as unknown as HTMLSelectElement
  assert.equal(
    select.tagName,
    'SELECT',
    'groups must be selected from the fetched list'
  )
  assert.ok([...select.options].some((option) => option.value === value))
  select.value = value
  select.dispatchEvent(
    new domWindow.Event('change', { bubbles: true }) as unknown as Event
  )
}

describe('user request limit editor', () => {
  after(() => domWindow.close())
  test('toggles dimensions independently, adds a dedicated pool, and saves one complete policy', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const oldAdapter = api.defaults.adapter
    let submitted: { key: string; value: string } | undefined
    let resolveSave: () => void = () => {}
    const saved = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    api.defaults.adapter = async (config) => {
      if (config.method === 'get') {
        assert.equal(config.url, '/api/group/')
        return {
          data: { success: true, data: ['default', 'company', 'ds', 'auto'] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      submitted = JSON.parse(config.data as string) as {
        key: string
        value: string
      }
      resolveSave()
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <UserRequestLimitSection
                defaultValue='{}'
                legacyEnabled={false}
                legacySettings={{}}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.ok(
        container.textContent?.includes('No user group limits configured.')
      )
      await act(async () => button(container, 'Add user group rule').click())
      await act(async () =>
        selectGroup(container, 'User group name', 'default')
      )
      assert.equal(
        labeledInput(container, 'Maximum concurrent requests').disabled,
        true
      )
      assert.equal(
        labeledInput(container, 'Max requests per period').disabled,
        true
      )
      const concurrency =
        container.querySelector<HTMLButtonElement>('[role="switch"]')
      assert.ok(concurrency)
      await act(async () => concurrency.click())
      assert.equal(concurrency.getAttribute('aria-checked'), 'true')
      assert.equal(
        labeledInput(container, 'Maximum concurrent requests').disabled,
        false
      )
      assert.equal(
        labeledInput(container, 'Max requests per period').disabled,
        true
      )
      await act(async () =>
        changeInputValue(
          labeledInput(container, 'Maximum concurrent requests'),
          '5'
        )
      )
      await act(async () => button(container, 'Add Key group rule').click())
      await act(async () => selectGroup(container, 'Key group name', 'ds'))
      const switches =
        container.querySelectorAll<HTMLButtonElement>('[role="switch"]')
      await act(async () => switches[3].click())
      assert.equal(
        labeledInput(container, 'Maximum concurrent requests', 1).disabled,
        true
      )
      assert.equal(
        labeledInput(container, 'Max requests per period', 1).disabled,
        false
      )
      assert.equal(button(container, 'Save Changes').disabled, false)
      await act(async () => {
        container.querySelector('form')?.requestSubmit()
        await saved
      })
      assert.ok(submitted)
      assert.equal(submitted.key, 'UserRequestLimits')
      assert.deepEqual(JSON.parse(submitted.value), {
        default: {
          default: { max_concurrent: 5, rate_count: 0, rate_window_minutes: 0 },
          key_groups: {
            ds: { max_concurrent: 0, rate_count: 60, rate_window_minutes: 1 },
          },
        },
      })
      await act(async () => button(container, 'Remove Key group rule').click())
      assert.equal(
        container.textContent?.includes('Dedicated Key group pool'),
        false
      )
    } finally {
      api.defaults.adapter = oldAdapter
      await act(async () => root.unmount())
      container.remove()
      client.clear()
    }
  })
  test('shows legacy replacement notice and blocks invalid saved configuration', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient()
    client.setQueryData(['groups'], {
      success: true,
      data: ['default', 'company', 'ds'],
    })
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <UserRequestLimitSection
                defaultValue=''
                legacyEnabled
                legacySettings={{ ModelRequestRateLimitCount: 10 }}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.ok(
        container.textContent?.includes(
          'Legacy request rate limits are still active.'
        )
      )
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <UserRequestLimitSection
                defaultValue='null'
                legacyEnabled
                legacySettings={{}}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.ok(
        container.textContent?.includes('Invalid saved request limits.')
      )
      assert.equal(button(container, 'Save Changes').disabled, true)
      assert.equal(button(container, 'Add user group rule').disabled, true)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      client.clear()
    }
  })
  test('preserves missing saved groups while offering fetched groups and excluding auto', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient()
    client.setQueryData(['groups'], {
      success: true,
      data: ['default', 'company', 'ds', 'auto'],
    })
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <UserRequestLimitSection
                defaultValue='{"old-company":{"default":{},"key_groups":{"old-ds":{}}}}'
                legacyEnabled={false}
                legacySettings={{}}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      const selects = container.querySelectorAll('select')
      assert.equal(selects.length, 2)
      assert.equal(selects[0].value, 'old-company')
      assert.equal(selects[1].value, 'old-ds')
      for (const select of selects) {
        assert.ok([...select.options].some((option) => option.value === 'ds'))
        assert.ok(
          ![...select.options].some((option) => option.value === 'auto')
        )
        assert.equal(select.selectedOptions[0].disabled, true)
        assert.ok(
          select.selectedOptions[0].textContent?.includes('(unavailable)')
        )
      }
      await act(async () =>
        selectGroup(container, 'User group name', 'company')
      )
      await act(async () => selectGroup(container, 'Key group name', 'ds'))
      assert.equal(selects[0].value, 'company')
      assert.equal(selects[1].value, 'ds')
      assert.equal(button(container, 'Save Changes').disabled, false)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      client.clear()
    }
  })

  test('shows empty and failed group results and blocks adding unselectable rules', async () => {
    for (const response of [
      { success: true, data: [] },
      { success: false, data: [] },
    ]) {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      const client = new QueryClient()
      client.setQueryData(['groups'], response)
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={client}>
              <I18nextProvider i18n={i18n}>
                <UserRequestLimitSection
                  defaultValue='{}'
                  legacyEnabled={false}
                  legacySettings={{}}
                />
              </I18nextProvider>
            </QueryClientProvider>
          )
        )
        assert.equal(button(container, 'Add user group rule').disabled, true)
        assert.ok(
          container.textContent?.includes(
            response.success ? 'No groups available' : 'Failed to load groups'
          )
        )
        if (!response.success)
          {assert.equal(button(container, 'Retry').disabled, false)}
      } finally {
        await act(async () => root.unmount())
        container.remove()
        client.clear()
      }
    }
  })
})
