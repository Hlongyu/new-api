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
import { test } from 'node:test'

import type { CellContext } from '@tanstack/react-table'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import type { UsageLog } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { UsageLogsProvider } from '../usage-logs-provider'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
function OwnerUserCell() {
  const columns = useCommonLogsColumns(false)
  const column = columns.find((item) => item.id === 'user')
  assert.ok(column)
  assert.equal(typeof column.cell, 'function')
  const Cell = column.cell as (
    context: CellContext<UsageLog, unknown>
  ) => ReactNode
  return (
    <Cell
      {...({ row: { original: { username: 'caller' } } } as CellContext<
        UsageLog,
        unknown
      >)}
    />
  )
}

test('personal log view shows the calling username without an administrator user-details action', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <UsageLogsProvider>
        <OwnerUserCell />
      </UsageLogsProvider>
    </I18nextProvider>
  )
  assert.match(html, /caller/)
  assert.doesNotMatch(html, /<button/)
})
