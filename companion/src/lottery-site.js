import { randomInt, randomUUID } from 'node:crypto'
import { clientIp, createRateLimiter, json, readJson } from './http.js'
import { NewApiError } from './new-api-client.js'

const drawCounts = new Set([1, 10])
const rarities = new Set(['common', 'rare', 'epic', 'legendary'])
const rarityOrder = ['common', 'rare', 'epic', 'legendary']
const subscriptionDurationDays = 7
const permanentCampaignId = 'permanent-red-moon'
const permanentCampaignEndsAt = 4_102_444_800
const permanentPrizes = [
  { amountUsd: 1, weight: 60, rarity: 'common' },
  { amountUsd: 2, weight: 25, rarity: 'rare' },
  { amountUsd: 5, weight: 10, rarity: 'epic' },
  { amountUsd: 10, weight: 4, rarity: 'epic' },
  { amountUsd: 20, weight: 1, rarity: 'legendary' },
]

function apiError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function cleanText(value, label, max = 80, min = 1) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (text.length < min || text.length > max) {
    throw apiError(`${label}长度应为 ${min}-${max} 个字符`)
  }
  return text
}

function positiveInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0 || number > max) {
    throw apiError(`${label}无效`)
  }
  return number
}

function requestKey(value) {
  const key = String(value || '').trim()
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw apiError('请求号格式无效')
  }
  return key
}

function timestamp(value, label) {
  if (Number.isSafeInteger(Number(value)) && Number(value) > 0) return Number(value)
  const parsed = Date.parse(String(value || ''))
  if (!Number.isFinite(parsed)) throw apiError(`${label}无效`)
  return Math.floor(parsed / 1000)
}

function campaignPhase(campaign, now = nowSeconds()) {
  if (!campaign) return 'none'
  if (campaign.status === 'draft') return 'draft'
  if (campaign.status === 'cancelled') return 'cancelled'
  if (campaign.status === 'ended' || now >= Number(campaign.ends_at)) return 'ended'
  if (now < Number(campaign.starts_at)) return 'upcoming'
  return 'active'
}

function parsePrizes(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12) {
    throw apiError('奖池需要 2-12 个奖项')
  }
  const seen = new Set()
  return input.map((item) => {
    const amountUsd = positiveInteger(item?.amountUsd, '奖励金额', 9_999)
    const weight = positiveInteger(item?.weight, '概率权重', 1_000_000)
    const rarity = String(item?.rarity || '').trim()
    if (!rarities.has(rarity)) throw apiError('奖励稀有度无效')
    if (seen.has(amountUsd)) throw apiError('同一活动不能重复配置相同金额')
    seen.add(amountUsd)
    return { amountUsd, weight, rarity }
  })
}

function prizePayload(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0)
  return prizes.map((prize) => ({
    id: Number(prize.id),
    amountUsd: Number(prize.amount_usd),
    weight: Number(prize.weight),
    rarity: prize.rarity,
    probability: Number(prize.weight) / totalWeight,
  }))
}

function expectedValue(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0)
  if (totalWeight <= 0) return 0
  return prizes.reduce(
    (sum, prize) => sum + Number(prize.amount_usd) * Number(prize.weight),
    0,
  ) / totalWeight
}

function publicCampaign(campaign, now = nowSeconds()) {
  if (!campaign) return null
  return {
    id: campaign.id,
    name: campaign.name,
    phase: campaignPhase(campaign, now),
    startsAt: Number(campaign.starts_at),
    endsAt: Number(campaign.ends_at),
    rulesVersion: Number(campaign.rules_version),
    isPermanent: Number(campaign.is_permanent) === 1,
    isDefault: Number(campaign.is_default) === 1,
    subscriptionDays: subscriptionDurationDays,
    expectedValue: expectedValue(campaign.prizes),
    prizes: prizePayload(campaign.prizes),
  }
}

