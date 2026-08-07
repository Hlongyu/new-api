import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApplication } from '../src/app.js'
import { NewApiError } from '../src/new-api-client.js'
import { periodKey, previousWeekRange } from '../src/time.js'

async function request(
  baseUrl,
  pathname,
  {
  body,
  method = 'GET',
  cookie = 'session=alice',
  userId = 42,
  csrf = method !== 'GET',
  } = {},
) {
  const headers = {}
  if (cookie)
    headers.Authorization = `Bearer ${cookie.replace(/^session=/, '')}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (csrf) headers['X-Leaderboard-Request'] = '1'
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = response.headers
    .get('content-type')
    ?.includes('application/json')
    ? await response.json()
    : null
  return { response, status: response.status, body: payload }
}

test('复用 New API 会话管理参榜状态并自动完成赞助扣费', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-app-'))
  const deductions = []
  let deductionMode = 'complete'
  const users = {
    'session=alice': {
      id: 42,
      username: 'alice',
      display_name: 'Alice',
      quota: 100_000_000,
      role: 1,
    },
    'session=root': {
      id: 1,
      username: 'root',
      display_name: 'Root',
      quota: 100_000_000,
      role: 100,
    },
  }
  const client = {
    async getSessionUser(authorization) {
      const user =
        users[`session=${String(authorization).replace(/^Bearer /, '')}`]
      if (!user) {
        throw new NewApiError('请先登录主站', 401)
      }
      return { ...user }
    },
    async getUser(userId) {
      return Object.values(users).find((user) => user.id === userId)
    },
    async decreaseUserQuota(userId, quota) {
      deductions.push({ userId, quota })
      if (deductionMode === 'timeout') throw new NewApiError('请求超时', 504)
      return true
    },
    async getPerfMetricsSummary(authorization) {
      assert.equal(authorization, 'Bearer alice')
      return {
        models: [
          {
            model_name: 'gpt-test',
            avg_latency_ms: 1200,
            success_rate: 99.5,
            avg_tps: 42,
            recent_success_rates: [100, 99],
          },
        ],
      }
    },
    async getPerfMetrics({ model }, authorization) {
      assert.equal(authorization, 'Bearer alice')
      assert.equal(model, 'gpt-test')
      return {
        model_name: 'gpt-test',
        groups: [
          {
            group: 'default',
            avg_ttft_ms: 300,
            avg_latency_ms: 1200,
            success_rate: 99.5,
            avg_tps: 42,
            series: [
              {
                ts: 1,
                avg_ttft_ms: 300,
                avg_latency_ms: 1200,
                success_rate: 99.5,
                avg_tps: 42,
              },
            ],
          },
        ],
      }
    },
  }
  const synchronizer = {
    getState() {
      return {
        configured: true,
        running: false,
        lastSyncAt: 0,
        lastSyncError: '',
      }
    },
    async sync() {
      return true
    },
    start() {},
    stop() {},
  }
  const config = {
    basePath: '/leaderboard',
    modelStatusBasePath: '/modelstatus',
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
    quotaPerUnit: 500_000,
    sponsorMinAmount: 1,
    sponsorMaxAmount: 1_000,
    sponsorBadgeActiveDays: 30,
    supportActivityActiveDays: 3,
    supportActivityStartTimestamp:
      Date.parse('2026-07-16T16:00:00.000Z') / 1000,
    rankSystemStartTimestamp: Date.parse('2026-07-17T16:00:00.000Z') / 1000,
    appGitCommit: '0123456789abcdef0123456789abcdef01234567',
    appDeployedAt: 1_785_830_400,
  }
  const application = createApplication(config, { client, synchronizer })
  await new Promise((resolve, reject) => {
    application.server.once('error', reject)
    application.server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`

  try {
    const guestPage = await request(baseUrl, '/leaderboard/', { cookie: '' })
    assert.equal(guestPage.status, 404)
    assert.equal(guestPage.body.message, '接口不存在')

    const guestApi = await request(baseUrl, '/leaderboard/api/me', {
      cookie: '',
    })
    assert.equal(guestApi.status, 401)

    const page = await request(baseUrl, '/leaderboard/')
    assert.equal(page.status, 404)

    const appStatus = await request(baseUrl, '/leaderboard/api/app/status')
    assert.equal(appStatus.status, 200)
    assert.deepEqual(appStatus.body.data.version, {
      commit: '0123456789abcdef0123456789abcdef01234567',
      deployedAt: 1_785_830_400,
    })

    const modelsPage = await request(baseUrl, '/modelstatus/')
    assert.equal(modelsPage.status, 404)

    const health = await request(baseUrl, '/healthz', { cookie: '' })
    assert.equal(health.status, 200)
    assert.deepEqual(health.body.data, {
      service: 'new-api-companion',
      version: {
        commit: '0123456789abcdef0123456789abcdef01234567',
        deployedAt: 1_785_830_400,
      },
    })

    const guestModelsApi = await request(baseUrl, '/modelstatus/api/summary', {
      cookie: '',
    })
    assert.equal(guestModelsApi.status, 401)

    const modelSummary = await request(baseUrl, '/modelstatus/api/summary')
    assert.equal(modelSummary.status, 200)
    assert.equal(modelSummary.body.data.models[0].model_name, 'gpt-test')

    const modelMetrics = await request(
      baseUrl,
      '/modelstatus/api/metrics?model=gpt-test',
    )
    assert.equal(modelMetrics.status, 200)
    assert.equal(modelMetrics.body.data.groups[0].group, 'default')

    const me = await request(baseUrl, '/leaderboard/api/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.data.id, 42)
    assert.equal(me.body.data.entry.isNamePublic, false)
    assert.equal(me.body.data.balanceUsd, 200)
    assert.equal(me.body.data.supportActivity.points, 0)
    assert.equal(me.body.data.supportActivity.activeUntil, 0)

    const rejectedCsrf = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      csrf: false,
      body: { participating: false },
    })
    assert.equal(rejectedCsrf.status, 403)

    const rejectedLongName = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: {
        displayName:
          '这是一个超过三十六个字符的展示名称用于验证后端限制确实生效请务必拒绝保存啊',
        isNamePublic: true,
      },
    })
    assert.equal(rejectedLongName.status, 400)

    const updated = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: {
        displayName: '公开名称',
        isNamePublic: true,
        participating: true,
      },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.entry.currentName, '公开名称')

    const entry = application.db.getEntryByUserId(42)
    const now = new Date()
    for (const [periodType, key] of [
      ['all', 'all'],
      ['day', periodKey('day', { now, timeZone: config.timeZone })],
    ]) {
      application.db.upsertAggregate({
        entryId: entry.id,
        periodType,
        periodKey: key,
        tokenUsed: 100,
        quota: 1,
        requestCount: 2,
        updatedAt: Math.floor(now.getTime() / 1000),
      })
    }

    const board = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=day',
    )
    assert.equal(board.body.data.entries[0].displayName, '公开名称')
    assert.equal('userId' in board.body.data.entries[0], false)

    const sponsored = await request(baseUrl, '/leaderboard/api/sponsors', {
      method: 'POST',
      body: {
        requestKey: 'request_1234567890',
        amountCny: 30,
        message: '继续维护',
      },
    })
    assert.equal(sponsored.status, 201)
    assert.equal(sponsored.body.data.status, 'completed')
    assert.deepEqual(deductions, [{ userId: 42, quota: 15_000_000 }])

    const duplicate = await request(baseUrl, '/leaderboard/api/sponsors', {
      method: 'POST',
      body: {
        requestKey: 'request_1234567890',
        amountCny: 30,
      },
    })
    assert.equal(duplicate.status, 200)
    assert.equal(deductions.length, 1)

    const sponsorBoard = await request(
      baseUrl,
      '/leaderboard/api/sponsors?period=all',
    )
    assert.equal(sponsorBoard.body.data.entries[0].amountCny, 30)
    assert.equal(sponsorBoard.body.data.entries[0].displayName, '公开名称')
    assert.equal('id' in sponsorBoard.body.data.entries[0], false)

    const sponsoredUsageBoard = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=day',
    )
    assert.equal(sponsoredUsageBoard.body.data.entries[0].isSponsor, true)
    assert.deepEqual(sponsoredUsageBoard.body.data.entries[0].sponsorBadge, {
      key: 'platinum',
      name: '白金',
    })
    assert.equal(
      'supportPoints' in sponsoredUsageBoard.body.data.entries[0],
      false,
    )
    assert.equal(
      'supportTier' in sponsoredUsageBoard.body.data.entries[0],
      false,
    )
    assert.equal(
      'supportLit' in sponsoredUsageBoard.body.data.entries[0],
      false,
    )
    assert.equal(
      typeof sponsoredUsageBoard.body.data.entries[0].rankLabel,
      'string',
    )
    assert.equal('rankScore' in sponsoredUsageBoard.body.data.entries[0], false)
    assert.equal(
      'rankSegmentScore' in sponsoredUsageBoard.body.data.entries[0],
      false,
    )
    assert.equal(
      'inPromotion' in sponsoredUsageBoard.body.data.entries[0],
      false,
    )

    const rankBoard = await request(baseUrl, '/leaderboard/api/ranks')
    assert.equal(rankBoard.status, 200)
    assert.equal(rankBoard.body.data.entries[0].displayName, '公开名称')
    assert.equal(typeof rankBoard.body.data.entries[0].rankLabel, 'string')
    assert.equal('rankValue' in rankBoard.body.data.entries[0], false)
    assert.equal('rankScore' in rankBoard.body.data.entries[0], false)
    assert.equal('pendingScore' in rankBoard.body.data.entries[0], false)
    assert.equal('promotion' in rankBoard.body.data.entries[0], false)
    assert.deepEqual(rankBoard.body.data.entries[0].sponsorBadge, {
      key: 'platinum',
      name: '白金',
    })

    const sponsoredMe = await request(baseUrl, '/leaderboard/api/me')
    assert.deepEqual(sponsoredMe.body.data.sponsorBadge, {
      key: 'platinum',
      name: '白金',
      points: 300,
      amountCny: 30,
      threshold: 250,
    })
    assert.equal(sponsoredMe.body.data.supportActivity.sponsorAmountCny, 30)
    assert.equal(sponsoredMe.body.data.supportActivity.sponsorCount, 1)
    assert.equal(sponsoredMe.body.data.supportActivity.sponsorPoints, 150)
    assert.equal(sponsoredMe.body.data.supportActivity.points, 150)
    assert.equal(sponsoredMe.body.data.supportActivity.tier, 'gold')
    assert.equal(sponsoredMe.body.data.supportActivity.lit, true)
    assert.equal(sponsoredMe.body.data.supportActivity.expiredDays, 0)
    assert.equal(
      sponsoredMe.body.data.supportActivity.activeUntil,
      sponsoredMe.body.data.supportActivity.lastActiveAt + 3 * 86_400,
    )

    const oldSponsorEntryId = application.db.createEntry({
      userId: 43,
      username: 'bob',
      displayName: '过期赞助',
      createdAt: 1,
    })
    for (const [periodType, key] of [
      ['all', 'all'],
      ['day', periodKey('day', { now, timeZone: config.timeZone })],
    ]) {
      application.db.upsertAggregate({
        entryId: oldSponsorEntryId,
        periodType,
        periodKey: key,
        tokenUsed: 80,
        quota: 1,
        requestCount: 1,
        updatedAt: Math.floor(now.getTime() / 1000),
      })
    }
    const oldCompletedAt = Math.floor(Date.now() / 1000) - 35 * 86_400
    application.db.createSponsorOrder({
      id: 'old-sponsor-order',
      requestKey: 'old_sponsor_request',
      userId: 43,
      entryId: oldSponsorEntryId,
      amountCny: 80,
      quotaAmount: 40_000_000,
      displayAnonymously: false,
      message: '',
      operatorUserId: 1,
      createdAt: oldCompletedAt - 1,
    })
    application.db.finishSponsorOrder(
      'old-sponsor-order',
      'completed',
      '',
      oldCompletedAt,
    )

    const expiredSponsorBoard = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=day',
    )
    const expiredSponsor = expiredSponsorBoard.body.data.entries.find(
      (row) => row.displayName === '过期赞助',
    )
    assert.deepEqual(expiredSponsor.sponsorBadge, {
      key: 'black-gold',
      name: '黑金',
    })

    const anonymized = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: { isNamePublic: false },
    })
    assert.equal(anonymized.status, 200)
    assert.equal(anonymized.body.data.entry.isNamePublic, false)
    assert.equal(anonymized.body.data.supportActivity.sponsorAmountCny, 30)
    assert.equal(anonymized.body.data.supportActivity.points, 150)

    const anonymousUsageBoard = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=day',
    )
    assert.match(
      anonymousUsageBoard.body.data.entries[0].displayName,
      /^匿名用户 /,
    )
    assert.equal(anonymousUsageBoard.body.data.entries[0].isSponsor, false)
    assert.equal(anonymousUsageBoard.body.data.entries[0].sponsorBadge, null)
    assert.equal(anonymousUsageBoard.body.data.entries[0].showRankBadge, true)

    const anonymousSponsorBoard = await request(
      baseUrl,
      '/leaderboard/api/sponsors?period=all',
    )
    const anonymousSponsor = anonymousSponsorBoard.body.data.entries.find(
      (row) => row.amountCny === 30,
    )
    assert.equal(anonymousSponsor.displayName, '匿名赞助者')

    deductionMode = 'timeout'
    const uncertain = await request(baseUrl, '/leaderboard/api/sponsors', {
      method: 'POST',
      body: {
        requestKey: 'request_abcdefghij',
        amountCny: 10,
      },
    })
    assert.equal(uncertain.status, 202)
    assert.equal(uncertain.body.data.status, 'unknown')

    // 异常订单不再有独立端点：/admin/sponsors 返回全部订单，由前端把
    // failed/unknown 排到最前。这里断言未确认的那笔确实在里面。
    const deniedSponsors = await request(
      baseUrl,
      '/leaderboard/api/admin/sponsors',
    )
    assert.equal(deniedSponsors.status, 403)
    const rootSponsors = await request(
      baseUrl,
      '/leaderboard/api/admin/sponsors',
      {
      cookie: 'session=root',
      userId: 1,
      },
    )
    assert.equal(rootSponsors.status, 200)
    const unknownOrder = rootSponsors.body.data.orders.find(
      (order) => order.status === 'unknown',
    )
    assert.ok(unknownOrder, '未确认订单应出现在管理员视图中')
    assert.equal(unknownOrder.userId, 42)
  } finally {
    await new Promise((resolve) => application.server.close(resolve))
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('每周消费金额榜前三可按名次奖池抽奖，历史机会可累计领取', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'leaderboard-lottery-'),
  )
  const grants = []
  let grantMode = 'complete'
  const users = {
    'session=root': { id: 1, username: 'root', display_name: 'Root', quota: 1 },
    'session=alice': {
      id: 42,
      username: 'alice',
      display_name: 'Alice',
      quota: 1,
    },
    'session=bob': { id: 43, username: 'bob', display_name: 'Bob', quota: 1 },
    'session=carol': {
      id: 44,
      username: 'carol',
      display_name: 'Carol',
      quota: 1,
    },
  }
  const client = {
    async getSessionUser(authorization) {
      const user =
        users[`session=${String(authorization).replace(/^Bearer /, '')}`]
      if (!user) {
        throw new NewApiError('请先登录主站', 401)
      }
      return { ...user }
    },
    async increaseUserQuota(userId, quota) {
      if (grantMode === 'timeout') throw new NewApiError('请求超时', 504)
      grants.push({ userId, quota })
      return true
    },
  }
  const synchronizer = {
    getState() {
      return {
        configured: true,
        running: false,
        lastSyncAt: 0,
        lastSyncError: '',
      }
    },
    async sync() {
      return true
    },
    start() {},
    stop() {},
  }
  const config = {
    basePath: '/leaderboard',
    modelStatusBasePath: '/modelstatus',
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
    quotaPerUnit: 500_000,
    sponsorMinAmount: 1,
    sponsorMaxAmount: 1_000,
    sponsorBadgeActiveDays: 30,
    supportActivityActiveDays: 3,
    supportActivityStartTimestamp: 1,
    rankSystemStartTimestamp: 1,
    lotteryEnabled: true,
    lotteryPrizes: [
      [{ amountUsd: 5, weight: 1 }],
      [{ amountUsd: 2, weight: 1 }],
    ],
  }
  const application = createApplication(config, { client, synchronizer })
  await new Promise((resolve, reject) => {
    application.server.once('error', reject)
    application.server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`

  try {
    await request(baseUrl, '/leaderboard/api/me')
    await request(baseUrl, '/leaderboard/api/me', {
      cookie: 'session=bob',
      userId: 43,
    })
    await request(baseUrl, '/leaderboard/api/me', {
      cookie: 'session=carol',
      userId: 44,
    })

    const weekKey = previousWeekRange({ timeZone: config.timeZone }).key
    const previousWeekKey = '2026-07-13'
    const updatedAt = Math.floor(Date.now() / 1000)
    for (const [userId, tokenUsed, quota] of [
      [42, 1000, 300],
      [43, 5000, 100],
      [44, 100, 200],
    ]) {
      const entry = application.db.getEntryByUserId(userId)
      for (const [periodType, key] of [
        ['all', 'all'],
        ['week', weekKey],
      ]) {
        application.db.upsertAggregate({
          entryId: entry.id,
          periodType,
          periodKey: key,
          tokenUsed,
          quota,
          requestCount: 2,
          updatedAt,
        })
      }
    }
    const aliceEntry = application.db.getEntryByUserId(42)
    application.db.upsertAggregate({
      entryId: aliceEntry.id,
      periodType: 'week',
      periodKey: previousWeekKey,
      tokenUsed: 10,
      quota: 400,
      requestCount: 1,
      updatedAt,
    })

    const bobView = await request(baseUrl, '/leaderboard/api/lottery', {
      cookie: 'session=bob',
      userId: 43,
    })
    assert.equal(bobView.status, 200)
    assert.equal(bobView.body.data.periodKey, weekKey)
    assert.equal(bobView.body.data.winners.length, 2)
    assert.equal(bobView.body.data.winners[0].rank, 1)
    assert.equal(bobView.body.data.winners[0].isMe, false)
    assert.match(bobView.body.data.winners[0].displayName, /^匿名用户 /)
    assert.equal(bobView.body.data.winners[1].isMe, false)
    assert.equal(bobView.body.data.me, null)
    assert.equal(bobView.body.data.canDraw, false)
    assert.equal(bobView.body.data.isRoot, false)
    assert.equal('userId' in bobView.body.data.winners[0], false)
    assert.equal('tokenUsed' in bobView.body.data.winners[0], false)
    assert.equal('quota' in bobView.body.data.winners[0], false)
    assert.equal('amountUsd' in bobView.body.data.winners[0], false)
    assert.equal('requestCount' in bobView.body.data.winners[0], false)
    assert.equal(bobView.body.data.weeklyHistory.length, 2)
    assert.equal(bobView.body.data.weeklyHistory[0].periodKey, weekKey)
    assert.equal(bobView.body.data.weeklyHistory[0].winners.length, 2)
    assert.equal(bobView.body.data.weeklyHistory[1].periodKey, previousWeekKey)
    assert.equal(bobView.body.data.weeklyHistory[1].winners.length, 1)
    assert.equal(
      'amountUsd' in bobView.body.data.weeklyHistory[0].winners[0],
      false,
    )

    const bobEntry = application.db.getEntryByUserId(43)
    application.db.upsertAggregate({
      entryId: bobEntry.id,
      periodType: 'week',
      periodKey: weekKey,
      tokenUsed: 50_000,
      quota: 10_000,
      requestCount: 20,
      updatedAt: updatedAt + 1,
    })
    const frozenView = await request(baseUrl, '/leaderboard/api/lottery', {
      cookie: 'session=bob',
      userId: 43,
    })
    assert.deepEqual(
      frozenView.body.data.winners.map((winner) => winner.displayName),
      bobView.body.data.winners.map((winner) => winner.displayName),
    )
    assert.equal(frozenView.body.data.me, null)

    grantMode = 'timeout'
    const carolDraw = await request(baseUrl, '/leaderboard/api/lottery/draw', {
      method: 'POST',
      cookie: 'session=carol',
      userId: 44,
      body: {},
    })
    assert.equal(carolDraw.status, 202)
    assert.equal(carolDraw.body.data.status, 'unknown')
    assert.equal(carolDraw.body.data.periodKey, weekKey)
    assert.equal(carolDraw.body.data.rank, 2)
    assert.equal(carolDraw.body.data.amountUsd, 2)
    assert.deepEqual(grants, [])

    const rootView = await request(baseUrl, '/leaderboard/api/lottery', {
      cookie: 'session=root',
      userId: 1,
    })
    assert.equal(rootView.status, 200)
    assert.equal(rootView.body.data.isRoot, true)
    assert.equal(rootView.body.data.winners[0].tokenUsed, 1000)
    assert.equal(rootView.body.data.winners[0].quota, 300)
    assert.equal(rootView.body.data.winners[0].amountUsd, 0.0006)
    assert.equal(rootView.body.data.winners[0].requestCount, 2)
    assert.equal(
      rootView.body.data.weeklyHistory[0].winners[0].amountUsd,
      0.0006,
    )
    assert.equal(rootView.body.data.adminIssues.length, 1)
    assert.equal(rootView.body.data.adminIssues[0].id, carolDraw.body.data.id)
    assert.equal(rootView.body.data.adminIssues[0].userId, 44)

    const deniedResolution = await request(
      baseUrl,
      `/leaderboard/api/admin/lottery/${carolDraw.body.data.id}`,
      {
        method: 'PATCH',
        cookie: 'session=bob',
        userId: 43,
        body: { resolution: 'failed' },
      },
    )
    assert.equal(deniedResolution.status, 403)

    const resolved = await request(
      baseUrl,
      `/leaderboard/api/admin/lottery/${carolDraw.body.data.id}`,
      {
        method: 'PATCH',
        cookie: 'session=root',
        userId: 1,
        body: { resolution: 'failed' },
      },
    )
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.data.status, 'failed')

    grantMode = 'complete'
    const carolRetry = await request(baseUrl, '/leaderboard/api/lottery/draw', {
      method: 'POST',
      cookie: 'session=carol',
      userId: 44,
      body: {},
    })
    assert.equal(carolRetry.status, 201)
    assert.equal(carolRetry.body.data.status, 'completed')
    assert.deepEqual(grants, [{ userId: 44, quota: 1_000_000 }])

    const carolView = await request(baseUrl, '/leaderboard/api/lottery', {
      cookie: 'session=carol',
      userId: 44,
    })
    assert.equal(carolView.body.data.me.rank, 2)
    assert.equal(carolView.body.data.canDraw, false)

    const bobDrawn = await request(baseUrl, '/leaderboard/api/lottery/draw', {
      method: 'POST',
      cookie: 'session=bob',
      userId: 43,
      body: {},
    })
    assert.equal(bobDrawn.status, 403)
    assert.equal(grants.length, 1)

    const publicAlice = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: {
        displayName: 'Alice Draw',
        isNamePublic: true,
      },
    })
    assert.equal(publicAlice.status, 200)

    const aliceDrawn = await request(baseUrl, '/leaderboard/api/lottery/draw', {
      method: 'POST',
      body: {},
    })
    assert.equal(aliceDrawn.status, 201)
    assert.equal(aliceDrawn.body.data.periodKey, previousWeekKey)
    assert.equal(aliceDrawn.body.data.rank, 1)
    assert.equal(aliceDrawn.body.data.amountUsd, 5)
    assert.equal(aliceDrawn.body.data.displayName, 'Alice Draw')
    assert.deepEqual(grants.at(-1), { userId: 42, quota: 2_500_000 })

    const aliceSecondDrawn = await request(
      baseUrl,
      '/leaderboard/api/lottery/draw',
      {
      method: 'POST',
      body: {},
      },
    )
    assert.equal(aliceSecondDrawn.status, 201)
    assert.equal(aliceSecondDrawn.body.data.periodKey, weekKey)
    assert.equal(aliceSecondDrawn.body.data.rank, 1)
    assert.equal(aliceSecondDrawn.body.data.amountUsd, 5)
    assert.equal(grants.length, 3)

    const duplicate = await request(baseUrl, '/leaderboard/api/lottery/draw', {
      method: 'POST',
      body: {},
    })
    assert.equal(duplicate.status, 403)
    assert.equal(grants.length, 3)

    const hiddenAlice = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: { isNamePublic: false },
    })
    assert.equal(hiddenAlice.status, 200)

    const drawnView = await request(baseUrl, '/leaderboard/api/lottery')
    assert.equal(drawnView.body.data.canDraw, false)
    assert.equal(drawnView.body.data.me.draw.status, 'completed')
    assert.equal(drawnView.body.data.winners[0].draw.amountUsd, 5)
    assert.equal(drawnView.body.data.winners[0].displayName, 'Alice Draw')
    assert.equal(drawnView.body.data.winners[1].draw.amountUsd, 2)
    assert.equal(drawnView.body.data.weeklyHistory.length, 2)
    assert.equal(
      drawnView.body.data.weeklyHistory[0].winners[0].draw.amountUsd,
      5,
    )
    assert.equal(
      drawnView.body.data.weeklyHistory[0].winners[1].draw.amountUsd,
      2,
    )
    assert.equal(
      drawnView.body.data.weeklyHistory[1].winners[0].draw.amountUsd,
      5,
    )
    assert.equal(
      drawnView.body.data.weeklyHistory[0].winners[0].displayName,
      'Alice Draw',
    )
    assert.match(
      drawnView.body.data.weeklyHistory[0].winners[1].displayName,
      /^匿名用户 /,
    )
  } finally {
    await new Promise((resolve) => application.server.close(resolve))
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('用户可分榜单隐藏，周榜抽奖按真实消费计算，改名卡控制额外改名', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'leaderboard-privacy-'),
  )
  const deductions = []
  const users = {
    'session=alice': {
      id: 42,
      username: 'alice',
      display_name: 'Alice',
      quota: 100_000_000,
      role: 1,
    },
    'session=root': {
      id: 1,
      username: 'root',
      display_name: 'Root',
      quota: 100_000_000,
      role: 100,
    },
  }
  const client = {
    async getSessionUser(authorization) {
      const user =
        users[`session=${String(authorization).replace(/^Bearer /, '')}`]
      if (!user) {
        throw new NewApiError('请先登录主站', 401)
      }
      return { ...user }
    },
    async getUser(userId) {
      return Object.values(users).find((user) => user.id === userId)
    },
    async decreaseUserQuota(userId, quota) {
      deductions.push({ userId, quota })
      return true
    },
  }
  const synchronizer = {
    getState() {
      return {
        configured: true,
        running: false,
        lastSyncAt: 0,
        lastSyncError: '',
      }
    },
    async sync() {
      return true
    },
    start() {},
    stop() {},
  }
  const config = {
    basePath: '/leaderboard',
    modelStatusBasePath: '/modelstatus',
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
    quotaPerUnit: 500_000,
    sponsorMinAmount: 1,
    sponsorMaxAmount: 1_000,
    sponsorBadgeActiveDays: 30,
    supportActivityActiveDays: 3,
    supportActivityStartTimestamp: 1,
    rankSystemStartTimestamp: 1,
    lotteryEnabled: true,
    lotteryPrizes: [[{ amountUsd: 1, weight: 1 }]],
  }
  const application = createApplication(config, { client, synchronizer })
  await new Promise((resolve, reject) => {
    application.server.once('error', reject)
    application.server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`

  try {
    await request(baseUrl, '/leaderboard/api/me')

    const updated = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: {
        displayName: 'Alice One',
        isNamePublic: true,
        visibility: {
          participateDay: true,
          participateWeek: false,
          participateMonth: false,
          participateAll: false,
          participateRank: false,
          showRankBadge: false,
        },
      },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.rename.freeUsed, true)
    assert.equal(updated.body.data.entry.visibility.participateWeek, false)
    assert.equal(updated.body.data.entry.visibility.showRankBadge, false)

    const entry = application.db.getEntryByUserId(42)
    const now = new Date()
    const previousWeekKey = previousWeekRange({
      timeZone: config.timeZone,
    }).key
    for (const [periodType, key] of [
      ['all', 'all'],
      ['day', periodKey('day', { now, timeZone: config.timeZone })],
      ['week', previousWeekKey],
    ]) {
      application.db.upsertAggregate({
        entryId: entry.id,
        periodType,
        periodKey: key,
        tokenUsed: 1_000,
        quota: 1_500_000,
        requestCount: 3,
        updatedAt: Math.floor(now.getTime() / 1000),
      })
    }

    const dayBoard = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=day',
    )
    assert.equal(dayBoard.body.data.entries.length, 1)
    assert.equal(dayBoard.body.data.entries[0].displayName, 'Alice One')
    assert.equal(dayBoard.body.data.entries[0].showRankBadge, false)

    const weekBoard = await request(
      baseUrl,
      '/leaderboard/api/leaderboard?period=week',
    )
    assert.equal(weekBoard.body.data.entries.length, 0)

    const rankBoard = await request(baseUrl, '/leaderboard/api/ranks')
    assert.equal(rankBoard.body.data.entries.length, 0)

    const lottery = await request(baseUrl, '/leaderboard/api/lottery')
    assert.equal(lottery.status, 200)
    assert.equal(lottery.body.data.winners.length, 1)
    assert.match(lottery.body.data.winners[0].displayName, /^匿名用户 /)
    assert.equal(lottery.body.data.me.rank, 1)

    const deniedRename = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: { displayName: 'Alice Two' },
    })
    assert.equal(deniedRename.status, 402)

    const cardOrder = await request(baseUrl, '/leaderboard/api/rename-cards', {
      method: 'POST',
      body: { requestKey: 'rename_card_request_1', quantity: 2 },
    })
    assert.equal(cardOrder.status, 201)
    assert.equal(cardOrder.body.data.status, 'completed')
    assert.deepEqual(deductions, [{ userId: 42, quota: 1_000_000 }])

    const paidRename = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      body: { displayName: 'Alice Two' },
    })
    assert.equal(paidRename.status, 200)
    assert.equal(paidRename.body.data.entry.displayName, 'Alice Two')
    assert.equal(paidRename.body.data.rename.cardBalance, 1)
    assert.equal(paidRename.body.data.rankProgress.renameScore, 4)

    const duplicateCardOrder = await request(
      baseUrl,
      '/leaderboard/api/rename-cards',
      {
      method: 'POST',
      body: { requestKey: 'rename_card_request_1', quantity: 2 },
      },
    )
    assert.equal(duplicateCardOrder.status, 200)
    assert.equal(deductions.length, 1)
    const afterDuplicate = await request(baseUrl, '/leaderboard/api/me')
    assert.equal(afterDuplicate.body.data.rankProgress.renameScore, 4)

    users['session=alice'].quota = 500_000
    const insufficientCardOrder = await request(
      baseUrl,
      '/leaderboard/api/rename-cards',
      {
      method: 'POST',
      body: { requestKey: 'rename_card_request_2', quantity: 2 },
      },
    )
    assert.equal(insufficientCardOrder.status, 400)
    assert.equal(insufficientCardOrder.body.message, '账户余额不足')
    assert.equal(deductions.length, 1)
    assert.equal(
      application.db.getRenameCardOrderByRequestKey('rename_card_request_2'),
      null,
    )
    const afterInsufficient = await request(baseUrl, '/leaderboard/api/me')
    assert.equal(afterInsufficient.body.data.rename.cardBalance, 1)
    assert.equal(afterInsufficient.body.data.rankProgress.renameScore, 4)

    // Root 没有改名豁免：同样是每周一次免费槽，用完就得买改名卡。
    const rootFirstRename = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      cookie: 'session=root',
      userId: 1,
      body: { displayName: 'Root One', isNamePublic: true },
    })
    assert.equal(rootFirstRename.status, 200)
    assert.equal(rootFirstRename.body.data.rename.freeUsed, true)
    assert.equal(rootFirstRename.body.data.rename.cardBalance, 0)

    const rootSecondRename = await request(baseUrl, '/leaderboard/api/me', {
      method: 'PATCH',
      cookie: 'session=root',
      userId: 1,
      body: { displayName: 'Root Two' },
    })
    assert.equal(rootSecondRename.status, 402)
  } finally {
    await new Promise((resolve) => application.server.close(resolve))
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
