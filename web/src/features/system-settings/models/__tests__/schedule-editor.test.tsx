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
const { QueryClient, QueryClientProvider, notifyManager } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { GroupRatioSchedules } = await import('../group-ratio-schedules')
const { scheduleQueryKey } = await import('../group-ratio-schedule-api')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
after(() => dom.close())

async function renderSchedules(groups: string[], records: unknown[] = []) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData([...scheduleQueryKey, 'pending', 1], {
    items: records,
    total: records.length,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <GroupRatioSchedules groups={groups} />
        </I18nextProvider>
      </QueryClientProvider>
    )
  )
  return {
    container,
    client,
    async close() {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
    },
  }
}

async function enterField(
  container: HTMLElement,
  labelText: string,
  value: string
) {
  const label = [...container.querySelectorAll('label')].find(
    (node) => node.textContent === labelText
  )
  assert.ok(label)
  const control = container.querySelector(`[id="${label.htmlFor}"]`)
  assert.ok(control)
  await act(async () => {
    const prototype =
      control.tagName === 'SELECT'
        ? dom.HTMLSelectElement.prototype
        : dom.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
      control,
      value
    )
    control.dispatchEvent(
      new dom.Event(control.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }) as unknown as Event
    )
  })
}

async function submit(container: HTMLElement) {
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
}

test('invalid ratio or past date blocks scheduling; a valid Beijing time is sent once as UTC', async () => {
  const previousAdapter = api.defaults.adapter
  const writes: Record<string, unknown>[] = []
  api.defaults.adapter = async (config) => {
    if (config.method === 'post') {
      writes.push(JSON.parse(config.data as string) as Record<string, unknown>)
    }
    return {
      data: { success: true, data: { items: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const view = await renderSchedules(['gpt-pro'])
  try {
    assert.ok(
      view.container.textContent?.includes('No scheduled changes in this view.')
    )
    await enterField(view.container, 'Scheduled group', 'gpt-pro')
    await enterField(view.container, 'Target group ratio', '-1')
    await enterField(
      view.container,
      'Execution time (Beijing, UTC+8)',
      '2000-01-01T00:00'
    )
    await submit(view.container)
    assert.equal(writes.length, 0)
    assert.ok(
      view.container.textContent?.includes('Enter a non-negative ratio.')
    )
    assert.ok(
      view.container.textContent?.includes(
        'Choose a future Beijing date and time.'
      )
    )
    assert.ok(view.container.querySelector('[aria-invalid="true"]'))
    await enterField(view.container, 'Target group ratio', '0.1')
    await enterField(
      view.container,
      'Execution time (Beijing, UTC+8)',
      '2099-10-25T00:00'
    )
    await submit(view.container)
    assert.deepEqual(writes, [
      {
        group: 'gpt-pro',
        ratio: 0.1,
        execute_at: Date.UTC(2099, 9, 24, 16) / 1000,
      },
    ])
  } finally {
    await view.close()
    api.defaults.adapter = previousAdapter
  }
})

test('empty saved groups disables creating a schedule and explains why', async () => {
  const view = await renderSchedules([])
  try {
    const button = [...view.container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Schedule one-time change'
    )
    assert.ok(button?.disabled)
    assert.ok(view.container.querySelector('select')?.disabled)
    assert.ok(
      view.container.textContent?.includes(
        'Save a group ratio before scheduling a change.'
      )
    )
  } finally {
    await view.close()
  }
})

test('cancellation requires confirmation and is available only for pending plans', async () => {
  const previousAdapter = api.defaults.adapter
  const writes: string[] = []
  const records = ['pending', 'succeeded', 'failed', 'cancelled'].map(
    (status, i) => ({
      id: i + 1,
      group: 'gpt-pro',
      ratio: 0.1,
      previous_ratio: null,
      execute_at: Date.UTC(2026, 9, 24, 16) / 1000,
      finished_at: 0,
      status,
      error: status === 'failed' ? 'group no longer exists' : '',
    })
  )
  api.defaults.adapter = async (config) => {
    if (config.method === 'post') writes.push(config.url ?? '')
    return {
      data: { success: true, data: { items: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const view = await renderSchedules(['gpt-pro'], records)
  try {
    assert.ok(view.container.textContent?.includes('2026-10-25 00:00'))
    assert.ok(
      view.container.textContent?.includes('The group no longer exists.')
    )
    const buttons = [...view.container.querySelectorAll('button')].filter(
      (node) =>
        node.getAttribute('aria-label') ===
        'Cancel scheduled change for gpt-pro'
    )
    assert.equal(buttons.length, 1)
    await act(async () => buttons[0].click())
    assert.deepEqual(writes, [])
    const confirm = [...view.container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Confirm cancellation'
    )
    assert.ok(confirm)
    await act(async () => confirm.click())
    assert.deepEqual(writes, ['/api/option/group-ratio-schedules/1/cancel'])
  } finally {
    await view.close()
    api.defaults.adapter = previousAdapter
  }
})

test('failed creation preserves entered fields so the administrator can retry', async () => {
  const previousAdapter = api.defaults.adapter
  api.defaults.adapter = async (config) => ({
    data: { success: false, message: 'Storage unavailable' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  })
  const view = await renderSchedules(['gpt-pro'])
  try {
    await enterField(view.container, 'Scheduled group', 'gpt-pro')
    await enterField(view.container, 'Target group ratio', '0')
    await enterField(
      view.container,
      'Execution time (Beijing, UTC+8)',
      '2099-10-25T00:00'
    )
    await submit(view.container)
    assert.equal(view.container.querySelector('select')?.value, 'gpt-pro')
    assert.equal(
      view.container.querySelector<HTMLInputElement>('input[type=number]')
        ?.value,
      '0'
    )
    const button = [...view.container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Schedule one-time change'
    )
    assert.ok(button && !button.disabled)
  } finally {
    await view.close()
    api.defaults.adapter = previousAdapter
  }
})

test('Chinese labels clearly identify Beijing time and one-time scheduling', async () => {
  const chinese = (await import('@/i18n/locales/zh.json')).default
  i18n.addResourceBundle('zh', 'translation', chinese.translation)
  await i18n.changeLanguage('zh')
  const view = await renderSchedules(['gpt-pro'])
  try {
    assert.ok(
      view.container.textContent?.includes('执行时间（北京时间 UTC+8）')
    )
    assert.ok(view.container.textContent?.includes('添加单次定时修改'))
  } finally {
    await view.close()
    await i18n.changeLanguage('en')
  }
})

test('saving disables controls and a second submission until the request completes', async () => {
  notifyManager.setScheduler(queueMicrotask)
  const previousAdapter = api.defaults.adapter
  let complete: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  api.defaults.adapter = async (config) => {
    if (config.method === 'post') {
      await pending
    }
    return {
      data: { success: true, data: { items: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const view = await renderSchedules(['gpt-pro'])
  try {
    await enterField(view.container, 'Scheduled group', 'gpt-pro')
    await enterField(view.container, 'Target group ratio', '0.1')
    await enterField(
      view.container,
      'Execution time (Beijing, UTC+8)',
      '2099-10-25T00:00'
    )
    await submit(view.container)
    const saving = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Saving...'
    )
    assert.ok(saving?.disabled)
    assert.ok(view.container.querySelector('select')?.disabled)
    assert.ok(
      view.container.querySelector<HTMLInputElement>('input[type=number]')
        ?.disabled
    )
    await act(async () => {
      complete?.()
    })
  } finally {
    complete?.()
    await view.close()
    api.defaults.adapter = previousAdapter
    notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  }
})
