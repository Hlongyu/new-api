import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createDatabase } from '../src/db.js'

test('旧版同一用户的多个 Key 条目会迁移并合并用量', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-db-'))
  const databasePath = path.join(directory, 'test.db')
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE leaderboard_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL UNIQUE,
      token_name TEXT NOT NULL DEFAULT '',
      masked_key TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      token_created_at INTEGER NOT NULL DEFAULT 0,
      manage_secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE usage_aggregates (
      entry_id INTEGER NOT NULL,
      period_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      token_used INTEGER NOT NULL DEFAULT 0,
      quota INTEGER NOT NULL DEFAULT 0,
      request_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entry_id, period_type, period_key),
      FOREIGN KEY (entry_id) REFERENCES leaderboard_entries(id) ON DELETE CASCADE
    );
    INSERT INTO leaderboard_entries
      (user_id, token_id, token_name, masked_key, display_name,
       manage_secret_hash, created_at)
    VALUES
      (7, 101, 'Key 1', 'sk-1', '旧名称一', 'hash-1', 1),
      (7, 102, 'Key 2', 'sk-2', '旧名称二', 'hash-2', 2);
    INSERT INTO usage_aggregates
      (entry_id, period_type, period_key, token_used, quota,
       request_count, updated_at)
    VALUES
      (1, 'day', '2026-07-13', 100, 200, 1, 10),
      (2, 'day', '2026-07-13', 300, 400, 2, 20);
  `)
  legacy.close()

  const db = createDatabase(databasePath)
  try {
    const entries = db.listEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].user_id, 7)
    assert.equal(entries[0].id, 1)
    assert.equal(entries[0].is_name_public, 1)
    assert.match(entries[0].anonymous_name, /^匿名用户 [A-F0-9]{10}$/)

    const [usage] = db.listLeaderboard('day', '2026-07-13')
    assert.equal(usage.token_used, 400)
    assert.equal(usage.quota, 600)
    assert.equal(usage.request_count, 3)
    assert.equal(usage.public_name, '旧名称一')

    db.anonymizeEntry(entries[0].id)
    const [anonymousUsage] = db.listLeaderboard('day', '2026-07-13')
    assert.equal(anonymousUsage.public_name, entries[0].anonymous_name)

    const discovered = db.ensureAnonymousEntry(8, 3, '真实名称')
    assert.equal(discovered.is_name_public, 0)
    assert.equal(discovered.source_name, '真实名称')
    assert.match(discovered.anonymous_name, /^匿名用户 [A-F0-9]{10}$/)

    assert.throws(
      () => db.createEntry({
        userId: 7,
        username: 'alice',
        displayName: '不能重复',
        createdAt: 3,
      }),
      /constraint|unique/i,
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('赞助同金额时按达成当前总额的时间排序并服从账户匿名状态', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-sponsor-db-'))
  const databasePath = path.join(directory, 'test.db')
  const db = createDatabase(databasePath)

  function addCompletedOrder({ id, requestKey, userId, entryId, amount, completedAt }) {
    db.createSponsorOrder({
      id,
      requestKey,
      userId,
      entryId,
      amountCny: amount,
      quotaAmount: amount * 500_000,
      displayAnonymously: false,
      message: '',
      operatorUserId: 1,
      createdAt: completedAt - 1,
    })
    db.finishSponsorOrder(id, 'completed', '', completedAt)
  }

  try {
    const entryA = db.createEntry({
      userId: 101,
      username: 'a',
      displayName: '用户 A',
      createdAt: 1,
    })
    const entryB = db.createEntry({
      userId: 102,
      username: 'b',
      displayName: '用户 B',
      createdAt: 2,
    })
    const entryC = db.ensureAnonymousEntry(103, 3, '用户 C').id

    addCompletedOrder({
      id: 'order-a-1', requestKey: 'request-a-1', userId: 101,
      entryId: entryA, amount: 50, completedAt: 100,
    })
    addCompletedOrder({
      id: 'order-a-2', requestKey: 'request-a-2', userId: 101,
      entryId: entryA, amount: 50, completedAt: 200,
    })
    addCompletedOrder({
      id: 'order-a-legacy', requestKey: 'request-a-legacy', userId: 999,
      entryId: entryA, amount: 5, completedAt: 250,
    })
    addCompletedOrder({
      id: 'order-b-1', requestKey: 'request-b-1', userId: 102,
      entryId: entryB, amount: 100, completedAt: 150,
    })
    addCompletedOrder({
      id: 'order-c-1', requestKey: 'request-c-1', userId: 103,
      entryId: entryC, amount: 100, completedAt: 175,
    })

    const sponsors = db.listSponsorLeaderboard(0, 1_000)
    assert.deepEqual(sponsors.map((row) => row.user_id), [101, 102, 103])
    assert.deepEqual(sponsors.map((row) => row.updated_at), [250, 150, 175])
    assert.equal(sponsors[2].public_name, '匿名赞助者')

    const usage = new Map(
      db.listLeaderboard('all', 'all').map((row) => [row.user_id, row]),
    )
    assert.equal(usage.get(101).sponsor_amount_cny, 105)
    assert.equal(usage.get(101).last_sponsor_completed_at, 250)
    assert.equal(usage.get(102).sponsor_amount_cny, 100)
    assert.equal(usage.get(102).last_sponsor_completed_at, 150)
    assert.equal(usage.get(103).sponsor_amount_cny, 0)
    assert.equal(usage.get(103).last_sponsor_completed_at, 0)

    const summary = db.getSponsorSummary(101)
    assert.equal(summary.amount_cny, 105)
    assert.equal(summary.sponsor_count, 3)
    assert.equal(summary.last_completed_at, 250)
    assert.deepEqual(
      db.listSponsorHistory(101).map((order) => order.id),
      ['order-a-legacy', 'order-a-2', 'order-a-1'],
    )
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('旧版单人抽奖表迁移为按名次抽奖表并保留记录', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-db-lottery-'))
  const databasePath = path.join(directory, 'test.db')
  const initial = createDatabase(databasePath)
  const entryId = initial.createEntry({
    userId: 7,
    username: 'alice',
    displayName: '公开名称',
    createdAt: 1,
  })
  initial.upsertAggregate({
    entryId,
    periodType: 'week',
    periodKey: '2026-07-13',
    tokenUsed: 1_234,
    quota: 6_000_000,
    requestCount: 9,
    updatedAt: 12,
  })
  initial.close()

  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    DROP TABLE lottery_draws;
    CREATE TABLE lottery_draws (
      id TEXT PRIMARY KEY,
      period_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      amount_usd REAL NOT NULL,
      quota_amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('processing', 'completed', 'failed', 'unknown')
      ),
      error_message TEXT NOT NULL DEFAULT '',
      operator_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES leaderboard_entries(id) ON DELETE RESTRICT
    );
    INSERT INTO lottery_draws
      (id, period_key, user_id, entry_id, amount_usd, quota_amount,
       status, operator_user_id, created_at, updated_at, completed_at)
    VALUES
      ('draw-1', '2026-07-13', 7, ${entryId}, 5, 2500000,
       'completed', 1, 10, 11, 11);
  `)
  legacy.close()

  const db = createDatabase(databasePath)
  try {
    const migrated = db.getLotteryDrawByPeriodRank('2026-07-13', 1)
    assert.equal(migrated.id, 'draw-1')
    assert.equal(migrated.draw_rank, 1)
    assert.equal(migrated.status, 'completed')
    assert.equal(migrated.amount_usd, 5)
    assert.equal(migrated.display_name_snapshot, '公开名称')
    assert.deepEqual(
      db.listLotteryOpportunitiesBefore(1, '2026-07-13').map((item) => ({
        rank: item.draw_rank,
        userId: item.user_id,
        drawId: item.draw_id,
        tokenUsed: item.token_used,
        quota: item.quota,
        requestCount: item.request_count,
      })),
      [{
        rank: 1,
        userId: 7,
        drawId: 'draw-1',
        tokenUsed: 1_234,
        quota: 6_000_000,
        requestCount: 9,
      }],
    )

    const second = db.createLotteryDraw({
      id: 'draw-2',
      periodKey: '2026-07-13',
      rank: 2,
      userId: 8,
      entryId,
      displayNameSnapshot: '开奖名称',
      amountUsd: 2,
      quotaAmount: 1_000_000,
      operatorUserId: 1,
      createdAt: 20,
    })
    assert.equal(second.id, 'draw-2')
    assert.equal(second.display_name_snapshot, '开奖名称')
    assert.equal(db.listLotteryDrawsByPeriod('2026-07-13').length, 2)

    db.anonymizeEntry(entryId)
    assert.deepEqual(
      db.listLotteryDraws(1).map((draw) => draw.public_name),
      ['公开名称', '开奖名称'],
    )

    const conflict = db.createLotteryDraw({
      id: 'draw-3',
      periodKey: '2026-07-13',
      rank: 2,
      userId: 9,
      entryId,
      amountUsd: 1,
      quotaAmount: 500_000,
      operatorUserId: 1,
      createdAt: 30,
    })
    assert.equal(conflict.id, 'draw-2')
  } finally {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
