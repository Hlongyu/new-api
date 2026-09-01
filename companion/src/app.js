import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createDatabase } from './db.js'
import { isRootConfigured } from './config.js'
import {
  clientIp,
  createRateLimiter,
  json,
  readJson,
  serveStatic,
} from './http.js'
import { createLotterySiteDatabase } from './lottery-site-db.js'
import { createLotterySite } from './lottery-site.js'
import { NewApiClient, NewApiError } from './new-api-client.js'
import { calculateRankProgress } from './rank.js'
import { pickLotteryPrize } from './lottery.js'
import { PostpaidService, postpaidCreditForTier } from './postpaid.js'
import { sponsorBadgeForAmount } from './sponsor-badge.js'
import { UsageSynchronizer } from './sync.js'
import { calculateSupportActivity } from './support.js'
import {
  periodKey,
  previousWeekRange,
  sponsorPeriodRange,
  weekRangeFromKey,
  zonedDayKey,
} from './time.js'

const lotteryRuleVersion = 2
const displayNameMaxLength = 36
const lotterySitePublicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'lottery',
)

function cleanText(value, { min = 1, max = 40, label = '内容' } = {}) {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (text.length < min || text.length > max) {
    const error = new Error(`${label}长度应为 ${min}-${max} 个字符`)
    error.status = 400
    throw error
  }
  return text
}

function positiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(`${label}无效`)
    error.status = 400
    throw error
  }
  return parsed
}

function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname
  if (pathname === basePath) return '/'
  if (pathname.startsWith(`${basePath}/`))
    return pathname.slice(basePath.length)
  return null
}

function groupedByUser(rows) {
  const groups = new Map()
  for (const row of rows) {
    const userId = Number(row.user_id)
    if (!groups.has(userId)) groups.set(userId, [])
    groups.get(userId).push(row)
  }
  return groups
}

function bool(value) {
  return Number(value) === 1 || value === true
}

function participationForPeriod(row, period) {
  if (period === 'day') return bool(row.participate_day)
  if (period === 'week') return bool(row.participate_week)
  if (period === 'month') return bool(row.participate_month)
  if (period === 'all') return bool(row.participate_all)
  return bool(row.participating)
}

function visibilitySettingsFromEntry(entry) {
  return {
    participateDay: bool(entry.participate_day),
    participateWeek: bool(entry.participate_week),
    participateMonth: bool(entry.participate_month),
    participateAll: bool(entry.participate_all),
    participateRank: bool(entry.participate_rank),
    showRankBadge: bool(entry.show_rank_badge),
  }
}

function showRankBadgeForRow(row, excluded = false) {
  return !excluded && bool(row.show_rank_badge)
}

function lotteryDisplayName(row) {
  return bool(row.is_name_public) && bool(row.participate_week)
    ? row.display_name
    : row.anonymous_name
}

function supportContext(
  db,
  config,
  nowTimestamp = Math.floor(Date.now() / 1000),
) {
  const startKey = zonedDayKey(
    config.supportActivityStartTimestamp,
    config.timeZone,
  )
  const dailyUsage = groupedByUser(db.listSupportDailyUsage(startKey))
  const sponsors = groupedByUser(db.listSupportSponsors())
  const cache = new Map()
  return {
    forUser(userId) {
      const normalizedUserId = Number(userId)
      if (!cache.has(normalizedUserId)) {
        cache.set(
          normalizedUserId,
          calculateSupportActivity({
          dailyUsage: dailyUsage.get(normalizedUserId) || [],
          sponsors: sponsors.get(normalizedUserId) || [],
          nowTimestamp,
          timeZone: config.timeZone,
          startTimestamp: config.supportActivityStartTimestamp,
          quotaPerUnit: config.quotaPerUnit,
          activeDays: config.supportActivityActiveDays,
          }),
        )
      }
      return cache.get(normalizedUserId)
    },
  }
}

function rankContext(db, config, nowTimestamp = Math.floor(Date.now() / 1000)) {
  const startTimestamp = config.rankSystemStartTimestamp || 1_784_304_000
  const startKey = zonedDayKey(startTimestamp, config.timeZone)
  const dailyUsage = groupedByUser(db.listSupportDailyUsage(startKey))
  const renameCards = groupedByUser(db.listSupportRenameCards())
  const sponsors = groupedByUser(db.listSupportSponsors())
  const cache = new Map()
  return {
    forUser(userId) {
      const normalizedUserId = Number(userId)
      if (!cache.has(normalizedUserId)) {
        cache.set(
          normalizedUserId,
          calculateRankProgress({
          dailyUsage: dailyUsage.get(normalizedUserId) || [],
          renameCards: renameCards.get(normalizedUserId) || [],
          sponsors: sponsors.get(normalizedUserId) || [],
          nowTimestamp,
          timeZone: config.timeZone,
          startTimestamp,
          quotaPerUnit: config.quotaPerUnit,
          }),
        )
      }
      return cache.get(normalizedUserId)
    },
  }
}

const EXCLUDED_USERS_SETTING = 'excluded_user_ids'

// 屏蔽名单以 app_settings 为准；管理员未保存过时回退到 LEADERBOARD_EXCLUDED_USER_IDS，
// 这样已有部署的环境变量继续生效，第一次在后台保存后即由数据库接管。
function excludedUserIdSet(db, config) {
  const stored = db.getSetting(EXCLUDED_USERS_SETTING, null)
  if (Array.isArray(stored)) {
    return new Set(
      stored.map(Number).filter((id) => Number.isInteger(id) && id > 0),
    )
  }
  return new Set((config.excludedUserIds || []).map(Number))
}

function leaderboardPayload(db, config, period) {
  const key = periodKey(period, {
    timeZone: config.timeZone,
    allStartTimestamp: config.allStartTimestamp,
  })
  const excludedUserIds = excludedUserIdSet(db, config)
  const ranks = rankContext(db, config)
  const rows = db
    .listLeaderboard(period, key)
    .filter((row) => Boolean(row.has_usage))
    .map((row) => {
      const excluded = excludedUserIds.has(Number(row.user_id))
      const rankProgress = ranks.forUser(row.user_id)
      const showBadge = !excluded && Boolean(row.is_name_public)
      const sponsorBadge = showBadge
        ? sponsorBadgeForAmount(row.sponsor_amount_cny)
        : null
      return {
        id: row.id,
        displayName: excluded
          ? row.source_name || row.username || `用户 #${row.user_id}`
          : row.public_name,
        tokenUsed: Number(row.token_used),
        requestCount: Number(row.request_count),
        updatedAt: Number(row.updated_at),
        participating: participationForPeriod(row, period),
        rankLabel: rankProgress.label,
        showRankBadge: showRankBadgeForRow(row, excluded),
        sponsorBadge,
        isSponsor: Boolean(sponsorBadge),
        excluded,
      }
    })
  rows.sort(
    (left, right) =>
      right.tokenUsed - left.tokenUsed ||
      right.requestCount - left.requestCount ||
      left.id - right.id,
  )
  // Blocked members are dropped outright rather than listed separately, so
  // neither their identity nor their usage reaches the client. Totals follow
  // the same rule: a headline figure that counted invisible rows would never
  // reconcile with the list below it.
  const entries = rows.filter((row) => !row.excluded && row.participating)
  entries.forEach((row, index) => {
    row.rank = index + 1
  })
  for (const row of rows) {
    delete row.excluded
    delete row.participating
  }
  const visibleRows = entries
  const totals = visibleRows.reduce(
    (result, row) => ({
      tokenUsed: result.tokenUsed + row.tokenUsed,
      requestCount: result.requestCount + row.requestCount,
    }),
    { tokenUsed: 0, requestCount: 0 },
  )

  return {
    period,
    periodKey: key,
    timeZone: config.timeZone,
    entries,
    memberCount: visibleRows.length,
    totals,
    lastSyncAt: db.getSetting('last_sync_at', 0),
  }
}

