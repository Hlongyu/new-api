import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDatabase } from '../src/db.js'
import { UsageSynchronizer } from '../src/sync.js'
import { periodKey, previousWeekRange } from '../src/time.js'

function config() {
  return {
    baseUrl: 'https://new-api.example.com',
    rootAccessToken: 'root-access-token',
    rootUserId: 1,
    timeZone: 'Asia/Shanghai',
    allStartTimestamp: 1,
    excludedUserIds: [],
    syncIntervalMs: 300_000,
  }
}

test('root 用户列表补充名称但只同步产生过用量的用户', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-sync-'))
  const db = createDatabase(path.join(directory, 'test.db'))
  try {
    const flowRanges = []
    const client = {
      async getUsers() {
        return [
          { id: 7, username: 'alice', display_name: 'Alice' },
          { id: 999, username: 'admin', display_name: '' },
          { id: 123, username: 'zero', display_name: '零用量用户' },
        ]
      },
      async getFlow(start, end) {
        flowRanges.push({ start, end })
        return [
          { user_id: 7, token_id: 101, token_used: 120, quota: 400_000, count: 2 },
          { user_id: 7, token_id: 102, token_used: 80, quota: 100_000, count: 1 },
          { user_id: 999, token_id: 999, token_used: 50_000, quota: 9_000_000, count: 20 },
        ]
      },
    }
    const settings = config()
    const synchronizer = new UsageSynchronizer({ db, client, config: settings })

    assert.equal(await synchronizer.sync(), true)
    const completedWeek = previousWeekRange({ timeZone: settings.timeZone })
    assert.equal(flowRanges.length, 5)
    assert.deepEqual(flowRanges.at(-1), {
      start: completedWeek.start,
      end: completedWeek.end,
    })
    assert.equal(db.getSetting('last_finalized_week_key'), completedWeek.key)
    assert.ok(db.getLotteryWeekUpdatedAt(completedWeek.key) >= completedWeek.end)
    const entries = db.listEntries()
    assert.equal(entries.length, 2)
    assert.ok(entries.every((entry) => entry.is_name_public === 0))
    assert.ok(entries.every((entry) => /^匿名用户 [A-F0-9]{10}$/.test(entry.anonymous_name)))
    assert.equal(entries.find((entry) => entry.user_id === 7).source_name, 'Alice')
    assert.equal(entries.some((entry) => entry.user_id === 123), false)

    const key = periodKey('day', { timeZone: settings.timeZone })
    const rows = db.listLeaderboard('day', key)
    const user7 = rows.find((row) => row.user_id === 7)
    assert.equal(user7.token_used, 200)
    assert.equal(user7.request_count, 3)
    assert.equal(user7.public_name, entries.find((entry) => entry.user_id === 7).anonymous_name)

    const originalAliases = new Map(entries.map((entry) => [entry.user_id, entry.anonymous_name]))
    assert.equal(await synchronizer.sync(), true)
    assert.equal(flowRanges.length, 9)
    for (const entry of db.listEntries()) {
      assert.equal(entry.anonymous_name, originalAliases.get(entry.user_id))
    }
    assert.equal(db.getSetting('last_sync_error'), '')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('root 流量数据缺少 user_id 时拒绝写入', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-sync-'))
  const db = createDatabase(path.join(directory, 'test.db'))
  try {
    const client = {
      async getUsers() {
        return []
      },
      async getFlow() {
        return [{ token_id: 101, token_used: 120, quota: 400_000, count: 2 }]
      },
    }
    const synchronizer = new UsageSynchronizer({ db, client, config: config() })

    await assert.rejects(() => synchronizer.sync(), /未返回 user_id/)
    assert.match(db.getSetting('last_sync_error'), /未返回 user_id/)
    assert.equal(db.listEntries().length, 0)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
