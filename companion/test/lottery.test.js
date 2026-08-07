import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLotteryPrizes, pickLotteryPrize } from '../src/lottery.js'

test('未配置奖池时使用默认三档奖池', () => {
  const pools = parseLotteryPrizes('')
  assert.equal(pools.length, 3)
  assert.deepEqual(pools[0][0], { amountUsd: 1, weight: 40 })
  assert.deepEqual(pools[0].at(-1), { amountUsd: 50, weight: 1 })
  assert.deepEqual(pools[1].at(-1), { amountUsd: 20, weight: 1 })
  assert.deepEqual(pools[2].at(-1), { amountUsd: 10, weight: 3 })
})

test('解析按名次奖池并校验字段', () => {
  const pools = parseLotteryPrizes('[[{"amountUsd":3,"weight":2}],[{"amountUsd":8}]]')
  assert.deepEqual(pools, [
    [{ amountUsd: 3, weight: 2 }],
    [{ amountUsd: 8, weight: 1 }],
  ])

  const flat = parseLotteryPrizes('[{"amountUsd":5}]')
  assert.equal(flat.length, 3)
  assert.deepEqual(flat[2], [{ amountUsd: 5, weight: 1 }])

  assert.throws(() => parseLotteryPrizes('not-json'), /JSON/)
  assert.throws(() => parseLotteryPrizes('[]'), /至少需要一个奖项/)
  assert.throws(() => parseLotteryPrizes('[[]]'), /奖池至少需要一个奖项/)
  assert.throws(() => parseLotteryPrizes('[[{"amountUsd":0}]]'), /amountUsd/)
  assert.throws(
    () => parseLotteryPrizes('[{"amountUsd":1,"weight":-1}]'),
    /weight/,
  )
  assert.throws(
    () => parseLotteryPrizes(
      '[[{"amountUsd":1}],[{"amountUsd":1}],[{"amountUsd":1}],[{"amountUsd":1}]]',
    ),
    /最多支持/,
  )
})

test('按权重抽取奖项', () => {
  const prizes = [
    { amountUsd: 1, weight: 5 },
    { amountUsd: 10, weight: 4 },
    { amountUsd: 50, weight: 1 },
  ]
  assert.equal(pickLotteryPrize(prizes, 0).amountUsd, 1)
  assert.equal(pickLotteryPrize(prizes, 0.49).amountUsd, 1)
  assert.equal(pickLotteryPrize(prizes, 0.5).amountUsd, 10)
  assert.equal(pickLotteryPrize(prizes, 0.89).amountUsd, 10)
  assert.equal(pickLotteryPrize(prizes, 0.9).amountUsd, 50)
  assert.equal(pickLotteryPrize(prizes, 0.999999).amountUsd, 50)
  assert.throws(() => pickLotteryPrize([]), /奖池为空/)
})
