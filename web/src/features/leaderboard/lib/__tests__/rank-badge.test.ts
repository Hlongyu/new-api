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

import { resolveTierBadge, showsTierBadge } from '../rank-badge'

describe('resolveTierBadge', () => {
  test('resolves a Chinese board label to its badge asset', () => {
    const badge = resolveTierBadge({ label: '黄金 I' })
    assert.deepEqual(badge, {
      src: '/rank-badges/04-huangjin-i.png',
      tierKey: 'gold',
      division: 'I',
      tierLabelKey: 'Gold',
    })
  })

  test('resolves every tier and division the service can emit', () => {
    const cases: [string, string][] = [
      ['黑铁 IV', '/rank-badges/01-heitie-iv.png'],
      ['青铜 III', '/rank-badges/02-qingtong-iii.png'],
      ['白银 II', '/rank-badges/03-baiyin-ii.png'],
      ['铂金 I', '/rank-badges/05-bojin-i.png'],
      ['钻石 IV', '/rank-badges/06-zuanshi-iv.png'],
      ['大师 III', '/rank-badges/07-dashi-iii.png'],
      ['宗师 II', '/rank-badges/08-zongshi-ii.png'],
      ['王者 I', '/rank-badges/09-wangzhe-i.png'],
    ]
    for (const [label, src] of cases) {
      assert.equal(resolveTierBadge({ label })?.src, src, label)
    }
  })

  test('prefers structured fields over the label when both are present', () => {
    const badge = resolveTierBadge({
      label: '黄金 I',
      tierKey: 'silver',
      division: 'IV',
    })
    assert.equal(badge?.src, '/rank-badges/03-baiyin-iv.png')
    assert.equal(badge?.tierLabelKey, 'Silver')
  })

  test('collapses irregular whitespace in the label', () => {
    assert.equal(
      resolveTierBadge({ label: '  黄金   I ' })?.src,
      '/rank-badges/04-huangjin-i.png'
    )
  })

  test('returns null for tiers the client does not know yet', () => {
    assert.equal(resolveTierBadge({ label: '传奇 I' }), null)
    assert.equal(resolveTierBadge({ tierKey: 'legend', division: 'I' }), null)
  })

  test('returns null for malformed or missing input', () => {
    assert.equal(resolveTierBadge({ label: '黄金' }), null)
    assert.equal(resolveTierBadge({ label: '黄金 V' }), null)
    assert.equal(resolveTierBadge({ label: '黄金 I 额外' }), null)
    assert.equal(resolveTierBadge({ label: '' }), null)
    assert.equal(resolveTierBadge({ label: null }), null)
    assert.equal(resolveTierBadge({}), null)
  })

  test('returns null when only one structured field is supplied', () => {
    assert.equal(resolveTierBadge({ tierKey: 'gold' }), null)
    assert.equal(resolveTierBadge({ division: 'I' }), null)
  })
})

describe('showsTierBadge', () => {
  test('treats a missing flag as opted in, matching the service', () => {
    assert.equal(showsTierBadge(undefined), true)
  })

  test('hides the badge only on an explicit false', () => {
    assert.equal(showsTierBadge(false), false)
    assert.equal(showsTierBadge(true), true)
  })
})
