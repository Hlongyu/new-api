import { randomUUID } from 'node:crypto'
import { isRootConfigured } from './config.js'
import { zonedDayKey, zonedStartUnix } from './time.js'

export const postpaidCreditByTier = Object.freeze({
  iron: 10,
  bronze: 50,
  silver: 100,
  gold: 200,
  platinum: 350,
  diamond: 500,
  master: 750,
  grandmaster: 1_100,
  challenger: 1_500,
})

export function postpaidCreditForTier(tierKey, division = '') {
  if (String(tierKey) === 'iron') {
    const normalizedDivision = String(division).trim().toUpperCase()
    return ['III', 'II', 'I'].includes(normalizedDivision) ? 10 : 0
  }
  return Number(postpaidCreditByTier[String(tierKey)] || 0)
}

// 还款截止：次月 15 日 23:59:59（申请当月不计，用户拿到整个次月的前半段还款）。
//
// 两处容易看错，改动前先读完：
//   1. 常量是 16 而不是 15。末尾 `- 1` 秒取的是「16 日零点的前一秒」，也就是
//      15 日 23:59:59。想把还款日改成 N 号，这里要填 N + 1。
//   2. zonedDayKey 给的 month 是 1-based，而 Date.UTC 的 month 是 0-based，
//      两者相抵正好落到次月，跨年也正确（12 月 -> 次年 1 月）。
const POSTPAID_DUE_DAY_BOUNDARY = 16

export function postpaidDueAt(nowTimestamp, timeZone = 'Asia/Shanghai') {
  const [year, month] = zonedDayKey(nowTimestamp, timeZone).split('-').map(Number)
  const afterDueDate = new Date(Date.UTC(year, month, POSTPAID_DUE_DAY_BOUNDARY))
  return zonedStartUnix(
    afterDueDate.getUTCFullYear(),
    afterDueDate.getUTCMonth() + 1,
    afterDueDate.getUTCDate(),
    timeZone,
  ) - 1
}

function apiError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function uncertainExternalResult(error) {
  return error?.status === 504 || !error?.details
}

export class PostpaidService {
  constructor({ db, client, config, now = () => Math.floor(Date.now() / 1000) }) {
    this.db = db
    this.client = client
    this.config = config
    this.now = now
    this.running = false
    this.timer = null
  }

  getState() {
    return {
      configured: isRootConfigured(this.config),
      running: this.running,
      lastSyncAt: this.db.getSetting('last_postpaid_sync_at', 0),
      lastSyncError: this.db.getSetting('last_postpaid_sync_error', ''),
    }
  }

  async grant({ requestKey, userId, entryId, rankProgress, amount }) {
    const existing = this.db.getPostpaidGrantByRequestKey(requestKey)
    if (existing) {
      if (Number(existing.user_id) !== Number(userId)) {
        throw apiError('请求编号已被使用', 409)
      }
      return existing
    }
    if (!isRootConfigured(this.config)) throw apiError('先用后付尚未配置', 503)

    const creditLimit = postpaidCreditForTier(
      rankProgress?.tierKey,
      rankProgress?.division,
    )
    if (creditLimit <= 0) throw apiError('当前段位暂未开放先用后付', 403)
    const quotaPerUnit = Number(this.config.quotaPerUnit)
    const openGrants = this.db.listOpenPostpaidGrantsForUser(userId)
    if (openGrants.some((grant) => ['processing', 'unknown'].includes(grant.status))) {
      throw apiError('已有额度申请待处理', 409)
    }
    const availableAmount = Math.max(
      0,
      Math.floor((creditLimit * quotaPerUnit - this.db.getPostpaidExposure(userId)) /
        quotaPerUnit),
    )
    if (availableAmount <= 0) throw apiError('当前可用额度不足', 409)
    const creditAmount = amount == null ? availableAmount : Number(amount)
    if (!Number.isSafeInteger(creditAmount) || creditAmount <= 0) {
      throw apiError('本次申请额度必须为正整数')
    }
    if (creditAmount > availableAmount) {
      throw apiError(`本次最多可申请 ${availableAmount} 额度`)
    }
    const redemptions = await this.client.listRedeemedCodesForUser(
      userId,
      this.config.rootUserId,
      this.config.rootAccessToken,
    )
    const redemptionStartId = redemptions.reduce(
      (highest, item) => Math.max(highest, Number(item.id) || 0),
      0,
    )
    const createdAt = this.now()
    const latestAvailableAmount = Math.max(
      0,
      Math.floor((creditLimit * quotaPerUnit - this.db.getPostpaidExposure(userId)) /
        quotaPerUnit),
    )
    if (creditAmount > latestAvailableAmount) {
      throw apiError(`本次最多可申请 ${latestAvailableAmount} 额度`, 409)
    }
    const quotaAmount = creditAmount * quotaPerUnit
    let grant
    try {
      grant = this.db.createPostpaidGrant({
        id: randomUUID(),
        requestKey,
        userId,
        entryId,
        tierKey: rankProgress.tierKey,
        tierName: rankProgress.tierName,
        creditAmount,
        quotaAmount,
        redemptionStartId,
        operatorUserId: this.config.rootUserId,
        createdAt,
        dueAt: postpaidDueAt(createdAt, this.config.timeZone),
      })
    } catch (error) {
      if (/idx_postpaid_user_processing|UNIQUE constraint failed/i.test(error.message)) {
        throw apiError('已有额度申请正在处理', 409)
      }
      throw error
    }

    try {
      await this.client.increaseUserQuota(
        userId,
        quotaAmount,
        this.config.rootUserId,
        this.config.rootAccessToken,
      )
      this.db.activatePostpaidGrant(grant.id, this.now())
    } catch (error) {
      const status = uncertainExternalResult(error) ? 'unknown' : 'failed'
      this.db.finishPostpaidGrantFailure(grant.id, status, error.message, this.now())
    }
    return this.db.getPostpaidGrant(grant.id)
  }

