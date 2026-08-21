import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentPeriodRanges,
  periodKey,
  previousWeekRange,
  sponsorPeriodRange,
  usagePeriodRangeFromKey,
} from '../src/time.js'

test('按配置时区计算今日、本周、本月和总榜范围', () => {
  const now = new Date('2026-07-13T04:34:56.000Z')
  const ranges = currentPeriodRanges({
    now,
    timeZone: 'Asia/Shanghai',
    allStartTimestamp: 123,
  })

  assert.deepEqual(ranges, [
    {
      type: 'day',
      key: '2026-07-13',
      start: Date.parse('2026-07-12T16:00:00.000Z') / 1000,
      end: now.getTime() / 1000,
    },
    {
      type: 'week',
      key: '2026-07-13',
      start: Date.parse('2026-07-12T16:00:00.000Z') / 1000,
      end: now.getTime() / 1000,
    },
    {
      type: 'month',
      key: '2026-07',
      start: Date.parse('2026-06-30T16:00:00.000Z') / 1000,
      end: now.getTime() / 1000,
    },
    { type: 'all', key: 'all', start: 123, end: now.getTime() / 1000 },
  ])
  assert.equal(periodKey('week', { now, timeZone: 'Asia/Shanghai' }), '2026-07-13')
  assert.equal(periodKey('month', { now, timeZone: 'Asia/Shanghai' }), '2026-07')
})

test('本周在跨月时仍从周一零点开始', () => {
  const now = new Date('2026-08-02T07:00:00.000Z')
  const range = currentPeriodRanges({ now, timeZone: 'Asia/Shanghai' })
    .find((item) => item.type === 'week')

  assert.deepEqual(range, {
    type: 'week',
    key: '2026-07-27',
    start: Date.parse('2026-07-26T16:00:00.000Z') / 1000,
    end: now.getTime() / 1000,
  })
})

test('拒绝未知排行榜周期', () => {
  assert.throws(() => periodKey('quarter'), /不支持/)
})

test('上一周从上周一零点到本周一零点', () => {
  const now = new Date('2026-07-22T04:00:00.000Z')
  assert.deepEqual(previousWeekRange({ now, timeZone: 'Asia/Shanghai' }), {
    key: '2026-07-13',
    start: Date.parse('2026-07-12T16:00:00.000Z') / 1000,
    end: Date.parse('2026-07-19T16:00:00.000Z') / 1000,
  })

  const crossMonth = new Date('2026-08-05T04:00:00.000Z')
  assert.deepEqual(previousWeekRange({ now: crossMonth, timeZone: 'Asia/Shanghai' }), {
    key: '2026-07-27',
    start: Date.parse('2026-07-26T16:00:00.000Z') / 1000,
    end: Date.parse('2026-08-02T16:00:00.000Z') / 1000,
  })
})

test('从历史排行榜周期键还原同步范围', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')
  const options = { now, timeZone: 'Asia/Shanghai', allStartTimestamp: 123 }

  assert.deepEqual(usagePeriodRangeFromKey('day', '2026-07-13', options), {
    type: 'day',
    key: '2026-07-13',
    start: Date.parse('2026-07-12T16:00:00.000Z') / 1000,
    end: Date.parse('2026-07-13T16:00:00.000Z') / 1000,
  })
  assert.deepEqual(usagePeriodRangeFromKey('month', '2026-07', options), {
    type: 'month',
    key: '2026-07',
    start: Date.parse('2026-06-30T16:00:00.000Z') / 1000,
    end: Date.parse('2026-07-31T16:00:00.000Z') / 1000,
  })
  assert.deepEqual(usagePeriodRangeFromKey('all', 'all', options), {
    type: 'all', key: 'all', start: 123, end: now.getTime() / 1000,
  })
})

test('赞助榜按自然月、季度、年度和总榜计算', () => {
  const now = new Date('2026-07-16T04:00:00.000Z')
  const options = { now, timeZone: 'Asia/Shanghai', allStartTimestamp: 123 }

  assert.deepEqual(sponsorPeriodRange('month', options), {
    key: '2026-07',
    start: Date.parse('2026-06-30T16:00:00.000Z') / 1000,
    end: now.getTime() / 1000 + 1,
  })
  assert.deepEqual(sponsorPeriodRange('quarter', options), {
    key: '2026-Q3',
    start: Date.parse('2026-06-30T16:00:00.000Z') / 1000,
    end: now.getTime() / 1000 + 1,
  })
  assert.deepEqual(sponsorPeriodRange('year', options), {
    key: '2026',
    start: Date.parse('2025-12-31T16:00:00.000Z') / 1000,
    end: now.getTime() / 1000 + 1,
  })
  assert.deepEqual(sponsorPeriodRange('all', options), {
    key: 'all',
    start: 123,
    end: now.getTime() / 1000 + 1,
  })
})
