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

const domWindow = new Window({
  url: 'http://localhost/',
  settings: { enableImageFileLoading: false },
})
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

const originalMatchMedia = domWindow.matchMedia.bind(domWindow)
const reducedMotionQuery = originalMatchMedia(
  '(prefers-reduced-motion: reduce)'
)
let reducedMotion = false
Object.defineProperty(reducedMotionQuery, 'matches', {
  get: () => reducedMotion,
})
Object.defineProperty(domWindow, 'matchMedia', {
  configurable: true,
  value: (query: string) =>
    query === '(prefers-reduced-motion: reduce)'
      ? reducedMotionQuery
      : originalMatchMedia(query),
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
  id: 1 as number | string,
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

async function loadCrestArtwork() {
  await act(async () => {
    for (const image of document.querySelectorAll('.challenger-crest img')) {
      image.dispatchEvent(new Event('load'))
    }
  })
}

async function finishCrestEntrance() {
  const crest = document.querySelector('[role="dialog"] img')
  assert.ok(crest)
  await loadCrestArtwork()
  const sweep = document.querySelector('.challenger-crest-shine-sweep')
  assert.ok(sweep)
  const ended = new Event('animationend', { bubbles: true })
  Object.defineProperty(ended, 'animationName', { value: 'crest-shine' })
  await act(async () => sweep.dispatchEvent(ended))
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
        ?.textContent?.includes('Announcement Details')
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

test('announcement popup shows content without a visible heading, publication time, or dismissal explanation', async () => {
  const fixture = await announcementFixture()
  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    const title = document.querySelector(
      `[id="${dialog.getAttribute('aria-labelledby')}"]`
    )
    assert.equal(title?.textContent, 'Announcement Details')
    assert.equal(title?.parentElement?.classList.contains('sr-only'), true)
    assert.match(dialog.textContent ?? '', /Service update/)
    assert.doesNotMatch(
      dialog.textContent ?? '',
      /Must-read announcement|Published:|2020-01-01|Closing this announcement/
    )
    assert.equal(closeButton().disabled, false)
    assert.equal(dialog.querySelector('img'), null)
    assert.equal(document.querySelector('.announcement-celebration'), null)
    assert.equal(closeButton().classList.contains('w-full'), false)
    assert.equal(closeButton().classList.contains('h-10'), true)
    const footer = closeButton().closest('[data-slot="dialog-footer"]')
    assert.equal(footer?.classList.contains('border-0'), true)
    assert.equal(footer?.classList.contains('bg-transparent'), true)
    assert.equal(footer?.classList.contains('justify-center'), true)
    const text = [...dialog.querySelectorAll('div')].find((item) =>
      item.classList.contains('prose')
    )
    assert.equal(text?.classList.contains('text-center'), true)
  } finally {
    await fixture.cleanup()
  }
})

test('first challenger announcement displays the complete standalone crest without adding a title or date', async () => {
  const fixture = await announcementFixture([
    {
      ...announcement,
      id: 'system:leaderboard-first-challenger',
      content: 'Congratulations to our first challenger!',
    },
  ])
  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    const crest = dialog.querySelector('img')
    assert.equal(
      crest?.getAttribute('src'),
      '/rank-badges/challenger-crest.png'
    )
    assert.equal(crest?.getAttribute('alt'), '')
    assert.equal(crest?.parentElement?.getAttribute('aria-hidden'), 'true')
    assert.equal(crest?.classList.contains('w-auto'), true)
    assert.equal(crest?.classList.contains('max-w-full'), true)
    assert.equal(crest?.getAttribute('width'), crest?.getAttribute('height'))
    assert.equal(
      crest?.parentElement?.classList.contains('overflow-hidden'),
      false
    )
    assert.match(
      dialog.textContent ?? '',
      /Congratulations to our first challenger!/
    )
    assert.doesNotMatch(
      dialog.textContent ?? '',
      /Must-read announcement|Published:|2020-01-01/
    )
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('[role="dialog"]'), null)
  } finally {
    await fixture.cleanup()
  }
})

test('crest assembles after the image loads, preserves its sequence on refresh, and disappears on close', async () => {
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    const crest = document.querySelector<HTMLImageElement>(
      '[role="dialog"] img'
    )
    assert.ok(crest)
    assert.equal(document.querySelector('.challenger-crest-fragment'), null)
    await loadCrestArtwork()
    const fragment = document.querySelector('.challenger-crest-fragment')
    assert.ok(fragment)
    assert.ok(document.querySelector('.challenger-crest-shine'))
    assert.ok(document.querySelector('.challenger-crest-charge'))
    assert.ok(document.querySelector('.challenger-crest-old-energy'))
    assert.ok(document.querySelector('.challenger-crest-forging animateMotion'))
    assert.ok(document.querySelector('.challenger-crest-beam'))
    assert.ok(document.querySelector('.challenger-crest-impact-spark'))
    assert.equal(
      crest.parentElement?.querySelector('button, a, [tabindex]'),
      null
    )
    assert.equal(closeButton().disabled, false)
    await fixture.render(10)
    assert.equal(document.querySelector('.challenger-crest-fragment'), fragment)
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('.challenger-crest'), null)
    assert.equal(document.querySelector('.announcement-celebration'), null)
  } finally {
    await fixture.cleanup()
  }
})

