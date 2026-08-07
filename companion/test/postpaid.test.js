import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApplication } from '../src/app.js'
import { createDatabase } from '../src/db.js'
import { NewApiError } from '../src/new-api-client.js'
import {
  PostpaidService,
  postpaidCreditForTier,
  postpaidDueAt,
} from '../src/postpaid.js'
import { zonedDayKey } from '../src/time.js'

const quotaPerUnit = 500_000

async function apiRequest(baseUrl, pathname, {
  method = 'GET',
  token = 'alice',
  body,
} = {}) {
  const headers = { Authorization: `Bearer ${token}` }
  if (method !== 'GET') headers['X-Leaderboard-Request'] = '1'
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-postpaid-'))
  const db = createDatabase(path.join(directory, 'test.db'))
  const entryId = db.createEntry({
    userId: 42,
    username: 'alice',
    displayName: 'Alice',
    createdAt: 1,
  })
  const redemptions = [
    { id: 10, usedUserId: 42, redeemedTime: 90, quota: 20 * quotaPerUnit },
  ]
  const increases = []
  const decreases = []
  let now = 100
  let deductionError = null
  const client = {
    async listRedeemedCodes() {
      return redemptions.map((item) => ({ ...item }))
    },
    async listRedeemedCodesForUser(userId) {
      return redemptions.filter((item) => item.usedUserId === Number(userId))
    },
    async increaseUserQuota(userId, quota) {
      increases.push({ userId, quota })
      return true
    },
    async decreaseUserQuota(userId, quota) {
      decreases.push({ userId, quota })
      if (deductionError) throw deductionError
      return true
    },
  }
  const config = {
    baseUrl: 'https://new-api.example.com',
    rootAccessToken: 'root-token',
    rootUserId: 1,
    quotaPerUnit,
    timeZone: 'Asia/Shanghai',
  }
  const service = new PostpaidService({ db, client, config, now: () => now })
  return {
    db,
    entryId,
    redemptions,
    increases,
    decreases,
    service,
    setNow(value) { now = value },
    setDeductionError(value) { deductionError = value },
    close() {
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('段位映射为确认后的先用后付额度且仅黑铁 IV 为零', () => {
  assert.deepEqual(
    ['IV', 'III', 'II', 'I'].map((division) =>
      postpaidCreditForTier('iron', division)),
    [0, 10, 10, 10],
  )
  assert.equal(postpaidCreditForTier('iron'), 0)
  assert.deepEqual(
    ['bronze', 'silver', 'gold', 'platinum', 'diamond',
      'master', 'grandmaster', 'challenger'].map(postpaidCreditForTier),
    [50, 100, 200, 350, 500, 750, 1_100, 1_500],
  )
  // 还款截止是次月 15 日 23:59:59（东八区），即 UTC 的 15 日 15:59:59。
  assert.equal(
    postpaidDueAt(Date.parse('2026-08-04T04:00:00Z') / 1000, 'Asia/Shanghai'),
    Date.parse('2026-09-15T15:59:59Z') / 1000,
  )
  // 12 月申请跨年到次年 1 月，月份进位不能算错。
  assert.equal(
    postpaidDueAt(Date.parse('2026-12-15T02:00:00Z') / 1000, 'Asia/Shanghai'),
    Date.parse('2027-01-15T15:59:59Z') / 1000,
  )
})

test('旧版单笔额度索引会迁移为多笔申请索引', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-postpaid-index-'))
  const databasePath = path.join(directory, 'test.db')
  try {
    createDatabase(databasePath).close()
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      DROP INDEX idx_postpaid_user_processing;
      DROP INDEX idx_postpaid_redemption_grant;
      CREATE UNIQUE INDEX idx_postpaid_user_open
        ON postpaid_grants(user_id)
        WHERE status IN ('processing', 'active', 'overdue', 'unknown');
      CREATE UNIQUE INDEX idx_postpaid_redemption
        ON postpaid_events(redemption_id) WHERE redemption_id IS NOT NULL;
    `)
    legacy.close()

    createDatabase(databasePath).close()
    const migrated = new DatabaseSync(databasePath)
    const grantIndexes = migrated.prepare('PRAGMA index_list(postpaid_grants)').all()
      .map((row) => row.name)
    const eventIndexes = migrated.prepare('PRAGMA index_list(postpaid_events)').all()
      .map((row) => row.name)
    migrated.close()
    assert.equal(grantIndexes.includes('idx_postpaid_user_open'), false)
    assert.equal(grantIndexes.includes('idx_postpaid_user_processing'), true)
    assert.equal(eventIndexes.includes('idx_postpaid_redemption'), false)
    assert.equal(eventIndexes.includes('idx_postpaid_redemption_grant'), true)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('可分多次申请段位额度并用一个兑换码依次归还多笔账单', async () => {
  const value = fixture()
  try {
    const firstGrant = await value.service.grant({
      requestKey: 'postpaid-request-1',
      userId: 42,
      entryId: value.entryId,
      rankProgress: { tierKey: 'gold', tierName: '黄金' },
      amount: 60,
    })
    const secondGrant = await value.service.grant({
      requestKey: 'postpaid-request-2',
      userId: 42,
      entryId: value.entryId,
      rankProgress: { tierKey: 'gold', tierName: '黄金' },
      amount: 40,
    })
    assert.equal(firstGrant.status, 'active')
    assert.equal(firstGrant.credit_amount, 60)
    assert.equal(firstGrant.redemption_start_id, 10)
    assert.equal(secondGrant.status, 'active')
    assert.equal(secondGrant.credit_amount, 40)
    assert.equal(value.db.getPostpaidExposure(42), 100 * quotaPerUnit)
    assert.deepEqual(value.increases, [
      { userId: 42, quota: 60 * quotaPerUnit },
      { userId: 42, quota: 40 * quotaPerUnit },
    ])

    await assert.rejects(
      value.service.grant({
        requestKey: 'postpaid-request-over-limit',
        userId: 42,
        entryId: value.entryId,
        rankProgress: { tierKey: 'gold', tierName: '黄金' },
        amount: 101,
      }),
      { status: 400 },
    )

    value.setNow(110)
    value.redemptions.push({
      id: 11, usedUserId: 42, redeemedTime: 105, quota: 80 * quotaPerUnit,
    })
    await value.service.sync()
    assert.equal(value.db.getPostpaidGrant(firstGrant.id).status, 'settled')
    assert.equal(
      value.db.getPostpaidGrant(secondGrant.id).outstanding_quota,
      20 * quotaPerUnit,
    )
    assert.deepEqual(value.decreases, [
      { userId: 42, quota: 60 * quotaPerUnit },
      { userId: 42, quota: 20 * quotaPerUnit },
    ])
    assert.equal(value.db.listPostpaidEventsByRedemption(11).length, 2)

    value.setNow(120)
    value.redemptions.push({
      id: 12, usedUserId: 42, redeemedTime: 115, quota: 100 * quotaPerUnit,
    })
    await value.service.sync()
    const settled = value.db.getPostpaidGrant(secondGrant.id)
    assert.equal(settled.status, 'settled')
    assert.equal(settled.outstanding_quota, 0)
    assert.deepEqual(value.decreases, [
      { userId: 42, quota: 60 * quotaPerUnit },
      { userId: 42, quota: 20 * quotaPerUnit },
      { userId: 42, quota: 20 * quotaPerUnit },
    ])
    const events = value.db.listUserPostpaidEvents(42)
    assert.equal(events.length, 3)
    assert.deepEqual(
      events.map((event) => event.quota_amount).sort((a, b) => a - b),
      [20, 20, 60].map((amount) => amount * quotaPerUnit),
    )

    await value.service.sync()
    assert.equal(value.decreases.length, 3)
  } finally {
    value.close()
  }
})

test('管理员扣减超时后流水待核查且不会重复扣除', async () => {
  const value = fixture()
  try {
    const grant = await value.service.grant({
      requestKey: 'postpaid-request-timeout',
      userId: 42,
      entryId: value.entryId,
      rankProgress: { tierKey: 'bronze', tierName: '青铜' },
    })
    value.setNow(110)
    value.redemptions.push({
      id: 11, usedUserId: 42, redeemedTime: 105, quota: 50 * quotaPerUnit,
    })
    value.redemptions.push({
      id: 12, usedUserId: 42, redeemedTime: 106, quota: 50 * quotaPerUnit,
    })
    value.setDeductionError(new NewApiError('请求超时', 504))

    await value.service.sync()
    assert.equal(value.db.getPostpaidGrant(grant.id).outstanding_quota, 50 * quotaPerUnit)
    assert.equal(value.db.getPostpaidEventByRedemption(11).status, 'unknown')

    value.setDeductionError(null)
    await value.service.sync()
    assert.equal(value.decreases.length, 1)
    assert.equal(value.db.getPostpaidEventByRedemption(12), null)
    assert.equal(value.db.getPostpaidGrant(grant.id).outstanding_quota, 50 * quotaPerUnit)
  } finally {
    value.close()
  }
})

test('用户接口申请额度并向 Root 暴露申请与归还历史', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-postpaid-app-'))
  const redemptions = []
  const rankNow = Math.floor(Date.now() / 1000)
  const rankStart = rankNow - 3 * 86_400
  const users = {
    alice: { id: 42, username: 'alice', display_name: 'Alice', quota: 0 },
    root: { id: 1, username: 'root', display_name: 'Root', quota: 0 },
  }
  const client = {
    async getSessionUser(authorization) {
      return { ...users[String(authorization).replace(/^Bearer /, '')] }
    },
    async listRedeemedCodes() { return redemptions.map((item) => ({ ...item })) },
    async listRedeemedCodesForUser(userId) {
      return redemptions.filter((item) => item.usedUserId === Number(userId))
    },
    async increaseUserQuota(userId, quota) {
      const user = Object.values(users).find((item) => item.id === userId)
      user.quota += quota
      return true
    },
    async decreaseUserQuota(userId, quota) {
      const user = Object.values(users).find((item) => item.id === userId)
      user.quota -= quota
      return true
    },
  }
  const synchronizer = {
    getState() {
      return { configured: true, running: false, lastSyncAt: 0, lastSyncError: '' }
    },
    async sync() { return true },
    start() {},
    stop() {},
  }
  const config = {
    basePath: '/leaderboard',
    modelStatusBasePath: '/modelstatus',
    lotterySiteBasePath: '/lottery',
    publicUrl: '',
    baseUrl: 'https://new-api.example.com',
    rootAccessToken: 'root-token',
    rootUserId: 1,
    databasePath: path.join(directory, 'test.db'),
    requestTimeoutMs: 1_000,
    timeZone: 'Asia/Shanghai',
    allStartTimestamp: 1,
    excludedUserIds: [],
    syncIntervalMs: 300_000,
    quotaPerUnit,
    sponsorMinAmount: 1,
    sponsorMaxAmount: 1_000,
    supportActivityActiveDays: 3,
    supportActivityStartTimestamp: Math.floor(Date.now() / 1000) - 3_600,
    rankSystemStartTimestamp: rankStart,
    lotteryEnabled: false,
    lotteryPrizes: [],
  }
  const application = createApplication(config, { client, synchronizer })
  await new Promise((resolve, reject) => {
    application.server.once('error', reject)
    application.server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`

  try {
    const iron = await apiRequest(baseUrl, '/leaderboard/api/me')
    assert.equal(iron.body.data.postpaid.creditLimit, 0)
    assert.equal(iron.body.data.postpaid.canApply, false)

    const denied = await apiRequest(baseUrl, '/leaderboard/api/postpaid/apply', {
      method: 'POST',
      body: { requestKey: 'postpaid-web-request-iron' },
    })
    assert.equal(denied.status, 403)

    const entry = application.db.getEntryByUserId(42)
    for (const [timestamp, score] of [[rankStart, 80], [rankStart + 86_400, 5]]) {
      application.db.upsertAggregate({
        entryId: entry.id,
        periodType: 'day',
        periodKey: zonedDayKey(timestamp, config.timeZone),
        tokenUsed: 0,
        quota: score * quotaPerUnit,
        requestCount: 1,
        updatedAt: rankNow,
      })
    }

    const before = await apiRequest(baseUrl, '/leaderboard/api/me')
    assert.equal(before.body.data.rankProgress.tierKey, 'bronze')
    assert.equal(before.body.data.postpaid.creditLimit, 50)
    assert.equal(before.body.data.postpaid.availableCredit, 50)
    assert.equal(before.body.data.postpaid.outstandingAmount, 0)
    assert.equal(before.body.data.postpaid.canApply, true)

    const firstApplied = await apiRequest(baseUrl, '/leaderboard/api/postpaid/apply', {
      method: 'POST',
      body: { requestKey: 'postpaid-web-request-1', amount: 20 },
    })
    assert.equal(firstApplied.status, 201)
    assert.equal(firstApplied.body.data.creditAmount, 20)
    assert.equal(users.alice.quota, 20 * quotaPerUnit)

    const middle = await apiRequest(baseUrl, '/leaderboard/api/me')
    assert.equal(middle.body.data.postpaid.availableCredit, 30)
    assert.equal(middle.body.data.postpaid.outstandingAmount, 20)
    assert.equal(middle.body.data.postpaid.canApply, true)

    const secondApplied = await apiRequest(baseUrl, '/leaderboard/api/postpaid/apply', {
      method: 'POST',
      body: { requestKey: 'postpaid-web-request-2', amount: 15 },
    })
    assert.equal(secondApplied.status, 201)
    assert.equal(secondApplied.body.data.creditAmount, 15)
    assert.equal(users.alice.quota, 35 * quotaPerUnit)

    redemptions.push({
      id: 1,
      usedUserId: 42,
      redeemedTime: Math.floor(Date.now() / 1000),
      quota: 60 * quotaPerUnit,
    })
    users.alice.quota += 60 * quotaPerUnit
    await application.postpaidService.sync()
    assert.equal(users.alice.quota, 60 * quotaPerUnit)

    const after = await apiRequest(baseUrl, '/leaderboard/api/me')
    assert.equal(after.body.data.postpaid.activeGrant, null)
    assert.equal(after.body.data.postpaid.openGrants.length, 0)
    assert.equal(after.body.data.postpaid.availableCredit, 50)
    assert.equal(after.body.data.postpaid.outstandingAmount, 0)
    assert.equal(after.body.data.postpaid.grants.length, 2)
    assert.equal(after.body.data.postpaid.events.length, 2)
    assert.deepEqual(
      after.body.data.postpaid.events.map((event) => event.amount).sort((a, b) => a - b),
      [15, 20],
    )

    const admin = await apiRequest(baseUrl, '/leaderboard/api/admin/postpaid', {
      token: 'root',
    })
    assert.equal(admin.status, 200)
    assert.equal(admin.body.data.summary.grantCount, 2)
    assert.equal(admin.body.data.summary.grantedAmount, 35)
    assert.equal(admin.body.data.summary.repaidAmount, 35)
    assert.equal(admin.body.data.grants[0].displayName, 'Alice')
    assert.equal(admin.body.data.events[0].redemptionId, 1)
  } finally {
    await new Promise((resolve) => application.server.close(resolve))
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
