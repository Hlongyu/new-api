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
import { after, afterEach, describe, test } from 'node:test'

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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { LotteryCard } = await import('../lottery-card')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type ApiMethod = (...args: unknown[]) => Promise<unknown>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
  patch: ApiMethod
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
const originalPatch = apiClient.patch
let cleanup: (() => Promise<void>) | null = null

const eligiblePayload = {
  enabled: true,
  configured: true,
  isRoot: false,
  ruleVersion: 2,
  periodKey: '2026-07-27',
  weekStart: 1_775_404_800,
  weekEnd: 1_776_009_600,
  timeZone: 'Asia/Shanghai',
  prizesByRank: [[{ amountUsd: 5, weight: 1 }]],
  winners: [
    {
      periodKey: '2026-07-27',
      weekStart: 1_775_404_800,
      weekEnd: 1_776_009_600,
      rank: 1,
      displayName: 'Alice',
      tokenUsed: 100,
      quota: 5_000_000,
      amountUsd: 10,
      requestCount: 2,
      isMe: true,
      draw: null,
    },
  ],
  opportunities: [],
  pendingOpportunities: 1,
  me: {
    periodKey: '2026-07-27',
    rank: 1,
    prizes: [{ amountUsd: 5, weight: 1 }],
    canDraw: true,
    draw: null,
  },
  nextDraw: {
    periodKey: '2026-07-27',
    weekStart: 1_775_404_800,
    weekEnd: 1_776_009_600,
    rank: 1,
    prizes: [{ amountUsd: 5, weight: 1 }],
    draw: null,
  },
  canDraw: true,
  weeklyHistory: [
    {
      periodKey: '2026-07-27',
      weekStart: 1_775_404_800,
      weekEnd: 1_776_009_600,
      winners: [
        {
          periodKey: '2026-07-27',
          weekStart: 1_775_404_800,
          weekEnd: 1_776_009_600,
          rank: 1,
          displayName: 'Alice',
          tokenUsed: 100,
          quota: 5_000_000,
          amountUsd: 10,
          requestCount: 2,
          isMe: true,
          draw: {
            id: 'draw-1',
            periodKey: '2026-07-27',
            rank: 1,
            amountUsd: 5,
            status: 'completed',
            completedAt: 1_776_009_700,
          },
        },
      ],
    },
  ],
}

async function renderCard(onAwarded?: () => void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <LotteryCard onAwarded={onAwarded} />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
  }
  return container
}

describe('weekly lottery card', () => {
  afterEach(async () => {
    await cleanup?.()
    cleanup = null
    apiClient.get = originalGet
    apiClient.post = originalPost
    apiClient.patch = originalPatch
  })

  after(() => domWindow.close())

  test('draws an eligible weekly reward with the mutation header', async () => {
    let awarded = 0
    apiClient.get = async (...args) => {
      const [url] = args
      assert.equal(url, '/leaderboard/api/lottery')
      return { data: { success: true, data: eligiblePayload } }
    }
    apiClient.post = async (...args) => {
      const [url, body, rawConfig] = args
      assert.equal(url, '/leaderboard/api/lottery/draw')
      assert.deepEqual(body, {})
      assert.ok(rawConfig && typeof rawConfig === 'object')
      const config = rawConfig as { headers: Record<string, string> }
      assert.equal(config.headers['X-Leaderboard-Request'], '1')
      return {
        status: 201,
        data: {
          success: true,
          data: {
            id: 'draw-1',
            periodKey: '2026-07-27',
            rank: 1,
            amountUsd: 5,
            status: 'completed',
            completedAt: 1_776_009_700,
          },
        },
      }
    }

    const container = await renderCard(() => {
      awarded += 1
    })
    const drawButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Draw now')
    )
    assert.ok(drawButton)

    await act(async () => {
      drawButton.dispatchEvent(
        new domWindow.MouseEvent('click', { bubbles: true }) as unknown as Event
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    assert.equal(awarded, 1)
    assert.match(container.textContent, /You won \$5/)
  })

  test('remains visible when the companion lottery is disabled', async () => {
    apiClient.get = async () => ({
      data: {
        success: true,
        data: { ...eligiblePayload, enabled: false },
      },
    })

    const container = await renderCard()
    assert.match(container.textContent, /Weekly Top 3 Draw/)
    assert.match(container.textContent, /No draw available/)
  })

  test('hides weekly spending amounts from non-root viewers', async () => {
    apiClient.get = async () => ({
      data: { success: true, data: eligiblePayload },
    })

    const container = await renderCard()
    assert.doesNotMatch(container.textContent, /\$10/)
    assert.match(container.textContent, /\$5/)
  })

  test('lets every user open the weekly top-three history', async () => {
    apiClient.get = async () => ({
      data: { success: true, data: eligiblePayload },
    })

    const container = await renderCard()
    const historyButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('View weekly history')
    )
    assert.ok(historyButton)

    await act(async () => {
      historyButton.dispatchEvent(
        new domWindow.MouseEvent('click', { bubbles: true }) as unknown as Event
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    assert.match(document.body.textContent, /Weekly Top 3 History/)
    assert.match(document.body.textContent, /Alice/)
    assert.match(document.body.textContent, /Claimed \$5/)
    assert.doesNotMatch(document.body.textContent, /Spent \$10/)
  })

  test('shows weekly spending amounts to root viewers', async () => {
    apiClient.get = async () => ({
      data: {
        success: true,
        data: { ...eligiblePayload, isRoot: true },
      },
    })

    const container = await renderCard()
    assert.match(container.textContent, /\$10/)

    const historyButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('View weekly history')
    )
    assert.ok(historyButton)
    await act(async () => {
      historyButton.dispatchEvent(
        new domWindow.MouseEvent('click', { bubbles: true }) as unknown as Event
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    assert.match(document.body.textContent, /Spent \$10/)
  })
})
