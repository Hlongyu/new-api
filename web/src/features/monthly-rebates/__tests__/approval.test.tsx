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

import type { MonthlyRebate, MonthlyRebateList } from '../types'

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
const { api } = await import('@/lib/api')
const { MonthlyRebatesDialog } = await import('../index')
const { RebateReviewDialog } =
  await import('../components/rebate-review-dialog')
const { previousBeijingMonth } = await import('../lib/format')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => domWindow.close())

const bill: MonthlyRebate = {
  id: 1,
  period: previousBeijingMonth(),
  user_id: 42,
  username: 'rebate-alice',
  quota_per_usd: 500000,
  wallet_quota: 500000000,
  rate_percent: 5,
  rebate_quota: 25000000,
  revision: 3,
  status: 'pending',
  last_error: '',
  issued_wallet_quota: 0,
  issued_rate_percent: 0,
  issued_quota: 0,
  subscription_id: 0,
  subscription_expires_at: 0,
  subscription_status: '',
  subscription_amount_used: 0,
  issued_by: 0,
  issued_at: 0,
  checked_at: 1788200000,
}

function rebateList(record: MonthlyRebate): MonthlyRebateList {
  return {
    items: [record],
    total: 1,
    page: 1,
    page_size: 20,
    summary: {
      users: 1,
      pending: record.issued_at ? 0 : 1,
      issued: record.issued_at ? 1 : 0,
      needs_review: 0,
      failed: 0,
      issued_quota: record.issued_quota,
    },
  }
}

test('calculating never issues a reward; explicit approval sends the reviewed revision', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  const filters = { period: bill.period, status: '', user_id: '', p: 1 }
  queryClient.setQueryData(['monthly-rebates', filters], rebateList(bill))
  const originalAdapter = api.defaults.adapter
  const posts: { url: string | undefined; data: unknown }[] = []
  let current = bill
  api.defaults.adapter = async (config) => {
    if (config.method === 'post') {
      posts.push({ url: config.url, data: JSON.parse(config.data as string) })
      if (config.url?.endsWith('/issue')) {
        current = {
          ...bill,
          status: 'issued',
          issued_quota: bill.rebate_quota,
          issued_at: 1788300000,
          subscription_id: 7,
        }
      }
    }
    const data = config.method === 'get' ? rebateList(current) : current
    return {
      data: { success: true, data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <MonthlyRebatesDialog open onOpenChange={() => {}} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    })
    const main = document.querySelector('[role="dialog"]')
    assert.ok(main)
    assert.match(main.textContent || '', /rebate-alice/)
    assert.match(main.textContent || '', /\$1,000.00/)
    assert.match(main.textContent || '', /\$50.00/)
    assert.equal(posts.length, 0)
    const calculate = [...main.querySelectorAll('button')].find(
      (button) => button.textContent === 'Calculate month'
    )
    assert.ok(calculate)
    await act(async () => {
      calculate.click()
    })
    assert.deepEqual(posts, [
      {
        url: '/api/subscription/admin/rebates/recalculate',
        data: { period: bill.period },
      },
    ])
    const review = [...main.querySelectorAll('button')].find(
      (button) => button.textContent === 'Review details'
    )
    assert.ok(review)
    await act(async () => {
      review.click()
    })
    const approve = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve and issue'
    )
    assert.ok(approve)
    assert.equal(posts.length, 1, 'opening review must not issue a reward')
    await act(async () => {
      approve.click()
    })
    assert.deepEqual(posts[1], {
      url: '/api/subscription/admin/rebates/1/issue',
      data: { revision: 3 },
    })
  } finally {
    api.defaults.adapter = originalAdapter
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
  }
})

test('issued discrepancies show original issuance and difference without another approval button', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const issued: MonthlyRebate = {
    ...bill,
    status: 'needs_review',
    wallet_quota: 0,
    rebate_quota: 0,
    rate_percent: 0,
    issued_wallet_quota: 500000000,
    issued_rate_percent: 5,
    issued_quota: 25000000,
    issued_by: 99,
    issued_at: 1788300000,
    subscription_id: 7,
    subscription_status: 'active',
    subscription_expires_at: 1819836000,
  }
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RebateReviewDialog
            bill={issued}
            pending={false}
            onClose={() => {}}
            onIssue={() => assert.fail('issued rewards cannot be issued twice')}
          />
        </I18nextProvider>
      )
    })
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent || '', /Consumption at approval/)
    assert.match(dialog.textContent || '', /-\$50.00/)
    assert.match(dialog.textContent || '', /#99/)
    assert.match(dialog.textContent || '', /#7/)
    assert.ok(
      ![...dialog.querySelectorAll('button')].some(
        (button) => button.textContent === 'Approve and issue'
      )
    )
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

test('Chinese review details render instead of showing the error page', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await i18n.changeLanguage('zhCN')
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RebateReviewDialog
            bill={bill}
            pending={false}
            onClose={() => {}}
            onIssue={() => {}}
          />
        </I18nextProvider>
      )
    })
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent || '', /rebate-alice/)
    assert.match(dialog.textContent || '', /2026/)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    await i18n.changeLanguage('en')
  }
})
