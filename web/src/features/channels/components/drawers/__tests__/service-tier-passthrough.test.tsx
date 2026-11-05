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
domWindow.document.write(
  '<!doctype html><html><head></head><body></body></html>'
)
const originalGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'customElements',
  'CSSStyleSheet',
  'Document',
  'ShadowRoot',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
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
  'matchMedia',
] as const) {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
originalGlobals.set(
  'IS_REACT_ACT_ENVIRONMENT',
  Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
)
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
})
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { useAuthStore } = await import('@/stores/auth-store')
const { channelSchema } = await import('../../../types')
const { channelsQueryKeys } = await import('../../../lib/channel-actions')
const { ChannelsProvider } = await import('../../channels-provider')
const { ChannelMutateDrawer } = await import('../channel-mutate-drawer')

after(() => {
  domWindow.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

test('advanced custom channels expose a service tier switch and save its selected value', async () => {
  const channel = channelSchema.parse({
    id: 58,
    type: 58,
    name: 'xxgate',
    key: '',
    status: 1,
    created_time: 0,
    test_time: 0,
    response_time: 0,
    balance_updated_time: 0,
    base_url: 'https://gateway.example',
    models: 'gpt-5',
    settings: JSON.stringify({
      advanced_custom: {
        advanced_routes: [
          {
            incoming_path: '/v1/responses',
            upstream_path: '/v1/responses',
            converter: 'none',
          },
        ],
      },
    }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(channelsQueryKeys.detail(channel.id), {
    success: true,
    data: channel,
  })
  client.setQueryData(['groups'], { success: true, data: ['default'] })
  client.setQueryData(['channel_models'], { success: true, data: [] })
  client.setQueryData(['prefill_groups', 'model'], { success: true, data: [] })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const previousUser = useAuthStore.getState().auth.user
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  const originalAdapter = api.defaults.adapter
  const updates: { settings: string }[] = []
  api.defaults.adapter = async (config) => {
    if (config.method === 'put') {
      assert.equal(config.url, '/api/channel/')
      updates.push(JSON.parse(config.data as string))
    } else {
      assert.ok(
        ['/api/user/2fa/status', '/api/user/passkey'].includes(config.url || '')
      )
    }
    return {
      config,
      data: { success: true, data: { enabled: false } },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <ChannelsProvider>
              <ChannelMutateDrawer
                open
                currentRow={channel}
                onOpenChange={() => {}}
              />
            </ChannelsProvider>
          </I18nextProvider>
        </QueryClientProvider>
      )
    })

    const label = [...document.querySelectorAll('label')].find(
      (element) => element.textContent === 'Allow service_tier passthrough'
    )
    assert.ok(
      label,
      'the advanced custom editor must expose the passthrough control'
    )
    assert.ok(label.id)
    const control = document.querySelector<HTMLElement>(
      `[role="switch"][aria-labelledby~="${label.id}"]`
    )
    assert.ok(control)
    assert.equal(control.getAttribute('aria-checked'), 'false')
    await act(async () => control.click())
    assert.equal(control.getAttribute('aria-checked'), 'true')

    const save = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Update Channel'
    )
    assert.ok(save)
    await act(async () => save.click())
    assert.equal(updates.length, 1)
    assert.equal(JSON.parse(updates[0].settings).allow_service_tier, true)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    localStorage.clear()
    api.defaults.adapter = originalAdapter
    useAuthStore.getState().auth.setUser(previousUser)
  }
})
