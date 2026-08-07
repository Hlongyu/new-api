import { zonedDayKey, zonedDayStartFromKey } from './time.js'

export const supportTiers = [
  { key: 'silver', name: '银卡', threshold: 10, dailyTokenCap: 10 },
  { key: 'gold', name: '金卡', threshold: 100, dailyTokenCap: 30 },
  { key: 'platinum', name: '白金', threshold: 250, dailyTokenCap: 50 },
  { key: 'black-gold', name: '黑金', threshold: 500, dailyTokenCap: 100 },
  { key: 'diamond', name: '钻石', threshold: 1000, dailyTokenCap: 200 },
]

const defaultTokenCap = 10

export function supportTierForPoints(points) {
  return [...supportTiers].reverse()
    .find((tier) => Number(points) >= tier.threshold) || null
}

export function dailyTokenCapForPoints(points) {
  return supportTierForPoints(points)?.dailyTokenCap || defaultTokenCap
}

function materializeDecay(state, timestamp, activeDays) {
  if (!state.lastActiveAt || state.points <= 0) return state
  const expiredSeconds = Math.max(0, timestamp - state.lastActiveAt - activeDays * 86_400)
  const expiredDays = Math.floor(expiredSeconds / 86_400)
  if (expiredDays <= state.decayedDays) return state
  const extraDays = expiredDays - state.decayedDays
  state.points = Math.max(0, state.points - extraDays * 10)
  state.decayedDays = expiredDays
  return state
}

function addContribution(state, timestamp, points, activeDays) {
  materializeDecay(state, timestamp, activeDays)
  if (points <= 0) return state
  state.points += points
  state.totalEarnedPoints += points
  state.lastActiveAt = timestamp
  state.decayedDays = 0
  return state
}

function emptyState() {
  return {
    points: 0,
    totalEarnedPoints: 0,
    tokenPoints: 0,
    sponsorPoints: 0,
    sponsorAmountCny: 0,
    sponsorCount: 0,
    lastActiveAt: 0,
    decayedDays: 0,
  }
}

export function calculateSupportActivity({
  dailyUsage = [],
  sponsors = [],
  nowTimestamp = Math.floor(Date.now() / 1000),
  timeZone = 'Asia/Shanghai',
  startTimestamp = 1784217600,
  quotaPerUnit = 500_000,
  activeDays = 3,
} = {}) {
  const state = emptyState()
  const startDayKey = zonedDayKey(startTimestamp, timeZone)
  const groupedSponsors = new Map()
  for (const sponsor of sponsors) {
    if (sponsor.status && sponsor.status !== 'completed') continue
    const amount = Math.floor(Number(sponsor.amountCny ?? sponsor.amount_cny) || 0)
    const completedAt = Number(sponsor.completedAt ?? sponsor.completed_at) || 0
    if (amount <= 0 || completedAt <= 0 || completedAt > nowTimestamp) continue
    const key = zonedDayKey(completedAt, timeZone)
    const points = amount * 5
    state.sponsorAmountCny += amount
    state.sponsorCount += 1
    state.sponsorPoints += points
    if (!groupedSponsors.has(key)) groupedSponsors.set(key, [])
    groupedSponsors.get(key).push({ completedAt, points })
  }

  const groupedUsage = new Map()
  for (const usage of dailyUsage) {
    const key = String(usage.periodKey ?? usage.period_key ?? '')
    if (!key || key < startDayKey) continue
    const quota = Math.max(0, Number(usage.quota) || 0)
    const rawPoints = Math.floor(quota / quotaPerUnit)
    if (rawPoints <= 0) continue
    groupedUsage.set(key, (groupedUsage.get(key) || 0) + rawPoints)
  }

  const keys = [...new Set([...groupedSponsors.keys(), ...groupedUsage.keys()])]
    .sort()

  for (const key of keys) {
    const dayStart = zonedDayStartFromKey(key, timeZone)
    if (dayStart > nowTimestamp) continue
    const pointsAtDayStart = materializeDecay(state, dayStart, activeDays).points
    const tokenPoints = Math.min(groupedUsage.get(key) || 0, dailyTokenCapForPoints(pointsAtDayStart))
    if (tokenPoints > 0 && key >= startDayKey) {
      state.tokenPoints += tokenPoints
      addContribution(state, Math.max(dayStart, startTimestamp), tokenPoints, activeDays)
    }
    for (const sponsor of groupedSponsors.get(key) || []) {
      addContribution(state, sponsor.completedAt, sponsor.points, activeDays)
    }
  }

  materializeDecay(state, nowTimestamp, activeDays)
  const tier = supportTierForPoints(state.points)
  const activeUntil = state.lastActiveAt ? state.lastActiveAt + activeDays * 86_400 : 0
  const expiredDays = state.lastActiveAt
    ? Math.floor(Math.max(0, nowTimestamp - activeUntil) / 86_400)
    : 0
  return {
    points: state.points,
    totalEarnedPoints: state.totalEarnedPoints,
    tokenPoints: state.tokenPoints,
    sponsorPoints: state.sponsorPoints,
    sponsorAmountCny: state.sponsorAmountCny,
    sponsorCount: state.sponsorCount,
    tier,
    lit: Boolean(state.lastActiveAt && nowTimestamp <= activeUntil),
    expiredDays,
    activeUntil,
    lastActiveAt: state.lastActiveAt,
    activeDays,
  }
}
