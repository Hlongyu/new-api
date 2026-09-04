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

const domWindow = new Window()
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const i18next = (await import('i18next')).default
const { initReactI18next } = await import('react-i18next')
await i18next.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})
const { CouponHistoryFilters } = await import('../coupon-history-filters')
const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active'>('all')

  return (
    <>
      <CouponHistoryFilters
        search={search}
        status={status}
        onSearchChange={setSearch}
        onStatusChange={(value) => {
          if (value === 'all' || value === 'active') setStatus(value)
        }}
      />
      <output data-testid='filter-state'>{`${status}:${search}`}</output>
    </>
  )
}

describe('coupon history filters', () => {
  after(() => domWindow.close())

  test('updates the visible status and search filters', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => root.render(<Harness />))
    const search = container.querySelector<HTMLInputElement>(
      '#coupon-history-search'
    )
    const status = container.querySelector<HTMLButtonElement>(
      'button[role="combobox"]'
    )
    assert.ok(search)
    assert.ok(status)
    const statusLabel = container.querySelector<HTMLLabelElement>(
      'label[for="coupon-history-status"]'
    )
    assert.ok(statusLabel)
    assert.equal(statusLabel.textContent, 'Status')
    assert.match(status.textContent || '', /All Status/)

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set
      assert.ok(valueSetter)
      valueSetter.call(search, 'batch-42')
      search.dispatchEvent(
        new domWindow.Event('input', { bubbles: true }) as unknown as Event
      )
    })
    await act(async () => status.click())
    const activeOption = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent?.includes('Active'))
    assert.ok(activeOption)
    await act(async () => activeOption.click())

    assert.equal(
      container.querySelector('[data-testid="filter-state"]')?.textContent,
      'active:batch-42'
    )

    await act(async () => root.unmount())
    container.remove()
  })
})
