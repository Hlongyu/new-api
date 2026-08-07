import { zonedDayKey, zonedDayStartFromKey } from './time.js'

export const rankTiers = [
  {
    key: 'iron', name: '黑铁', segmentScore: 20,
    promotionWindowDays: 3, promotionRequiredDays: 1, activeScoreRequired: 5,
  },
  {
    key: 'bronze', name: '青铜', segmentScore: 30,
    promotionWindowDays: 3, promotionRequiredDays: 1, activeScoreRequired: 8,
  },
  {
    key: 'silver', name: '白银', segmentScore: 45,
    promotionWindowDays: 5, promotionRequiredDays: 2, activeScoreRequired: 8,
  },
  {
    key: 'gold', name: '黄金', segmentScore: 65,
    promotionWindowDays: 5, promotionRequiredDays: 2, activeScoreRequired: 10,
  },
  {
    key: 'platinum', name: '铂金', segmentScore: 90,
    promotionWindowDays: 7, promotionRequiredDays: 3, activeScoreRequired: 10,
  },
  {
    key: 'diamond', name: '钻石', segmentScore: 120,
    promotionWindowDays: 7, promotionRequiredDays: 3, activeScoreRequired: 15,
  },
  {
    key: 'master', name: '大师', segmentScore: 160,
    promotionWindowDays: 10, promotionRequiredDays: 4, activeScoreRequired: 15,
  },
  {
    key: 'grandmaster', name: '宗师', segmentScore: 220,
    promotionWindowDays: 10, promotionRequiredDays: 5, activeScoreRequired: 20,
  },
  {
    key: 'challenger', name: '王者', segmentScore: 300,
    promotionWindowDays: 0, promotionRequiredDays: 0, activeScoreRequired: 0,
  },
]

export const divisionLabels = ['IV', 'III', 'II', 'I']

function emptyState() {
  return {
    tierIndex: 0,
    divisionIndex: 0,
    score: 0,
    pendingScore: 0,
    tokenScore: 0,
    renameScore: 0,
    sponsorScore: 0,
    totalScore: 0,
    promotion: null,
  }
}

function currentTier(state) {
  return rankTiers[state.tierIndex]
}

function nextTier(state) {
  return rankTiers[state.tierIndex + 1] || null
}

function startPromotion(state, overflow = 0) {
  const tier = currentTier(state)
  if (!nextTier(state)) {
    state.score = Math.min(tier.segmentScore, state.score + overflow)
    return
  }
  state.divisionIndex = divisionLabels.length - 1
  state.score = tier.segmentScore
  state.pendingScore += Math.max(0, overflow)
  state.promotion = {
    targetTierIndex: state.tierIndex + 1,
    windowDays: tier.promotionWindowDays,
    requiredDays: tier.promotionRequiredDays,
    activeScoreRequired: tier.activeScoreRequired,
    checkedDays: 0,
    activeDays: 0,
    todayScore: 0,
    todayRequiredRemaining: tier.activeScoreRequired,
    todayCounts: false,
  }
}

function applyScoreOutsidePromotion(state, score) {
  let remaining = Math.max(0, Math.floor(score))
  while (remaining > 0) {
    const tier = currentTier(state)
    const need = tier.segmentScore - state.score
    if (remaining < need) {
      state.score += remaining
      return
    }
    remaining -= need
    if (state.divisionIndex < divisionLabels.length - 1) {
      state.divisionIndex += 1
      state.score = 0
      continue
    }
    startPromotion(state, remaining)
    return
  }
}

function promotionSuccess(state) {
  const pending = state.pendingScore
  state.tierIndex = state.promotion.targetTierIndex
  state.divisionIndex = 0
  state.score = 0
  state.pendingScore = 0
  state.promotion = null
  applyScoreOutsidePromotion(state, pending)
}

function promotionFailure(state) {
  state.score = Math.floor(currentTier(state).segmentScore / 2)
  state.pendingScore = 0
  state.promotion = null
}

function applyDailyScore(state, score, { allowFailure = true } = {}) {
  const gained = Math.max(0, Math.floor(score))
  if (!state.promotion) {
    applyScoreOutsidePromotion(state, gained)
    return
  }

  state.pendingScore += gained
  state.promotion.checkedDays += 1
  if (gained >= state.promotion.activeScoreRequired) {
    state.promotion.activeDays += 1
  }
  if (state.promotion.activeDays >= state.promotion.requiredDays) {
    promotionSuccess(state)
    return
  }
  if (allowFailure && state.promotion.checkedDays >= state.promotion.windowDays) {
    promotionFailure(state)
  }
}

