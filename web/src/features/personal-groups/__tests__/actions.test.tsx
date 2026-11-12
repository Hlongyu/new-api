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

import type { PersonalChannel } from '../types'

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
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
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
})
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider } = await import('react-i18next')
const { QueryClient, QueryClientProvider, notifyManager, defaultScheduler } =
  await import('@tanstack/react-query')
notifyManager.setScheduler(queueMicrotask)
const { api } = await import('@/lib/api')
const { PersonalChannelActions } =
  await import('../components/personal-channel-actions')
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
after(() => {
  notifyManager.setScheduler(defaultScheduler)
  domWindow.close()
})

const channel: PersonalChannel = {
  id: 4,
  owner_user_id: 11,
  group_id: 2,
  group_name: 'custom-example',
  published_channel_id: 9,
  latest_revision_id: 12,
  revision: {
    id: 12,
    status: 'approved',
    reason: '',
    reviewer_id: 99,
    reviewed_at: 1,
  },
  config: {
    name: 'Example',
    type: 1,
    base_url: 'https://example.com',
    models: 'model',
    priority: 0,
    weight: 10,
    enabled: true,
  },
  published_config: {
    name: 'Example',
    type: 1,
    base_url: 'https://example.com',
    models: 'model',
    priority: 0,
    weight: 10,
    enabled: true,
  },
  has_key: true,
  key_changed: false,
}

function mountActions() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return { container, root, client }
}

test('owner disables the published version immediately without creating a draft', async () => {
  const { container, root, client } = mountActions()
  const adapter = api.defaults.adapter
  const requests: unknown[] = []
  let finish: (() => void) | undefined
  api.defaults.adapter = async (config) => {
    requests.push({
      url: config.url,
      method: config.method,
      data: JSON.parse(config.data as string),
    })
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return {
      config,
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <PersonalChannelActions channel={channel} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Disable Example"]'
    )
    assert.ok(toggle)
    await act(async () => toggle.click())
    assert.deepEqual(requests, [
      {
        url: '/api/personal/channels/4/status',
        method: 'put',
        data: { enabled: false },
      },
    ])
    assert.equal(toggle.disabled, true)
    await act(async () => finish?.())
    assert.equal(toggle.disabled, false)
  } finally {
    api.defaults.adapter = adapter
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('deletion requires confirmation and submits the current revision for review', async () => {
  const { container, root, client } = mountActions()
  const adapter = api.defaults.adapter
  const requests: unknown[] = []
  api.defaults.adapter = async (config) => {
    requests.push({
      url: config.url,
      method: config.method,
      data: JSON.parse(config.data as string),
    })
    return {
      config,
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <PersonalChannelActions channel={channel} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const request = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Request deletion Example"]'
    )
    assert.ok(request)
    await act(async () => request.click())
    let dialog = document.querySelector('[role="alertdialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent ?? '', /administrator approval/)
    assert.equal(requests.length, 0)
    const cancel = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    )
    assert.ok(cancel)
    await act(async () => cancel.click())
    assert.equal(requests.length, 0)
    await act(async () => request.click())
    dialog = document.querySelector('[role="alertdialog"]')
    assert.ok(dialog)
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent === 'Submit for Review'
    )
    assert.ok(confirm)
    await act(async () => confirm.click())
    assert.deepEqual(requests, [
      {
        url: '/api/personal/channels/4/delete',
        method: 'post',
        data: { expected_revision_id: 12 },
      },
    ])
  } finally {
    api.defaults.adapter = adapter
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('pending deletion cannot be requested twice and unpublished drafts have no enable action', async () => {
  const { container, root, client } = mountActions()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <PersonalChannelActions
              channel={{
                ...channel,
                published_config: undefined,
                published_channel_id: 0,
                revision: { ...channel.revision, status: 'delete_pending' },
              }}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    assert.equal(
      container.querySelector('button[aria-label="Enable Example"]'),
      null
    )
    assert.equal(
      container.querySelector('button[aria-label="Disable Example"]'),
      null
    )
    assert.equal(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Request deletion Example"]'
      )?.disabled,
      true
    )
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('a failed enable request keeps the disabled state visible and allows retry', async () => {
  const { container, root, client } = mountActions()
  const adapter = api.defaults.adapter
  api.defaults.adapter = async (config) => ({
    config,
    data: {
      success: false,
      message: 'Published personal channel is unavailable',
    },
    status: 200,
    statusText: 'OK',
    headers: {},
  })
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <PersonalChannelActions
              channel={{
                ...channel,
                published_config: { ...channel.config, enabled: false },
              }}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enable Example"]'
    )
    assert.ok(toggle)
    await act(async () => toggle.click())
    assert.equal(
      container.querySelector('[role="alert"]')?.textContent,
      'Published personal channel is unavailable'
    )
    assert.equal(toggle.disabled, false)
    assert.equal(toggle.textContent, 'Enable')
  } finally {
    api.defaults.adapter = adapter
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})
