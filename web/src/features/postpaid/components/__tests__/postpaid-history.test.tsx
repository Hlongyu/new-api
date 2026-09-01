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

import type { PostpaidEvent, PostpaidGrant } from '../../types'

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
const { PostpaidHistory } = await import('../postpaid-history')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

let cleanup: (() => Promise<void>) | null = null

function grant(index: number): PostpaidGrant {
  return {
    id: `grant-${index}`,
    tierKey: 'bronze',
    tierName: 'Bronze',
    creditAmount: index,
    quotaAmount: index * 500_000,
    outstandingAmount: index,
    status: 'active',
    createdAt: 1_700_000_000 + index,
    updatedAt: 1_700_000_000 + index,
    dueAt: 1_800_000_000,
    completedAt: 0,
  }
}

function repayment(overrides: Partial<PostpaidEvent> = {}): PostpaidEvent {
  return {
    id: 'repayment-1',
    grantId: 'grant-1',
    type: 'repayment',
    redemptionId: 7,
    redemptionTime: 1_700_000_500,
    amount: 1,
    outstandingBefore: 1,
    outstandingAfter: 0,
    status: 'completed',
    createdAt: 1_700_000_500,
    updatedAt: 1_700_000_500,
    ...overrides,
  }
}

async function renderHistory(grants: PostpaidGrant[], events: PostpaidEvent[]) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <PostpaidHistory grants={grants} events={events} />
      </I18nextProvider>
    )
  })

  const trigger = container.querySelector('button')
  assert.ok(trigger)
  await act(async () => trigger.click())

  cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return container
}

describe('postpaid history', () => {
  afterEach(async () => {
    await cleanup?.()
    cleanup = null
  })
  after(() => domWindow.close())

  test('shows every credit record supplied by Core', async () => {
    const container = await renderHistory(
      Array.from({ length: 7 }, (_, index) => grant(index + 1)),
      []
    )

    assert.equal(container.querySelectorAll('li').length, 7)
  })

  test('labels the exact borrowing and repayment timestamps', async () => {
    const borrowedAt = 1_700_000_001
    const repaidAt = 1_700_000_500
    const container = await renderHistory([grant(1)], [repayment()])
    const text = container.textContent ?? ''

    assert.equal(
      text.includes(
        `Borrowed at ${new Date(borrowedAt * 1000).toLocaleString()}`
      ),
      true,
      text
    )
    assert.equal(
      text.includes(`Repaid at ${new Date(repaidAt * 1000).toLocaleString()}`),
      true,
      text
    )
  })

  test('shows drawdowns and repayments in one newest-first timeline', async () => {
    const olderDraw = grant(1)
    const newerDraw = {
      ...grant(3),
      createdAt: 1_700_000_700,
      updatedAt: 1_700_000_700,
    }
    const middleRepayment = repayment()
    const container = await renderHistory(
      [olderDraw, newerDraw],
      [middleRepayment]
    )
    const lists = container.querySelectorAll('ul')
    const rows = [...container.querySelectorAll('li')].map(
      (row) => row.textContent ?? ''
    )

    assert.equal(lists.length, 1)
    assert.equal(rows.length, 3)
    assert.equal(rows[0]?.includes('+3'), true, rows.join('\n'))
    assert.equal(rows[1]?.includes('−1'), true, rows.join('\n'))
    assert.equal(rows[2]?.includes('+1'), true, rows.join('\n'))
  })

  test('groups one redemption across internal loan allocations', async () => {
    const container = await renderHistory(
      [],
      [
        repayment({ id: 'repayment-1', amount: 1, grantId: 'grant-1' }),
        repayment({ id: 'repayment-2', amount: 2, grantId: 'grant-2' }),
      ]
    )
    const rows = [...container.querySelectorAll('li')]

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.textContent?.includes('−3'), true)
  })
})
