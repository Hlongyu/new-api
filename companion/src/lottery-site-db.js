import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function databaseError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

export function createLotterySiteDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS lottery_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('draft', 'published', 'ended', 'cancelled')
      ),
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      rules_version INTEGER NOT NULL DEFAULT 1,
      simulation_count INTEGER NOT NULL DEFAULT 0,
      operator_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      published_at INTEGER NOT NULL DEFAULT 0,
      ended_at INTEGER NOT NULL DEFAULT 0,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lottery_prizes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      amount_usd INTEGER NOT NULL,
      weight INTEGER NOT NULL,
      rarity TEXT NOT NULL CHECK (
        rarity IN ('common', 'rare', 'epic', 'legendary')
      ),
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
      UNIQUE (campaign_id, amount_usd)
    );

    CREATE TABLE IF NOT EXISTS lottery_grant_batches (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      campaign_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('manual', 'all', 'revoke')),
      quantity_per_user INTEGER NOT NULL,
      recipients_json TEXT NOT NULL DEFAULT '[]',
      skip_previously_granted INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (
        status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
      ),
      recipient_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      operator_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES lottery_campaigns(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS lottery_ledger (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      batch_id TEXT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('grant', 'revoke', 'draw')),
      delta INTEGER NOT NULL,
      reference_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      operator_user_id INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES lottery_campaigns(id) ON DELETE RESTRICT,
      FOREIGN KEY (batch_id) REFERENCES lottery_grant_batches(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS lottery_draw_batches (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      campaign_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      draw_count INTEGER NOT NULL CHECK (draw_count IN (1, 5, 10)),
      total_amount_usd INTEGER NOT NULL,
      total_quota INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'processing', 'unknown', 'completed', 'failed')
      ),
      plan_id INTEGER NOT NULL DEFAULT 0,
      external_subscription_id INTEGER NOT NULL DEFAULT 0,
      preflight_subscription_ids TEXT NOT NULL DEFAULT '[]',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES lottery_campaigns(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS lottery_draw_items (
      id TEXT PRIMARY KEY,
      draw_batch_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      prize_id INTEGER NOT NULL,
      amount_usd INTEGER NOT NULL,
      quota_amount INTEGER NOT NULL,
      rarity TEXT NOT NULL,
      random_value TEXT NOT NULL,
      FOREIGN KEY (draw_batch_id) REFERENCES lottery_draw_batches(id) ON DELETE RESTRICT,
      FOREIGN KEY (prize_id) REFERENCES lottery_prizes(id) ON DELETE RESTRICT,
      UNIQUE (draw_batch_id, ordinal)
    );

    CREATE TABLE IF NOT EXISTS lottery_plan_mappings (
      quota_amount INTEGER NOT NULL,
      duration_days INTEGER NOT NULL,
      amount_usd INTEGER NOT NULL,
      plan_id INTEGER NOT NULL,
      plan_title TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (quota_amount, duration_days)
    );

    CREATE TABLE IF NOT EXISTS lottery_redemption_progress (
      user_id INTEGER PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      observed_quota INTEGER NOT NULL DEFAULT 0,
      redemption_count INTEGER NOT NULL DEFAULT 0,
      granted_draws INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (campaign_id) REFERENCES lottery_campaigns(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_lottery_prizes_campaign
      ON lottery_prizes(campaign_id, sort_order, id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_grant_batch_user
      ON lottery_ledger(batch_id, user_id) WHERE batch_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_lottery_ledger_balance
      ON lottery_ledger(campaign_id, user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_draw_ledger
      ON lottery_ledger(reference_id) WHERE kind = 'draw';
    CREATE INDEX IF NOT EXISTS idx_lottery_draw_user
      ON lottery_draw_batches(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lottery_fulfillment_due
      ON lottery_draw_batches(status, next_attempt_at, created_at);
  `)

  const campaignColumns = new Set(
    db.prepare('PRAGMA table_info(lottery_campaigns)').all().map((column) => column.name),
  )
  if (!campaignColumns.has('is_permanent')) {
    db.exec('ALTER TABLE lottery_campaigns ADD COLUMN is_permanent INTEGER NOT NULL DEFAULT 0')
  }
  if (!campaignColumns.has('is_default')) {
    db.exec('ALTER TABLE lottery_campaigns ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_lottery_single_published;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_single_default_campaign
      ON lottery_campaigns(is_default) WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS idx_lottery_published_campaigns
      ON lottery_campaigns(status, is_default DESC, created_at DESC);
  `)

  const statements = {
    insertCampaign: db.prepare(`
      INSERT INTO lottery_campaigns
        (id, name, status, starts_at, ends_at, operator_user_id, created_at,
         published_at, is_permanent, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertPrize: db.prepare(`
      INSERT INTO lottery_prizes
        (campaign_id, amount_usd, weight, rarity, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `),
    getCampaign: db.prepare('SELECT * FROM lottery_campaigns WHERE id = ?'),
    listCampaigns: db.prepare(`
      SELECT * FROM lottery_campaigns ORDER BY created_at DESC, id DESC
    `),
    listPrizes: db.prepare(`
      SELECT * FROM lottery_prizes WHERE campaign_id = ? ORDER BY sort_order, id
    `),
    getDefaultCampaign: db.prepare(`
      SELECT * FROM lottery_campaigns WHERE is_default = 1 LIMIT 1
    `),
    listPublishedCampaigns: db.prepare(`
      SELECT * FROM lottery_campaigns
      WHERE status = 'published'
      ORDER BY is_default DESC, created_at DESC, id DESC
    `),
    publishCampaign: db.prepare(`
      UPDATE lottery_campaigns
      SET status = 'published', published_at = ?
      WHERE id = ? AND status = 'draft'
    `),
    endCampaign: db.prepare(`
      UPDATE lottery_campaigns
      SET status = 'ended', ended_at = ?
      WHERE id = ? AND status = 'published' AND is_permanent = 0
    `),
    cancelCampaign: db.prepare(`
      UPDATE lottery_campaigns
      SET status = 'cancelled', ended_at = ?
      WHERE id = ? AND status IN ('draft', 'published') AND is_permanent = 0
    `),
    endExpiredCampaigns: db.prepare(`
      UPDATE lottery_campaigns
      SET status = 'ended', ended_at = ?
      WHERE status = 'published' AND is_permanent = 0 AND ends_at <= ?
    `),
    incrementSimulation: db.prepare(`
      UPDATE lottery_campaigns SET simulation_count = simulation_count + 1 WHERE id = ?
    `),
    getBalance: db.prepare(`
      SELECT COALESCE(SUM(delta), 0) AS balance
      FROM lottery_ledger WHERE campaign_id = ? AND user_id = ?
    `),
    hasPositiveGrant: db.prepare(`
      SELECT 1 FROM lottery_ledger
      WHERE campaign_id = ? AND user_id = ? AND kind = 'grant' LIMIT 1
    `),
    insertGrantBatch: db.prepare(`
      INSERT INTO lottery_grant_batches
        (id, request_key, campaign_id, kind, quantity_per_user,
         recipients_json, skip_previously_granted, status, note,
         operator_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING
    `),
    getGrantBatch: db.prepare(`
      SELECT * FROM lottery_grant_batches WHERE id = ?
    `),
    getGrantBatchByRequestKey: db.prepare(`
      SELECT * FROM lottery_grant_batches WHERE request_key = ?
    `),
    listGrantBatches: db.prepare(`
      SELECT * FROM lottery_grant_batches ORDER BY created_at DESC LIMIT ?
    `),
    listQueuedGrantBatches: db.prepare(`
      SELECT * FROM lottery_grant_batches
      WHERE status IN ('queued', 'processing') ORDER BY created_at ASC
    `),
    startGrantBatch: db.prepare(`
      UPDATE lottery_grant_batches SET status = 'processing'
      WHERE id = ? AND status IN ('queued', 'processing')
    `),
    insertLedger: db.prepare(`
      INSERT INTO lottery_ledger
        (id, campaign_id, batch_id, user_id, kind, delta, reference_id,
         note, operator_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `),
    finishGrantBatch: db.prepare(`
      UPDATE lottery_grant_batches
      SET status = ?, recipient_count = ?, processed_count = ?,
          error_message = ?, completed_at = ?
      WHERE id = ?
    `),
    getDrawById: db.prepare(`
      SELECT * FROM lottery_draw_batches WHERE id = ?
    `),
    getDrawByRequestKey: db.prepare(`
      SELECT * FROM lottery_draw_batches WHERE request_key = ?
    `),
    insertDraw: db.prepare(`
      INSERT INTO lottery_draw_batches
        (id, request_key, campaign_id, user_id, draw_count,
         total_amount_usd, total_quota, status, next_attempt_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `),
    insertDrawItem: db.prepare(`
      INSERT INTO lottery_draw_items
        (id, draw_batch_id, ordinal, prize_id, amount_usd,
         quota_amount, rarity, random_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listDrawItems: db.prepare(`
      SELECT * FROM lottery_draw_items
      WHERE draw_batch_id = ? ORDER BY ordinal ASC
    `),
    listUserDraws: db.prepare(`
      SELECT * FROM lottery_draw_batches
      WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listUserCampaignDraws: db.prepare(`
      SELECT * FROM lottery_draw_batches
      WHERE user_id = ? AND campaign_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listDueFulfillments: db.prepare(`
      SELECT * FROM lottery_draw_batches
      WHERE status IN ('pending', 'unknown') AND next_attempt_at <= ?
      ORDER BY created_at ASC LIMIT ?
    `),
    listFulfillmentIssues: db.prepare(`
      SELECT * FROM lottery_draw_batches
      WHERE status IN ('unknown', 'failed')
      ORDER BY updated_at DESC LIMIT ?
    `),
    markFulfillmentProcessing: db.prepare(`
      UPDATE lottery_draw_batches
      SET status = 'processing', attempt_count = attempt_count + 1,
          error_message = '', updated_at = ?
      WHERE id = ? AND status IN ('pending', 'unknown')
    `),
    recoverStaleFulfillments: db.prepare(`
      UPDATE lottery_draw_batches
      SET status = 'unknown', error_message = '履约进程中断，等待核对',
          next_attempt_at = ?, updated_at = ?
      WHERE status = 'processing' AND updated_at < ?
    `),
    setFulfillmentPlan: db.prepare(`
      UPDATE lottery_draw_batches SET plan_id = ?, updated_at = ? WHERE id = ?
    `),
    setFulfillmentSnapshot: db.prepare(`
      UPDATE lottery_draw_batches
      SET preflight_subscription_ids = ?, updated_at = ? WHERE id = ?
    `),
    finishFulfillment: db.prepare(`
      UPDATE lottery_draw_batches
      SET status = ?, external_subscription_id = ?, error_message = ?,
          next_attempt_at = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
    `),
    retryFulfillment: db.prepare(`
      UPDATE lottery_draw_batches
      SET status = 'pending', error_message = '', next_attempt_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('unknown', 'failed')
    `),
    getPlanMapping: db.prepare(`
      SELECT * FROM lottery_plan_mappings
      WHERE quota_amount = ? AND duration_days = ?
    `),
    upsertPlanMapping: db.prepare(`
      INSERT INTO lottery_plan_mappings
        (quota_amount, duration_days, amount_usd, plan_id,
         plan_title, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(quota_amount, duration_days) DO UPDATE SET
        amount_usd = excluded.amount_usd,
        plan_id = excluded.plan_id,
        plan_title = excluded.plan_title,
        verified_at = excluded.verified_at
    `),
    listPlanMappings: db.prepare(`
      SELECT * FROM lottery_plan_mappings ORDER BY amount_usd ASC
    `),
    getRedemptionProgress: db.prepare(`
      SELECT * FROM lottery_redemption_progress WHERE user_id = ?
    `),
    getRedemptionProgressStats: db.prepare(`
      SELECT
        COUNT(*) AS user_count,
        COALESCE(SUM(observed_quota), 0) AS observed_quota,
        COALESCE(SUM(redemption_count), 0) AS redemption_count,
        COALESCE(SUM(granted_draws), 0) AS granted_draws,
        COALESCE(MAX(updated_at), 0) AS updated_at
      FROM lottery_redemption_progress
    `),
    upsertRedemptionProgress: db.prepare(`
      INSERT INTO lottery_redemption_progress
        (user_id, campaign_id, observed_quota, redemption_count, granted_draws, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        campaign_id = excluded.campaign_id,
        observed_quota = excluded.observed_quota,
        redemption_count = excluded.redemption_count,
        granted_draws = excluded.granted_draws,
        updated_at = excluded.updated_at
    `),
    campaignStats: db.prepare(`
      SELECT
        (SELECT COUNT(DISTINCT user_id) FROM lottery_ledger
          WHERE campaign_id = ? AND kind = 'grant') AS covered_users,
        (SELECT COALESCE(SUM(CASE WHEN kind = 'grant' THEN delta ELSE 0 END), 0)
          FROM lottery_ledger WHERE campaign_id = ?) AS granted,
        (SELECT COALESCE(-SUM(CASE WHEN kind = 'draw' THEN delta ELSE 0 END), 0)
          FROM lottery_ledger WHERE campaign_id = ?) AS used,
        (SELECT COALESCE(SUM(delta), 0) FROM lottery_ledger
          WHERE campaign_id = ?) AS remaining,
        (SELECT COUNT(*) FROM lottery_draw_batches
          WHERE campaign_id = ?) AS draw_batches,
        (SELECT COALESCE(SUM(draw_count), 0) FROM lottery_draw_batches
          WHERE campaign_id = ?) AS draw_items,
        (SELECT COALESCE(SUM(total_amount_usd), 0) FROM lottery_draw_batches
          WHERE campaign_id = ?) AS actual_amount_usd,
        (SELECT COUNT(*) FROM lottery_draw_batches
          WHERE campaign_id = ? AND status = 'completed') AS fulfilled,
        (SELECT COUNT(*) FROM lottery_draw_batches
          WHERE campaign_id = ? AND status IN ('pending', 'processing', 'unknown', 'failed'))
          AS fulfillment_issues
    `),
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function hydrateDraw(draw) {
    if (!draw) return null
    return { ...draw, items: statements.listDrawItems.all(draw.id) }
  }

  return {
    createCampaign(campaign, prizes) {
      return transaction(() => {
        statements.insertCampaign.run(
          campaign.id,
          campaign.name,
          campaign.status || 'draft',
          campaign.startsAt,
          campaign.endsAt,
          campaign.operatorUserId,
          campaign.createdAt,
          campaign.publishedAt || 0,
          campaign.isPermanent ? 1 : 0,
          campaign.isDefault ? 1 : 0,
        )
        prizes.forEach((prize, index) => {
          statements.insertPrize.run(
            campaign.id,
            prize.amountUsd,
            prize.weight,
            prize.rarity,
            index,
          )
        })
        return this.getCampaign(campaign.id)
      })
    },
    getCampaign(id) {
      const campaign = statements.getCampaign.get(id)
      return campaign ? { ...campaign, prizes: statements.listPrizes.all(id) } : null
    },
    listCampaigns() {
      return statements.listCampaigns.all().map((campaign) => ({
        ...campaign,
        prizes: statements.listPrizes.all(campaign.id),
      }))
    },
    getDefaultCampaign() {
      const campaign = statements.getDefaultCampaign.get()
      return campaign ? { ...campaign, prizes: statements.listPrizes.all(campaign.id) } : null
    },
    listPublishedCampaigns() {
      return statements.listPublishedCampaigns.all().map((campaign) => ({
        ...campaign,
        prizes: statements.listPrizes.all(campaign.id),
      }))
    },
    getPublishedCampaign() {
      return this.listPublishedCampaigns()[0] || null
    },
    publishCampaign(id, now) {
      return Number(statements.publishCampaign.run(now, id).changes)
    },
    endCampaign(id, now) {
      return Number(statements.endCampaign.run(now, id).changes)
    },
    cancelCampaign(id, now) {
      return Number(statements.cancelCampaign.run(now, id).changes)
    },
    endExpiredCampaigns(now) {
      return Number(statements.endExpiredCampaigns.run(now, now).changes)
    },
    incrementSimulation(id) {
      statements.incrementSimulation.run(id)
    },
    getBalance(campaignId, userId) {
      return Number(statements.getBalance.get(campaignId, userId).balance)
    },
    hasPositiveGrant(campaignId, userId) {
      return Boolean(statements.hasPositiveGrant.get(campaignId, userId))
    },
    createGrantBatch(batch) {
      const existing = statements.getGrantBatchByRequestKey.get(batch.requestKey)
      if (existing) {
        if (
          existing.campaign_id !== batch.campaignId ||
          Number(existing.operator_user_id) !== Number(batch.operatorUserId)
        ) {
          throw databaseError('发放请求号已被其他批次使用', 409)
        }
        return existing
      }
      statements.insertGrantBatch.run(
        batch.id,
        batch.requestKey,
        batch.campaignId,
        batch.kind,
        batch.quantityPerUser,
        JSON.stringify(batch.userIds || []),
        batch.skipPreviouslyGranted ? 1 : 0,
        batch.note || '',
        batch.operatorUserId,
        batch.createdAt,
      )
      return statements.getGrantBatchByRequestKey.get(batch.requestKey)
    },
    getGrantBatch(id) {
      return statements.getGrantBatch.get(id) || null
    },
    listGrantBatches(limit = 30) {
      return statements.listGrantBatches.all(limit)
    },
    listQueuedGrantBatches() {
      return statements.listQueuedGrantBatches.all()
    },
    startGrantBatch(id) {
      statements.startGrantBatch.run(id)
    },
    applyGrantRecipient(batch, userId, now) {
      return transaction(() => {
        if (batch.kind === 'revoke') {
          const balance = Number(
            statements.getBalance.get(batch.campaign_id, userId).balance,
          )
          if (balance < batch.quantity_per_user) {
            throw databaseError(`用户 ${userId} 的可用次数不足`, 409)
          }
        } else if (
          Number(batch.skip_previously_granted) === 1 &&
          statements.hasPositiveGrant.get(batch.campaign_id, userId)
        ) {
          return false
        }
        const kind = batch.kind === 'revoke' ? 'revoke' : 'grant'
        const delta = batch.kind === 'revoke'
          ? -Number(batch.quantity_per_user)
          : Number(batch.quantity_per_user)
        return Number(statements.insertLedger.run(
          `${batch.id}:${userId}`,
          batch.campaign_id,
          batch.id,
          userId,
          kind,
          delta,
          batch.id,
          batch.note,
          batch.operator_user_id,
          now,
        ).changes) > 0
      })
    },
    finishGrantBatch(id, status, recipientCount, processedCount, errorMessage, now) {
      statements.finishGrantBatch.run(
        status,
        recipientCount,
        processedCount,
        errorMessage || '',
        now,
        id,
      )
    },
    createDraw(draw) {
      return transaction(() => {
        const existing = statements.getDrawByRequestKey.get(draw.requestKey)
        if (existing) {
          if (Number(existing.user_id) !== Number(draw.userId) ||
              existing.campaign_id !== draw.campaignId) {
            throw databaseError('抽奖请求号已被其他用户或活动池使用', 409)
          }
          return hydrateDraw(existing)
        }
        const campaign = statements.getCampaign.get(draw.campaignId)
        if (!campaign || campaign.status !== 'published' ||
            draw.createdAt < campaign.starts_at || draw.createdAt >= campaign.ends_at) {
          throw databaseError('活动当前不可抽奖', 409)
        }
        const balance = Number(
          statements.getBalance.get(draw.campaignId, draw.userId).balance,
        )
        if (balance < draw.drawCount) {
          throw databaseError('剩余抽奖次数不足', 409)
        }
        statements.insertDraw.run(
          draw.id,
          draw.requestKey,
          draw.campaignId,
          draw.userId,
          draw.drawCount,
          draw.totalAmountUsd,
          draw.totalQuota,
          draw.createdAt,
          draw.createdAt,
          draw.createdAt,
        )
        draw.items.forEach((item, index) => {
          statements.insertDrawItem.run(
            item.id,
            draw.id,
            index + 1,
            item.prizeId,
            item.amountUsd,
            item.quotaAmount,
            item.rarity,
            item.randomValue,
          )
        })
        statements.insertLedger.run(
          `draw:${draw.id}`,
          draw.campaignId,
          null,
          draw.userId,
          'draw',
          -draw.drawCount,
          draw.id,
          `${draw.drawCount} 抽`,
          0,
          draw.createdAt,
        )
        return hydrateDraw(statements.getDrawById.get(draw.id))
      })
    },
    getDrawById(id) {
      return hydrateDraw(statements.getDrawById.get(id))
    },
    getDrawByRequestKey(requestKey) {
      return hydrateDraw(statements.getDrawByRequestKey.get(requestKey))
    },
    listUserDraws(userId, limit = 20, offset = 0) {
      return statements.listUserDraws.all(userId, limit, offset).map(hydrateDraw)
    },
    listUserCampaignDraws(userId, campaignId, limit = 20, offset = 0) {
      return statements.listUserCampaignDraws
        .all(userId, campaignId, limit, offset)
        .map(hydrateDraw)
    },
    listDueFulfillments(now, limit = 10) {
      return statements.listDueFulfillments.all(now, limit).map(hydrateDraw)
    },
    listFulfillmentIssues(limit = 30) {
      return statements.listFulfillmentIssues.all(limit).map(hydrateDraw)
    },
    markFulfillmentProcessing(id, now) {
      return Number(statements.markFulfillmentProcessing.run(now, id).changes)
    },
    recoverStaleFulfillments(now, staleBefore) {
      return Number(
        statements.recoverStaleFulfillments.run(now + 60, now, staleBefore).changes,
      )
    },
    setFulfillmentPlan(id, planId, now) {
      statements.setFulfillmentPlan.run(planId, now, id)
    },
    setFulfillmentSnapshot(id, ids, now) {
      statements.setFulfillmentSnapshot.run(JSON.stringify(ids), now, id)
    },
    finishFulfillment(id, {
      status,
      externalSubscriptionId = 0,
      errorMessage = '',
      nextAttemptAt = 0,
      now,
      completedAt = 0,
    }) {
      statements.finishFulfillment.run(
        status,
        externalSubscriptionId,
        errorMessage,
        nextAttemptAt,
        now,
        completedAt,
        id,
      )
    },
    retryFulfillment(id, now) {
      return Number(statements.retryFulfillment.run(now, now, id).changes)
    },
    getPlanMapping(quotaAmount, durationDays = 7) {
      return statements.getPlanMapping.get(quotaAmount, durationDays) || null
    },
    savePlanMapping(mapping, now) {
      statements.upsertPlanMapping.run(
        mapping.quotaAmount,
        mapping.durationDays,
        mapping.amountUsd,
        mapping.planId,
        mapping.planTitle,
        now,
        now,
      )
    },
    listPlanMappings() {
      return statements.listPlanMappings.all()
    },
    getRedemptionProgress(userId) {
      return statements.getRedemptionProgress.get(userId) || null
    },
    getRedemptionProgressStats() {
      return statements.getRedemptionProgressStats.get()
    },
    syncRedemptionRewards({
      campaignId,
      userId,
      observedQuota,
      redemptionCount,
      quotaPerDraw,
      operatorUserId,
      now,
    }) {
      return transaction(() => {
        const campaign = statements.getCampaign.get(campaignId)
        if (!campaign || Number(campaign.is_default) !== 1 ||
            Number(campaign.is_permanent) !== 1) {
          throw databaseError('常驻活动池配置无效', 409)
        }
        const previous = statements.getRedemptionProgress.get(userId)
        const grantedDraws = Number(previous?.granted_draws || 0)
        const eligibleDraws = Math.floor(Number(observedQuota) / Number(quotaPerDraw))
        const addedDraws = Math.max(0, eligibleDraws - grantedDraws)
        const nextGrantedDraws = grantedDraws + addedDraws
        if (addedDraws > 0) {
          statements.insertLedger.run(
            `redemption:${userId}:${nextGrantedDraws}`,
            campaignId,
            null,
            userId,
            'grant',
            addedDraws,
            `redemption:${userId}:${nextGrantedDraws}`,
            `兑换额度累计满额自动发放 ${addedDraws} 次`,
            operatorUserId,
            now,
          )
        }
        statements.upsertRedemptionProgress.run(
          userId,
          campaignId,
          observedQuota,
          redemptionCount,
          nextGrantedDraws,
          now,
        )
        return {
          userId: Number(userId),
          campaignId,
          observedQuota: Number(observedQuota),
          redemptionCount: Number(redemptionCount),
          grantedDraws: nextGrantedDraws,
          addedDraws,
          remainderQuota: Number(observedQuota) % Number(quotaPerDraw),
          updatedAt: Number(now),
        }
      })
    },
    campaignStats(campaignId) {
      return statements.campaignStats.get(
        campaignId,
        campaignId,
        campaignId,
        campaignId,
        campaignId,
        campaignId,
        campaignId,
        campaignId,
        campaignId,
      )
    },
    transaction,
    close() {
      db.close()
    },
  }
}
