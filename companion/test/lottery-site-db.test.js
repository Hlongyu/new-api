import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createLotterySiteDatabase } from '../src/lottery-site-db.js'

test('独立抽奖账本原子扣减次数并保证请求幂等', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lottery-site-db-'))
  const db = createLotterySiteDatabase(path.join(directory, 'test.db'))
  const now = Math.floor(Date.now() / 1000)
  try {
    const campaign = db.createCampaign({
      id: 'campaign-1',
      name: '深夜宝库',
      startsAt: now - 60,
      endsAt: now + 3600,
      operatorUserId: 1,
      createdAt: now - 120,
    }, [
      { amountUsd: 1, weight: 60, rarity: 'common' },
      { amountUsd: 20, weight: 1, rarity: 'legendary' },
    ])
    assert.equal(campaign.status, 'draft')
    assert.equal(db.publishCampaign(campaign.id, now - 30), 1)
    const secondCampaign = db.createCampaign({
      id: 'campaign-2',
      name: '第二活动池',
      startsAt: now - 60,
      endsAt: now + 3600,
      operatorUserId: 1,
      createdAt: now - 110,
    }, [
      { amountUsd: 2, weight: 1, rarity: 'rare' },
      { amountUsd: 10, weight: 1, rarity: 'epic' },
    ])
    assert.equal(db.publishCampaign(secondCampaign.id, now - 20), 1)
    assert.equal(db.listPublishedCampaigns().length, 2)

    const grant = db.createGrantBatch({
      id: 'grant-1',
      requestKey: 'grant_request_1',
      campaignId: campaign.id,
      kind: 'manual',
      quantityPerUser: 5,
      userIds: [42],
      skipPreviouslyGranted: false,
      note: '测试发放',
      operatorUserId: 1,
      createdAt: now,
    })
    assert.equal(db.createGrantBatch({
      id: 'grant-duplicate',
      requestKey: 'grant_request_1',
      campaignId: campaign.id,
      kind: 'manual',
      quantityPerUser: 5,
      userIds: [42],
      operatorUserId: 1,
      createdAt: now,
    }).id, 'grant-1')
    assert.equal(db.applyGrantRecipient(grant, 42, now), true)
    assert.equal(db.applyGrantRecipient(grant, 42, now), false)
    assert.equal(db.getBalance(campaign.id, 42), 5)

    const payload = {
      id: 'draw-1',
      requestKey: 'draw_request_1',
      campaignId: campaign.id,
      userId: 42,
      drawCount: 5,
      totalAmountUsd: 5,
      totalQuota: 2_500_000,
      createdAt: now,
      items: Array.from({ length: 5 }, (_, index) => ({
        id: `item-${index}`,
        prizeId: campaign.prizes[0].id,
        amountUsd: 1,
        quotaAmount: 500_000,
        rarity: 'common',
        randomValue: String(index),
      })),
    }
    assert.equal(db.createDraw(payload).id, 'draw-1')
    assert.equal(db.createDraw({ ...payload, id: 'draw-duplicate' }).id, 'draw-1')
    assert.throws(
      () => db.createDraw({ ...payload, campaignId: secondCampaign.id }),
      /其他用户或活动池/,
    )
    assert.equal(db.getBalance(campaign.id, 42), 0)
    assert.throws(
      () => db.createDraw({ ...payload, id: 'draw-2', requestKey: 'draw_request_2' }),
      /次数不足/,
    )
    assert.equal(db.listUserDraws(42).length, 1)
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
