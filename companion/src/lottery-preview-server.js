import fs from 'node:fs'
import path from 'node:path'
import { createApplication } from './app.js'

const port = Number(process.env.LOTTERY_PREVIEW_PORT || 8791)
const now = Math.floor(Date.now() / 1000)
const quotaPerUnit = 500_000
const users = [
  { id: 1, username: 'root', display_name: 'Root', role: 100, status: 1 },
  { id: 42, username: 'alice', display_name: '夜行者 Alice', role: 1, status: 1 },
]
const plans = []
const subscriptions = new Map()
const databasePath = process.env.LOTTERY_PREVIEW_DATABASE_PATH ||
  path.resolve(process.cwd(), 'data', 'preview-lottery.db')

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const client = {
  async getSessionUser(authorization) {
    const match = /^Preview (\d+)$/.exec(String(authorization || ''))
    const user = match && users.find((candidate) => candidate.id === Number(match[1]))
    if (!user) {
      const error = new Error('请先登录主站')
      error.status = 401
      throw error
    }
    return { ...user }
  },
  async getUsers() {
    return users.map((user) => ({ ...user }))
  },
  async listRedeemedCodes() {
    return [{
      id: 1,
      usedUserId: 42,
      redeemedTime: now - 300,
      quota: 160 * quotaPerUnit,
    }]
  },
  async listSubscriptionPlans() {
    return plans.map((plan) => ({ ...plan }))
  },
  async createSubscriptionPlan(plan) {
    const saved = { ...plan, enabled: true, id: plans.length + 101 }
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
    const list = subscriptions.get(userId) || []
    const saved = { id: list.length + 201, plan_id: planId, start_time: now }
    list.push(saved)
    subscriptions.set(userId, list)
    return saved
  },
}

const synchronizer = {
  start() {},
  stop() {},
  getState() {
    return { configured: false, running: false }
  },
  async sync() {
    return false
  },
}

const config = {
  port,
  basePath: '/leaderboard',
  modelStatusBasePath: '/modelstatus',
  lotterySiteBasePath: '/lottery',
  publicUrl: `http://127.0.0.1:${port}/lottery`,
  mainSiteUrl: 'http://127.0.0.1:5174',
  tlsCertPath: '',
  tlsKeyPath: '',
  baseUrl: 'http://127.0.0.1:5174',
  rootAccessToken: 'preview-root-token',
  rootUserId: 1,
  databasePath,
  requestTimeoutMs: 1_000,
  timeZone: 'Asia/Shanghai',
  syncIntervalMs: 300_000,
  allStartTimestamp: 1,
  excludedUserIds: [],
  quotaPerUnit,
  sponsorMinAmount: 1,
  sponsorMaxAmount: 1_000,
  sponsorBadgeActiveDays: 30,
  supportActivityActiveDays: 3,
  supportActivityStartTimestamp: 1,
  rankSystemStartTimestamp: 1,
  lotteryEnabled: true,
  lotteryPrizes: [],
  lotteryFulfillmentIntervalMs: 1_000,
  lotteryRedemptionIntervalMs: 60_000,
  postpaidSyncIntervalMs: 30_000,
  appGitCommit: 'local-preview',
  appDeployedAt: now,
}

const application = createApplication(config, { client, synchronizer })
await application.lotterySite.syncRedemptionRewards()

const campaign = application.lotteryDb.getDefaultCampaign()
const currentBalance = application.lotteryDb.getBalance(campaign.id, 42)
if (currentBalance < 12) {
  const batch = application.lotteryDb.createGrantBatch({
    id: `preview-grant-${now}`,
    requestKey: `preview_grant_${now}`,
    campaignId: campaign.id,
    kind: 'manual',
    quantityPerUser: 12 - currentBalance,
    userIds: [42],
    skipPreviouslyGranted: false,
    note: '本地预览次数',
    operatorUserId: 1,
    createdAt: now,
  })
  application.lotteryDb.applyGrantRecipient(batch, 42, now)
  application.lotteryDb.finishGrantBatch(batch.id, 'completed', 1, 1, '', now)
}

application.server.listen(port, '127.0.0.1', () => {
  application.start()
  console.log(`充值抽奖预览：http://127.0.0.1:${port}/lottery/?preview_user_id=42`)
})

function shutdown() {
  application.server.close(() => {
    application.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