function nextDayStart(timestamp) {
  return timestamp + 86_400
}

export function calculateRankProgress({
  dailyUsage = [],
  renameCards = [],
  sponsors = [],
  nowTimestamp = Math.floor(Date.now() / 1000),
  timeZone = 'Asia/Shanghai',
  startTimestamp = 1_784_304_000,
  quotaPerUnit = 500_000,
} = {}) {
  const state = emptyState()
  const startKey = zonedDayKey(startTimestamp, timeZone)
  const dailyScores = new Map()
  let initialScore = 0

  for (const order of renameCards) {
    if (order.status && order.status !== 'completed') continue
    const amount = Math.floor(Number(order.amountCny ?? order.amount_cny) || 0)
    const completedAt = Number(order.completedAt ?? order.completed_at) || 0
    if (amount <= 0 || completedAt <= 0 || completedAt > nowTimestamp) continue
    const score = amount * 2
    state.renameScore += score
    state.totalScore += score
    if (completedAt < startTimestamp) {
      initialScore += score
    } else {
      const key = zonedDayKey(completedAt, timeZone)
      dailyScores.set(key, (dailyScores.get(key) || 0) + score)
    }
  }

  for (const sponsor of sponsors) {
    if (sponsor.status && sponsor.status !== 'completed') continue
    const amount = Math.floor(Number(sponsor.amountCny ?? sponsor.amount_cny) || 0)
    const completedAt = Number(sponsor.completedAt ?? sponsor.completed_at) || 0
    if (amount <= 0 || completedAt <= 0 || completedAt > nowTimestamp) continue
    const score = amount * 5
    state.sponsorScore += score
    state.totalScore += score
    if (completedAt < startTimestamp) {
      initialScore += score
    } else {
      const key = zonedDayKey(completedAt, timeZone)
      dailyScores.set(key, (dailyScores.get(key) || 0) + score)
    }
  }

  for (const usage of dailyUsage) {
    const key = String(usage.periodKey ?? usage.period_key ?? '')
    if (!key || key < startKey) continue
    const quota = Math.max(0, Number(usage.quota) || 0)
    const score = Math.floor(quota / quotaPerUnit)
    if (score <= 0) continue
    state.tokenScore += score
    state.totalScore += score
    dailyScores.set(key, (dailyScores.get(key) || 0) + score)
  }

  applyScoreOutsidePromotion(state, initialScore)

  const todayKey = zonedDayKey(nowTimestamp, timeZone)
  let cursor = zonedDayStartFromKey(startKey, timeZone)
  const end = zonedDayStartFromKey(todayKey, timeZone)
  while (cursor <= end) {
    const key = zonedDayKey(cursor, timeZone)
    const score = dailyScores.get(key) || 0
    const promotionBeforeDay = state.promotion
    if (key === todayKey && promotionBeforeDay) {
      promotionBeforeDay.todayScore = Math.max(0, Math.floor(score))
      promotionBeforeDay.todayRequiredRemaining = Math.max(
        0,
        promotionBeforeDay.activeScoreRequired - promotionBeforeDay.todayScore,
      )
      promotionBeforeDay.todayCounts = true
    }
    applyDailyScore(state, score, {
      allowFailure: key !== todayKey,
    })
    cursor = nextDayStart(cursor)
  }

  const tier = currentTier(state)
  const targetTier = state.promotion ? rankTiers[state.promotion.targetTierIndex] : null
  return {
    tierKey: tier.key,
    tierName: tier.name,
    tierIndex: state.tierIndex,
    division: divisionLabels[state.divisionIndex],
    divisionIndex: state.divisionIndex,
    label: `${tier.name} ${divisionLabels[state.divisionIndex]}`,
    score: state.score,
    segmentScore: tier.segmentScore,
    pendingScore: state.pendingScore,
    tokenScore: state.tokenScore,
    renameScore: state.renameScore,
    sponsorScore: state.sponsorScore,
    totalScore: state.totalScore,
    rankValue: state.tierIndex * 10_000 + state.divisionIndex * 1_000 + state.score,
    promotion: state.promotion
      ? {
          targetTierKey: targetTier.key,
          targetTierName: targetTier.name,
          windowDays: state.promotion.windowDays,
          requiredDays: state.promotion.requiredDays,
          activeScoreRequired: state.promotion.activeScoreRequired,
          checkedDays: state.promotion.checkedDays,
          activeDays: state.promotion.activeDays,
          todayScore: state.promotion.todayScore,
          todayRequiredRemaining: state.promotion.todayRequiredRemaining,
          todayCounts: Boolean(state.promotion.todayCounts),
        }
      : null,
  }
}
