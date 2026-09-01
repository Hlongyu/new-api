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
import { after, afterEach, describe, test } from 'node:test'

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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { PostpaidAdminPanel } = await import('../postpaid-admin-panel')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type ApiMethod = (...args: unknown[]) => Promise<unknown>
const apiClient = api as unknown as { get: ApiMethod }
const originalGet = apiClient.get
let cleanup: (() => Promise<void>) | null = null

const now = Math.floor(Date.now() / 1000)
const adminView = {
  state: {
    configured: true,
    running: true,
    lastSyncAt: now,
    lastSyncError: '',
  },
  summary: {
    grantCount: 2,
    userCount: 2,
    outstandingAmount: 5,
    overdueAmount: 0,
    grantedAmount: 10,
    repaidAmount: 5,
  },
  grants: [
    {
      id: 'active-grant',
      userId: 1,
      displayName: 'ACTIVE_USER',
      tierKey: 'bronze',
      tierName: 'Bronze',
      creditAmount: 5,
      quotaAmount: 2_500_000,
      outstandingAmount: 5,
      status: 'active',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      dueAt: 1_800_000_000,
      completedAt: 0,
    },
    {
      id: 'settled-grant',
      userId: 2,
      displayName: 'SETTLED_USER',
      tierKey: 'bronze',
      tierName: 'Bronze',
      creditAmount: 5,
      quotaAmount: 2_500_000,
      outstandingAmount: 0,
      status: 'settled',
      createdAt: 1_700_000_100,
      updatedAt: 1_700_000_200,
      dueAt: 1_800_000_000,
      completedAt: 1_700_000_200,
    },
  ],
  events: [],
}

async function renderPanel() {
  apiClient.get = async () => ({
    data: { success: true, data: adminView },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <PostpaidAdminPanel enabled />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })
  const panelTrigger = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('All Credit Grants')
  )
  assert.ok(panelTrigger)
  await act(async () => panelTrigger.click())
  await act(() => Promise.resolve())

  cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
  }
  return container
}

describe('postpaid admin panel', () => {
  afterEach(async () => {
    await cleanup?.()
    cleanup = null
    apiClient.get = originalGet
  })
  after(() => domWindow.close())

  test('filters grants by repayment status', async () => {
    const container = await renderPanel()
    assert.equal(container.textContent?.includes('ACTIVE_USER'), true)
    assert.equal(container.textContent?.includes('SETTLED_USER'), true)

    const settledFilter = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Settled')
    )
    assert.ok(settledFilter)
    await act(async () => settledFilter.click())

    assert.equal(container.textContent?.includes('ACTIVE_USER'), false)
    assert.equal(container.textContent?.includes('SETTLED_USER'), true)
  })
})
