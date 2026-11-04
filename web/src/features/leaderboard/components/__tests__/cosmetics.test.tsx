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

import type { LeaderboardMe } from '../../types'

const domWindow = new Window()
const domGlobals = [
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
after(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)))
const { ProfileCosmeticsForm } = await import('../profile-cosmetics-form')
const { EntryCosmetics } = await import('../entry-cosmetics')
const { api } = await import('@/lib/api')
const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
after(() => domWindow.close())

function profile(
  tierKey: LeaderboardMe['rankProgress']['tierKey'],
  cards: number,
  freeAvailable = false
): LeaderboardMe {
  return {
    id: 42,
    username: 'alice',
    identityName: 'Alice',
    quota: 0,
    balanceUsd: 0,
    isRoot: false,
    entry: {
      displayName: 'Alice',
      currentName: 'Alice',
      anonymousName: 'Anonymous',
      isNamePublic: true,
      customTitle: '旧称号',
      avatarImage: 'data:image/jpeg;base64,cHJldmlldw==',
      visibility: {
        participateDay: true,
        participateWeek: true,
        participateMonth: true,
        participateAll: true,
        participateRank: true,
        showRankBadge: true,
      },
    },
    rename: {
      periodKey: 'week',
      freeAvailable,
      freeUsed: !freeAvailable,
      cardBalance: cards,
      cardPriceCny: 1,
    },
    rankProgress: {
      tierKey,
      tierName: tierKey,
      tierIndex: 0,
      division: 'I',
      divisionIndex: 0,
      label: tierKey,
      score: 0,
      segmentScore: 0,
      pendingScore: 0,
      tokenScore: 0,
      renameScore: 0,
      sponsorScore: 0,
      totalScore: 0,
      rankValue: 0,
      promotion: null,
    },
  }
}

for (const [tier, cards] of [
  ['gold', 2],
  ['challenger', 0],
] as const) {
  test(`${tier} with ${cards} cards keeps cosmetics visible but disables editing`, async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const client = new QueryClient()
    const me = profile(tier, cards)
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <ProfileCosmeticsForm me={me} />
              <EntryCosmetics
                entry={{
                  id: 7,
                  displayName: 'Alice',
                  customTitle: me.entry.customTitle,
                  avatarImage: me.entry.avatarImage,
                }}
              />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.equal(
        container.querySelector<HTMLInputElement>('#leaderboard-custom-title')
          ?.value,
        '旧称号'
      )
      assert.equal(
        container.querySelector<HTMLInputElement>('#leaderboard-custom-title')
          ?.disabled,
        true
      )
      assert.equal(
        container.querySelector<HTMLInputElement>('#leaderboard-avatar')
          ?.disabled,
        true
      )
      assert.ok(
        [...container.querySelectorAll('button')].every(
          (button) => button.disabled
        )
      )
      assert.equal(
        container.querySelector('img')?.getAttribute('src'),
        me.entry.avatarImage
      )
      assert.ok(container.textContent?.includes('旧称号'))
    } finally {
      await act(async () => root.unmount())
      client.clear()
    }
  })
}

test('Challenger without cards uses the weekly free change to save a valid title', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const originalAdapter = api.defaults.adapter
  const requests: unknown[] = []
  const me = profile('challenger', 0, true)
  api.defaults.adapter = async (config) => {
    requests.push(JSON.parse(config.data as string))
    return {
      data: { success: true, data: me },
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
            <ProfileCosmeticsForm me={me} />
          </I18nextProvider>
        </QueryClientProvider>
      )
    )
    const input = container.querySelector<HTMLInputElement>(
      '#leaderboard-custom-title'
    )
    const save = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    )
    assert.ok(input)
    assert.ok(save)
    assert.equal(input.disabled, false)
    assert.equal(save.textContent, 'Save title (free)')
    assert.equal(
      container.querySelector<HTMLInputElement>('#leaderboard-avatar')
        ?.disabled,
      false
    )
    assert.equal(save.disabled, true)
    for (const value of ['', '一二三四五六七八九十多']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          domWindow.HTMLInputElement.prototype,
          'value'
        )?.set?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      assert.equal(save.disabled, true)
    }
    const title = '一二三四五六七八九😀'
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set?.call(input, title)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal(save.disabled, false)
    await act(async () => save.click())
    assert.deepEqual(requests, [{ customTitle: title }])
    assert.equal(
      container.querySelector<HTMLInputElement>('#leaderboard-avatar')?.value,
      ''
    )
  } finally {
    api.defaults.adapter = originalAdapter
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  }
})