  async processRedemption(grant, redemption, availableQuota = Number(redemption.quota)) {
    const latest = this.db.getPostpaidGrant(grant.id)
    if (!latest || !['active', 'overdue'].includes(latest.status) ||
        Number(latest.outstanding_quota) <= 0) return false
    const quotaAmount = Math.min(
      Number(availableQuota),
      Number(latest.outstanding_quota),
    )
    if (!Number.isSafeInteger(quotaAmount) || quotaAmount <= 0) return false

    const createdAt = this.now()
    const eventId = randomUUID()
    const event = this.db.createPostpaidRepayment({
      id: eventId,
      grantId: latest.id,
      userId: Number(latest.user_id),
      redemptionId: Number(redemption.id),
      redemptionTime: Number(redemption.redeemedTime),
      quotaAmount,
      outstandingBefore: Number(latest.outstanding_quota),
      outstandingAfter: Number(latest.outstanding_quota) - quotaAmount,
      createdAt,
    })
    if (!event || event.id !== eventId) return false

    let remoteSucceeded = false
    try {
      await this.client.decreaseUserQuota(
        Number(latest.user_id),
        quotaAmount,
        this.config.rootUserId,
        this.config.rootAccessToken,
      )
      remoteSucceeded = true
      this.db.transaction(() => {
        if (this.db.finishPostpaidEvent(event.id, 'completed', '', this.now()) !== 1) {
          throw new Error('还款流水状态已变化')
        }
        if (this.db.applyPostpaidRepayment(
          latest.id,
          Number(latest.outstanding_quota),
          Number(latest.outstanding_quota) - quotaAmount,
          this.now(),
        ) !== 1) {
          throw new Error('待还额度状态已变化')
        }
      })
      return true
    } catch (error) {
      const status = remoteSucceeded || uncertainExternalResult(error) ? 'unknown' : 'failed'
      this.db.finishPostpaidEvent(event.id, status, error.message, this.now())
      return false
    }
  }

  async sync() {
    if (this.running || !isRootConfigured(this.config) || this.config.previewMode) return false
    this.running = true
    try {
      const now = this.now()
      this.db.markPostpaidOverdue(now)
      const grants = this.db.listOpenPostpaidGrants()
      if (grants.length === 0) {
        this.db.setSetting('last_postpaid_sync_at', now)
        this.db.setSetting('last_postpaid_sync_error', '')
        return true
      }
      const redemptions = await this.client.listRedeemedCodes(
        this.config.rootUserId,
        this.config.rootAccessToken,
      )
      redemptions.sort((a, b) =>
        Number(a.redeemedTime) - Number(b.redeemedTime) || Number(a.id) - Number(b.id))
      const grantsByUser = new Map()
      for (const grant of grants) {
        const userId = Number(grant.user_id)
        if (!grantsByUser.has(userId)) grantsByUser.set(userId, [])
        grantsByUser.get(userId).push(grant)
      }
      for (const [userId, userGrants] of grantsByUser) {
        let userBlocked = false
        for (const redemption of redemptions) {
          if (Number(redemption.usedUserId) !== userId) continue
          const redemptionId = Number(redemption.id)
          const existingEvents = this.db.listPostpaidEventsByRedemption(redemptionId)
          if (existingEvents.some((event) =>
            ['unknown', 'processing'].includes(event.status))) {
            userBlocked = true
            break
          }
          let remainingQuota = Number(redemption.quota) - existingEvents
            .filter((event) => event.status === 'completed')
            .reduce((total, event) => total + Number(event.quota_amount), 0)
          if (!Number.isSafeInteger(remainingQuota) || remainingQuota <= 0) continue

          for (const grant of userGrants) {
            if (redemptionId <= Number(grant.redemption_start_id) ||
                Number(redemption.redeemedTime) < Number(grant.created_at)) continue
            const latestGrant = this.db.getPostpaidGrant(grant.id)
            if (!latestGrant || !['active', 'overdue'].includes(latestGrant.status) ||
                Number(latestGrant.outstanding_quota) <= 0) continue
            const existing = this.db.getPostpaidEventByGrantRedemption(
              grant.id,
              redemptionId,
            )
            if (existing) {
              if (['unknown', 'processing'].includes(existing.status)) userBlocked = true
              if (existing.status !== 'completed') break
              continue
            }
            await this.processRedemption(grant, redemption, remainingQuota)
            const event = this.db.getPostpaidEventByGrantRedemption(grant.id, redemptionId)
            if (!event || event.status !== 'completed') {
              if (event && ['unknown', 'processing'].includes(event.status)) userBlocked = true
              break
            }
            remainingQuota -= Number(event.quota_amount)
            if (remainingQuota <= 0) break
          }
          if (userBlocked) break
        }
      }
      this.db.setSetting('last_postpaid_sync_at', this.now())
      this.db.setSetting('last_postpaid_sync_error', '')
      return true
    } catch (error) {
      this.db.setSetting('last_postpaid_sync_error', error.message)
      throw error
    } finally {
      this.running = false
    }
  }

  start() {
    if (!isRootConfigured(this.config) || this.config.previewMode) return
    this.sync().catch(() => {})
    const intervalMs = Number(this.config.postpaidSyncIntervalMs) || 30_000
    this.timer = setInterval(() => this.sync().catch(() => {}), intervalMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }
}
