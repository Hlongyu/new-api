export const sponsorBadgeTiers = [
  { key: 'silver', name: '银卡', threshold: 10 },
  { key: 'gold', name: '金卡', threshold: 100 },
  { key: 'platinum', name: '白金', threshold: 250 },
  { key: 'black-gold', name: '黑金', threshold: 500 },
  { key: 'diamond', name: '钻石', threshold: 1000 },
  { key: 'crown', name: '皇冠', threshold: 5000, enabled: false },
  { key: 'collector', name: '典藏', threshold: 10_000, enabled: false },
]

export function sponsorBadgePointsForAmount(amountCny) {
  return Math.max(0, Math.floor(Number(amountCny) || 0)) * 10
}

export function sponsorBadgeTierForPoints(points) {
  return [...sponsorBadgeTiers]
    .filter((tier) => tier.enabled !== false)
    .reverse()
    .find((tier) => Number(points) >= tier.threshold) || null
}

export function sponsorBadgeForAmount(amountCny, { includePoints = false } = {}) {
  const points = sponsorBadgePointsForAmount(amountCny)
  const tier = sponsorBadgeTierForPoints(points)
  if (!tier) return null
  const payload = {
    key: tier.key,
    name: tier.name,
  }
  if (includePoints) {
    payload.points = points
    payload.amountCny = Math.max(0, Math.floor(Number(amountCny) || 0))
    payload.threshold = tier.threshold
  }
  return payload
}
