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

const [html, styles, appSource] = await Promise.all([
  readFile(new URL('../public/lottery/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/lottery/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/lottery/app.js', import.meta.url), 'utf8'),
])

test('充值抽奖顶部只保留返回入口并在右侧显示货币与工具', () => {
  const topbar = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] ?? ''

  assert.doesNotMatch(topbar, /lottery-navigation/)
  assert.match(topbar, /class="currency-balance top-currency-balance"/)
  assert.match(topbar, /id="balance"/)
  assert.match(topbar, /id="rulesButton"/)
})

test('充值抽奖底部仅居中显示单抽与十连抽', () => {
  const deck = html.match(/<section class="control-deck"[\s\S]*?<\/section>/)?.[0] ?? ''
  const deckRule = styles.match(/\.control-deck \{([^}]*)\}/)?.[1] ?? ''

  assert.equal(deck.match(/class="wish-action /g)?.length, 2)
  assert.doesNotMatch(deck, /currency-balance/)
  assert.doesNotMatch(deck, /redemption-progress/)
  assert.match(deckRule, /grid-template-columns:\s*repeat\(2,\s*216px\)/)
})

test('问号弹窗列出当前兑换进度与奖项概率', () => {
  const rulesDialog = html.match(/<dialog id="rulesDialog"[\s\S]*?<\/dialog>/)?.[0] ?? ''

  assert.match(html, /id="rulesButton"[^>]*aria-label="进度与概率"/)
  assert.match(rulesDialog, /class="drawer rules-drawer"/)
  assert.match(rulesDialog, /id="redemptionProgressSection"/)
  assert.match(rulesDialog, />当前进度</)
  assert.match(rulesDialog, />奖项概率</)
})

test('兑换进度只控制问号弹窗中的进度区域', () => {
  const renderProgress = appSource.match(
    /function renderRedemptionProgress\(\) \{([\s\S]*?)\n\}\n\nfunction renderStatus/,
  )?.[1] ?? ''

  assert.match(renderProgress, /redemptionProgressSection\.hidden/)
  assert.doesNotMatch(renderProgress, /controlDeck/)
  assert.doesNotMatch(renderProgress, /document\.body/)
})

test('问号弹窗使用与两套背景协调的半透明表面', () => {
  const baseRule = styles.match(/\.rules-drawer \{([^}]*)\}/)?.[1] ?? ''
  const starlightRule = styles.match(
    /:root\[data-theme="starlight"\] \.rules-drawer \{([^}]*)\}/,
  )?.[1] ?? ''

  assert.match(baseRule, /background:\s*rgba\(/)
  assert.match(baseRule, /backdrop-filter:\s*blur\(/)
  assert.match(starlightRule, /background:\s*rgba\(/)
  assert.match(starlightRule, /backdrop-filter:\s*blur\(/)
})

test('祈愿演出与结果期间隐藏常驻界面且不显示点击提示', () => {
  const cinematicRule = styles.match(
    /body:is\(\.is-opening, \.has-results\) \.topbar,\s*body:is\(\.is-opening, \.has-results\) \.control-deck \{([^}]*)\}/,
  )?.[1] ?? ''
  const runDraw = appSource.match(/async function runDraw\(count\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const tapHandler = appSource.match(
    /elements\.wishTap\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\)/,
  )?.[1] ?? ''

  assert.match(cinematicRule, /opacity:\s*0/)
  assert.match(cinematicRule, /visibility:\s*hidden/)
  assert.match(cinematicRule, /pointer-events:\s*none/)
  assert.doesNotMatch(html, /id="wishHint"/)
  assert.doesNotMatch(appSource, /点击返回|点击继续|已跳过演出|跳过演出|星轨展开/)
  assert.match(runDraw, /classList\.add\('is-opening'\)[\s\S]*await api/)
  assert.match(tapHandler, /wish\?\.advance\(\)/)
  assert.match(tapHandler, /skipPlayback\(\)/)
})
