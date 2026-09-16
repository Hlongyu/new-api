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
const { WalletMonthlyConsumption } =
  await import('../wallet-monthly-consumption')
const { AdminMonthlyConsumption } = await import('../admin-monthly-consumption')
const { api } = await import('@/lib/api')
const { getMonthlyConsumption } = await import('../api')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'zhCN', resources: { zhCN: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => domWindow.close())
const data = {
  period: '2026-09',
  as_of: 1789534075,
  quota_per_usd: 500000,
  total: 2,
  items: [
    {
      user_id: 1,
      username: 'alice',
      wallet_quota: 500000000,
      subscription_quota: 250000000,
      total_quota: 750000000,
    },
    {
      user_id: 2,
      username: 'zero-user',
      wallet_quota: 0,
      subscription_quota: 0,
      total_quota: 0,
    },
  ],
}

for (const view of ['wallet', 'admin'] as const) {
  test(`${view} shows current month funding breakdown in Chinese locale`, async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const key =
      view === 'wallet'
        ? ['monthly-consumption', 'self', undefined]
        : ['monthly-consumption', 'admin', { keyword: '', p: 1 }]
    client.setQueryData(key, data)
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              {view === 'wallet' ? (
                <WalletMonthlyConsumption />
              ) : (
                <AdminMonthlyConsumption />
              )}
            </I18nextProvider>
          </QueryClientProvider>
        )
      })
      assert.match(container.textContent || '', /2026-09/)
      assert.match(container.textContent || '', /\$1,000.00/)
      assert.match(container.textContent || '', /\$500.00/)
      assert.match(container.textContent || '', /\$1,500.00/)
      if (view === 'admin') {
        assert.match(container.textContent || '', /zero-user/)
        assert.match(container.textContent || '', /\$0.00/)
        assert.ok(
          container.querySelector(
            'table[aria-label="Monthly consumption by user"]'
          )
        )
        const next = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Next'
        )
        assert.ok(next?.disabled)
      }
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
    }
  })
}

test('personal consumption uses self endpoint and backend failures are not displayed as zero consumption', async () => {
  const previous = api.defaults.adapter
  const urls: (string | undefined)[] = []
  api.defaults.adapter = async (config) => {
    urls.push(config.url)
    return {
      config,
      headers: {},
      status: 200,
      statusText: 'OK',
      data: { success: false, message: 'unavailable' },
    }
  }
  try {
    await assert.rejects(getMonthlyConsumption(), /unavailable/)
    assert.deepEqual(urls, ['/api/data/monthly-consumption/self'])
  } finally {
    api.defaults.adapter = previous
  }
})
