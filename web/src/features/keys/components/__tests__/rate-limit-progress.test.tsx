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
        'Reset time: {{time}}': 'Reset time: {{time}}',
        'Reset time: starts after first use':
          'Reset time: starts after first use',
      },
    },
  },
})

const { ApiKeyRateLimitProgress } =
  await import('../api-key-rate-limit-progress')
const { formatTimestampToDate } = await import('@/lib/format')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RenderedProgress = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderProgress(
  props: React.ComponentProps<typeof ApiKeyRateLimitProgress>
): Promise<RenderedProgress> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <ApiKeyRateLimitProgress {...props} />
      </I18nextProvider>
    )
  })

  return { container, root }
}

async function unmountProgress(rendered: RenderedProgress) {
  await act(async () => rendered.root.unmount())
  rendered.container.remove()
}

describe('API key rate-limit progress', () => {
  after(() => domWindow.close())

  test('shows the backend-provided reset time for an active window', async () => {
    const resetAt = 1_800_000_000
    const rendered = await renderProgress({
      used: 25,
      limit: 100,
      resetAt,
    })

    assert.equal(
      rendered.container.textContent?.includes(
        `Reset time: ${formatTimestampToDate(resetAt)}`
      ),
      true
    )

    await unmountProgress(rendered)
  })

  test('explains that an unused window starts on first use', async () => {
    const rendered = await renderProgress({
      used: 0,
      limit: 100,
      resetAt: 0,
    })

    assert.equal(
      rendered.container.textContent?.includes(
        'Reset time: starts after first use'
      ),
      true
    )

    await unmountProgress(rendered)
  })
})
