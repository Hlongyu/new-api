/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const styles = await readFile(
  new URL('../public/lottery/styles.css', import.meta.url),
  'utf8',
)

test('充值抽奖顶部状态栏在明亮与暗黑风格下均保持透明', () => {
  const baseRule = styles.match(/\.topbar \{([^}]*)\}/)?.[1]
  const starlightRule = styles.match(
    /:root\[data-theme="starlight"\] \.topbar \{([^}]*)\}/,
  )?.[1]

  assert.match(baseRule ?? '', /background:\s*transparent/)
  assert.match(baseRule ?? '', /backdrop-filter:\s*none/)
  assert.match(starlightRule ?? '', /background:\s*transparent/)
  assert.match(starlightRule ?? '', /box-shadow:\s*none/)
  assert.match(starlightRule ?? '', /backdrop-filter:\s*none/)
})