function publicRedemptionProgress(progress, quotaPerUnit) {
  if (!progress) return null
  const thresholdUsd = 100
  const thresholdQuota = thresholdUsd * Number(quotaPerUnit)
  const observedQuota = Math.max(0, Number(
    progress.observedQuota ?? progress.observed_quota ?? 0,
  ))
  const remainderQuota = observedQuota % thresholdQuota
  return {
    thresholdUsd,
    observedUsd: observedQuota / Number(quotaPerUnit),
    remainderUsd: remainderQuota / Number(quotaPerUnit),
    remainingUsd: (thresholdQuota - remainderQuota) / Number(quotaPerUnit),
    progressRatio: remainderQuota / thresholdQuota,
    grantedDraws: Number(progress.grantedDraws ?? progress.granted_draws ?? 0),
    redemptionCount: Number(progress.redemptionCount ?? progress.redemption_count ?? 0),
    userCount: Number(progress.userCount ?? progress.user_count ?? 0),
    updatedAt: Number(progress.updatedAt ?? progress.updated_at ?? 0),
  }
}

function pickPrize(prizes) {
  const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight), 0)
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
    throw apiError('奖池配置无效', 503)
  }
  const value = randomInt(totalWeight)
  let remaining = value
  for (const prize of prizes) {
    remaining -= Number(prize.weight)
    if (remaining < 0) return { prize, randomValue: String(value) }
  }
  return { prize: prizes.at(-1), randomValue: String(value) }
}

function highestRarity(items) {
  return items.reduce((highest, item) => (
    rarityOrder.indexOf(item.rarity) > rarityOrder.indexOf(highest)
      ? item.rarity
      : highest
  ), 'common')
}

function drawPayload(draw) {
  return {
    id: draw.id,
    campaignId: draw.campaign_id,
    userId: Number(draw.user_id),
    drawCount: Number(draw.draw_count),
    totalAmountUsd: Number(draw.total_amount_usd),
    totalQuota: Number(draw.total_quota),
    status: draw.status,
    errorMessage: draw.error_message || '',
    createdAt: Number(draw.created_at),
    completedAt: Number(draw.completed_at),
    expiresAt: draw.completed_at
      ? Number(draw.completed_at) + subscriptionDurationDays * 86_400
      : 0,
    highestRarity: highestRarity(draw.items),
    items: draw.items.map((item) => ({
      ordinal: Number(item.ordinal),
      amountUsd: Number(item.amount_usd),
      rarity: item.rarity,
    })),
  }
}

function rootOnly(user, config) {
  if (Number(user.id) !== Number(config.rootUserId)) {
    throw apiError('仅 root 可执行此操作', 403)
  }
}

function enabledUser(user, config) {
  const id = Number(user?.id)
  if (!Number.isInteger(id) || id <= 0 || id === Number(config.rootUserId)) return false
  if (user?.status !== undefined && Number(user.status) !== 1) return false
  if (Number(user?.role || 0) >= 100 || user?.is_system === true) return false
  return true
}

function adminCampaign(campaign, db, now) {
  const stats = db.campaignStats(campaign.id)
  return {
    ...publicCampaign(campaign, now),
    status: campaign.status,
    simulationCount: Number(campaign.simulation_count),
    createdAt: Number(campaign.created_at),
    publishedAt: Number(campaign.published_at),
    endedAt: Number(campaign.ended_at),
    stats: Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, Number(value)]),
    ),
  }
}

function normalizedPlan(plan) {
  return plan?.plan || plan || {}
}

function planMatches(plan, { title, quotaAmount }) {
  const item = normalizedPlan(plan)
  return item.title === title &&
    Number(item.total_amount) === Number(quotaAmount) &&
    item.duration_unit === 'day' &&
    Number(item.duration_value) === subscriptionDurationDays
}

function lotteryPlanDefinition(title, quotaAmount) {
  return {
    title,
    subtitle: '深夜宝库 7 天奖励订阅',
    price_amount: 0,
    currency: 'USD',
    duration_unit: 'day',
    duration_value: subscriptionDurationDays,
    custom_seconds: 0,
    enabled: false,
    sort_order: 0,
    allow_balance_pay: false,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: Number(quotaAmount),
    upgrade_group: '',
    downgrade_group: '',
    quota_reset_period: 'never',
    quota_reset_custom_seconds: 0,
  }
}

