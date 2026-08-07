import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSupportActivity } from '../src/support.js'

const start = Date.parse('2026-07-16T16:00:00.000Z') / 1000
const day2 = Date.parse('2026-07-17T16:00:00.000Z') / 1000

test('旧赞助活跃兼容：Token 消费按当天开始前等级锁定每日贡献上限', () => {
  const result = calculateSupportActivity({
    dailyUsage: [
      { period_key: '2026-07-17', quota: 100 },
      { period_key: '2026-07-18', quota: 100 },
    ],
    sponsors: [],
    nowTimestamp: day2 + 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
    activeDays: 3,
  })

  assert.equal(result.tokenPoints, 20)
  assert.equal(result.points, 20)
  assert.equal(result.tier.key, 'silver')
})

test('旧赞助活跃兼容：同一天先计算 Token 消费，赞助可以直接跳级但不提高当天消费上限', () => {
  const result = calculateSupportActivity({
    dailyUsage: [
      { period_key: '2026-07-17', quota: 1000 },
    ],
    sponsors: [
      { amount_cny: 200, completed_at: start + 12 * 3600 },
    ],
    nowTimestamp: start + 13 * 3600,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
    activeDays: 3,
  })

  assert.equal(result.tokenPoints, 10)
  assert.equal(result.sponsorPoints, 1000)
  assert.equal(result.points, 1010)
  assert.equal(result.tier.key, 'diamond')
})

test('旧赞助活跃兼容：点亮期 3 天，过期后每天衰减 10 点', () => {
  const result = calculateSupportActivity({
    dailyUsage: [],
    sponsors: [
      { amount_cny: 10, completed_at: start },
    ],
    nowTimestamp: start + 5 * 86_400,
    timeZone: 'Asia/Shanghai',
    startTimestamp: start,
    quotaPerUnit: 1,
    activeDays: 3,
  })

  assert.equal(result.sponsorPoints, 50)
  assert.equal(result.expiredDays, 2)
  assert.equal(result.points, 30)
  assert.equal(result.lit, false)
})
