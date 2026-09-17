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

import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import type { UsageLog } from '../../data/schema'
import { formatModelName } from '../../lib/format'
import { ModelBadge } from '../model-badge'

const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })

for (const [name, responseModel, differs] of [
  ['different response', 'gpt-returned', true],
  ['same response', 'gpt-requested', false],
  ['legacy log', undefined, false],
  ['long response name', `gpt-${'snapshot'.repeat(30)}`, true],
] as const) {
  test(`${name}: displays a difference only when a returned model differs`, () => {
    const model = formatModelName({
      model_name: 'gpt-requested',
      other: JSON.stringify({ response_model_name: responseModel }),
    } as UsageLog)
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ModelBadge
          modelName={model.name}
          responseModel={model.responseModel}
        />
      </I18nextProvider>
    )
    assert.equal(html.includes('Response model differs from request'), differs)
    assert.equal(html.includes('aria-haspopup="dialog"'), differs)
    if (differs) {
      assert.ok(responseModel)
      assert.ok(html.includes(responseModel))
    }
  })
}

test('mapped request: retains mapping and shows the separately returned model', () => {
  const model = formatModelName({
    model_name: 'gpt-requested',
    other: JSON.stringify({
      is_model_mapped: true,
      upstream_model_name: 'gpt-mapped',
      response_model_name: 'gpt-mapped',
    }),
  } as UsageLog)
  assert.equal(model.actualModel, 'gpt-mapped')
  assert.equal(model.responseModel, 'gpt-mapped')
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ModelBadge
        modelName={model.name}
        actualModel={model.actualModel}
        responseModel={model.responseModel}
      />
    </I18nextProvider>
  )
  assert.ok(html.includes('Response model differs from request'))
  assert.ok(html.includes('gpt-mapped'))
})
