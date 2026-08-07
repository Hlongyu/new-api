import path from 'node:path'
import { parseLotteryPrizes } from './lottery.js'

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function positiveIntegerList(value) {
  return [...new Set(
    String(value ?? '')
      .split(/[\s,]+/)
      .filter((item) => /^\d+$/.test(item))
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  )]
}

function normalizeBasePath(value) {
  const path = String(value || '/leaderboard').trim()
  if (!path || path === '/') return ''
  return `/${path.replace(/^\/+|\/+$/g, '')}`
}

function normalizeOptionalBasePath(value, fallback) {
  const path = String(value ?? fallback).trim()
  if (!path || path === '/') return ''
  return `/${path.replace(/^\/+|\/+$/g, '')}`
}

export function loadConfig(env = process.env) {
  const baseUrl = (env.NEW_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const databasePath = path.resolve(
    env.DATABASE_PATH || path.join(process.cwd(), 'data', 'leaderboard.db'),
  )
  const tlsCertPath = (env.TLS_CERT_PATH ?? '').trim()
  const tlsKeyPath = (env.TLS_KEY_PATH ?? '').trim()
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new Error('TLS_CERT_PATH 与 TLS_KEY_PATH 必须同时配置')
  }
  const sponsorMinAmount = positiveInteger(env.SPONSOR_MIN_AMOUNT, 1)
  const sponsorMaxAmount = positiveInteger(env.SPONSOR_MAX_AMOUNT, 1_000)
  const sponsorBadgeActiveDays = positiveInteger(env.SPONSOR_BADGE_ACTIVE_DAYS, 30)
  const supportActivityActiveDays = positiveInteger(env.SUPPORT_ACTIVITY_ACTIVE_DAYS, 3)
  const supportActivityStartTimestamp = positiveInteger(
    env.SUPPORT_ACTIVITY_START_TIMESTAMP,
    1_784_217_600,
  )
  const rankSystemStartTimestamp = positiveInteger(
    env.RANK_SYSTEM_START_TIMESTAMP,
    1_784_304_000,
  )
  if (sponsorMaxAmount < sponsorMinAmount) {
    throw new Error('SPONSOR_MAX_AMOUNT 不能小于 SPONSOR_MIN_AMOUNT')
  }

  return {
    port: positiveInteger(env.PORT, 8787),
    basePath: normalizeBasePath(env.BASE_PATH),
    modelStatusBasePath: normalizeOptionalBasePath(env.MODEL_STATUS_BASE_PATH, '/modelstatus'),
    lotterySiteBasePath: normalizeOptionalBasePath(env.LOTTERY_SITE_BASE_PATH, '/lottery'),
    publicUrl: (env.PUBLIC_URL ?? '').trim().replace(/\/+$/, ''),
    mainSiteUrl: (env.NEW_API_PUBLIC_URL ?? '').trim().replace(/\/+$/, ''),
    tlsCertPath: tlsCertPath ? path.resolve(tlsCertPath) : '',
    tlsKeyPath: tlsKeyPath ? path.resolve(tlsKeyPath) : '',
    baseUrl,
    rootAccessToken: (env.NEW_API_ROOT_ACCESS_TOKEN ?? '').trim(),
    rootUserId: positiveInteger(env.NEW_API_ROOT_USER_ID, 0),
    timeZone: (env.LEADERBOARD_TIME_ZONE || 'Asia/Shanghai').trim(),
    syncIntervalMs:
      positiveInteger(env.LEADERBOARD_SYNC_INTERVAL_MINUTES, 5) * 60 * 1000,
    allStartTimestamp: positiveInteger(
      env.LEADERBOARD_ALL_START_TIMESTAMP,
      1,
    ),
    excludedUserIds: positiveIntegerList(env.LEADERBOARD_EXCLUDED_USER_IDS),
    databasePath,
    requestTimeoutMs: positiveInteger(env.NEW_API_REQUEST_TIMEOUT_MS, 12_000),
    quotaPerUnit: positiveInteger(env.NEW_API_QUOTA_PER_UNIT, 500_000),
    sponsorMinAmount,
    sponsorMaxAmount,
    sponsorBadgeActiveDays,
    supportActivityActiveDays,
    supportActivityStartTimestamp,
    rankSystemStartTimestamp,
    lotteryEnabled: (env.LOTTERY_ENABLED ?? 'true').trim() !== 'false',
    lotteryPrizes: parseLotteryPrizes(env.LOTTERY_PRIZES),
    lotteryFulfillmentIntervalMs:
      positiveInteger(env.LOTTERY_FULFILLMENT_INTERVAL_SECONDS, 15) * 1000,
    lotteryRedemptionIntervalMs:
      positiveInteger(env.LOTTERY_REDEMPTION_INTERVAL_SECONDS, 60) * 1000,
    postpaidSyncIntervalMs:
      positiveInteger(env.POSTPAID_SYNC_INTERVAL_SECONDS, 30) * 1000,
    appGitCommit: String(env.APP_GIT_COMMIT || '').trim(),
    appDeployedAt: positiveInteger(env.APP_DEPLOYED_AT, 0),
  }
}

export function isRootConfigured(config) {
  return Boolean(
    config.baseUrl && config.rootAccessToken && config.rootUserId > 0,
  )
}
