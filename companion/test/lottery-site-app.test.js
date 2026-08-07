import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApplication } from '../src/app.js'
import { NewApiError } from '../src/new-api-client.js'

async function api(baseUrl, pathname, {
  body,
  method = 'GET',
  cookie = 'session=alice',
  userId = 42,
} = {}) {
  const headers = { Authorization: `Bearer ${cookie.replace(/^session=/, '')}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-Leaderboard-Request'] = '1'
  const response = await fetch(`${baseUrl}/lottery${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  return { status: response.status, body: payload }
}

test('root 配置活动发放次数，用户模拟或真实抽奖并异步获得合并订阅', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-site-app-'))
  const users = [
    { id: 1, username: 'root', display_name: 'Root', role: 100, status: 1 },
    { id: 42, username: 'alice', display_name: 'Alice', role: 1, status: 1 },
    { id: 43, username: 'disabled', role: 1, status: 0 },
  ]
  const plans = []
  const subscriptions = new Map([[42, []]])
  const redemptions = []
  let createdPlans = 0
  let createdSubscriptions = 0
  const client = {
    async getSessionUser(authorization) {
      const expected = authorization === 'Bearer root' ? 1 : 42
      if (!['Bearer root', 'Bearer alice'].includes(authorization)) {
        throw new NewApiError('请先登录主站', 401)
      }
      return { ...users.find((user) => user.id === expected) }
    },
    async getUsers() { return users.map((user) => ({ ...user })) },
    async listRedeemedCodes() { return redemptions.map((item) => ({ ...item })) },
    async listSubscriptionPlans() { return plans.map((plan) => ({ ...plan })) },
    async createSubscriptionPlan(plan) {
      createdPlans += 1
      const saved = { ...plan, enabled: true, sort_order: -10_000, id: 100 + createdPlans }
      plans.push(saved)
      return saved
    },
    async updateSubscriptionPlan(planId, plan) {
      const index = plans.findIndex((item) => item.id === planId)
      const saved = { ...plan, id: planId }
      plans[index] = saved
      return saved
    },
    async listUserSubscriptions(userId) {
      return (subscriptions.get(userId) || []).map((item) => ({ ...item }))
    },
    async createUserSubscription(userId, planId) {
      createdSubscriptions += 1
      const saved = {
        id: 200 + createdSubscriptions,
        plan_id: planId,
        start_time: Math.floor(Date.now() / 1000),
      }
      const list = subscriptions.get(userId) || []
      list.push(saved)
      subscriptions.set(userId, list)
      return saved
    },
  }
  const synchronizer = { start() {}, stop() {}, getState() { return {} }, async sync() {} }
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
    quotaPerUnit: 500_000,
    sponsorMinAmount: 1,
    sponsorMaxAmount: 1_000,
    sponsorBadgeActiveDays: 30,
    supportActivityActiveDays: 3,
    supportActivityStartTimestamp: 1,
    rankSystemStartTimestamp: 1,
    lotteryFulfillmentIntervalMs: 60_000,
    lotteryRedemptionIntervalMs: 60_000,
  }
  const application = createApplication(config, { client, synchronizer })
  await new Promise((resolve, reject) => {
    application.server.once('error', reject)
    application.server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${application.server.address().port}`
  const now = Math.floor(Date.now() / 1000)

  try {
    const permanent = application.lotteryDb.getDefaultCampaign()
    assert.equal(permanent.name, '赤月回响')
    assert.equal(Number(permanent.is_permanent), 1)
    redemptions.push({ id: 1, usedUserId: 1, redeemedTime: now, quota: 250 * config.quotaPerUnit })
    await application.lotterySite.syncRedemptionRewards()
    assert.equal(application.lotteryDb.getBalance(permanent.id, 1), 2)
    assert.equal(application.lotteryDb.getBalance(permanent.id, 42), 0)
    const rootStatus = await api(baseUrl, '/api/status', {
      cookie: 'session=root', userId: 1,
    })
    assert.equal(rootStatus.body.data.redemptionProgress.grantedDraws, 2)
    assert.equal(rootStatus.body.data.redemptionProgress.observedUsd, 250)
    assert.equal(rootStatus.body.data.redemptionProgress.remainderUsd, 50)
    assert.equal(rootStatus.body.data.redemptionProgress.remainingUsd, 50)
    assert.equal(rootStatus.body.data.redemptionProgress.progressRatio, 0.5)
    const emptyAliceStatus = await api(baseUrl, '/api/status')
    assert.equal(emptyAliceStatus.body.data.redemptionProgress.grantedDraws, 0)
    assert.equal(emptyAliceStatus.body.data.redemptionProgress.observedUsd, 0)
    assert.equal(emptyAliceStatus.body.data.redemptionProgress.remainingUsd, 100)
    await application.lotterySite.syncRedemptionRewards()
    assert.equal(application.lotteryDb.getBalance(permanent.id, 1), 2)
    redemptions.push({ id: 2, usedUserId: 1, redeemedTime: now, quota: 50 * config.quotaPerUnit })
    redemptions.push({ id: 3, usedUserId: 42, redeemedTime: now, quota: 160 * config.quotaPerUnit })
    await application.lotterySite.syncRedemptionRewards()
    assert.equal(application.lotteryDb.getBalance(permanent.id, 1), 3)
    assert.equal(application.lotteryDb.getBalance(permanent.id, 42), 1)
    const aliceStatus = await api(baseUrl, '/api/status')
    assert.equal(aliceStatus.body.data.redemptionProgress.grantedDraws, 1)
    assert.equal(aliceStatus.body.data.redemptionProgress.observedUsd, 160)
    assert.equal(aliceStatus.body.data.redemptionProgress.remainderUsd, 60)
    assert.equal(aliceStatus.body.data.redemptionProgress.remainingUsd, 40)
    await application.lotterySite.syncRedemptionRewards()
    assert.equal(application.lotteryDb.getBalance(permanent.id, 42), 1)
    const progressStats = application.lotteryDb.getRedemptionProgressStats()
    assert.equal(progressStats.user_count, 2)
    assert.equal(progressStats.observed_quota, 460 * config.quotaPerUnit)
    assert.equal(progressStats.redemption_count, 3)
    assert.equal(progressStats.granted_draws, 4)
    assert.ok(progressStats.updated_at >= now)

    const dashboard = await api(baseUrl, '/api/admin/dashboard', {
      cookie: 'session=root', userId: 1,
    })
    assert.equal(dashboard.body.data.redemption.userCount, 2)
    assert.equal(dashboard.body.data.redemption.observedUsd, 460)
    assert.equal(dashboard.body.data.redemption.grantedDraws, 4)

    const page = await fetch(`${baseUrl}/lottery/`)
    assert.equal(page.status, 404)
    assert.equal((await page.json()).message, '接口不存在')
    assert.match(page.headers.get('content-type'), /application\/json/)

    const created = await api(baseUrl, '/api/admin/campaigns', {
      method: 'POST', cookie: 'session=root', userId: 1,
      body: {
        name: '深夜宝库测试', startsAt: now - 60, endsAt: now + 3600,
        prizes: [
          { amountUsd: 1, weight: 1, rarity: 'common' },
          { amountUsd: 2, weight: 1, rarity: 'rare' },
        ],
      },
    })
    assert.equal(created.status, 201)
    const campaignId = created.body.data.id

    const published = await api(baseUrl, `/api/admin/campaigns/${campaignId}/publish`, {
      method: 'POST', cookie: 'session=root', userId: 1, body: {},
    })
    assert.equal(published.status, 200)

    const poolStatus = await api(baseUrl, `/api/status?campaign_id=${campaignId}`)
    assert.equal(poolStatus.status, 200)
    assert.equal(poolStatus.body.data.campaign.id, campaignId)
    assert.equal(poolStatus.body.data.campaigns.some((item) => item.isDefault), true)
    assert.equal(poolStatus.body.data.campaigns.length, 2)
    assert.equal(poolStatus.body.data.redemptionProgress.grantedDraws, 1)

    const grant = await api(baseUrl, '/api/admin/grants', {
      method: 'POST', cookie: 'session=root', userId: 1,
      body: {
        campaignId, quantity: 10, userIds: [1, 42, 43],
        note: '测试次数', requestKey: 'grant_request_integration',
      },
    })
    assert.equal(grant.status, 202)
    users[1].status = 0
    await application.lotterySite.processGrantBatch(grant.body.data.id)
    users[1].status = 1
    assert.equal(application.lotteryDb.getBalance(campaignId, 42), 10)
    assert.equal(application.lotteryDb.getBalance(campaignId, 1), 0)
    assert.equal(application.lotteryDb.getBalance(campaignId, 43), 0)

    const simulated = await api(baseUrl, '/api/simulate', {
      method: 'POST', body: { count: 10, campaignId },
    })
    assert.equal(simulated.status, 200)
    assert.equal(simulated.body.data.items.length, 10)
    assert.equal(application.lotteryDb.getBalance(campaignId, 42), 10)
    assert.equal(application.lotteryDb.listUserDraws(42).length, 0)

    const drawn = await api(baseUrl, '/api/draw', {
      method: 'POST', body: { count: 5, campaignId, requestKey: 'draw_request_integration' },
    })
    assert.equal(drawn.status, 201)
    assert.equal(drawn.body.data.items.length, 5)
    assert.equal(application.lotteryDb.getBalance(campaignId, 42), 5)

    const duplicate = await api(baseUrl, '/api/draw', {
      method: 'POST', body: { count: 5, campaignId, requestKey: 'draw_request_integration' },
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.data.id, drawn.body.data.id)
    assert.equal(application.lotteryDb.getBalance(campaignId, 42), 5)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await application.lotterySite.processFulfillments()
      if (application.lotteryDb.getDrawById(drawn.body.data.id).status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const completed = application.lotteryDb.getDrawById(drawn.body.data.id)
    assert.equal(completed.status, 'completed')
    assert.equal(createdPlans, 1)
    assert.equal(createdSubscriptions, 1)
    assert.equal(plans[0].duration_value, 7)
    assert.equal(plans[0].enabled, false)
    assert.equal(plans[0].sort_order, 0)
    assert.equal(plans[0].total_amount, completed.total_amount_usd * config.quotaPerUnit)
    assert.equal(subscriptions.get(42).length, 1)
  } finally {
    await new Promise((resolve) => application.server.close(resolve))
    application.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
