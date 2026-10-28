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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { ReviewForm } = await import('../components/review-form')
const { ChannelForm } = await import('../components/channel-form')
const { GroupForm } = await import('../components/group-form')
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
after(() => domWindow.close())

const channel: PersonalChannel = {
  id: 4,
  owner_user_id: 11,
  group_id: 2,
  group_name: 'custom-example',
  published_channel_id: 9,
  latest_revision_id: 12,
  revision: {
    id: 12,
    status: 'pending',
    reason: '',
    reviewer_id: 0,
    reviewed_at: 0,
  },
  config: {
    name: 'New name',
    type: 1,
    base_url: 'https://example.com',
    models: 'model-new',
    priority: 0,
    weight: 10,
    enabled: true,
  },
  published_config: {
    name: 'Old name',
    type: 1,
    base_url: 'https://example.com',
    models: 'model-old',
    priority: 0,
    weight: 10,
    enabled: true,
  },
  has_key: true,
  key_changed: false,
}

function mountForm() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return { container, root, client }
}

test('review displays published and submitted values and submits only the reviewed revision', async () => {
  const { container, root, client } = mountForm()
  const original = api.defaults.adapter
  const posts: unknown[] = []
  let finish: (() => void) | undefined
  api.defaults.adapter = async (config) => {
    posts.push({ url: config.url, data: JSON.parse(config.data as string) })
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return {
      config,
      data: { success: true, data: null },
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
            <ReviewForm channel={channel} canReview onSaved={() => {}} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    assert.match(container.textContent ?? '', /Old name/)
    assert.match(container.textContent ?? '', /New name/)
    assert.equal(posts.length, 0)
    const reject = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reject'
    )
    const approve = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve and Publish'
    )
    assert.ok(reject)
    assert.ok(approve)
    assert.equal(reject.disabled, true)
    await act(async () => approve.click())
    assert.deepEqual(posts, [
      {
        url: '/api/personal-channel-reviews/4',
        data: { revision_id: 12, approve: true, reason: '' },
      },
    ])
    assert.equal(approve.disabled, true)
    await act(async () => finish?.())
  } finally {
    api.defaults.adapter = original
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('read-only reviewers cannot approve or reject a submitted revision', async () => {
  const { container, root, client } = mountForm()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <ReviewForm
              channel={channel}
              canReview={false}
              onSaved={() => {}}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    for (const button of container.querySelectorAll('button')) {
      assert.equal(button.disabled, true)
    }
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('saving a channel edit preserves a blank key and sends a draft with its expected revision', async () => {
  const { container, root, client } = mountForm()
  const original = api.defaults.adapter
  const posts: unknown[] = []
  api.defaults.adapter = async (config) => {
    posts.push({ url: config.url, data: JSON.parse(config.data as string) })
    return {
      config,
      data: { success: true, data: null },
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
            <ChannelForm
              channel={channel}
              groups={[
                {
                  id: 2,
                  owner_user_id: 11,
                  name: 'custom-example',
                  description: '',
                  ratio: 1,
                },
              ]}
              onSaved={() => {}}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const key = container.querySelector<HTMLInputElement>(
      '#personal-channel-key'
    )
    assert.ok(key)
    assert.equal(key.type, 'password')
    assert.equal(key.value, '')
    assert.match(container.textContent ?? '', /Leave the key blank/)
    const form = container.querySelector('form')
    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })
    assert.deepEqual(posts, [
      {
        url: '/api/personal/channels',
        data: {
          id: 4,
          group_id: 2,
          expected_revision_id: 12,
          config: { ...channel.config, key: '' },
        },
      },
    ])
  } finally {
    api.defaults.adapter = original
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('saving a group updates its ratio without submitting a channel for review', async () => {
  const { container, root, client } = mountForm()
  const original = api.defaults.adapter
  const posts: unknown[] = []
  api.defaults.adapter = async (config) => {
    posts.push({
      method: config.method,
      url: config.url,
      data: JSON.parse(config.data as string),
    })
    return {
      config,
      data: { success: true, data: null },
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
            <GroupForm
              group={{
                id: 2,
                owner_user_id: 11,
                name: 'custom-example',
                description: 'Example',
                ratio: 0,
              }}
              onSaved={() => {}}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const name = container.querySelector<HTMLInputElement>(
      '#personal-group-name'
    )
    assert.ok(name)
    assert.equal(name.readOnly, true)
    const form = container.querySelector('form')
    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
    })
    assert.deepEqual(posts, [
      {
        method: 'put',
        url: '/api/personal/groups/2',
        data: {
          id: 2,
          name: 'custom-example',
          description: 'Example',
          ratio: 0,
        },
      },
    ])
  } finally {
    api.defaults.adapter = original
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('channel creation stays disabled when the owner has no groups', async () => {
  const { container, root, client } = mountForm()
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <ChannelForm groups={[]} onSaved={() => {}} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const save = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save Draft'
    )
    assert.ok(save)
    assert.equal(save.disabled, true)
  } finally {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('a rejected review request keeps the reviewed configuration visible and allows retry', async () => {
  const { container, root, client } = mountForm()
  const original = api.defaults.adapter
  let saved = false
  api.defaults.adapter = async (config) => ({
    config,
    data: { success: false, message: 'This revision is no longer current' },
    status: 200,
    statusText: 'OK',
    headers: {},
  })
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <ReviewForm
              channel={channel}
              canReview
              onSaved={() => {
                saved = true
              }}
            />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const approve = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve and Publish'
    )
    assert.ok(approve)
    await act(async () => approve.click())
    assert.equal(saved, false)
    assert.equal(
      container.querySelector('[role="alert"]')?.textContent,
      'This revision is no longer current'
    )
    assert.match(container.textContent ?? '', /New name/)
    assert.equal(approve.disabled, false)
  } finally {
    api.defaults.adapter = original
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

test('fetching models allows search and checkbox selection without typing model IDs', async () => {
  const { PersonalModelPicker } = await import('../components/model-picker')
  const { container, root, client } = mountForm()
  const original = api.defaults.adapter
  let selected = ''
  let requestBody: unknown
  api.defaults.adapter = async (config) => {
    requestBody = JSON.parse(config.data as string)
    return {
      config,
      data: { success: true, data: ['model-alpha', 'model-beta'] },
      status: 200,
      statusText: 'OK',
      headers: {},
    }
  }
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <PersonalModelPicker
            channelId={4}
            type={1}
            baseURL='https://example.com'
            apiKey=''
            hasSavedKey
            value=''
            onChange={(value) => {
              selected = value
            }}
          />
        </I18nextProvider>
      )
    )
    const fetch = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Fetch Models'
    )
    assert.ok(fetch)
    await act(async () => fetch.click())
    assert.deepEqual(requestBody, {
      channel_id: 4,
      type: 1,
      base_url: 'https://example.com',
      key: '',
    })
    assert.match(container.textContent ?? '', /model-alpha/)
    const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]')
    assert.ok(checkbox)
    await act(async () => checkbox.click())
    assert.equal(selected, 'model-alpha')
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search models"]'
    )
    assert.ok(search)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set?.call(search, 'beta')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.doesNotMatch(container.textContent ?? '', /model-alpha/)
    assert.match(container.textContent ?? '', /model-beta/)
  } finally {
    api.defaults.adapter = original
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

for (const suffix of ['/v1', '/v1/']) {
  test(`channel address ending in ${suffix} displays the administrator version-path warning`, async () => {
    const { container, root, client } = mountForm()
    try {
      const edited = {
        ...channel,
        config: { ...channel.config, base_url: `https://example.com${suffix}` },
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <ChannelForm
                channel={edited}
                groups={[
                  {
                    id: 2,
                    owner_user_id: 11,
                    name: 'custom-example',
                    description: '',
                    ratio: 1,
                  },
                ]}
                onSaved={() => {}}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.match(
        container.querySelector('[role="alert"]')?.textContent ?? '',
        /Base URL should not end with \/v1/
      )
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
    }
  })
}
