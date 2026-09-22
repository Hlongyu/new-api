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
const { MonthlyAccounting } = await import('../monthly-accounting')
const { SnapshotUsers } = await import('../snapshot-users')
const { api } = await import('@/lib/api')
const { getMonthlyAccounting, getSnapshotUsers } = await import('../api')
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

const snapshot = {
  period: '2026-10',
  scheduled_at: 1790784000,
  captured_at: 1790784001,
  status: 'captured',
  quota_per_cny: 500000,
  balance_quota: 3000000000,
  redeemed_quota: 0,
  user_count: 21,
}

// Fixtures are cached API responses; network failures are exercised at the HTTP adapter boundary.
test('monthly accounting distinguishes completed income from missing and scheduled snapshots', async () => {
  const previousNow = Date.now
  Date.now = () => Date.parse('2026-11-01T00:00:00+08:00')
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['monthly-accounting', 2026], {
    year: 2026,
    start_period: '2026-10',
    items: [
      {
        period: '2026-10',
        status: 'complete',
        opening: snapshot,
        closing: { ...snapshot, period: '2026-11', balance_quota: 3200000000 },
        receipts_quota: 800000000,
        revenue_quota: 600000000,
        transition_adjustment_quota: -3000000000,
        bookkeeping_revenue_quota: -2400000000,
      },
      {
        period: '2026-11',
        status: 'missing',
        opening: null,
        closing: null,
        receipts_quota: null,
        revenue_quota: null,
        transition_adjustment_quota: null,
        bookkeeping_revenue_quota: null,
      },
      {
        period: '2026-12',
        status: 'scheduled',
        opening: null,
        closing: null,
        receipts_quota: null,
        revenue_quota: null,
        transition_adjustment_quota: null,
        bookkeeping_revenue_quota: null,
      },
    ],
  })
  client.setQueryData(['monthly-accounting', 'users', '2026-10', 1], {
    snapshot,
    total: 1,
    items: [
      {
        user_id: 42,
        username: 'historical-user',
        quota: 3000000000,
        deleted: true,
      },
    ],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <MonthlyAccounting />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const table = container.querySelector(
      'table[aria-label="Monthly accounting"]'
    )
    assert.equal(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Next year"]'
      )?.disabled,
      true
    )
    assert.equal(container.querySelector('[role="alert"]'), null)
    assert.ok(table)
    const rows = table.querySelectorAll('tbody tr')
    assert.match(rows[0].textContent || '', /6,000.00/)
    assert.match(rows[0].textContent || '', /1,600.00/)
    assert.match(rows[0].textContent || '', /1,200.00/)
    assert.match(rows[0].textContent || '', /-¥6,000.00/)
    assert.match(rows[0].textContent || '', /-¥4,800.00/)
    assert.match(rows[0].textContent || '', /Complete/)
    assert.match(rows[1].textContent || '', /Snapshot missing/)
    assert.doesNotMatch(rows[1].textContent || '', /0[.]00/)
    assert.equal(rows[2].querySelector('button')?.disabled, true)
    const view = rows[0].querySelector('button')
    assert.ok(view)
    await act(async () => view.click())
    assert.match(container.textContent || '', /historical-user/)
    assert.match(container.textContent || '', /Deleted/)
    assert.ok(container.querySelector('table[aria-label="Snapshot balances"]'))
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    Date.now = previousNow
  }
})

test('snapshot details paginate frozen users and disable next on the last page', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['monthly-accounting', 'users', '2026-10', 1], {
    snapshot,
    total: 21,
    items: [
      {
        user_id: 1,
        username: 'first-page-user',
        quota: 500000,
        deleted: false,
      },
    ],
  })
  client.setQueryData(['monthly-accounting', 'users', '2026-10', 2], {
    snapshot,
    total: 21,
    items: [
      {
        user_id: 21,
        username: 'last-page-user',
        quota: 1000000,
        deleted: false,
      },
    ],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <SnapshotUsers period='2026-10' onClose={() => {}} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const previous = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Previous'
    )
    const next = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Next'
    )
    assert.equal(previous?.disabled, true)
    assert.ok(next)
    assert.equal(next.disabled, false)
    await act(async () => next.click())
    assert.match(container.textContent || '', /last-page-user/)
    assert.doesNotMatch(container.textContent || '', /first-page-user/)
    assert.equal(next.disabled, true)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('accounting request failure displays an error without fabricated zero balances', async () => {
  const previousNow = Date.now
  Date.now = () => Date.parse('2026-11-01T00:00:00+08:00')
  const previous = api.defaults.adapter
  api.defaults.adapter = async (config) => ({
    config,
    headers: {},
    status: 200,
    statusText: 'OK',
    data: { success: false, message: 'accounting unavailable' },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await assert.rejects(getMonthlyAccounting(2026), /accounting unavailable/)
    await assert.rejects(
      getSnapshotUsers('2026-10', 1),
      /accounting unavailable/
    )
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <MonthlyAccounting />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    assert.match(container.textContent || '', /Failed to load accounting data/)
    assert.equal(container.querySelector('table'), null)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
    api.defaults.adapter = previous
    Date.now = previousNow
  }
})
