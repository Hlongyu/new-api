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
import { after, afterEach, test } from 'node:test'

import { Window } from 'happy-dom'

import { recapFixture } from './fixture'

const dom = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'IntersectionObserver',
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
})
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider, notifyManager } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { useAuthStore } = await import('@/stores/auth-store')
const { api } = await import('@/lib/api')
const { MonthlyRecapPage } = await import('../index')
notifyManager.setScheduler(queueMicrotask)
const originalAdapter = api.defaults.adapter
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
let root: ReturnType<typeof createRoot> | undefined
let client: InstanceType<typeof QueryClient> | undefined
let container: HTMLDivElement | undefined

async function renderPage(role = 1) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'recap-test', role })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const queryClient = client
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MonthlyRecapPage />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })
  return container
}
function waitForText(text: string) {
  assert.ok(
    container?.textContent?.includes(text),
    container?.textContent ?? ''
  )
}
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  client?.clear()
  api.defaults.adapter = originalAdapter
  useAuthStore.getState().auth.reset()
})
after(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  dom.close()
})

test('empty month keeps month navigation and explains the missing records', async () => {
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: {
      success: true,
      data: {
        ...recapFixture,
        requests: 0,
        models: [],
        history_incomplete: true,
      },
    },
  })
  const page = await renderPage()
  await waitForText('A new chapter is waiting.')
  assert.ok(page.textContent?.includes('Some historical details are missing.'))
  assert.ok(page.querySelector('input[type="month"]'))
  assert.equal(
    page
      .querySelector('button[aria-label="Next month"]')
      ?.hasAttribute('disabled'),
    true
  )
  assert.equal(page.querySelector('nav[aria-label="Recap chapters"]'), null)
})

test('failed monthly query presents retry and retry recovers to the empty state', async () => {
  let fail = true
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: fail
      ? { success: false, message: 'unavailable' }
      : { success: true, data: { ...recapFixture, requests: 0, models: [] } },
  })
  const page = await renderPage()
  await waitForText('Could not load your recap')
  assert.ok(page.querySelector('[role="alert"]'))
  fail = false
  const retry = [...page.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry'
  )
  assert.ok(retry)
  await act(async () => retry.click())
  await waitForText('A new chapter is waiting.')
  assert.equal(page.querySelector('[role="alert"]'), null)
})

test('Chinese interface locale renders amounts and story chapters without invalid Intl tags', async () => {
  await i18n.changeLanguage('zhCN')
  api.defaults.adapter = async (config) => ({
    config,
    status: 200,
    statusText: 'OK',
    headers: {},
    data: { success: true, data: recapFixture },
  })
  try {
    const page = await renderPage()
    assert.ok(page.querySelector('nav[aria-label="Recap chapters"]'))
    assert.ok(page.textContent?.includes('gpt-test'))
  } finally {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
  }
})

test('ordinary user has no admin picker and only requests their own recap', async () => {
  const paths: string[] = []
  api.defaults.adapter = async (config) => {
    paths.push(config.url ?? '')
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data: recapFixture },
    }
  }
  const page = await renderPage()
  assert.equal(
    page.querySelector('button[aria-controls="recap-user-browser"]'),
    null
  )
  assert.deepEqual(paths, ['/api/data/monthly-recap/self'])
})

test('admin selects another user then returns to their own recap without mixing cached data', async () => {
  const paths: string[] = []
  api.defaults.adapter = async (config) => {
    paths.push(config.url ?? '')
    let data: unknown = recapFixture
    if (config.url?.endsWith('/users')) {
      data = {
        items: [{ id: 2, username: 'alice', display_name: 'Alice' }],
        total: 1,
        page: 1,
        page_size: 20,
      }
    } else if (config.url === '/api/data/monthly-recap') {
      assert.equal(config.params.user_id, 2)
      data = {
        ...recapFixture,
        subject: { id: 2, username: 'alice', display_name: 'Alice' },
        requests: 8,
        priced_requests: 8,
      }
    }
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { success: true, data },
    }
  }
  const page = await renderPage(10)
  const toggle = page.querySelector<HTMLButtonElement>(
    'button[aria-controls="recap-user-browser"]'
  )
  assert.ok(toggle)
  await act(async () => toggle.click())
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  const select = [...page.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('@alice')
  )
  assert.ok(select)
  await act(async () => select.click())
  assert.ok(page.textContent?.includes('For Alice'))
  assert.ok(paths.includes('/api/data/monthly-recap'))
  const own = [...page.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'My monthly recap'
  )
  assert.ok(own)
  await act(async () => own.click())
  assert.ok(page.textContent?.includes('For recap-test'))
  assert.ok(!page.textContent?.includes('For Alice'))
})
