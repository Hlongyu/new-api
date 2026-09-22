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

const dom = new Window()
for (const key of [
  'window',
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
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom[key],
  })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
  writable: true,
})
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { GroupRatioWebhook } = await import('../group-ratio-webhook')
const { webhookQueryKey } = await import('../group-ratio-webhook-api')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
after(() => dom.close())

test('enabled webhook requires groups but saves without a signing secret', async () => {
  const adapter = api.defaults.adapter
  const writes: Record<string, unknown>[] = []
  api.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      writes.push(JSON.parse(config.data as string) as Record<string, unknown>)
    }
    return {
      data: {
        success: true,
        data: {
          enabled: true,
          url: 'https://example.com/hook',
          groups: ['vip'],
          has_secret: true,
        },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData([...webhookQueryKey, 'config'], {
    enabled: true,
    url: 'https://example.com/hook',
    groups: [],
    has_secret: false,
  })
  client.setQueryData([...webhookQueryKey, 'deliveries', 1], [])
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroupRatioWebhook />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    assert.ok(container.textContent?.includes('No webhook deliveries yet'))
    const form = container.querySelector('form')
    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(
        new dom.Event('submit', {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      )
    })
    assert.ok(container.textContent?.includes('Select at least one group.'))
    assert.ok(
      !container.textContent?.includes(
        'Signing secret must contain at least 32 characters.'
      )
    )
    assert.equal(writes.length, 0)
    for (const [text, value] of Object.entries({
      'Watched groups (comma-separated)': 'vip, svip, vip',
    })) {
      const label = [...container.querySelectorAll('label')].find(
        (item) => item.textContent === text
      )
      assert.ok(label)
      const input = container.querySelector(`[id="${label.htmlFor}"]`)
      assert.ok(input)
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          dom.HTMLInputElement.prototype,
          'value'
        )?.set?.call(input, value)
        input.dispatchEvent(
          new dom.Event('input', { bubbles: true }) as unknown as Event
        )
      })
    }
    await act(async () => {
      form.dispatchEvent(
        new dom.Event('submit', {
          bubbles: true,
          cancelable: true,
        }) as unknown as Event
      )
    })
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].groups, ['vip', 'svip'])
    assert.equal(writes[0].secret, '')
    assert.equal(
      container.querySelector<HTMLInputElement>('input[type=password]')?.value,
      ''
    )
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = adapter
  }
})

test('only failed deliveries offer manual retry and stored secrets stay hidden', async () => {
  const adapter = api.defaults.adapter
  const requests: string[] = []
  const records = ['failed', 'pending', 'delivered'].map((status) => ({
    id: status,
    status,
    attempts: 1,
    last_status: 503,
    created_at: 1,
    payload: '{}',
  }))
  api.defaults.adapter = async (config) => {
    if (config.method === 'post') requests.push(config.url ?? '')
    return {
      data: { success: true, data: records },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData([...webhookQueryKey, 'config'], {
    enabled: false,
    url: '',
    groups: [],
    has_secret: true,
  })
  client.setQueryData([...webhookQueryKey, 'deliveries', 1], records)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <GroupRatioWebhook />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const buttons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Retry'
    )
    assert.equal(buttons.length, 1)
    await act(async () => buttons[0].click())
    assert.deepEqual(requests, [
      '/api/option/group-ratio-webhook/deliveries/failed/retry',
    ])
    assert.equal(
      container.querySelector<HTMLInputElement>('input[type=password]')?.value,
      ''
    )
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = adapter
  }
})