for (const freeAvailable of [false, true]) {
  test(`avatar upload with free allowance ${freeAvailable} validates files, saves independently, and exposes failures`, async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const originalAdapter = api.defaults.adapter
    const me = profile('challenger', freeAvailable ? 0 : 2, freeAvailable)
    let submitted: FormData | undefined
    let complete: (() => void) | undefined
    const request = new Promise<void>((resolve) => {
      complete = resolve
    })
    api.defaults.adapter = async (config) => {
      assert.equal(config.url, '/api/leaderboard/me/avatar')
      submitted = config.data as FormData
      await request
      throw new Error('Upload failed')
    }
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <ProfileCosmeticsForm me={me} />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      const input = container.querySelector<HTMLInputElement>(
        '#leaderboard-avatar'
      )
      const save = [...container.querySelectorAll('button')].find(
        (button) =>
          button.textContent ===
          (freeAvailable ? 'Save avatar (free)' : 'Save avatar (1 card)')
      )
      assert.ok(input)
      assert.ok(save)
      for (const file of [
        new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' }),
        new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', {
          type: 'image/png',
        }),
      ]) {
        await act(async () => {
          Object.defineProperty(input, 'files', {
            configurable: true,
            value: [file],
          })
          input.dispatchEvent(new Event('change', { bubbles: true }))
        })
        assert.equal(input.getAttribute('aria-invalid'), 'true')
        assert.equal(save.disabled, true)
      }
      const file = new File(['image bytes'], 'avatar.png', {
        type: 'image/png',
      })
      await act(async () => {
        Object.defineProperty(input, 'files', {
          configurable: true,
          value: [file],
        })
        input.dispatchEvent(new Event('change', { bubbles: true }))
      })
      assert.equal(save.disabled, false)
      await act(async () => save.click())
      assert.ok(submitted instanceof FormData)
      assert.equal((submitted.get('avatar') as File).name, 'avatar.png')
      assert.equal(submitted.has('customTitle'), false)
      assert.equal(save.disabled, true)
      assert.equal(input.disabled, true)
      await act(async () => complete?.())
      assert.ok(container.querySelector('[role="alert"]'))
      api.defaults.adapter = async (config) => ({
        data: {
          success: true,
          data: {
            ...me,
            rename: {
              ...me.rename,
              freeAvailable: false,
              freeUsed: true,
              cardBalance: freeAvailable ? 0 : 1,
            },
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      })
      await act(async () => save.click())
      assert.equal(container.querySelector('[role="alert"]'), null)
      assert.equal(input.value, '')
      assert.equal(save.disabled, true)
      assert.equal(
        client.getQueryData<LeaderboardMe>(['leaderboard', 'me'])?.rename
          .cardBalance,
        freeAvailable ? 0 : 1
      )

      assert.equal(
        container.querySelector<HTMLInputElement>('#leaderboard-custom-title')
          ?.value,
        '旧称号'
      )
      const saved = client.getQueryData<LeaderboardMe>(['leaderboard', 'me'])
      assert.ok(saved)
      assert.equal(saved.rename.freeAvailable, false)
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <I18nextProvider i18n={i18n}>
              <ProfileCosmeticsForm me={saved} />
            </I18nextProvider>
          </QueryClientProvider>
        )
      )
      assert.equal(input.disabled, freeAvailable)
      assert.equal(save.textContent, 'Save avatar (1 card)')
      assert.equal(
        container.querySelector<HTMLInputElement>('#leaderboard-custom-title')
          ?.disabled,
        freeAvailable
      )
    } finally {
      complete?.()
      api.defaults.adapter = originalAdapter
      await act(async () => root.unmount())
      client.clear()
      container.remove()
    }
  })
}