function rankPayload(db, config) {
  const excludedUserIds = excludedUserIdSet(db, config)
  const ranks = rankContext(db, config)
  const rows = db
    .listLeaderboard('all', 'all')
    .map((row) => {
      const rankProgress = ranks.forUser(row.user_id)
      const showSponsorBadge =
        !excludedUserIds.has(Number(row.user_id)) && Boolean(row.is_name_public)
      const excluded = excludedUserIds.has(Number(row.user_id))
      return {
        id: row.id,
        displayName: excluded
          ? row.source_name || row.username || `用户 #${row.user_id}`
          : row.public_name,
        participating: bool(row.participate_rank),
        excluded,
        hasUsage: Boolean(row.has_usage),
        rankLabel: rankProgress.label,
        showRankBadge: showRankBadgeForRow(row, excluded),
        sponsorBadge: showSponsorBadge
          ? sponsorBadgeForAmount(row.sponsor_amount_cny)
          : null,
        sortRankValue: rankProgress.rankValue,
        sortTotalScore: rankProgress.totalScore,
      }
    })
    .filter(
      (row) =>
        !row.excluded &&
        row.participating &&
        (row.hasUsage || row.sortTotalScore > 0),
    )
  rows.sort(
    (left, right) =>
      right.sortRankValue - left.sortRankValue ||
      right.sortTotalScore - left.sortTotalScore ||
      left.id - right.id,
  )
  rows.forEach((row, index) => {
    row.rank = index + 1
    delete row.excluded
    delete row.participating
    delete row.hasUsage
    delete row.sortRankValue
    delete row.sortTotalScore
  })
  return {
    timeZone: config.timeZone,
    entries: rows,
    totals: {
      memberCount: rows.length,
    },
    lastSyncAt: db.getSetting('last_sync_at', 0),
  }
}

function sponsorPayload(db, config, period) {
  const range = sponsorPeriodRange(period, {
    timeZone: config.timeZone,
    allStartTimestamp: config.allStartTimestamp,
  })
  const entries = db
    .listSponsorLeaderboard(range.start, range.end)
    .map((row, index) => ({
    rank: index + 1,
    displayName: row.public_name,
    amountCny: Number(row.amount_cny),
    sponsorCount: Number(row.sponsor_count),
    updatedAt: Number(row.updated_at),
  }))
  const totals = db.sponsorTotals(range.start, range.end)
  return {
    period,
    periodKey: range.key,
    timeZone: config.timeZone,
    entries,
    totals: {
      amountCny: Number(totals.amount_cny),
      sponsorCount: Number(totals.sponsor_count),
      memberCount: Number(totals.member_count),
    },
  }
}

function sponsorOrderPayload(order, includeError = false) {
  const result = {
    id: order.id,
    amountCny: Number(order.amount_cny),
    quotaAmount: Number(order.quota_amount),
    message: order.message,
    status: order.status,
    createdAt: Number(order.created_at),
    updatedAt: Number(order.updated_at),
    completedAt: Number(order.completed_at),
  }
  if (includeError) result.errorMessage = order.error_message
  return result
}

function renameCardOrderPayload(order, includeError = false) {
  const result = {
    id: order.id,
    quantity: Number(order.quantity),
    amountCny: Number(order.amount_cny),
    quotaAmount: Number(order.quota_amount),
    status: order.status,
    createdAt: Number(order.created_at),
    updatedAt: Number(order.updated_at),
    completedAt: Number(order.completed_at),
  }
  if (includeError) result.errorMessage = order.error_message
  return result
}

function postpaidGrantPayload(grant, quotaPerUnit, includeError = false) {
  if (!grant) return null
  const result = {
    id: grant.id,
    tierKey: grant.tier_key,
    tierName: grant.tier_name,
    creditAmount: Number(grant.credit_amount),
    quotaAmount: Number(grant.quota_amount),
    outstandingAmount: Number(grant.outstanding_quota) / Number(quotaPerUnit),
    status: grant.status,
    createdAt: Number(grant.created_at),
    updatedAt: Number(grant.updated_at),
    dueAt: Number(grant.due_at),
    completedAt: Number(grant.completed_at),
  }
  if (includeError) result.errorMessage = grant.error_message
  return result
}

function postpaidEventPayload(event, quotaPerUnit, includeUser = false) {
  const result = {
    id: event.id,
    grantId: event.grant_id,
    type: event.event_type,
    redemptionId: Number(event.redemption_id),
    redemptionTime: Number(event.redemption_time),
    amount: Number(event.quota_amount) / Number(quotaPerUnit),
    outstandingBefore: Number(event.outstanding_before) / Number(quotaPerUnit),
    outstandingAfter: Number(event.outstanding_after) / Number(quotaPerUnit),
    status: event.status,
    errorMessage: event.error_message,
    createdAt: Number(event.created_at),
    updatedAt: Number(event.updated_at),
  }
  if (includeUser) {
    result.userId = Number(event.user_id)
    result.displayName =
      event.source_name ||
      event.username ||
      event.public_name ||
      `用户 #${event.user_id}`
    result.tierName = event.tier_name
  }
  return result
}

function weeklyTopEntries(db, config, weekKey, count) {
  const excludedUserIds = excludedUserIdSet(db, config)
  const rows = db
    .listLeaderboard('week', weekKey)
    .filter(
      (row) =>
      Boolean(row.has_usage) &&
      !excludedUserIds.has(Number(row.user_id)) &&
        Number(row.quota) > 0,
    )
  rows.sort(
    (left, right) =>
      right.quota - left.quota ||
      right.token_used - left.token_used ||
      right.request_count - left.request_count ||
      left.id - right.id,
  )
  return rows.slice(0, count)
}

function lotteryDrawPayload(draw, includeError = false) {
  const result = {
    ruleVersion: Number(draw.rule_version || lotteryRuleVersion),
    periodKey: draw.period_key,
    rank: Number(draw.draw_rank),
    amountUsd: Number(draw.amount_usd),
    quotaAmount: Number(draw.quota_amount),
    status: draw.status,
    displayName: draw.display_name_snapshot || '',
    createdAt: Number(draw.created_at),
    updatedAt: Number(draw.updated_at),
    completedAt: Number(draw.completed_at),
  }
  if (includeError) {
    result.id = draw.id
    result.errorMessage = draw.error_message
  }
  return result
}

