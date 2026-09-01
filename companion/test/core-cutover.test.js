import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createApplication } from '../src/app.js'
import { loadConfig } from '../src/config.js'

test('Core 接管后不启动旧排行榜和充值抽奖任务', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'core-cutover-'))
  const calls = { syncStart: 0, postpaidStart: 0, lotteryStart: 0 }
  const synchronizer = {
    start() { calls.syncStart += 1 },
    stop() {},
    getState() { return {} },
    async sync() { return false },
  }
  const postpaidService = {
    start() { calls.postpaidStart += 1 },
    stop() {},
    getState() { return {} },
  }
  const config = loadConfig({
    DATABASE_PATH: path.join(directory, 'leaderboard.db'),
    CORE_LEADERBOARD_ENABLED: 'true',
    CORE_RECHARGE_LOTTERY_ENABLED: 'true',
    BASE_PATH: '/leaderboard',
  })
  const application = createApplication(config, {
    synchronizer,
    postpaidService,
    lotterySite: {
      start() { calls.lotteryStart += 1 },
      close() {},
      async handleApi() {
        throw new Error('Core-owned recharge lottery API must not run here')
      },
    },
    client: {
      async getSessionUser() {
        throw new Error('Core-owned leaderboard API must not authenticate here')
      },
    },
  })

  try {
    application.start()
    assert.deepEqual(calls, { syncStart: 0, postpaidStart: 0, lotteryStart: 0 })

    await new Promise((resolve, reject) => {
      application.server.once('error', reject)
      application.server.listen(0, '127.0.0.1', resolve)
    })
    const address = application.server.address()
    const response = await fetch(
      `http://127.0.0.1:${address.port}/leaderboard/api/me`,
    )
    assert.equal(response.status, 410)
    assert.equal((await response.json()).success, false)

    const lotteryResponse = await fetch(
      `http://127.0.0.1:${address.port}/lottery/api/status`,
    )
    assert.equal(lotteryResponse.status, 410)
    assert.equal((await lotteryResponse.json()).success, false)
  } finally {
    if (application.server.listening) {
      await new Promise((resolve) => application.server.close(resolve))
    }
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
