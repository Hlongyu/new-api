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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { GroupConsumption } = await import('../group-consumption')
const { api } = await import('@/lib/api')
const { parseExcludedUserIDs } = await import('../api')
const { notifyManager } = await import('@tanstack/react-query')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
notifyManager.setScheduler(queueMicrotask)
after(() => domWindow.close())

test('excluded user IDs accept deduplicated IDs and reject invalid values', () => {
  assert.deepEqual(parseExcludedUserIDs('3, 2，3'), [2, 3])
  assert.deepEqual(parseExcludedUserIDs(''), [])
  for (const value of ['-1', '0', '1.5', '2147483648', 'abc']) {
    assert.equal(parseExcludedUserIDs(value), null)
  }
})

test('each group applies and clears its own user exclusions without changing other groups', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const previous = api.defaults.adapter
  const requests: Record<string, number[]>[] = []
  api.defaults.adapter = async (config) => {
    const exclusions = JSON.parse(config.params.group_exclusions) as Record<
      string,
      number[]
    >
    requests.push(exclusions)
    return {
      config,
      headers: {},
      status: 200,
      statusText: 'OK',
      data: {
        success: true,
        data: {
          period: config.params.month,
          quota_per_usd: 100,
          unattributed_requests: 0,
          items: [
            {
              group: 'custom-a',
              owner_user_id: 1,
              wallet_quota: exclusions['custom-a']?.includes(7) ? 0 : 100,
              subscription_quota: 0,
              total_quota: exclusions['custom-a']?.includes(7) ? 0 : 100,
              requests: 1,
            },
            {
              group: 'custom-b',
              owner_user_id: 2,
              wallet_quota: exclusions['custom-b']?.includes(8) ? 0 : 200,
              subscription_quota: 0,
              total_quota: exclusions['custom-b']?.includes(8) ? 0 : 200,
              requests: 1,
            },
          ],
        },
      },
    }
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroupConsumption />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const rows = [...container.querySelectorAll('tbody tr')]
    assert.equal(rows.length, 2)
    const first = rows[0].querySelector('input')
    const second = rows[1].querySelector('input')
    assert.ok(first)
    assert.ok(second)
    const setter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setter)
    await act(async () => {
      setter.call(first, '7')
      first.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      [...rows[0].querySelectorAll('button')]
        .find((button) => button.textContent === 'Confirm')
        ?.click()
    )
    assert.deepEqual(requests.at(-1), { 'custom-a': [7] })
    assert.ok(rows[0].textContent?.includes('$0.00'))
    assert.ok(rows[1].textContent?.includes('$2.00'))
    await act(async () => {
      setter.call(second, '8')
      second.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      [...rows[1].querySelectorAll('button')]
        .find((button) => button.textContent === 'Confirm')
        ?.click()
    )
    assert.deepEqual(requests.at(-1), { 'custom-a': [7], 'custom-b': [8] })
    await act(async () => {
      const current = rows[0].querySelector('input')
      assert.ok(current)
      setter.call(current, '')
      current.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      [...rows[0].querySelectorAll('button')]
        .find((button) => button.textContent === 'Confirm')
        ?.click()
    )
    assert.deepEqual(requests.at(-1), { 'custom-a': [], 'custom-b': [8] })
    assert.ok(rows[0].textContent?.includes('$1.00'))
    assert.ok(rows[1].textContent?.includes('$0.00'))
    assert.equal(container.querySelectorAll('tbody tr').length, 2)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = previous
  }
})

test('failed group report shows an error without fabricated consumption', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const previous = api.defaults.adapter
  api.defaults.adapter = async (config) => ({
    config,
    headers: {},
    status: 200,
    statusText: 'OK',
    data: { success: false, message: 'unavailable' },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroupConsumption />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    assert.ok(
      container.textContent?.includes('Failed to load monthly consumption')
    )
    assert.equal(container.querySelector('table'), null)
    assert.equal(container.querySelector('[role="status"]'), null)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = previous
  }
})

test('group drilldown preserves exclusions and unified filters query user consumption', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const previous = api.defaults.adapter
  const requests: {
    group: string
    user_id: string
    dimension: string
    source: string
    group_exclusions: string
  }[] = []
  api.defaults.adapter = async (config) => {
    requests.push(config.params)
    const users = config.params.dimension === 'user'
    return {
      config,
      headers: {},
      status: 200,
      statusText: 'OK',
      data: {
        success: true,
        data: {
          period: config.params.month,
          dimension: config.params.dimension,
          source: config.params.source,
          quota_per_usd: 100,
          unattributed_requests: 0,
          groups: [{ group: 'custom-a', owner_user_id: 1 }],
          items: [
            {
              group: users ? '' : 'custom-a',
              user_id: users ? 7 : undefined,
              owner_user_id: 1,
              wallet_quota: 100,
              subscription_quota: 50,
              total_quota: 150,
              requests: 1,
            },
          ],
        },
      },
    }
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroupConsumption />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const groupLink = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'custom-a'
    )
    assert.ok(groupLink)
    const exclusion = container.querySelector('tbody input')
    assert.ok(exclusion)
    const setter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setter)
    await act(async () => {
      setter.call(exclusion, '8')
      exclusion.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('tbody button[type="submit"]')
        ?.click()
    )
    await act(async () => groupLink.click())
    assert.equal(requests.at(-1)?.dimension, 'user')
    assert.equal(requests.at(-1)?.group, 'custom-a')
    assert.deepEqual(JSON.parse(requests.at(-1)?.group_exclusions ?? '{}'), {
      'custom-a': [8],
    })
    assert.ok(container.querySelector('tbody')?.textContent?.includes('#7'))
    assert.ok(container.querySelector('details'))
    const source = container.querySelector<HTMLSelectElement>(
      '#consumption-source'
    )
    const user = container.querySelector<HTMLInputElement>('#consumption-user')
    assert.ok(source)
    assert.ok(user)
    await act(async () => {
      source.value = 'wallet'
      source.dispatchEvent(new Event('change', { bubbles: true }))
      setter.call(user, '7')
      user.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const search = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Search'
    )
    assert.ok(search)
    await act(async () => search.click())
    assert.equal(requests.at(-1)?.source, 'wallet')
    assert.equal(requests.at(-1)?.user_id, '7')
    assert.equal(requests.at(-1)?.group, 'custom-a')
    const reset = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset'
    )
    assert.ok(reset)
    await act(async () => reset.click())
    assert.equal(requests.at(-1)?.dimension, 'group')
    assert.equal(requests.at(-1)?.group, '')
    assert.deepEqual(JSON.parse(requests.at(-1)?.group_exclusions ?? '{}'), {})
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = previous
  }
})