function lotteryOpportunityPayload(
  opportunity,
  { isMe = false, includeUsage = false } = {},
) {
  const draw = opportunity.draw
  const result = {
    periodKey: opportunity.periodKey,
    weekStart: opportunity.range.start,
    weekEnd: opportunity.range.end,
    rank: opportunity.rank,
    displayName: draw?.display_name_snapshot || opportunity.displayName,
    isMe,
    draw: draw
      ? {
          status: draw.status,
          amountUsd: Number(draw.amount_usd),
          completedAt: Number(draw.completed_at),
        }
      : null,
  }
  if (includeUsage && opportunity.quota > 0) {
    result.tokenUsed = opportunity.tokenUsed
    result.quota = opportunity.quota
    result.amountUsd =
      opportunity.quota / Number(opportunity.quotaPerUnit || 500_000)
    result.requestCount = opportunity.requestCount
  }
  return result
}

function settleLotteryOpportunities(db, config, pools, currentRange) {
  const weekKeys = db.listLotteryWeekKeysBefore(currentRange.key)
  for (const weekKey of weekKeys) {
    if (db.isLotteryPeriodSettled(lotteryRuleVersion, weekKey)) continue
    const range = weekRangeFromKey(weekKey, config.timeZone)
    if (
      weekKey === currentRange.key &&
      db.getLotteryWeekUpdatedAt(weekKey) < range.end
    ) {
      continue
    }

    const winners = weeklyTopEntries(db, config, weekKey, pools.length)
    db.settleLotteryPeriod({
      ruleVersion: lotteryRuleVersion,
      periodKey: weekKey,
      settledAt: Math.floor(Date.now() / 1000),
      opportunities: winners.map((row, index) => ({
        rank: index + 1,
        userId: Number(row.user_id),
        entryId: Number(row.id),
        displayNameSnapshot: lotteryDisplayName(row),
        tokenUsed: Number(row.token_used),
        quota: Number(row.quota),
        requestCount: Number(row.request_count),
        prizePool: pools[index],
      })),
    })
  }
}

function lotteryDrawFromOpportunity(row) {
  if (!row.draw_id) return null
  return {
    id: row.draw_id,
    rule_version: row.rule_version,
    period_key: row.period_key,
    draw_rank: row.draw_rank,
    user_id: row.user_id,
    entry_id: row.entry_id,
    display_name_snapshot: row.draw_display_name_snapshot,
    amount_usd: row.draw_amount_usd,
    quota_amount: row.draw_quota_amount,
    status: row.draw_status,
    error_message: row.draw_error_message,
    operator_user_id: row.draw_operator_user_id,
    created_at: row.draw_created_at,
    updated_at: row.draw_updated_at,
    completed_at: row.draw_completed_at,
  }
}

function lotteryOpportunities(db, config, pools, auth, currentRange) {
  settleLotteryOpportunities(db, config, pools, currentRange)
  return db
    .listLotteryOpportunitiesBefore(lotteryRuleVersion, currentRange.key)
    .map((row) => {
      let pool = []
      try {
        const parsed = JSON.parse(row.prize_pool_json)
        if (Array.isArray(parsed)) pool = parsed
      } catch {
        // A migrated completed draw no longer needs its historical prize pool.
      }
      if (pool.length === 0 && !row.draw_id) {
        pool = pools[Number(row.draw_rank) - 1] || []
      }
      return {
        periodKey: row.period_key,
        range: weekRangeFromKey(row.period_key, config.timeZone),
        rank: Number(row.draw_rank),
        userId: Number(row.user_id),
        entryId: Number(row.entry_id),
        displayName: lotteryDisplayName({
          display_name: row.current_display_name,
          anonymous_name: row.current_anonymous_name,
          is_name_public: row.current_is_name_public,
          participate_week: row.current_participate_week,
        }),
        tokenUsed: Number(row.token_used),
        quota: Number(row.quota),
        requestCount: Number(row.request_count),
        pool,
        draw: lotteryDrawFromOpportunity(row),
        isMe: Number(row.user_id) === Number(auth.user.id),
        quotaPerUnit: config.quotaPerUnit,
      }
    })
}

function lotteryPayload(db, config, auth) {
  const range = previousWeekRange({ timeZone: config.timeZone })
  const pools = config.lotteryPrizes || []
  const configured = Boolean(
    config.rootAccessToken && config.rootUserId && pools.length > 0,
  )
  const opportunities = lotteryOpportunities(db, config, pools, auth, range)
  const currentWeekOpportunities = opportunities.filter(
    (opportunity) => opportunity.periodKey === range.key,
  )
  const myOpportunities = opportunities.filter(
    (opportunity) => opportunity.isMe,
  )
  const nextOpportunity = myOpportunities.find(
    (opportunity) => !opportunity.draw || opportunity.draw.status === 'failed',
  )
  const currentWeekMyOpportunity = currentWeekOpportunities.find(
    (opportunity) => opportunity.isMe,
  )
  const currentWeekMyDraw = currentWeekMyOpportunity?.draw || null
  const weeklyHistoryByPeriod = new Map()
  for (const opportunity of opportunities) {
    let period = weeklyHistoryByPeriod.get(opportunity.periodKey)
    if (!period) {
      period = {
        periodKey: opportunity.periodKey,
        weekStart: opportunity.range.start,
        weekEnd: opportunity.range.end,
        winners: [],
      }
      weeklyHistoryByPeriod.set(opportunity.periodKey, period)
    }
    period.winners.push(
      lotteryOpportunityPayload(opportunity, {
        isMe: opportunity.isMe,
        includeUsage: auth.isRoot,
      }),
    )
  }
  const weeklyHistory = [...weeklyHistoryByPeriod.values()].sort(
    (left, right) => right.weekStart - left.weekStart,
  )
  const canDraw = Boolean(
    config.lotteryEnabled && configured && nextOpportunity,
  )
  return {
    enabled: Boolean(config.lotteryEnabled),
    configured,
    isRoot: auth.isRoot,
    ruleVersion: lotteryRuleVersion,
    periodKey: range.key,
    weekStart: range.start,
    weekEnd: range.end,
    timeZone: config.timeZone,
    prizesByRank: pools.map((pool) =>
      pool.map((prize) => ({
        amountUsd: prize.amountUsd,
        weight: prize.weight,
      })),
    ),
    winners: currentWeekOpportunities.map((opportunity) =>
      lotteryOpportunityPayload(opportunity, {
        isMe: opportunity.isMe,
        includeUsage: auth.isRoot,
      }),
    ),
    opportunities: myOpportunities.map((opportunity) =>
      lotteryOpportunityPayload(opportunity, {
        isMe: true,
        includeUsage: auth.isRoot,
      }),
    ),
    pendingOpportunities: myOpportunities.filter(
      (opportunity) =>
        !opportunity.draw || opportunity.draw.status === 'failed',
    ).length,
    me: currentWeekMyOpportunity
      ? {
          periodKey: currentWeekMyOpportunity.periodKey,
          rank: currentWeekMyOpportunity.rank,
          prizes: currentWeekMyOpportunity.pool.map((prize) => ({
            amountUsd: prize.amountUsd,
            weight: prize.weight,
          })),
          canDraw: Boolean(
            config.lotteryEnabled &&
              configured &&
              (!currentWeekMyDraw || currentWeekMyDraw.status === 'failed'),
          ),
          draw: currentWeekMyDraw
            ? lotteryDrawPayload(currentWeekMyDraw, true)
            : null,
        }
      : null,
    nextDraw: nextOpportunity
      ? {
          periodKey: nextOpportunity.periodKey,
          weekStart: nextOpportunity.range.start,
          weekEnd: nextOpportunity.range.end,
          rank: nextOpportunity.rank,
          prizes: nextOpportunity.pool.map((prize) => ({
            amountUsd: prize.amountUsd,
            weight: prize.weight,
          })),
          draw: nextOpportunity.draw
            ? lotteryDrawPayload(nextOpportunity.draw, true)
            : null,
        }
      : null,
    canDraw,
    weeklyHistory,
    adminIssues: auth.isRoot
      ? db.listUnknownLotteryDraws(lotteryRuleVersion).map((draw) => ({
          ...lotteryDrawPayload(draw, true),
          userId: Number(draw.user_id),
          userName:
            draw.source_name ||
            draw.username ||
            draw.display_name_snapshot ||
            `用户 #${draw.user_id}`,
        }))
      : undefined,
  }
}

