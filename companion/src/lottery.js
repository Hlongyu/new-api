const defaultPrizePools = [
  [
    { amountUsd: 1, weight: 40 },
    { amountUsd: 2, weight: 30 },
    { amountUsd: 5, weight: 20 },
    { amountUsd: 10, weight: 9 },
    { amountUsd: 50, weight: 1 },
  ],
  [
    { amountUsd: 1, weight: 50 },
    { amountUsd: 2, weight: 30 },
    { amountUsd: 5, weight: 15 },
    { amountUsd: 10, weight: 4 },
    { amountUsd: 20, weight: 1 },
  ],
  [
    { amountUsd: 1, weight: 60 },
    { amountUsd: 2, weight: 25 },
    { amountUsd: 5, weight: 12 },
    { amountUsd: 10, weight: 3 },
  ],
]

export const maxLotteryRanks = 3

function parsePool(pool, rank) {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error(`LOTTERY_PRIZES 第 ${rank} 名奖池至少需要一个奖项`)
  }
  return pool.map((item) => {
    const amountUsd = Number(item?.amountUsd)
    const weight = Number(item?.weight ?? 1)
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new Error('LOTTERY_PRIZES 中 amountUsd 必须为正数')
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error('LOTTERY_PRIZES 中 weight 必须为正数')
    }
    return { amountUsd, weight }
  })
}

export function parseLotteryPrizes(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return defaultPrizePools.map((pool) => pool.map((prize) => ({ ...prize })))
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('LOTTERY_PRIZES 必须是 JSON 数组')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('LOTTERY_PRIZES 至少需要一个奖项')
  }
  const pools = Array.isArray(parsed[0])
    ? parsed
    : Array.from({ length: maxLotteryRanks }, () => parsed)
  if (pools.length > maxLotteryRanks) {
    throw new Error(`LOTTERY_PRIZES 最多支持前 ${maxLotteryRanks} 名奖池`)
  }
  return pools.map((pool, index) => parsePool(pool, index + 1))
}

export function pickLotteryPrize(prizes, random = Math.random()) {
  if (!Array.isArray(prizes) || prizes.length === 0) {
    throw new Error('奖池为空')
  }
  const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0)
  let remaining = random * totalWeight
  for (const prize of prizes) {
    remaining -= prize.weight
    if (remaining < 0) return prize
  }
  return prizes[prizes.length - 1]
}
