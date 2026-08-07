import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateRankProgress } from '../src/rank.js'

const start = Date.parse('2026-07-17T16:00:00.000Z') / 1000
const day = 86_400

test('历史赞助作为初始分进入同大段，但不能跨过升段赛', () => {
  const result = calculateRankProgress({
    dailyUsage: [],
    sponsors: [
      { amount_cny: 100, completed_at: start - day },
    ],
    nowTimestamp: start,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 I')
  assert.equal(result.score, 20)
  assert.equal(result.pendingScore, 420)
  assert.equal(result.promotion.targetTierName, '青铜')
})

test('小段内按分数直接升级', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 45 },
    ],
    sponsors: [],
    nowTimestamp: start,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 II')
  assert.equal(result.score, 5)
  assert.equal(result.promotion, null)
})

test('改名卡购买按双倍金额计入段位分', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 9 },
    ],
    renameCards: [
      { amount_cny: 2, completed_at: start },
    ],
    sponsors: [
      { amount_cny: 1, completed_at: start },
    ],
    nowTimestamp: start,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.tokenScore, 9)
  assert.equal(result.renameScore, 4)
  assert.equal(result.sponsorScore, 5)
  assert.equal(result.totalScore, 18)
  assert.equal(result.label, '黑铁 IV')
  assert.equal(result.score, 18)
})

test('历史改名卡购买作为初始分计入但不能跨过升段赛', () => {
  const result = calculateRankProgress({
    dailyUsage: [],
    renameCards: [
      { amount_cny: 100, completed_at: start - day },
    ],
    sponsors: [],
    nowTimestamp: start,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.renameScore, 200)
  assert.equal(result.label, '黑铁 I')
  assert.equal(result.score, 20)
  assert.equal(result.pendingScore, 120)
  assert.equal(result.promotion.targetTierName, '青铜')
})

test('升段赛成功后进入下一大段并转入待入账分', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 85 },
    ],
    sponsors: [
      { amount_cny: 100, completed_at: start - day },
    ],
    nowTimestamp: start,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.tierName, '青铜')
  assert.equal(result.division, 'I')
  assert.equal(result.score, 30)
  assert.equal(result.promotion.targetTierName, '白银')
})

test('升段赛失败后回到当前段 I 半分，待入账清零', () => {
  const result = calculateRankProgress({
    dailyUsage: [],
    sponsors: [
      { amount_cny: 100, completed_at: start - day },
    ],
    nowTimestamp: start + 3 * day,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 I')
  assert.equal(result.score, 10)
  assert.equal(result.pendingScore, 0)
  assert.equal(result.promotion, null)
})

test('升段赛最后一天未结束时不提前判定失败', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 80 },
    ],
    sponsors: [],
    nowTimestamp: start + 3 * day + 12 * 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 I')
  assert.equal(result.score, 20)
  assert.equal(result.pendingScore, 0)
  assert.equal(result.promotion.targetTierName, '青铜')
  assert.equal(result.promotion.checkedDays, 3)
  assert.equal(result.promotion.activeDays, 0)
  assert.equal(result.promotion.todayCounts, true)
  assert.equal(result.promotion.todayScore, 0)
  assert.equal(result.promotion.todayRequiredRemaining, 5)
})

test('升段赛展示今日达标分数和剩余差额', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 80 },
      { period_key: '2026-07-21', quota: 3 },
    ],
    sponsors: [],
    nowTimestamp: start + 3 * day + 12 * 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 I')
  assert.equal(result.promotion.todayCounts, true)
  assert.equal(result.promotion.todayScore, 3)
  assert.equal(result.promotion.todayRequiredRemaining, 2)
  assert.equal(result.promotion.activeDays, 0)
})

test('当天刚进入升段赛时今日不计入升段赛进度', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 80 },
    ],
    sponsors: [],
    nowTimestamp: start + 12 * 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.label, '黑铁 I')
  assert.equal(result.promotion.checkedDays, 0)
  assert.equal(result.promotion.todayCounts, false)
  assert.equal(result.promotion.todayScore, 0)
  assert.equal(result.promotion.todayRequiredRemaining, 5)
})

test('升段赛最后一天达标时立即成功', () => {
  const result = calculateRankProgress({
    dailyUsage: [
      { period_key: '2026-07-18', quota: 80 },
      { period_key: '2026-07-21', quota: 5 },
    ],
    sponsors: [],
    nowTimestamp: start + 3 * day + 12 * 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
  })

  assert.equal(result.tierName, '青铜')
  assert.equal(result.division, 'IV')
  assert.equal(result.score, 5)
  assert.equal(result.promotion, null)
})