export function createApplication(config, options = {}) {
  const db = options.db || createDatabase(config.databasePath)
  const lotteryDb =
    options.lotteryDb || createLotterySiteDatabase(config.databasePath)
  const client =
    options.client ||
    new NewApiClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.requestTimeoutMs,
  })
  const synchronizer =
    options.synchronizer || new UsageSynchronizer({ db, client, config })
  const postpaidService =
    options.postpaidService || new PostpaidService({ db, client, config })
  const syncLimiter = createRateLimiter({ windowMs: 60_000, limit: 1 })
  const sponsorLimiter = createRateLimiter({ windowMs: 60_000, limit: 6 })
  const lotteryLimiter = createRateLimiter({ windowMs: 60_000, limit: 6 })
  const postpaidLimiter = createRateLimiter({ windowMs: 60_000, limit: 3 })
  const leaderboardBasePath = config.basePath || ''
  const modelStatusBasePath = config.modelStatusBasePath ?? '/modelstatus'
  const lotterySiteBasePath = config.lotterySiteBasePath ?? '/lottery'

  async function authenticateSession(req) {
    const user = await client.getSessionUser(req.headers.authorization || '')
    return user
  }

  async function authenticate(req) {
    const user = await authenticateSession(req)
    const userId = Number(user.id)
    const sourceName = String(user.display_name || user.username || '').trim()
    const entry = db.ensureAnonymousEntry(
      userId,
      Math.floor(Date.now() / 1000),
      sourceName,
    )
    return {
      user,
      entry,
      isRoot: userId === Number(config.rootUserId),
    }
  }

  function requireMutationRequest(req) {
    if (config.previewMode) {
      const error = new Error('本地预览不执行写操作')
      error.status = 403
      throw error
    }
    if (req.headers['x-leaderboard-request'] !== '1') {
      const error = new Error('写请求来源无效')
      error.status = 403
      throw error
    }
    const origin = req.headers.origin
    if (origin && config.publicUrl) {
      const expectedOrigin = new URL(config.publicUrl).origin
      if (origin !== expectedOrigin) {
        const error = new Error('写请求来源无效')
        error.status = 403
        throw error
      }
    }
  }

  const lotterySite =
    options.lotterySite ||
    createLotterySite({
    db: lotteryDb,
    client,
    config,
    requireMutationRequest,
  })

  function mePayload(auth) {
    const entry = db.getEntryByUserId(Number(auth.user.id))
    const renamePeriodKey = periodKey('week', {
      timeZone: config.timeZone,
      allStartTimestamp: config.allStartTimestamp,
    })
    const renameCards = db.getRenameCardBalance(Number(auth.user.id))
    const freeRenameUsed = Boolean(
      db.getWeeklyFreeRenameEvent(Number(auth.user.id), renamePeriodKey),
    )
    const supportActivity = supportContext(db, config).forUser(
      Number(auth.user.id),
    )
    const rankProgress = rankContext(db, config).forUser(Number(auth.user.id))
    const openPostpaidGrants = db.listOpenPostpaidGrantsForUser(
      Number(auth.user.id),
    )
    const postpaidLimit = postpaidCreditForTier(
      rankProgress.tierKey,
      rankProgress.division,
    )
    const postpaidOutstandingQuota = db.getPostpaidExposure(
      Number(auth.user.id),
    )
    const postpaidOutstanding = postpaidOutstandingQuota / config.quotaPerUnit
    const postpaidAvailable = Math.max(
      0,
      Math.floor(
      (postpaidLimit * config.quotaPerUnit - postpaidOutstandingQuota) /
        config.quotaPerUnit,
      ),
    )
    const postpaidApplicationPending = openPostpaidGrants.some((grant) =>
      ['processing', 'unknown'].includes(grant.status),
    )
    const nextPostpaidDueAt = openPostpaidGrants
      .filter((grant) => ['active', 'overdue'].includes(grant.status))
      .reduce((earliest, grant) => {
        const dueAt = Number(grant.due_at) || 0
        return dueAt > 0 && (!earliest || dueAt < earliest) ? dueAt : earliest
      }, 0)
    const sponsorBadge = sponsorBadgeForAmount(
      supportActivity.sponsorAmountCny,
      {
      includePoints: true,
      },
    )
    return {
      id: Number(auth.user.id),
      username: String(auth.user.username || ''),
      identityName: String(
        auth.user.display_name || auth.user.username || `用户 #${auth.user.id}`,
      ),
      quota: Number(auth.user.quota || 0),
      balanceUsd: Number(auth.user.quota || 0) / config.quotaPerUnit,
      isRoot: auth.isRoot,
      entry: {
        displayName: entry.display_name,
        currentName: entry.is_name_public
          ? entry.display_name
          : entry.anonymous_name,
        anonymousName: entry.anonymous_name,
        isNamePublic: Boolean(entry.is_name_public),
        participating: Boolean(entry.participating),
        visibility: visibilitySettingsFromEntry(entry),
      },
      rename: {
        periodKey: renamePeriodKey,
        freeAvailable: !freeRenameUsed,
        freeUsed: freeRenameUsed,
        cardBalance: renameCards,
        cardPriceCny: 1,
      },
      supportActivity: {
        points: supportActivity.points,
        totalEarnedPoints: supportActivity.totalEarnedPoints,
        tokenPoints: supportActivity.tokenPoints,
        sponsorPoints: supportActivity.sponsorPoints,
        sponsorAmountCny: supportActivity.sponsorAmountCny,
        sponsorCount: supportActivity.sponsorCount,
        tier: supportActivity.tier?.key || '',
        tierName: supportActivity.tier?.name || '',
        lit: supportActivity.lit,
        expiredDays: supportActivity.expiredDays,
        activeUntil: supportActivity.activeUntil || 0,
        lastActiveAt: supportActivity.lastActiveAt || 0,
        activeDays: config.supportActivityActiveDays,
      },
      sponsorBadge,
      rankProgress,
      postpaid: {
        configured: isRootConfigured(config),
        creditLimit: postpaidLimit,
        availableCredit: postpaidAvailable,
        outstandingAmount: postpaidOutstanding,
        nextDueAt: nextPostpaidDueAt,
        applicationPending: postpaidApplicationPending,
        canApply:
          isRootConfigured(config) &&
          postpaidAvailable > 0 &&
          !postpaidApplicationPending,
        activeGrant: postpaidGrantPayload(
          openPostpaidGrants.find((grant) =>
            ['active', 'overdue'].includes(grant.status),
          ) || openPostpaidGrants[0],
          config.quotaPerUnit,
          true,
        ),
        openGrants: openPostpaidGrants.map((grant) =>
          postpaidGrantPayload(grant, config.quotaPerUnit, true),
        ),
        grants: db
          .listUserPostpaidGrants(Number(auth.user.id), 12)
          .map((grant) =>
            postpaidGrantPayload(grant, config.quotaPerUnit, true),
          ),
        events: db
          .listUserPostpaidEvents(Number(auth.user.id), 30)
          .map((event) => postpaidEventPayload(event, config.quotaPerUnit)),
      },
      sponsorActivity: {
        amountCny: supportActivity.sponsorAmountCny,
        sponsorCount: supportActivity.sponsorCount,
        activity: supportActivity.points,
        lit: supportActivity.lit,
        expiredDays: supportActivity.expiredDays,
        activeUntil: supportActivity.activeUntil || 0,
        lastCompletedAt: supportActivity.lastActiveAt || 0,
        activeDays: config.supportActivityActiveDays,
      },
      sponsorships: db
        .listSponsorHistory(Number(auth.user.id))
        .map((order) => sponsorOrderPayload(order, true)),
    }
  }

  async function handleApi(req, res, url, auth) {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      requireMutationRequest(req)

    if (req.method === 'GET' && url.pathname === '/api/app/status') {
      const state = synchronizer.getState()
      return json(res, 200, {
        success: true,
        data: {
          ...state,
          timeZone: config.timeZone,
          version: {
            commit: config.appGitCommit || '',
            deployedAt: Number(config.appDeployedAt) || 0,
          },
          memberCount: db.countUsedEntries(),
          user: mePayload(auth),
          sponsorRules: {
            minAmount: config.sponsorMinAmount,
            maxAmount: config.sponsorMaxAmount,
            quotaPerUnit: config.quotaPerUnit,
            badgeActiveDays: config.supportActivityActiveDays,
            supportStartTimestamp: config.supportActivityStartTimestamp,
          },
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      return json(res, 200, { success: true, data: mePayload(auth) })
    }

    if (req.method === 'PATCH' && url.pathname === '/api/me') {
      const body = await readJson(req)
      const entry = db.getEntryByUserId(Number(auth.user.id))
      const now = Math.floor(Date.now() / 1000)
      const renamePeriodKey = periodKey('week', {
        timeZone: config.timeZone,
        allStartTimestamp: config.allStartTimestamp,
      })
      // Root is not exempt; only blocked members are. See GET /api/me.
      db.transaction(() => {
        if (typeof body.displayName !== 'undefined') {
          const displayName = cleanText(body.displayName, {
            min: 1,
            max: displayNameMaxLength,
            label: '排行榜名称',
          })
          if (displayName !== entry.display_name) {
            // Everyone renames on the same terms — the weekly free slot first,
            // then a card. No account is exempt, root included. Historical
            // events may still carry cost_type 'unlimited'.
            let costType = 'free'
            if (
              db.getWeeklyFreeRenameEvent(Number(auth.user.id), renamePeriodKey)
            ) {
              if (db.consumeRenameCard(Number(auth.user.id), now) === 0) {
                const error = new Error('本周免费改名已用完，请购买改名卡')
                error.status = 402
                throw error
              }
              costType = 'card'
            }
            db.updateEntryName(entry.id, displayName)
            db.createRenameEvent({
              id: randomUUID(),
              userId: Number(auth.user.id),
              entryId: entry.id,
              oldName: entry.display_name,
              newName: displayName,
              costType,
              periodKey: renamePeriodKey,
              createdAt: now,
            })
          }
        }
        if (typeof body.isNamePublic === 'boolean') {
          db.publishEntryName(entry.id, body.isNamePublic)
        }
        if (typeof body.participating === 'boolean') {
          const current = visibilitySettingsFromEntry(entry)
          db.updateVisibilitySettings(entry.id, {
            participateDay: body.participating,
            participateWeek: body.participating,
            participateMonth: body.participating,
            participateAll: body.participating,
            participateRank: body.participating,
            showRankBadge: current.showRankBadge,
          })
        }
        const visibility =
          body.visibility && typeof body.visibility === 'object'
          ? body.visibility
          : null
        if (visibility) {
          const current = visibilitySettingsFromEntry(entry)
          db.updateVisibilitySettings(entry.id, {
            participateDay:
              typeof visibility.participateDay === 'boolean'
                ? visibility.participateDay
                : current.participateDay,
            participateWeek:
              typeof visibility.participateWeek === 'boolean'
                ? visibility.participateWeek
                : current.participateWeek,
            participateMonth:
              typeof visibility.participateMonth === 'boolean'
                ? visibility.participateMonth
                : current.participateMonth,
            participateAll:
              typeof visibility.participateAll === 'boolean'
                ? visibility.participateAll
                : current.participateAll,
            participateRank:
              typeof visibility.participateRank === 'boolean'
                ? visibility.participateRank
                : current.participateRank,
            showRankBadge:
              typeof visibility.showRankBadge === 'boolean'
                ? visibility.showRankBadge
                : current.showRankBadge,
          })
        }
      })
      return json(res, 200, {
        success: true,
        data: mePayload({ ...auth, entry: db.getEntry(entry.id) }),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/postpaid/apply') {
      if (!postpaidLimiter(`${auth.user.id}:${clientIp(req)}`)) {
        return json(res, 429, {
          success: false,
          message: '操作过于频繁，请稍后再试',
        })
      }
      const body = await readJson(req)
      const requestKey = cleanText(body.requestKey, {
        min: 8,
        max: 80,
        label: '请求号',
      })
      if (!/^[A-Za-z0-9_-]+$/.test(requestKey)) {
        return json(res, 400, { success: false, message: '请求号无效' })
      }
      const rankProgress = rankContext(db, config).forUser(Number(auth.user.id))
      const grant = await postpaidService.grant({
        requestKey,
        userId: Number(auth.user.id),
        entryId: auth.entry.id,
        rankProgress,
        amount: body.amount,
      })
      const data = postpaidGrantPayload(grant, config.quotaPerUnit, true)
      if (grant.status === 'unknown') {
        return json(res, 202, { success: true, data })
      }
      if (grant.status === 'failed') {
        return json(res, 502, {
          success: false,
          message: grant.error_message || '额度发放失败',
          data,
        })
      }
      return json(res, 201, { success: true, data })
    }

    if (req.method === 'POST' && url.pathname === '/api/rename-cards') {
      if (!sponsorLimiter(`${auth.user.id}:rename:${clientIp(req)}`)) {
        return json(res, 429, {
          success: false,
          message: '操作过于频繁，请稍后再试',
        })
      }
      if (!config.rootAccessToken || !config.rootUserId) {
        return json(res, 503, { success: false, message: '自动扣费尚未配置' })
      }
      const body = await readJson(req)
      const requestKey = cleanText(body.requestKey, {
        min: 8,
        max: 80,
        label: '请求号',
      })
      const quantity = positiveInteger(body.quantity, '改名卡数量')
      if (quantity > 100) {
        return json(res, 400, {
          success: false,
          message: '单次最多购买 100 张改名卡',
        })
      }
      const existing = db.getRenameCardOrderByRequestKey(requestKey)
      if (existing) {
        return json(res, 200, {
          success: true,
          data: renameCardOrderPayload(existing, true),
        })
      }
      const entry = db.getEntryByUserId(Number(auth.user.id))
      const amountCny = quantity
      const quotaAmount = Math.round(amountCny * config.quotaPerUnit)
      const user = await client.getUser(
        Number(auth.user.id),
        config.rootUserId,
        config.rootAccessToken,
      )
      if (Number(user.quota) < quotaAmount) {
        return json(res, 400, { success: false, message: '账户余额不足' })
      }
      let order
      try {
        order = db.createRenameCardOrder({
          id: randomUUID(),
          requestKey,
          userId: Number(auth.user.id),
          entryId: entry.id,
          quantity,
          amountCny,
          quotaAmount,
          operatorUserId: config.rootUserId,
          createdAt: Math.floor(Date.now() / 1000),
        })
      } catch (error) {
        if (
          /idx_rename_card_user_processing|UNIQUE constraint failed/i.test(
            error.message,
          )
        ) {
          return json(res, 409, {
            success: false,
            message: '已有改名卡订单正在处理',
          })
        }
        throw error
      }

      try {
        await client.decreaseUserQuota(
          Number(auth.user.id),
          quotaAmount,
          config.rootUserId,
          config.rootAccessToken,
        )
        const now = Math.floor(Date.now() / 1000)
        db.transaction(() => {
          db.finishRenameCardOrder(order.id, 'completed', '', now)
          db.addRenameCards(Number(auth.user.id), quantity, now)
        })
        return json(res, 201, {
          success: true,
          data: renameCardOrderPayload(db.getRenameCardOrder(order.id)),
        })
      } catch (error) {
        const uncertain = error.status === 504 || !error.details
        const status = uncertain ? 'unknown' : 'failed'
        const now = Math.floor(Date.now() / 1000)
        db.finishRenameCardOrder(order.id, status, error.message, now)
        const saved = db.getRenameCardOrder(order.id)
        if (uncertain) {
          return json(res, 202, {
            success: true,
            data: renameCardOrderPayload(saved, true),
          })
        }
        return json(res, 502, {
          success: false,
          message: error.message,
          data: renameCardOrderPayload(saved, true),
        })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
      const period = url.searchParams.get('period') || 'day'
      if (!['day', 'week', 'month', 'all'].includes(period)) {
        return json(res, 400, { success: false, message: '排行榜周期无效' })
      }
      return json(res, 200, {
        success: true,
        data: leaderboardPayload(db, config, period),
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/ranks') {
      return json(res, 200, {
        success: true,
        data: rankPayload(db, config),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/leaderboard/refresh') {
      if (!syncLimiter(clientIp(req))) {
        return json(res, 429, { success: false, message: '刷新过于频繁' })
      }
      if (!synchronizer.getState().configured) {
        return json(res, 503, {
          success: false,
          message: 'Root 同步账户尚未配置',
        })
      }
      await synchronizer.sync()
      return json(res, 200, { success: true })
    }

    if (req.method === 'GET' && url.pathname === '/api/sponsors') {
      const period = url.searchParams.get('period') || 'month'
      if (!['month', 'quarter', 'year', 'all'].includes(period)) {
        return json(res, 400, { success: false, message: '赞助榜周期无效' })
      }
      return json(res, 200, {
        success: true,
        data: sponsorPayload(db, config, period),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/sponsors') {
      if (!sponsorLimiter(`${auth.user.id}:${clientIp(req)}`)) {
        return json(res, 429, {
          success: false,
          message: '操作过于频繁，请稍后再试',
        })
      }
      if (!config.rootAccessToken || !config.rootUserId) {
        return json(res, 503, { success: false, message: '赞助扣费尚未配置' })
      }
      const body = await readJson(req)
      const requestKey = cleanText(body.requestKey, {
        min: 16,
        max: 80,
        label: '请求编号',
      })
      if (!/^[A-Za-z0-9_-]+$/.test(requestKey)) {
        return json(res, 400, { success: false, message: '请求编号无效' })
      }
      const amountCny = positiveInteger(body.amountCny, '赞助金额')
      if (
        amountCny < config.sponsorMinAmount ||
        amountCny > config.sponsorMaxAmount
      ) {
        return json(res, 400, {
          success: false,
          message: `赞助金额应为 ${config.sponsorMinAmount}-${config.sponsorMaxAmount} 元`,
        })
      }
      const message = cleanText(body.message, {
        min: 0,
        max: 80,
        label: '留言',
      })
      const existing = db.getSponsorOrderByRequestKey(requestKey)
      if (existing) {
        if (Number(existing.user_id) !== Number(auth.user.id)) {
          return json(res, 409, {
            success: false,
            message: '请求编号已被使用',
          })
        }
        return json(res, existing.status === 'completed' ? 200 : 202, {
          success: true,
          data: sponsorOrderPayload(existing, true),
        })
      }

      const quotaAmount = amountCny * config.quotaPerUnit
      const user = await client.getUser(
        Number(auth.user.id),
        config.rootUserId,
        config.rootAccessToken,
      )
      if (Number(user.quota) < quotaAmount) {
        return json(res, 400, { success: false, message: '账户余额不足' })
      }

      let order
      try {
        order = db.createSponsorOrder({
          id: randomUUID(),
          requestKey,
          userId: Number(auth.user.id),
          entryId: auth.entry.id,
          amountCny,
          quotaAmount,
          displayAnonymously: !Boolean(auth.entry.is_name_public),
          message,
          operatorUserId: config.rootUserId,
          createdAt: Math.floor(Date.now() / 1000),
        })
      } catch (error) {
        if (
          /idx_sponsor_user_processing|UNIQUE constraint failed/i.test(
            error.message,
          )
        ) {
          return json(res, 409, {
            success: false,
            message: '已有赞助正在处理',
          })
        }
        throw error
      }

      try {
        await client.decreaseUserQuota(
          Number(auth.user.id),
          quotaAmount,
          config.rootUserId,
          config.rootAccessToken,
        )
        const now = Math.floor(Date.now() / 1000)
        db.finishSponsorOrder(order.id, 'completed', '', now)
        return json(res, 201, {
          success: true,
          data: sponsorOrderPayload(db.getSponsorOrder(order.id)),
        })
      } catch (error) {
        const uncertain = error.status === 504 || !error.details
        const status = uncertain ? 'unknown' : 'failed'
        const now = Math.floor(Date.now() / 1000)
        db.finishSponsorOrder(order.id, status, error.message, now)
        const saved = db.getSponsorOrder(order.id)
        if (uncertain) {
          return json(res, 202, {
            success: true,
            data: sponsorOrderPayload(saved, true),
          })
        }
        return json(res, 502, {
          success: false,
          message: error.message,
          data: sponsorOrderPayload(saved, true),
        })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/lottery') {
      return json(res, 200, {
        success: true,
        data: lotteryPayload(db, config, auth),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/lottery/draw') {
      if (!lotteryLimiter(`${auth.user.id}:${clientIp(req)}`)) {
        return json(res, 429, {
          success: false,
          message: '操作过于频繁，请稍后再试',
        })
      }
      if (!config.lotteryEnabled) {
        return json(res, 403, { success: false, message: '抽奖活动未开启' })
      }
      const pools = config.lotteryPrizes || []
      if (!config.rootAccessToken || !config.rootUserId || pools.length === 0) {
        return json(res, 503, { success: false, message: '抽奖发奖尚未配置' })
      }
      const range = previousWeekRange({ timeZone: config.timeZone })
      const opportunities = lotteryOpportunities(db, config, pools, auth, range)
      const myOpportunities = opportunities.filter(
        (opportunity) => opportunity.isMe,
      )
      if (myOpportunities.length === 0) {
        return json(res, 403, {
          success: false,
          message: `仅历史周消费榜前 ${pools.length} 名可以抽奖`,
        })
      }
      const opportunity = myOpportunities.find(
        (item) => !item.draw || item.draw.status === 'failed',
      )
      if (!opportunity) {
        return json(res, 403, {
          success: false,
          message: '暂无可领取的抽奖机会',
        })
      }
      const rank = opportunity.rank
      const now = Math.floor(Date.now() / 1000)
      let draw =
        opportunity.draw ||
        db.getLotteryDrawByPeriodRank(
          lotteryRuleVersion,
          opportunity.periodKey,
          rank,
        )
      if (draw && draw.status === 'completed') {
        return json(res, 200, {
          success: true,
          data: lotteryDrawPayload(draw, true),
        })
      }
      if (draw && draw.status === 'unknown') {
        return json(res, 202, {
          success: true,
          data: lotteryDrawPayload(draw, true),
        })
      }
      if (draw && draw.status === 'processing') {
        return json(res, 409, {
          success: false,
          message: '抽奖正在处理，请稍后刷新',
        })
      }
      if (draw && draw.status === 'failed') {
        if (db.restartLotteryDraw(draw.id, now) === 0) {
          return json(res, 409, {
            success: false,
            message: '抽奖正在处理，请稍后刷新',
          })
        }
        draw = db.getLotteryDraw(draw.id)
      }
      if (!draw) {
        const prize = pickLotteryPrize(opportunity.pool)
        draw = db.createLotteryDraw({
          id: randomUUID(),
          ruleVersion: lotteryRuleVersion,
          periodKey: opportunity.periodKey,
          rank,
          userId: Number(auth.user.id),
          entryId: opportunity.entryId,
          displayNameSnapshot: opportunity.displayName,
          amountUsd: prize.amountUsd,
          quotaAmount: Math.round(prize.amountUsd * config.quotaPerUnit),
          operatorUserId: config.rootUserId,
          createdAt: now,
        })
        if (!draw || draw.status !== 'processing') {
          return json(res, 409, {
            success: false,
            message: '抽奖正在处理，请稍后刷新',
          })
        }
      }

      try {
        await client.increaseUserQuota(
          Number(auth.user.id),
          Number(draw.quota_amount),
          config.rootUserId,
          config.rootAccessToken,
        )
        const finishedAt = Math.floor(Date.now() / 1000)
        db.finishLotteryDraw(draw.id, 'completed', '', finishedAt)
        return json(res, 201, {
          success: true,
          data: lotteryDrawPayload(db.getLotteryDraw(draw.id), true),
        })
      } catch (error) {
        const uncertain = error.status === 504 || !error.details
        const status = uncertain ? 'unknown' : 'failed'
        const finishedAt = Math.floor(Date.now() / 1000)
        db.finishLotteryDraw(draw.id, status, error.message, finishedAt)
        const saved = db.getLotteryDraw(draw.id)
        if (uncertain) {
          return json(res, 202, {
            success: true,
            data: lotteryDrawPayload(saved, true),
          })
        }
        return json(res, 502, {
          success: false,
          message: error.message,
          data: lotteryDrawPayload(saved, true),
        })
      }
    }

    const lotteryResolutionMatch = /^\/api\/admin\/lottery\/([^/]+)$/.exec(
      url.pathname,
    )
    if (req.method === 'PATCH' && lotteryResolutionMatch) {
      if (!auth.isRoot) {
        return json(res, 403, { success: false, message: '无权访问' })
      }
      const drawId = decodeURIComponent(lotteryResolutionMatch[1])
      const draw = db.getLotteryDraw(drawId)
      if (!draw || Number(draw.rule_version) !== lotteryRuleVersion) {
        return json(res, 404, { success: false, message: '抽奖记录不存在' })
      }
      if (draw.status !== 'unknown') {
        return json(res, 409, {
          success: false,
          message: '该记录无需人工核查',
        })
      }
      const body = await readJson(req)
      if (!['completed', 'failed'].includes(body.resolution)) {
        return json(res, 400, { success: false, message: '核查结果无效' })
      }
      const message =
        body.resolution === 'completed'
          ? 'Root 已确认额度到账'
          : 'Root 已确认额度未到账，可重新领取'
      const now = Math.floor(Date.now() / 1000)
      if (
        db.resolveUnknownLotteryDraw(draw.id, body.resolution, message, now) ===
        0
      ) {
        return json(res, 409, { success: false, message: '该记录已被处理' })
      }
      return json(res, 200, {
        success: true,
        data: lotteryDrawPayload(db.getLotteryDraw(draw.id), true),
      })
    }

    if (url.pathname === '/api/admin/excluded-users') {
      if (!auth.isRoot) {
        return json(res, 403, { success: false, message: '无权访问' })
      }

      if (req.method === 'GET') {
        return json(res, 200, {
          success: true,
          data: {
            userIds: [...excludedUserIdSet(db, config)].sort((a, b) => a - b),
          },
        })
      }

      if (req.method === 'PUT') {
        requireMutationRequest(req)
        const body = await readJson(req)
        if (!Array.isArray(body.userIds)) {
          return json(res, 400, {
            success: false,
            message: '屏蔽名单格式无效',
          })
        }
        if (body.userIds.length > 500) {
          return json(res, 400, {
            success: false,
            message: '屏蔽名单最多 500 个用户',
          })
        }
        const userIds = []
        for (const raw of body.userIds) {
          const id = Number(raw)
          if (!Number.isInteger(id) || id <= 0) {
            return json(res, 400, {
              success: false,
              message: `用户 ID 无效：${raw}`,
            })
          }
          if (!userIds.includes(id)) userIds.push(id)
        }
        userIds.sort((a, b) => a - b)
        db.setSetting(EXCLUDED_USERS_SETTING, userIds)
        return json(res, 200, { success: true, data: { userIds } })
      }
    }

    // Root view of every sponsorship. The broken ones are not split out into
    // their own endpoint; the admin panel sorts them to the top instead.
    if (req.method === 'GET' && url.pathname === '/api/admin/sponsors') {
      if (!auth.isRoot) {
        return json(res, 403, { success: false, message: '无权访问' })
      }
      const summary = { totalAmountCny: 0, completedCount: 0, orderCount: 0 }
      const orders = db.listAllSponsorOrders().map((order) => {
        summary.orderCount += 1
        if (order.status === 'completed') {
          summary.completedCount += 1
          summary.totalAmountCny += Number(order.amount_cny)
        }
        return {
          ...sponsorOrderPayload(order, true),
          userId: Number(order.entry_user_id),
          displayName: order.public_name,
        }
      })
      return json(res, 200, { success: true, data: { summary, orders } })
    }

    // Root view of rename cards. Sales and spends ship together because
    // neither half answers the operator's question alone: cards sold is
    // revenue, renames charged to a card is what that revenue bought, and the
    // gap between them is the balance still owed to users.
    //
    // Names are real here rather than anonymised. Every rename event already
    // spells out the old and new display name, so hiding the buyer's name
    // would obscure nothing while making the two lists impossible to line up.
    if (req.method === 'GET' && url.pathname === '/api/admin/rename-cards') {
      if (!auth.isRoot) {
        return json(res, 403, { success: false, message: '无权访问' })
      }
      const summary = {
        orderCount: 0,
        completedCount: 0,
        cardsSold: 0,
        totalAmountCny: 0,
        outstandingCards: db.renameCardOutstanding(),
        renameCount: 0,
        cardRenameCount: 0,
        freeRenameCount: 0,
      }
      const orders = db.listAllRenameCardOrders().map((order) => {
        summary.orderCount += 1
        if (order.status === 'completed') {
          summary.completedCount += 1
          summary.cardsSold += Number(order.quantity)
          summary.totalAmountCny += Number(order.amount_cny)
        }
        return {
          ...renameCardOrderPayload(order, true),
          userId: Number(order.entry_user_id),
          displayName: order.display_name,
        }
      })
      const events = db.listAllRenameEvents().map((event) => {
        summary.renameCount += 1
        if (event.cost_type === 'card') summary.cardRenameCount += 1
        if (event.cost_type === 'free') summary.freeRenameCount += 1
        return {
          id: event.id,
          userId: Number(event.user_id),
          oldName: event.old_name,
          newName: event.new_name,
          costType: event.cost_type,
          createdAt: Number(event.created_at),
        }
      })
      return json(res, 200, {
        success: true,
        data: { summary, orders, events },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/postpaid') {
      if (!auth.isRoot) {
        return json(res, 403, { success: false, message: '无权访问' })
      }
      db.markPostpaidOverdue(Math.floor(Date.now() / 1000))
      const summary = db.postpaidSummary()
      return json(res, 200, {
        success: true,
        data: {
          state: postpaidService.getState(),
          summary: {
            grantCount: Number(summary.grant_count),
            userCount: Number(summary.user_count),
            outstandingAmount:
              Number(summary.outstanding_quota) / config.quotaPerUnit,
            overdueAmount: Number(summary.overdue_quota) / config.quotaPerUnit,
            grantedAmount: Number(summary.granted_quota) / config.quotaPerUnit,
            repaidAmount: Number(summary.repaid_quota) / config.quotaPerUnit,
          },
          grants: db.listAdminPostpaidGrants(100).map((grant) => ({
            ...postpaidGrantPayload(grant, config.quotaPerUnit, true),
            userId: Number(grant.user_id),
            displayName:
              grant.source_name ||
              grant.username ||
              grant.public_name ||
              `用户 #${grant.user_id}`,
          })),
          events: db
            .listAdminPostpaidEvents(200)
            .map((event) =>
              postpaidEventPayload(event, config.quotaPerUnit, true),
            ),
        },
      })
    }

    return json(res, 404, { success: false, message: '接口不存在' })
  }

  async function handleModelStatusApi(req, res, url, user) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { success: false, message: '方法不允许' })
    }

    if (url.pathname === '/api/status') {
      return json(res, 200, {
        success: true,
        data: {
          user: {
            id: Number(user.id),
            username: String(user.username || ''),
            displayName: String(
              user.display_name || user.username || `用户 #${user.id}`,
            ),
          },
        },
      })
    }

    if (url.pathname === '/api/summary') {
      const data = await client.getPerfMetricsSummary(
        req.headers.authorization || '',
      )
      return json(res, 200, { success: true, data })
    }

    if (url.pathname === '/api/metrics') {
      const data = await client.getPerfMetrics(
        {
          model: url.searchParams.get('model') || '',
          group: url.searchParams.get('group') || '',
        },
        req.headers.authorization || '',
      )
      return json(res, 200, { success: true, data })
    }

    return json(res, 404, { success: false, message: '接口不存在' })
  }

  function resolveSite(pathname) {
    if (lotterySiteBasePath) {
      const localPath = stripBasePath(pathname, lotterySiteBasePath)
      if (localPath !== null) {
        return {
          name: 'lottery',
          basePath: lotterySiteBasePath,
          localPath,
        }
      }
    }

    if (modelStatusBasePath) {
      const localPath = stripBasePath(pathname, modelStatusBasePath)
      if (localPath !== null) {
        return {
          name: 'models',
          basePath: modelStatusBasePath,
          localPath,
        }
      }
    }

    const localPath = stripBasePath(pathname, leaderboardBasePath)
    if (localPath !== null) {
      return {
        name: 'leaderboard',
        basePath: leaderboardBasePath,
        localPath,
      }
    }

    return null
  }

  const requestListener = async (req, res) => {
    const externalUrl = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && externalUrl.pathname === '/healthz') {
      return json(res, 200, {
        success: true,
        data: {
          service: 'new-api-companion',
          version: {
            commit: config.appGitCommit || '',
            deployedAt: Number(config.appDeployedAt) || 0,
          },
        },
      })
    }
    const site = resolveSite(externalUrl.pathname)
    if (!site) {
      return json(res, 404, { success: false, message: '接口不存在' })
    }
    const url = new URL(externalUrl)
    url.pathname = site.localPath

    try {
      if (
        site.name === 'lottery' &&
        externalUrl.pathname === site.basePath &&
        site.basePath
      ) {
        res.writeHead(302, {
          Location: `${site.basePath}/`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end()
        return
      }
      if (url.pathname.startsWith('/api/')) {
        if (site.name === 'models') {
          const user = await authenticateSession(req)
          await handleModelStatusApi(req, res, url, user)
        } else if (site.name === 'lottery') {
          const user = await authenticateSession(req)
          await lotterySite.handleApi(req, res, url, user)
        } else if (config.coreLeaderboardEnabled) {
          json(res, 410, {
            success: false,
            message: '排行榜功能已迁移到 Core',
          })
        } else {
          const auth = await authenticate(req)
          await handleApi(req, res, url, auth)
        }
        return
      }
      if (
        site.name === 'lottery' &&
        req.method === 'GET' &&
        serveStatic(lotterySitePublicDir, url.pathname, res)
      ) {
        return
      }
      json(res, 404, { success: false, message: '接口不存在' })
    } catch (error) {
      const status =
        error.status || (error instanceof NewApiError ? error.status : 500)
      const message =
        status >= 500 && !(error instanceof NewApiError)
        ? '服务暂时不可用'
        : error.message
      if (status >= 500) console.error(error)
      json(res, status, { success: false, message })
    }
  }

  const server =
    config.tlsCertPath && config.tlsKeyPath
    ? https.createServer(
      {
        cert: fs.readFileSync(config.tlsCertPath),
        key: fs.readFileSync(config.tlsKeyPath),
      },
      requestListener,
    )
    : http.createServer(requestListener)

  return {
    server,
    db,
    synchronizer,
    postpaidService,
    lotteryDb,
    lotterySite,
    start() {
      if (!config.coreLeaderboardEnabled) {
        synchronizer.start()
        postpaidService.start()
      }
      lotterySite.start()
    },
    close() {
      synchronizer.stop()
      postpaidService.stop()
      lotterySite.close()
      lotteryDb.close()
      db.close()
    },
  }
}
