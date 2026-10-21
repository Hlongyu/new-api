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
const { AnnouncementsSection } = await import('../announcements-section')
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

for (const announcementId of [1, 'system:leaderboard-first-challenger']) {
  test(`administrator can edit and save announcement ${announcementId} through the shared editor`, async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const previousAdapter = api.defaults.adapter
    const saved: {
      key: string
      value: string
      known_announcement_ids: string[]
    }[] = []
    api.defaults.adapter = async (config) => {
      saved.push(JSON.parse(config.data as string))
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <AnnouncementsSection
                enabled
                data={JSON.stringify([
                  {
                    id: announcementId,
                    content: 'Service update',
                    publishDate: '2020-01-01T00:00:00Z',
                    type: 'default',
                  },
                ])}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      const edit = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Edit"]'
      )
      assert.ok(edit)
      await act(async () => edit.click())
      const label = [...document.querySelectorAll('label')].find(
        (label) => label.textContent === 'Must-read announcement'
      )
      assert.ok(label)
      const checkbox = document.querySelector<HTMLInputElement>(
        `[id="${label.htmlFor}"]`
      )
      assert.ok(checkbox)
      assert.equal(checkbox.checked, false)
      await act(async () => label.click())
      assert.equal(checkbox.checked, true)
      const update = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Update'
      )
      assert.ok(update)
      await act(async () => update.click())
      const save = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save Settings'
      )
      assert.ok(save)
      assert.equal(save.disabled, false)
      await act(async () => save.click())
      assert.equal(saved.length, 1)
      assert.equal(saved[0]?.key, 'console_setting.announcements')
      assert.deepEqual(
        saved[0]?.known_announcement_ids,
        typeof announcementId === 'string' ? [announcementId] : []
      )
      assert.deepEqual(JSON.parse(saved[0]?.value ?? ''), [
        {
          id: announcementId,
          content: 'Service update',
          publishDate: '2020-01-01T00:00:00Z',
          type: 'default',
          extra: '',
          requireRead: true,
        },
      ])
      await act(async () => edit.click())
      const savedLabel = [...document.querySelectorAll('label')].find(
        (label) => label.textContent === 'Must-read announcement'
      )
      assert.ok(savedLabel)
      assert.equal(
        document.querySelector<HTMLInputElement>(`[id="${savedLabel.htmlFor}"]`)
          ?.checked,
        true
      )
    } finally {
      await act(async () => root.unmount())
      client.clear()
      api.defaults.adapter = previousAdapter
      container.remove()
    }
  })
}