function subscriptionId(subscription) {
  return Number(subscription?.id || 0)
}

function subscriptionPlanId(subscription) {
  return Number(subscription?.plan_id || subscription?.planId || 0)
}

function findReconciledSubscription(subscriptions, draw) {
  let beforeIds = []
  try {
    beforeIds = JSON.parse(draw.preflight_subscription_ids || '[]').map(Number)
  } catch {}
  const before = new Set(beforeIds)
  return subscriptions.find((subscription) => {
    const created = Number(
      subscription.start_time || subscription.created_at || subscription.startTime || 0,
    )
    return subscriptionPlanId(subscription) === Number(draw.plan_id) &&
      !before.has(subscriptionId(subscription)) &&
      created >= Number(draw.created_at) - 5
  })
}

export function createLotterySite({ db, client, config, requireMutationRequest }) {
  const drawLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })
  const adminLimiter = createRateLimiter({ windowMs: 60_000, limit: 30 })
  let fulfillmentTimer = null
  let grantTimer = null
  let redemptionTimer = null
  let fulfilling = false
  let syncingRedemptions = false
  const processingGrants = new Set()
  const verifiedPlanIds = new Set()
  const createdAt = nowSeconds()
  let permanentCampaign = db.getDefaultCampaign()
  if (!permanentCampaign) {
    permanentCampaign = db.createCampaign({
      id: permanentCampaignId,
      name: '赤月回响',
      status: 'published',
      startsAt: 1,
      endsAt: permanentCampaignEndsAt,
      operatorUserId: Number(config.rootUserId || 0),
      createdAt,
      publishedAt: createdAt,
      isPermanent: true,
      isDefault: true,
    }, permanentPrizes)
  }
  let redemptionState = {
    configured: Boolean(
      config.rootUserId && config.rootAccessToken &&
      typeof client.listRedeemedCodes === 'function'
    ),
    running: false,
    lastCheckedAt: 0,
    lastError: '',
    progress: db.getRedemptionProgressStats(),
  }

  function refreshExpiredCampaign(now = nowSeconds()) {
    db.endExpiredCampaigns(now)
  }

  function currentCampaign(campaignId = '', now = nowSeconds()) {
    refreshExpiredCampaign(now)
    if (campaignId) {
      const requested = db.getCampaign(campaignId)
      return requested?.status === 'published' ? requested : null
    }
    const fallback = db.getDefaultCampaign()
    if (fallback?.status === 'published') return fallback
    return db.listPublishedCampaigns()[0] || null
  }

  function availableCampaigns(now = nowSeconds()) {
    refreshExpiredCampaign(now)
    return db.listPublishedCampaigns().filter(
      (campaign) => campaignPhase(campaign, now) !== 'ended',
    )
  }

  async function syncRedemptionRewards() {
    if (syncingRedemptions || !redemptionState.configured) return redemptionState
    syncingRedemptions = true
    redemptionState = { ...redemptionState, running: true, lastError: '' }
    try {
      const redemptions = await client.listRedeemedCodes(
        config.rootUserId,
        config.rootAccessToken,
      )
      const progressByUser = new Map()
      for (const item of redemptions) {
        const userId = Number(item.usedUserId)
        const quota = Number(item.quota)
        if (!Number.isSafeInteger(userId) || userId <= 0 ||
            !Number.isSafeInteger(quota) || quota <= 0) continue
        const current = progressByUser.get(userId) || {
          observedQuota: 0,
          redemptionCount: 0,
        }
        current.observedQuota += quota
        current.redemptionCount += 1
        if (!Number.isSafeInteger(current.observedQuota)) {
          throw new NewApiError(`用户 ${userId} 的兑换额度累计值超出安全范围`, 502)
        }
        progressByUser.set(userId, current)
      }
      const checkedAt = nowSeconds()
      let addedDraws = 0
      for (const [userId, aggregate] of progressByUser) {
        const result = db.syncRedemptionRewards({
          campaignId: permanentCampaign.id,
          userId,
          observedQuota: aggregate.observedQuota,
          redemptionCount: aggregate.redemptionCount,
          quotaPerDraw: 100 * Number(config.quotaPerUnit),
          operatorUserId: Number(config.rootUserId),
          now: checkedAt,
        })
        addedDraws += result.addedDraws
      }
      redemptionState = {
        configured: true,
        running: false,
        lastCheckedAt: checkedAt,
        lastError: '',
        progress: { ...db.getRedemptionProgressStats(), addedDraws },
      }
      return redemptionState
    } catch (error) {
      redemptionState = {
        ...redemptionState,
        running: false,
        lastCheckedAt: nowSeconds(),
        lastError: error.message,
      }
      throw error
    } finally {
      syncingRedemptions = false
    }
  }

  async function ensurePlan(draw, now) {
    const mapped = db.getPlanMapping(Number(draw.total_quota), subscriptionDurationDays)
    const mappedPlanId = Number(mapped?.plan_id || 0)
    if (mappedPlanId > 0 && verifiedPlanIds.has(mappedPlanId)) return mappedPlanId
    const title = `LOTTERY_REWARD_7D_USD_${Number(draw.total_amount_usd)}`
    const definition = lotteryPlanDefinition(title, Number(draw.total_quota))
    const plans = await client.listSubscriptionPlans(
      config.rootUserId,
      config.rootAccessToken,
    )
    let plan = plans.find((item) =>
      Number(normalizedPlan(item).id) === mappedPlanId && planMatches(item, {
        title,
        quotaAmount: Number(draw.total_quota),
      }))
    if (!plan) plan = plans.find((item) => planMatches(item, {
      title,
      quotaAmount: Number(draw.total_quota),
    }))
    let planId
    if (!plan) {
      plan = await client.createSubscriptionPlan(
        definition,
        config.rootUserId,
        config.rootAccessToken,
      )
      planId = Number(normalizedPlan(plan).id)
      if (!Number.isInteger(planId) || planId <= 0) {
        throw new NewApiError('抽奖订阅套餐 ID 无效', 502)
      }
      // New API currently ignores enabled=false during creation; a full edit persists it.
      await client.updateSubscriptionPlan(
        planId,
        definition,
        config.rootUserId,
        config.rootAccessToken,
      )
    } else {
      const item = normalizedPlan(plan)
      planId = Number(item.id)
      if (item.enabled !== false || Number(item.sort_order) !== 0) {
        await client.updateSubscriptionPlan(
          planId,
          { ...item, ...definition },
          config.rootUserId,
          config.rootAccessToken,
        )
      }
    }
    if (!Number.isInteger(planId) || planId <= 0) {
      throw new NewApiError('抽奖订阅套餐 ID 无效', 502)
    }
    verifiedPlanIds.add(planId)
    db.savePlanMapping({
      quotaAmount: Number(draw.total_quota),
      durationDays: subscriptionDurationDays,
      amountUsd: Number(draw.total_amount_usd),
      planId,
      planTitle: title,
    }, now)
    return planId
  }

  async function reconcileUnknown(draw, now) {
    const subscriptions = await client.listUserSubscriptions(
      Number(draw.user_id),
      config.rootUserId,
      config.rootAccessToken,
    )
    const matched = findReconciledSubscription(subscriptions, draw)
    if (matched) {
      db.finishFulfillment(draw.id, {
        status: 'completed',
        externalSubscriptionId: subscriptionId(matched),
        now,
        completedAt: now,
      })
      return true
    }
    db.finishFulfillment(draw.id, {
      status: 'pending',
      errorMessage: '未发现重复订阅，等待安全重试',
      nextAttemptAt: now + 60,
      now,
    })
    return false
  }

  async function fulfillDraw(draw) {
    const now = nowSeconds()
    if (draw.previousStatus === 'unknown') {
      await reconcileUnknown(draw, now)
      return
    }
    const planId = Number(draw.plan_id) || await ensurePlan(draw, now)
    db.setFulfillmentPlan(draw.id, planId, now)
    const before = await client.listUserSubscriptions(
      Number(draw.user_id),
      config.rootUserId,
      config.rootAccessToken,
    )
    db.setFulfillmentSnapshot(draw.id, before.map(subscriptionId).filter(Boolean), now)
    try {
      await client.createUserSubscription(
        Number(draw.user_id),
        planId,
        config.rootUserId,
        config.rootAccessToken,
      )
      let externalSubscriptionId = 0
      try {
        const after = await client.listUserSubscriptions(
          Number(draw.user_id),
          config.rootUserId,
          config.rootAccessToken,
        )
        externalSubscriptionId = subscriptionId(
          findReconciledSubscription(after, {
            ...draw,
            plan_id: planId,
            preflight_subscription_ids: JSON.stringify(before.map(subscriptionId)),
          }),
        )
      } catch {}
      const completedAt = nowSeconds()
      db.finishFulfillment(draw.id, {
        status: 'completed',
        externalSubscriptionId,
        now: completedAt,
        completedAt,
      })
    } catch (error) {
      const failedAt = nowSeconds()
      if (error.status === 504 || !error.details) {
        db.finishFulfillment(draw.id, {
          status: 'unknown',
          errorMessage: error.message,
          nextAttemptAt: failedAt + 60,
          now: failedAt,
        })
        return
      }
      const fresh = db.getDrawById(draw.id)
      const attempts = Number(fresh?.attempt_count || 1)
      db.finishFulfillment(draw.id, {
        status: attempts >= 5 ? 'failed' : 'pending',
        errorMessage: error.message,
        nextAttemptAt: failedAt + Math.min(300, 15 * (2 ** attempts)),
        now: failedAt,
      })
    }
  }

  async function processFulfillments() {
    if (fulfilling || !config.rootAccessToken || !config.rootUserId) return
    fulfilling = true
    try {
      const now = nowSeconds()
      db.recoverStaleFulfillments(now, now - 300)
      for (const draw of db.listDueFulfillments(now, 5)) {
        if (db.markFulfillmentProcessing(draw.id, nowSeconds()) === 0) continue
        const fresh = { ...db.getDrawById(draw.id), previousStatus: draw.status }
        try {
          await fulfillDraw(fresh)
        } catch (error) {
          const failedAt = nowSeconds()
          db.finishFulfillment(draw.id, {
            status: error.status === 504 || !error.details ? 'unknown' : 'pending',
            errorMessage: error.message,
            nextAttemptAt: failedAt + 60,
            now: failedAt,
          })
        }
      }
    } finally {
      fulfilling = false
    }
  }

  async function recipientsForBatch(batch) {
    let userIds
    try {
      userIds = JSON.parse(batch.recipients_json || '[]')
    } catch {
      userIds = []
    }
    return [...new Set(
      userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    )]
  }

  async function processGrantBatch(id) {
    if (processingGrants.has(id)) return
    processingGrants.add(id)
    try {
      const batch = db.getGrantBatch(id)
      if (!batch || !['queued', 'processing'].includes(batch.status)) return
      db.startGrantBatch(id)
      const recipients = await recipientsForBatch(batch)
      if (batch.kind === 'revoke') {
        for (const userId of recipients) {
          if (db.getBalance(batch.campaign_id, userId) < Number(batch.quantity_per_user)) {
            throw apiError(`用户 ${userId} 的可用次数不足，未执行撤回`, 409)
          }
        }
      }
      let processed = 0
      for (const userId of recipients) {
        if (db.applyGrantRecipient(batch, userId, nowSeconds())) processed += 1
      }
      db.finishGrantBatch(id, 'completed', recipients.length, processed, '', nowSeconds())
    } catch (error) {
      const batch = db.getGrantBatch(id)
      db.finishGrantBatch(
        id,
        'failed',
        Number(batch?.recipient_count || 0),
        Number(batch?.processed_count || 0),
        error.message,
        nowSeconds(),
      )
    } finally {
      processingGrants.delete(id)
    }
  }

  function scheduleGrantBatch(id) {
    setImmediate(() => {
      processGrantBatch(id).catch((error) => console.error(error))
    })
  }

  async function createGrantBatch(body, user, kind) {
    const campaignId = cleanText(body.campaignId, '活动 ID', 80)
    const campaign = db.getCampaign(campaignId)
    if (!campaign || !['draft', 'published'].includes(campaign.status)) {
      throw apiError('活动不可发放抽奖次数', 409)
    }
    const quantity = positiveInteger(body.quantity, '发放次数', 100_000)
    const requested = new Set((body.userIds || []).map(Number).filter(
      (id) => Number.isInteger(id) && id > 0,
    ))
    if (kind !== 'all' && (requested.size === 0 || requested.size > 10_000)) {
      throw apiError('用户列表需要包含 1-10000 个有效用户 ID')
    }
    const users = await client.getUsers(config.rootUserId, config.rootAccessToken)
    const userIds = users
      .filter((candidate) => enabledUser(candidate, config))
      .map((candidate) => Number(candidate.id))
      .filter((id) => kind === 'all' || requested.has(id))
    if (userIds.length === 0) throw apiError('没有符合条件的启用普通用户', 409)
    const batch = db.createGrantBatch({
      id: randomUUID(),
      requestKey: requestKey(body.requestKey),
      campaignId,
      kind,
      quantityPerUser: quantity,
      userIds,
      skipPreviouslyGranted: Boolean(body.skipPreviouslyGranted),
      note: cleanText(body.note || '管理员发放', '备注', 120, 1),
      operatorUserId: Number(user.id),
      createdAt: nowSeconds(),
    })
    scheduleGrantBatch(batch.id)
    return batch
  }

  function dashboard(now) {
    refreshExpiredCampaign(now)
    const progress = publicRedemptionProgress(redemptionState.progress, config.quotaPerUnit)
    return {
      campaigns: db.listCampaigns().map((campaign) => adminCampaign(campaign, db, now)),
      redemption: {
        ...redemptionState,
        thresholdUsd: progress?.thresholdUsd || 100,
        observedUsd: progress?.observedUsd || 0,
        remainderUsd: progress?.remainderUsd || 0,
        remainingUsd: progress?.remainingUsd || 100,
        grantedDraws: progress?.grantedDraws || 0,
        redemptionCount: progress?.redemptionCount || 0,
        userCount: progress?.userCount || 0,
      },
      grantBatches: db.listGrantBatches(30).map((batch) => ({
        id: batch.id,
        campaignId: batch.campaign_id,
        kind: batch.kind,
        quantity: Number(batch.quantity_per_user),
        status: batch.status,
        recipientCount: Number(batch.recipient_count),
        processedCount: Number(batch.processed_count),
        note: batch.note,
        errorMessage: batch.error_message,
        createdAt: Number(batch.created_at),
      })),
      fulfillmentIssues: db.listFulfillmentIssues(30).map(drawPayload),
      planMappings: db.listPlanMappings().map((mapping) => ({
        amountUsd: Number(mapping.amount_usd),
        quotaAmount: Number(mapping.quota_amount),
        durationDays: Number(mapping.duration_days),
        planId: Number(mapping.plan_id),
        planTitle: mapping.plan_title,
        verifiedAt: Number(mapping.verified_at),
      })),
    }
  }

  async function handleApi(req, res, url, user) {
    if (req.method !== 'GET' && req.method !== 'HEAD') requireMutationRequest(req)
    const now = nowSeconds()

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const campaign = currentCampaign(url.searchParams.get('campaign_id') || '', now)
      return json(res, 200, {
        success: true,
        data: {
          user: {
            id: Number(user.id),
            username: String(user.username || ''),
            displayName: String(user.display_name || user.username || `用户 #${user.id}`),
            isRoot: Number(user.id) === Number(config.rootUserId),
          },
          campaigns: availableCampaigns(now).map((item) => publicCampaign(item, now)),
          campaign: publicCampaign(campaign, now),
          balance: campaign ? db.getBalance(campaign.id, Number(user.id)) : 0,
          history: campaign
            ? db.listUserCampaignDraws(Number(user.id), campaign.id, 20, 0).map(drawPayload)
            : [],
          redemptionProgress: publicRedemptionProgress(
            db.getRedemptionProgress(Number(user.id)) || {},
            config.quotaPerUnit,
          ),
          mainSiteUrl:
            config.mainSiteUrl ||
            (config.publicUrl ? new URL(config.publicUrl).origin : config.baseUrl),
          timeZone: config.timeZone,
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0)
      const campaign = currentCampaign(url.searchParams.get('campaign_id') || '', now)
      return json(res, 200, {
        success: true,
        data: campaign
          ? db.listUserCampaignDraws(Number(user.id), campaign.id, 20, offset).map(drawPayload)
          : [],
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/draw') {
      if (!drawLimiter(`draw:${user.id}:${clientIp(req)}`)) {
        return json(res, 429, { success: false, message: '抽奖操作过于频繁' })
      }
      const body = await readJson(req)
      const key = requestKey(body.requestKey)
      const existing = db.getDrawByRequestKey(key)
      if (existing) {
        if (Number(existing.user_id) !== Number(user.id) ||
            (body.campaignId && existing.campaign_id !== String(body.campaignId))) {
          throw apiError('抽奖请求号已被其他用户或活动池使用', 409)
        }
        return json(res, 200, { success: true, data: drawPayload(existing) })
      }
      const campaign = currentCampaign(String(body.campaignId || ''), now)
      if (!campaign || campaignPhase(campaign, now) !== 'active') {
        throw apiError('活动尚未开始或已经结束', 409)
      }
      const count = positiveInteger(body.count, '抽奖数量', 10)
      if (!drawCounts.has(count)) throw apiError('仅支持单抽或十连抽')
      const items = Array.from({ length: count }, () => {
        const selected = pickPrize(campaign.prizes)
        return {
          id: randomUUID(),
          prizeId: Number(selected.prize.id),
          amountUsd: Number(selected.prize.amount_usd),
          quotaAmount: Number(selected.prize.amount_usd) * Number(config.quotaPerUnit),
          rarity: selected.prize.rarity,
          randomValue: selected.randomValue,
        }
      })
      const totalAmountUsd = items.reduce((sum, item) => sum + item.amountUsd, 0)
      const draw = db.createDraw({
        id: randomUUID(),
        requestKey: key,
        campaignId: campaign.id,
        userId: Number(user.id),
        drawCount: count,
        totalAmountUsd,
        totalQuota: totalAmountUsd * Number(config.quotaPerUnit),
        items,
        createdAt: now,
      })
      setImmediate(() => processFulfillments().catch((error) => console.error(error)))
      return json(res, 201, { success: true, data: drawPayload(draw) })
    }

    if (url.pathname.startsWith('/api/admin/')) rootOnly(user, config)

    if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
      return json(res, 200, { success: true, data: dashboard(now) })
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/eligible-users') {
      const users = await client.getUsers(config.rootUserId, config.rootAccessToken)
      return json(res, 200, {
        success: true,
        data: { count: users.filter((candidate) => enabledUser(candidate, config)).length },
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/redemptions/sync') {
      const state = await syncRedemptionRewards()
      return json(res, 200, { success: true, data: state })
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/campaigns') {
      if (!adminLimiter(`campaign:${user.id}:${clientIp(req)}`)) {
        return json(res, 429, { success: false, message: '管理操作过于频繁' })
      }
      const body = await readJson(req)
      const startsAt = timestamp(body.startsAt, '开始时间')
      const endsAt = timestamp(body.endsAt, '结束时间')
      if (endsAt <= startsAt) throw apiError('结束时间必须晚于开始时间')
      const campaign = db.createCampaign({
        id: randomUUID(),
        name: cleanText(body.name, '活动名称', 48),
        startsAt,
        endsAt,
        operatorUserId: Number(user.id),
        createdAt: now,
      }, parsePrizes(body.prizes))
      return json(res, 201, {
        success: true,
        data: adminCampaign(campaign, db, now),
      })
    }

    const publishMatch = url.pathname.match(/^\/api\/admin\/campaigns\/([^/]+)\/publish$/)
    if (req.method === 'POST' && publishMatch) {
      refreshExpiredCampaign(now)
      const campaign = db.getCampaign(publishMatch[1])
      if (!campaign || campaign.status !== 'draft') throw apiError('活动无法发布', 409)
      if (Number(campaign.ends_at) <= now) throw apiError('活动结束时间已过')
      try {
        if (db.publishCampaign(campaign.id, now) === 0) throw apiError('活动无法发布', 409)
      } catch (error) {
        if (/idx_lottery_single_published|UNIQUE constraint/i.test(error.message)) {
          throw apiError('同一时间只能发布一个活动', 409)
        }
        throw error
      }
      return json(res, 200, { success: true, data: adminCampaign(db.getCampaign(campaign.id), db, now) })
    }

    const endMatch = url.pathname.match(/^\/api\/admin\/campaigns\/([^/]+)\/end$/)
    if (req.method === 'POST' && endMatch) {
      if (db.endCampaign(endMatch[1], now) === 0) throw apiError('活动无法结束', 409)
      return json(res, 200, { success: true })
    }

    const cancelMatch = url.pathname.match(/^\/api\/admin\/campaigns\/([^/]+)\/cancel$/)
    if (req.method === 'POST' && cancelMatch) {
      if (db.cancelCampaign(cancelMatch[1], now) === 0) {
        throw apiError('仅草稿活动可以取消', 409)
      }
      return json(res, 200, { success: true })
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/grants') {
      const body = await readJson(req)
      const batch = await createGrantBatch(body, user, 'manual')
      return json(res, 202, { success: true, data: { id: batch.id, status: batch.status } })
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/grants/all') {
      const body = await readJson(req)
      const batch = await createGrantBatch(body, user, 'all')
      return json(res, 202, { success: true, data: { id: batch.id, status: batch.status } })
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/grants/revoke') {
      const body = await readJson(req)
      const batch = await createGrantBatch(body, user, 'revoke')
      return json(res, 202, { success: true, data: { id: batch.id, status: batch.status } })
    }

    const retryMatch = url.pathname.match(/^\/api\/admin\/fulfillments\/([^/]+)\/retry$/)
    if (req.method === 'POST' && retryMatch) {
      if (db.retryFulfillment(retryMatch[1], now) === 0) {
        throw apiError('该记录当前不可重试', 409)
      }
      setImmediate(() => processFulfillments().catch((error) => console.error(error)))
      return json(res, 200, { success: true })
    }

    return json(res, 404, { success: false, message: '接口不存在' })
  }

  return {
    handleApi,
    dashboard,
    processFulfillments,
    processGrantBatch,
    syncRedemptionRewards,
    start() {
      const now = nowSeconds()
      db.recoverStaleFulfillments(now, now - 300)
      for (const batch of db.listQueuedGrantBatches()) scheduleGrantBatch(batch.id)
      processFulfillments().catch((error) => console.error(error))
      syncRedemptionRewards().catch((error) => console.error(error))
      fulfillmentTimer = setInterval(
        () => processFulfillments().catch((error) => console.error(error)),
        Number(config.lotteryFulfillmentIntervalMs || 15_000),
      )
      grantTimer = setInterval(() => {
        for (const batch of db.listQueuedGrantBatches()) scheduleGrantBatch(batch.id)
      }, 5_000)
      redemptionTimer = setInterval(
        () => syncRedemptionRewards().catch((error) => console.error(error)),
        Number(config.lotteryRedemptionIntervalMs || 60_000),
      )
      fulfillmentTimer.unref?.()
      grantTimer.unref?.()
      redemptionTimer.unref?.()
    },
    close() {
      if (fulfillmentTimer) clearInterval(fulfillmentTimer)
      if (grantTimer) clearInterval(grantTimer)
      if (redemptionTimer) clearInterval(redemptionTimer)
      fulfillmentTimer = null
      grantTimer = null
      redemptionTimer = null
    },
  }
}
