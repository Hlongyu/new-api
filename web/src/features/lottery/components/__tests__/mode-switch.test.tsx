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
import test from 'node:test'

import { renderToStaticMarkup } from 'react-dom/server'

import { LotteryModeSwitch } from '../lottery-mode-switch'

test('周榜页可在同一抽奖入口切换到充值抽奖', () => {
  const markup = renderToStaticMarkup(<LotteryModeSwitch />)

  assert.match(markup, /aria-label="抽奖类型"/)
  assert.match(markup, /aria-current="page"[^>]*>周榜抽奖</)
  assert.match(markup, /href="\/lottery\/"[^>]*>充值抽奖</)
  assert.doesNotMatch(markup, /target="_blank"/)
})

test('周榜页切换条与充值抽奖页保持居中和等宽尺寸', () => {
  const markup = renderToStaticMarkup(<LotteryModeSwitch />)

  assert.match(markup, /<nav[^>]*class="[^"]*justify-center[^"]*"/)
  assert.match(markup, /class="[^"]*h-9[^"]*max-w-\[236px\][^"]*"/)
  assert.match(markup, /class="[^"]*grid-cols-2[^"]*"/)
})

test('周榜页激活背景铺满与未激活项相同的外边界', () => {
  const markup = renderToStaticMarkup(<LotteryModeSwitch />)
  const activeItem = markup.match(/<span[^>]*aria-current="page"[^>]*>/)?.[0]

  assert.match(activeItem ?? '', /\bbg-clip-border\b/)
  assert.doesNotMatch(activeItem ?? '', /\bborder-0\b/)
})

test('本地预览链接可以携带测试用户身份', () => {
  const markup = renderToStaticMarkup(
    <LotteryModeSwitch rechargeHref='/lottery/?preview_user_id=42' />
  )

  assert.match(markup, /href="\/lottery\/\?preview_user_id=42"/)
})
