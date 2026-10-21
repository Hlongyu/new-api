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
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'

import { buildXXSwitchURL, getXXSwitchImportSchema } from '../xx-switch-import'

const t = ((key: string) => key) as TFunction
const schema = getXXSwitchImportSchema(t)
const provider = {
  name: 'New API',
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-test+&=中文',
  apiFormat: 'openai_responses' as const,
  models: '',
}

describe('XXSwitch import protocol', () => {
  test('encodes the complete key and emits only supported parameters', () => {
    const url = new URL(buildXXSwitchURL(schema.parse(provider)))
    assert.equal(url.protocol, 'xxswitch:')
    assert.equal(url.host, 'v1')
    assert.equal(url.pathname, '/import')
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      resource: 'provider',
      app: 'codex',
      name: 'New API',
      endpoint: 'https://api.example.com/v1',
      apiKey: provider.apiKey,
      apiFormat: 'openai_responses',
      enabled: 'false',
    })
  })

  for (const apiFormat of [
    'openai_responses',
    'openai_chat',
    'anthropic',
  ] as const) {
    for (const suffix of ['', '/', '/v1', '/v1/']) {
      test(`${apiFormat} normalizes ${suffix || 'no suffix'} and preserves the deployment path`, () => {
        const input = schema.parse({
          ...provider,
          apiFormat,
          baseUrl: `https://api.example.com/gateway${suffix}`,
        })
        const params = new URL(buildXXSwitchURL(input)).searchParams
        assert.equal(
          params.get('app'),
          apiFormat === 'anthropic' ? 'claude' : 'codex'
        )
        assert.equal(params.get('apiFormat'), apiFormat)
        assert.equal(
          params.get('endpoint'),
          apiFormat === 'anthropic'
            ? 'https://api.example.com/gateway'
            : 'https://api.example.com/gateway/v1'
        )
      })
    }
  }

  test('trims comma-separated models and preserves their order', () => {
    const input = schema.parse({
      ...provider,
      models: ' gpt-5, claude-sonnet-4-5, ,gpt-4.1 ',
    })
    assert.equal(
      new URL(buildXXSwitchURL(input)).searchParams.get('model'),
      'gpt-5,claude-sonnet-4-5,gpt-4.1'
    )
  })

  test('omits a blank model list instead of restricting models', () => {
    const input = schema.parse({ ...provider, models: ' , , ' })
    assert.equal(
      new URL(buildXXSwitchURL(input)).searchParams.has('model'),
      false
    )
  })

  for (const baseUrl of [
    'ftp://api.example.com',
    'https://user:pass@api.example.com',
    'https://api.example.com?key=x',
    'https://api.example.com#fragment',
    'https://a.example,https://b.example',
    'https://api.example.com?',
    'not a URL',
    'https://api.example.com/a b',
  ]) {
    test(`rejects invalid server address ${baseUrl}`, () => {
      assert.equal(schema.safeParse({ ...provider, baseUrl }).success, false)
    })
  }

  test('accepts 100 Unicode name characters and rejects empty or longer names', () => {
    assert.equal(
      schema.safeParse({ ...provider, name: '中'.repeat(100) }).success,
      true
    )
    assert.equal(
      schema.safeParse({ ...provider, name: '中'.repeat(101) }).success,
      false
    )
    assert.equal(schema.safeParse({ ...provider, name: ' ' }).success, false)
  })

  test('bounds complete keys by UTF-8 bytes and rejects missing keys', () => {
    assert.equal(
      schema.safeParse({ ...provider, apiKey: 'a'.repeat(4096) }).success,
      true
    )
    assert.equal(
      schema.safeParse({ ...provider, apiKey: 'a'.repeat(4097) }).success,
      false
    )
    assert.equal(
      schema.safeParse({ ...provider, apiKey: '中'.repeat(1366) }).success,
      false
    )
    assert.equal(schema.safeParse({ ...provider, apiKey: '' }).success, false)
  })

  test('accepts 100 models and rejects a larger list', () => {
    assert.equal(
      schema.safeParse({
        ...provider,
        models: Array(100).fill('gpt-5').join(','),
      }).success,
      true
    )
    assert.equal(
      schema.safeParse({
        ...provider,
        models: Array(101).fill('gpt-5').join(','),
      }).success,
      false
    )
  })

  test('rejects a link that exceeds 16 KiB after URL encoding', () => {
    assert.equal(
      schema.safeParse({ ...provider, models: '中'.repeat(1900) }).success,
      false
    )
  })
})
