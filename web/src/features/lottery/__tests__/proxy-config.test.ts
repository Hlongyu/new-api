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

import createRsbuildConfig from '../../../../rsbuild.config'

test('充值抽奖代理将写请求来源改写为目标服务来源', () => {
  const previousLotteryUrl = process.env.VITE_LOTTERY_URL
  process.env.VITE_LOTTERY_URL = 'http://127.0.0.1:8792'

  try {
    const config = createRsbuildConfig({
      command: 'dev',
      env: 'development',
      envMode: 'development',
    })
    const proxy = config.server?.proxy
    assert.ok(proxy && !Array.isArray(proxy))
    assert.deepEqual(Reflect.get(proxy, '/lottery'), {
      target: 'http://127.0.0.1:8792',
      changeOrigin: true,
      headers: { Origin: 'http://127.0.0.1:8792' },
    })
  } finally {
    if (previousLotteryUrl === undefined) {
      delete process.env.VITE_LOTTERY_URL
    } else {
      process.env.VITE_LOTTERY_URL = previousLotteryUrl
    }
  }
})
