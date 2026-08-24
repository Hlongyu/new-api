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
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'
import type React from 'react'

const domWindow = new Window()
const domGlobals = [
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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Settlement Details': 'Settlement Details',
        'Funding Source': 'Funding Source',
        'Total Cost': 'Total Cost',
        'Deducted by subscription': 'Deducted by subscription',
        'Deducted from wallet': 'Deducted from wallet',
        'Subscription + Wallet': 'Subscription + Wallet',
        Subscription: 'Subscription',
        Wallet: 'Wallet',
      },
    },
  },
})

const { SettlementDetails } = await import('../dialogs/settlement-details')
const { formatLogQuota } = await import('@/lib/format')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RenderedDetails = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderDetails(
  props: React.ComponentProps<typeof SettlementDetails>
): Promise<RenderedDetails> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <SettlementDetails {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountDetails(rendered: RenderedDetails) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

describe('usage log settlement details', () => {
  after(() => domWindow.close())

  test('shows total, subscription, and wallet amounts for hybrid settlement', async () => {
    const rendered = await renderDetails({
      quota: 26838,
      other: {
        billing_source: 'hybrid',
        subscription_consumed: 21745,
        wallet_quota_deducted: 5093,
      },
    })
    const text = rendered.container.textContent ?? ''

    assert.equal(text.includes('Settlement Details'), true)
    assert.equal(text.includes('Subscription + Wallet'), true)
    assert.equal(text.includes(formatLogQuota(26838)), true)
    assert.equal(text.includes(formatLogQuota(21745)), true)
    assert.equal(text.includes(formatLogQuota(5093)), true)

    await unmountDetails(rendered)
  })

  test('shows both sides explicitly for wallet-only settlement', async () => {
    const rendered = await renderDetails({
      quota: 43,
      other: {
        billing_source: 'wallet',
        wallet_quota_deducted: 43,
      },
    })
    const text = rendered.container.textContent ?? ''

    assert.equal(text.includes('Wallet'), true)
    assert.equal(text.includes('Deducted by subscription'), true)
    assert.equal(text.includes('Deducted from wallet'), true)

    await unmountDetails(rendered)
  })

  test('does not render settlement details for legacy logs without allocation data', async () => {
    const rendered = await renderDetails({ quota: 100, other: {} })

    assert.equal(
      rendered.container.querySelector('[data-settlement-details="true"]'),
      null
    )

    await unmountDetails(rendered)
  })
})
