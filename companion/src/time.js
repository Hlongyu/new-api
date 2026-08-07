function partsFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

function offsetMinutesAt(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
  const value = formatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
  if (!value || value === 'GMT') return 0
  const match = value.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  if (!match) throw new Error(`无法解析时区偏移：${timeZone}`)
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

export function zonedStartUnix(year, month, day, timeZone) {
  const approximate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  let epoch = approximate.getTime() - offsetMinutesAt(approximate, timeZone) * 60_000
  const corrected = new Date(epoch)
  epoch = approximate.getTime() - offsetMinutesAt(corrected, timeZone) * 60_000
  return Math.floor(epoch / 1000)
}

export function zonedDayStartFromKey(key, timeZone = 'Asia/Shanghai') {
  const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`无效日期键：${key}`)
  return zonedStartUnix(Number(match[1]), Number(match[2]), Number(match[3]), timeZone)
}

export function zonedDayKey(timestamp, timeZone = 'Asia/Shanghai') {
  const parts = partsFor(new Date(Number(timestamp) * 1000), timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function currentPeriodRanges({
  now = new Date(),
  timeZone = 'Asia/Shanghai',
  allStartTimestamp = 1,
} = {}) {
  const parts = partsFor(now, timeZone)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const end = Math.floor(now.getTime() / 1000)
  const monthText = String(month).padStart(2, '0')
  const dayText = String(day).padStart(2, '0')
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const weekStartDate = new Date(
    Date.UTC(year, month - 1, day - ((weekDay + 6) % 7)),
  )
  const weekYear = weekStartDate.getUTCFullYear()
  const weekMonth = weekStartDate.getUTCMonth() + 1
  const weekDayOfMonth = weekStartDate.getUTCDate()
  const weekKey = [weekYear, weekMonth, weekDayOfMonth]
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0')))
    .join('-')

  return [
    {
      type: 'day',
      key: `${year}-${monthText}-${dayText}`,
      start: zonedStartUnix(year, month, day, timeZone),
      end,
    },
    {
      type: 'week',
      key: weekKey,
      start: zonedStartUnix(weekYear, weekMonth, weekDayOfMonth, timeZone),
      end,
    },
    {
      type: 'month',
      key: `${year}-${monthText}`,
      start: zonedStartUnix(year, month, 1, timeZone),
      end,
    },
    {
      type: 'all',
      key: 'all',
      start: allStartTimestamp,
      end,
    },
  ]
}

export function previousWeekRange({
  now = new Date(),
  timeZone = 'Asia/Shanghai',
} = {}) {
  const parts = partsFor(now, timeZone)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const currentWeekStart = new Date(
    Date.UTC(year, month - 1, day - ((weekDay + 6) % 7)),
  )
  const previousWeekStart = new Date(currentWeekStart.getTime() - 7 * 86_400_000)
  const key = [
    previousWeekStart.getUTCFullYear(),
    String(previousWeekStart.getUTCMonth() + 1).padStart(2, '0'),
    String(previousWeekStart.getUTCDate()).padStart(2, '0'),
  ].join('-')
  return {
    key,
    start: zonedStartUnix(
      previousWeekStart.getUTCFullYear(),
      previousWeekStart.getUTCMonth() + 1,
      previousWeekStart.getUTCDate(),
      timeZone,
    ),
    end: zonedStartUnix(
      currentWeekStart.getUTCFullYear(),
      currentWeekStart.getUTCMonth() + 1,
      currentWeekStart.getUTCDate(),
      timeZone,
    ),
  }
}

export function weekRangeFromKey(key, timeZone = 'Asia/Shanghai') {
  const match = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`无效周键：${key}`)
  const startDate = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ))
  const endDate = new Date(startDate.getTime() + 7 * 86_400_000)
  return {
    key,
    start: zonedStartUnix(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + 1,
      startDate.getUTCDate(),
      timeZone,
    ),
    end: zonedStartUnix(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth() + 1,
      endDate.getUTCDate(),
      timeZone,
    ),
  }
}

export function periodKey(period, options = {}) {
  const range = currentPeriodRanges(options).find((item) => item.type === period)
  if (!range) throw new Error('不支持的排行榜周期')
  return range.key
}

export function sponsorPeriodRange(period, {
  now = new Date(),
  timeZone = 'Asia/Shanghai',
  allStartTimestamp = 1,
} = {}) {
  const parts = partsFor(now, timeZone)
  const year = Number(parts.year)
  const month = Number(parts.month)
  const end = Math.floor(now.getTime() / 1000) + 1
  if (period === 'month') {
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      start: zonedStartUnix(year, month, 1, timeZone),
      end,
    }
  }
  if (period === 'quarter') {
    const quarter = Math.floor((month - 1) / 3) + 1
    const startMonth = (quarter - 1) * 3 + 1
    return {
      key: `${year}-Q${quarter}`,
      start: zonedStartUnix(year, startMonth, 1, timeZone),
      end,
    }
  }
  if (period === 'year') {
    return {
      key: String(year),
      start: zonedStartUnix(year, 1, 1, timeZone),
      end,
    }
  }
  if (period === 'all') {
    return { key: 'all', start: allStartTimestamp, end }
  }
  throw new Error('不支持的赞助榜周期')
}
