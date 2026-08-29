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
  'localStorage',
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
        'Applied extra multiplier': 'Applied extra multiplier',
        'Body param': 'Body param',
        'Conditional multipliers': 'Conditional multipliers',
        Matched: 'Matched',
        'Not matched': 'Not matched',
        'Tiered price table': 'Tiered price table',
      },
    },
  },
})

const { DynamicPricingBreakdown } = await import('../dynamic-pricing-breakdown')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RenderedBreakdown = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderBreakdown(
  props: React.ComponentProps<typeof DynamicPricingBreakdown>
): Promise<RenderedBreakdown> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <DynamicPricingBreakdown {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountBreakdown(rendered: RenderedBreakdown) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

describe('dynamic pricing conditional multipliers', () => {
  after(() => domWindow.close())

  test('shows the applied product and each condition result from the log', async () => {
    const rendered = await renderBreakdown({
      compact: true,
      billingExpr:
        '(tier("base", p * 2)) * (param("service_tier") == "fast" ? 2 : 1) * (param("priority") == "high" ? 0.5 : 1)',
      matchedTierLabel: 'base',
      requestMultiplier: 2,
      conditionalMultipliers: [
        { index: 0, multiplier: 2, matched: true },
        { index: 1, multiplier: 0.5, matched: false },
      ],
    })

    const applied = rendered.container.querySelector(
      '[data-applied-multiplier="2"]'
    )
    const matched = rendered.container.querySelector(
      '[data-conditional-multiplier-index="0"]'
    )
    const unmatched = rendered.container.querySelector(
      '[data-conditional-multiplier-index="1"]'
    )

    assert.ok(applied)
    assert.equal(applied.textContent?.includes('2x'), true)
    assert.equal(matched?.getAttribute('data-matched'), 'true')
    assert.equal(matched?.textContent?.includes('Matched'), true)
    assert.equal(unmatched?.getAttribute('data-matched'), 'false')
    assert.equal(unmatched?.textContent?.includes('Not matched'), true)

    await unmountBreakdown(rendered)
  })

  test('keeps legacy logs neutral when runtime results are absent', async () => {
    const rendered = await renderBreakdown({
      compact: true,
      billingExpr:
        '(tier("base", p * 2)) * (param("service_tier") == "fast" ? 2 : 1)',
      matchedTierLabel: 'base',
    })

    const rule = rendered.container.querySelector(
      '[data-conditional-multiplier-index="0"]'
    )
    assert.equal(rule?.hasAttribute('data-matched'), false)
    assert.equal(
      rendered.container.querySelector('[data-applied-multiplier]'),
      null
    )

    await unmountBreakdown(rendered)
  })
})
