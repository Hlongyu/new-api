import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { loadConfig } from '../src/config.js'

test('解析去重后的排除用户 ID 列表', () => {
  const config = loadConfig({
    LEADERBOARD_EXCLUDED_USER_IDS: '1, 2 2,abc,-3,4x, 5',
  })

  assert.deepEqual(config.excludedUserIds, [1, 2, 5])
})

test('TLS 证书和私钥必须成对配置', () => {
  assert.throws(
    () => loadConfig({ TLS_CERT_PATH: './data/tls/server.crt' }),
    /必须同时配置/,
  )

  const config = loadConfig({
    TLS_CERT_PATH: './data/tls/server.crt',
    TLS_KEY_PATH: './data/tls/server.key',
  })
  assert.equal(config.tlsCertPath, path.resolve('./data/tls/server.crt'))
  assert.equal(config.tlsKeyPath, path.resolve('./data/tls/server.key'))
})

test('解析挂载路径和赞助额度换算配置', () => {
  const config = loadConfig({
    BASE_PATH: 'leaderboard/',
    MODEL_STATUS_BASE_PATH: 'model-status/',
    LOTTERY_SITE_BASE_PATH: 'midnight-vault/',
    LOTTERY_FULFILLMENT_INTERVAL_SECONDS: '20',
    POSTPAID_SYNC_INTERVAL_SECONDS: '25',
    APP_GIT_COMMIT: '85863669e6456643c74af097f3ac73af5aa83445',
    APP_DEPLOYED_AT: '1785830400',
    PUBLIC_URL: 'https://code.xxcd.top/leaderboard/',
    NEW_API_QUOTA_PER_UNIT: '500000',
    SPONSOR_MIN_AMOUNT: '2',
    SPONSOR_MAX_AMOUNT: '800',
    SPONSOR_BADGE_ACTIVE_DAYS: '45',
    SUPPORT_ACTIVITY_ACTIVE_DAYS: '3',
    SUPPORT_ACTIVITY_START_TIMESTAMP: '1784217600',
  })

  assert.equal(config.basePath, '/leaderboard')
  assert.equal(config.modelStatusBasePath, '/model-status')
  assert.equal(config.lotterySiteBasePath, '/midnight-vault')
  assert.equal(config.lotteryFulfillmentIntervalMs, 20_000)
  assert.equal(config.postpaidSyncIntervalMs, 25_000)
  assert.equal(config.appGitCommit, '85863669e6456643c74af097f3ac73af5aa83445')
  assert.equal(config.appDeployedAt, 1_785_830_400)
  assert.equal(config.publicUrl, 'https://code.xxcd.top/leaderboard')
  assert.equal(config.quotaPerUnit, 500_000)
  assert.equal(config.sponsorMinAmount, 2)
  assert.equal(config.sponsorMaxAmount, 800)
  assert.equal(config.sponsorBadgeActiveDays, 45)
  assert.equal(config.supportActivityActiveDays, 3)
  assert.equal(config.supportActivityStartTimestamp, 1_784_217_600)
})