test('promotion waits for both rank images before replacing the old rank, and falls back if the old image fails', async () => {
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    const next = document.querySelector('.challenger-crest-image')
    const previous = document.querySelector('.challenger-crest-previous-image')
    assert.ok(next)
    assert.ok(previous)
    assert.equal(
      previous.getAttribute('src'),
      '/rank-badges/grandmaster-crest.png'
    )
    assert.equal(next.getAttribute('src'), '/rank-badges/challenger-crest.png')
    await act(async () => next.dispatchEvent(new Event('load')))
    assert.equal(document.querySelector('.challenger-crest-fragment'), null)
    assert.equal(document.querySelector('.announcement-celebration'), null)
    await act(async () => previous.dispatchEvent(new Event('error')))
    assert.equal(
      document.querySelector('.challenger-crest-previous-image'),
      null
    )
    assert.ok(
      document.querySelector('.challenger-crest-static .challenger-crest-image')
    )
    assert.equal(closeButton().disabled, false)
  } finally {
    await fixture.cleanup()
  }
})

test('confetti waits for the complete crest entrance including its final shine', async () => {
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    assert.equal(document.querySelector('.announcement-celebration'), null)
    const crest = document.querySelector('[role="dialog"] img')
    assert.ok(crest)
    await loadCrestArtwork()
    assert.equal(document.querySelector('.announcement-celebration'), null)
    const assembling = new Event('animationend', { bubbles: true })
    Object.defineProperty(assembling, 'animationName', {
      value: 'crest-feather-grow',
    })
    const fragment = document.querySelector('.challenger-crest-fragment')
    assert.ok(fragment)
    await act(async () => fragment.dispatchEvent(assembling))
    assert.equal(document.querySelector('.announcement-celebration'), null)
    await finishCrestEntrance()
    assert.ok(document.querySelector('.announcement-celebration'))
  } finally {
    await fixture.cleanup()
  }
})

test('champion confetti remains active across animation cycles and query refresh until closed', async () => {
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    await finishCrestEntrance()
    const celebration = document.querySelector('.announcement-celebration')
    assert.ok(celebration)
    assert.equal(celebration.getAttribute('aria-hidden'), 'true')
    assert.equal(celebration.querySelector('button, a, [tabindex]'), null)
    await fixture.render(10)
    assert.equal(
      document.querySelector('.announcement-celebration'),
      celebration
    )
    const lastPiece = celebration.lastElementChild
    assert.ok(lastPiece)
    const ended = new Event('animationiteration', { bubbles: true })
    Object.defineProperty(ended, 'animationName', {
      value: 'announcement-confetti-flight',
    })
    await act(async () => lastPiece.dispatchEvent(ended))
    assert.equal(
      document.querySelector('.announcement-celebration'),
      celebration
    )
    await fixture.render(10)
    assert.equal(
      document.querySelector('.announcement-celebration'),
      celebration
    )
    assert.ok(document.querySelector('[role="dialog"]'))
  } finally {
    await fixture.cleanup()
  }
})

test('reduced motion skips champion confetti while preserving the announcement and close action', async () => {
  reducedMotion = true
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    assert.equal(document.querySelector('.announcement-celebration'), null)
    const crest = document.querySelector('[role="dialog"] img')
    assert.ok(crest)
    await loadCrestArtwork()
    assert.equal(document.querySelector('.challenger-crest-fragment'), null)
    assert.equal(document.querySelector('.challenger-crest-shine'), null)
    assert.equal(document.querySelector('.challenger-crest-charge'), null)
    assert.equal(
      document.querySelector('.challenger-crest-previous-image'),
      null
    )
    assert.equal(document.querySelector('.challenger-crest-forging'), null)
    assert.equal(document.querySelector('.challenger-crest-impact-flash'), null)
    assert.equal(document.querySelector('.challenger-crest-impact-spark'), null)
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('[role="dialog"]'), null)
  } finally {
    await fixture.cleanup()
    reducedMotion = false
  }
})

test('closing the announcement removes confetti immediately', async () => {
  const fixture = await announcementFixture([
    { ...announcement, id: 'system:leaderboard-first-challenger' },
  ])
  try {
    await finishCrestEntrance()
    assert.ok(document.querySelector('.announcement-celebration'))
    await act(async () => closeButton().click())
    assert.equal(document.querySelector('.announcement-celebration'), null)
  } finally {
    await fixture.cleanup()
  }
})

test('formatted announcements preserve text, lists and links while scrolling independently of the close button', async () => {
  const fixture = await announcementFixture([
    {
      ...announcement,
      content:
        '## Planned maintenance\n\nA longer update with details for users.\n\n- API requests remain available\n- Usage records remain accessible\n\n[Read the details](https://example.com/details)',
      extra: 'Contact support if you need help.',
    },
  ])
  try {
    const dialog = document.querySelector('[role="dialog"]')
    assert.ok(dialog)
    const paragraph = [...dialog.querySelectorAll('p')].find(
      (item) => item.textContent === 'A longer update with details for users.'
    )
    assert.ok(paragraph)
    assert.equal(
      paragraph.closest('.prose')?.classList.contains('text-left'),
      true
    )
    assert.match(dialog.textContent ?? '', /Planned maintenance/)
    assert.equal(dialog.querySelectorAll('li').length, 2)
    assert.equal(
      dialog.querySelector('a')?.getAttribute('href'),
      'https://example.com/details'
    )
    assert.match(dialog.textContent ?? '', /Contact support/)
    const scrollArea = [...dialog.querySelectorAll('div')].find((item) =>
      item.classList.contains('overflow-y-auto')
    )
    assert.ok(scrollArea?.contains(paragraph))
    assert.equal(scrollArea?.contains(closeButton()), false)
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
