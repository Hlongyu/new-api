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
  'KeyboardEvent',
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
const { QueryClient, QueryClientProvider, notifyManager } =
  await import('@tanstack/react-query')
notifyManager.setScheduler(queueMicrotask)
const { api } = await import('@/lib/api')
const { useAuthStore } = await import('@/stores/auth-store')
const { RequiredAnnouncements } = await import('../required-announcements')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0))
  domWindow.close()
})

const announcement = {
  revision: 'a'.repeat(64),
  content: 'Service update',
  extra: '',
  publishDate: '2020-01-01T00:00:00Z',
}

async function announcementFixture(
  items = [announcement],
  userId: number | null = 10
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const previousAdapter = api.defaults.adapter
  const dismissed = new Map<number, Set<string>>()
  const requests: {
    method: string | undefined
    userId: number | undefined
    revision?: string
  }[] = []
  let fail = false
  let resolvePost: (() => void) | undefined
  let hold = false
  api.defaults.adapter = async (config) => {
    const account = useAuthStore.getState().auth.user?.id
    assert.ok(account)
    const revision =
      config.method === 'post'
        ? (JSON.parse(config.data as string).revision as string)
        : undefined
    requests.push({ method: config.method, userId: account, revision })
    if (config.method === 'post') {
      if (hold) {
        await new Promise<void>((resolve) => {
          resolvePost = resolve
        })
      }
      if (!fail) {
        assert.ok(revision)
        const read = dismissed.get(account) ?? new Set<string>()
        read.add(revision)
        dismissed.set(account, read)
      }
    }
    return {
      data: {
        success: !fail,
        message: fail ? 'Unavailable' : '',
        data: items.filter(
          (item) => !dismissed.get(account)?.has(item.revision)
        ),
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const render = async (id: number | null, visible = true) => {
    await act(async () => {
      useAuthStore
        .getState()
        .auth.setUser(id ? { id, username: `user-${id}`, role: 1 } : null)
      if (id) {
        client.setQueryData(
          ['required-announcements', id],
          items.filter((item) => !dismissed.get(id)?.has(item.revision))
        )
      }
      root.render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            {visible ? <RequiredAnnouncements /> : null}
          </I18nextProvider>
        </QueryClientProvider>
      )
    })
  }
  await render(userId)
  return {
    requests,
    render,
    setFail(value: boolean) {
      fail = value
    },
    holdPost() {
      hold = true
    },
    async finishPost() {
      await act(async () => {
        resolvePost?.()
      })
    },
    async cleanup() {
      await act(async () => root.unmount())
      client.clear()
      api.defaults.adapter = previousAdapter
      useAuthStore.getState().auth.reset()
      container.remove()
    },
  }
}

function closeButton() {
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Close'
  )
  assert.ok(button)
  return button
}

test('closing each announcement dismisses only that version and does not reopen after reentry', async () => {
  const fixture = await announcementFixture([
    announcement,
    { ...announcement, revision: 'b'.repeat(64), content: 'Second update' },
  ])
  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.ok(
      document
        .querySelector(`[id="${dialog.getAttribute('aria-labelledby')}"]`)
        ?.textContent?.includes('Must-read announcement')
    )
    assert.match(dialog.textContent ?? '', /Service update/)
    await act(async () => closeButton().click())
    assert.match(
      document.querySelector('[role="dialog"]')?.textContent ?? '',
      /Second update/
    )
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('[role="dialog"]'), null)
    await fixture.render(10, false)
    await fixture.render(10)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.deepEqual(
      fixture.requests
        .filter((request) => request.method === 'post')
        .map((request) => request.revision),
      ['a'.repeat(64), 'b'.repeat(64)]
    )
    await fixture.render(20)
    assert.match(
      document.querySelector('[role="dialog"]')?.textContent ?? '',
      /Service update/
    )
  } finally {
    await fixture.cleanup()
  }
})

test('failed dismissal stays visible and can be retried without losing the announcement', async () => {
  const fixture = await announcementFixture()
  try {
    fixture.setFail(true)
    await act(async () => closeButton().click())
    assert.ok(document.querySelector('[role="dialog"]'))
    assert.match(
      document.querySelector('[role="alert"]')?.textContent ?? '',
      /Could not save/
    )
    fixture.setFail(false)
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('[role="dialog"]'), null)
  } finally {
    await fixture.cleanup()
  }
})

test('dismissal disables the footer while saving and closes after persistence succeeds', async () => {
  const fixture = await announcementFixture()
  try {
    fixture.holdPost()
    await act(async () => closeButton().click())
    const saving = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Saving...'
    )
    assert.ok(saving)
    assert.equal(saving.disabled, true)
    await fixture.finishPost()
    assert.equal(document.querySelector('[role="dialog"]'), null)
  } finally {
    await fixture.cleanup()
  }
})

test('Escape dismisses the announcement and saves the preference', async () => {
  const fixture = await announcementFixture()
  try {
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(
      fixture.requests.filter((request) => request.method === 'post').length,
      1
    )
  } finally {
    await fixture.cleanup()
  }
})

test('logged-out visitors neither fetch nor see announcement reminders', async () => {
  const fixture = await announcementFixture([], null)
  try {
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.equal(fixture.requests.length, 0)
  } finally {
    await fixture.cleanup()
  }
})
