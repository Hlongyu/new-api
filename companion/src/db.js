import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

function randomAnonymousName() {
  return `匿名用户 ${randomBytes(5).toString('hex').toUpperCase()}`
}

export function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      token_id INTEGER NOT NULL UNIQUE,
      token_name TEXT NOT NULL DEFAULT '',
      masked_key TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      anonymous_name TEXT NOT NULL DEFAULT '',
      is_name_public INTEGER NOT NULL DEFAULT 0,
      token_created_at INTEGER NOT NULL DEFAULT 0,
      manage_secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      participating INTEGER NOT NULL DEFAULT 1,
      participate_day INTEGER NOT NULL DEFAULT 1,
      participate_week INTEGER NOT NULL DEFAULT 1,
      participate_month INTEGER NOT NULL DEFAULT 1,
      participate_all INTEGER NOT NULL DEFAULT 1,
      participate_rank INTEGER NOT NULL DEFAULT 1,
      show_rank_badge INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS usage_aggregates (
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

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sponsor_orders (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      amount_cny INTEGER NOT NULL,
      quota_amount INTEGER NOT NULL,
      display_anonymously INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS lottery_draws (
      id TEXT PRIMARY KEY,
      rule_version INTEGER NOT NULL DEFAULT 1,
      period_key TEXT NOT NULL,
      draw_rank INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      display_name_snapshot TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS lottery_periods (
      rule_version INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      settled_at INTEGER NOT NULL,
      PRIMARY KEY (rule_version, period_key)
    );

    CREATE TABLE IF NOT EXISTS lottery_opportunities (
      rule_version INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      draw_rank INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      display_name_snapshot TEXT NOT NULL,
      token_used INTEGER NOT NULL,
      quota INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      prize_pool_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (rule_version, period_key, draw_rank),
      FOREIGN KEY (entry_id) REFERENCES leaderboard_entries(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS rename_card_balances (
      user_id INTEGER PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rename_events (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      old_name TEXT NOT NULL,
      new_name TEXT NOT NULL,
      cost_type TEXT NOT NULL CHECK (cost_type IN ('free', 'card', 'unlimited')),
      period_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES leaderboard_entries(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS rename_card_orders (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      amount_cny INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS postpaid_grants (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      entry_id INTEGER NOT NULL,
      tier_key TEXT NOT NULL,
      tier_name TEXT NOT NULL,
      credit_amount INTEGER NOT NULL,
      quota_amount INTEGER NOT NULL,
      outstanding_quota INTEGER NOT NULL,
      redemption_start_id INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (
        status IN ('processing', 'active', 'settled', 'overdue', 'failed', 'unknown')
      ),
      error_message TEXT NOT NULL DEFAULT '',
      operator_user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      due_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (entry_id) REFERENCES leaderboard_entries(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS postpaid_events (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('repayment')),
      redemption_id INTEGER,
      redemption_time INTEGER NOT NULL DEFAULT 0,
      quota_amount INTEGER NOT NULL,
      outstanding_before INTEGER NOT NULL,
      outstanding_after INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('processing', 'completed', 'failed', 'unknown')
      ),
      error_message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (grant_id) REFERENCES postpaid_grants(id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_usage_period
      ON usage_aggregates(period_type, period_key);

    CREATE INDEX IF NOT EXISTS idx_sponsor_completed
      ON sponsor_orders(status, completed_at);

    CREATE INDEX IF NOT EXISTS idx_lottery_opportunity_user
      ON lottery_opportunities(rule_version, user_id, period_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_user_processing
      ON sponsor_orders(user_id) WHERE status = 'processing';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_rename_card_user_processing
      ON rename_card_orders(user_id) WHERE status = 'processing';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_postpaid_user_processing
      ON postpaid_grants(user_id)
      WHERE status IN ('processing', 'unknown');

    CREATE UNIQUE INDEX IF NOT EXISTS idx_postpaid_redemption_grant
      ON postpaid_events(redemption_id, grant_id) WHERE redemption_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_postpaid_grants_created
      ON postpaid_grants(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_postpaid_events_created
      ON postpaid_events(created_at DESC);
  `)
  db.exec(`
    DROP INDEX IF EXISTS idx_postpaid_user_open;
    DROP INDEX IF EXISTS idx_postpaid_redemption;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_postpaid_user_processing
      ON postpaid_grants(user_id)
      WHERE status IN ('processing', 'unknown');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_postpaid_redemption_grant
      ON postpaid_events(redemption_id, grant_id) WHERE redemption_id IS NOT NULL;
  `)
  db.exec('DROP TABLE IF EXISTS enrollment_sessions')

  const entryColumns = db.prepare('PRAGMA table_info(leaderboard_entries)').all()
  if (!entryColumns.some((column) => column.name === 'username')) {
    db.exec("ALTER TABLE leaderboard_entries ADD COLUMN username TEXT NOT NULL DEFAULT ''")
  }
  if (!entryColumns.some((column) => column.name === 'source_name')) {
    db.exec("ALTER TABLE leaderboard_entries ADD COLUMN source_name TEXT NOT NULL DEFAULT ''")
  }
  if (!entryColumns.some((column) => column.name === 'anonymous_name')) {
    db.exec("ALTER TABLE leaderboard_entries ADD COLUMN anonymous_name TEXT NOT NULL DEFAULT ''")
  }
  if (!entryColumns.some((column) => column.name === 'is_name_public')) {
    db.exec('ALTER TABLE leaderboard_entries ADD COLUMN is_name_public INTEGER NOT NULL DEFAULT 0')
    db.exec('UPDATE leaderboard_entries SET is_name_public = 1')
  }
  if (!entryColumns.some((column) => column.name === 'participating')) {
    db.exec('ALTER TABLE leaderboard_entries ADD COLUMN participating INTEGER NOT NULL DEFAULT 1')
  }
  for (const column of [
    'participate_day',
    'participate_week',
    'participate_month',
    'participate_all',
    'participate_rank',
    'show_rank_badge',
  ]) {
    if (!entryColumns.some((entryColumn) => entryColumn.name === column)) {
      db.exec(`ALTER TABLE leaderboard_entries ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`)
      db.exec(`UPDATE leaderboard_entries SET ${column} = participating`)
    }
  }

  const updateAnonymousName = db.prepare(
    'UPDATE leaderboard_entries SET anonymous_name = ? WHERE id = ?',
  )
  for (const row of db.prepare(`
    SELECT id FROM leaderboard_entries WHERE anonymous_name = ''
  `).all()) {
    updateAnonymousName.run(randomAnonymousName(), row.id)
  }

  const duplicateUsers = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT user_id FROM leaderboard_entries
      GROUP BY user_id HAVING COUNT(*) > 1
    )
  `).get().count
  if (duplicateUsers > 0) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        INSERT INTO usage_aggregates
          (entry_id, period_type, period_key, token_used, quota,
           request_count, updated_at)
        SELECT MIN(e.id), a.period_type, a.period_key,
               SUM(a.token_used), SUM(a.quota), SUM(a.request_count),
               MAX(a.updated_at)
        FROM leaderboard_entries e
        JOIN usage_aggregates a ON a.entry_id = e.id
        GROUP BY e.user_id, a.period_type, a.period_key
        ON CONFLICT(entry_id, period_type, period_key) DO UPDATE SET
          token_used = excluded.token_used,
          quota = excluded.quota,
          request_count = excluded.request_count,
          updated_at = excluded.updated_at;

        DELETE FROM leaderboard_entries
        WHERE id NOT IN (
          SELECT MIN(id) FROM leaderboard_entries GROUP BY user_id
        );
      `)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_user
      ON leaderboard_entries(user_id)
  `)

  const lotteryColumns = db.prepare('PRAGMA table_info(lottery_draws)').all()
  if (lotteryColumns.length > 0 && !lotteryColumns.some((column) => column.name === 'draw_rank')) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        ALTER TABLE lottery_draws RENAME TO lottery_draws_legacy;

        CREATE TABLE lottery_draws (
          id TEXT PRIMARY KEY,
          rule_version INTEGER NOT NULL DEFAULT 1,
          period_key TEXT NOT NULL,
          draw_rank INTEGER NOT NULL DEFAULT 1,
          user_id INTEGER NOT NULL,
          entry_id INTEGER NOT NULL,
          display_name_snapshot TEXT NOT NULL DEFAULT '',
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
          (id, rule_version, period_key, draw_rank, user_id, entry_id,
           display_name_snapshot, amount_usd, quota_amount, status,
           error_message, operator_user_id,
           created_at, updated_at, completed_at)
        SELECT id, 1, period_key, 1, user_id, entry_id, '', amount_usd,
               quota_amount, status, error_message, operator_user_id,
               created_at, updated_at, completed_at
        FROM lottery_draws_legacy;

        DROP TABLE lottery_draws_legacy;
      `)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const lotteryColumnsAfterRankMigration = db.prepare('PRAGMA table_info(lottery_draws)').all()
  if (lotteryColumnsAfterRankMigration.length > 0 &&
      !lotteryColumnsAfterRankMigration.some((column) => column.name === 'rule_version')) {
    db.exec('ALTER TABLE lottery_draws ADD COLUMN rule_version INTEGER NOT NULL DEFAULT 1')
  }
  const lotteryColumnsAfterRuleMigration = db.prepare('PRAGMA table_info(lottery_draws)').all()
  if (lotteryColumnsAfterRuleMigration.length > 0 &&
      !lotteryColumnsAfterRuleMigration.some((column) => column.name === 'display_name_snapshot')) {
    db.exec("ALTER TABLE lottery_draws ADD COLUMN display_name_snapshot TEXT NOT NULL DEFAULT ''")
  }
  db.exec(`
    UPDATE lottery_draws
    SET display_name_snapshot = COALESCE((
      SELECT CASE
        WHEN e.is_name_public = 1 AND e.participate_week = 1
        THEN e.display_name ELSE e.anonymous_name
      END
      FROM leaderboard_entries e
      WHERE e.id = lottery_draws.entry_id
    ), '')
    WHERE display_name_snapshot = ''
  `)
  db.exec(`
    DROP INDEX IF EXISTS idx_lottery_period_rank;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lottery_rule_period_rank
      ON lottery_draws(rule_version, period_key, draw_rank)
  `)
  db.exec(`
    INSERT OR IGNORE INTO lottery_opportunities
      (rule_version, period_key, draw_rank, user_id, entry_id,
       display_name_snapshot, token_used, quota, request_count,
       prize_pool_json, created_at)
    SELECT rule_version, period_key, draw_rank, user_id, entry_id,
           display_name_snapshot, 0, 0, 0, '[]', created_at
    FROM lottery_draws
  `)

  const statements = {
    insertEntry: db.prepare(`
      INSERT INTO leaderboard_entries
        (user_id, username, token_id, token_name, masked_key, display_name,
         anonymous_name, is_name_public, token_created_at,
         manage_secret_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertAnonymousEntry: db.prepare(`
      INSERT INTO leaderboard_entries
        (user_id, username, token_id, token_name, masked_key, display_name,
         anonymous_name, is_name_public, token_created_at,
         manage_secret_hash, created_at)
      VALUES (?, '', ?, '', '', ?, ?, 0, 0, '', ?)
      ON CONFLICT(user_id) DO NOTHING
    `),
    updateSourceName: db.prepare(`
      UPDATE leaderboard_entries SET source_name = ?
      WHERE user_id = ? AND active = 1
    `),
    getEntry: db.prepare(
      'SELECT * FROM leaderboard_entries WHERE id = ? AND active = 1',
    ),
    getEntryByUserId: db.prepare(
      'SELECT * FROM leaderboard_entries WHERE user_id = ? AND active = 1',
    ),
    listEntries: db.prepare(`
      SELECT * FROM leaderboard_entries
      WHERE active = 1
      ORDER BY created_at ASC
    `),
    updateEntryName: db.prepare(`
      UPDATE leaderboard_entries SET display_name = ?
      WHERE id = ? AND active = 1
    `),
    publishEntryName: db.prepare(`
      UPDATE leaderboard_entries SET is_name_public = ?
      WHERE id = ? AND active = 1
    `),
    anonymizeEntry: db.prepare(`
      UPDATE leaderboard_entries SET is_name_public = 0
      WHERE id = ? AND active = 1
    `),
    updateParticipation: db.prepare(`
      UPDATE leaderboard_entries SET participating = ?
      WHERE id = ? AND active = 1
    `),
    updateVisibilitySettings: db.prepare(`
      UPDATE leaderboard_entries
      SET participate_day = ?,
          participate_week = ?,
          participate_month = ?,
          participate_all = ?,
          participate_rank = ?,
          show_rank_badge = ?,
          participating = CASE
            WHEN ? = 1 OR ? = 1 OR ? = 1 OR ? = 1 OR ? = 1
            THEN 1 ELSE 0
          END
      WHERE id = ? AND active = 1
    `),
    deleteEntry: db.prepare(
      'DELETE FROM leaderboard_entries WHERE id = ? AND active = 1',
    ),
    upsertAggregate: db.prepare(`
      INSERT INTO usage_aggregates
        (entry_id, period_type, period_key, token_used, quota,
         request_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id, period_type, period_key) DO UPDATE SET
        token_used = excluded.token_used,
        quota = excluded.quota,
        request_count = excluded.request_count,
        updated_at = excluded.updated_at
    `),
    listLeaderboard: db.prepare(`
      SELECT e.id, e.user_id, e.username, e.source_name, e.is_name_public,
             e.display_name, e.anonymous_name,
             CASE WHEN e.is_name_public = 1
               THEN e.display_name ELSE e.anonymous_name
             END AS public_name,
             e.created_at, COALESCE(a.token_used, 0) AS token_used,
             COALESCE(a.quota, 0) AS quota,
             COALESCE(a.request_count, 0) AS request_count,
             COALESCE(a.updated_at, 0) AS updated_at,
             e.participating, e.participate_day, e.participate_week,
             e.participate_month, e.participate_all, e.participate_rank,
             e.show_rank_badge,
             CASE WHEN e.is_name_public = 1 THEN COALESCE((
               SELECT SUM(sponsor.amount_cny) FROM sponsor_orders sponsor
               WHERE sponsor.entry_id = e.id
                 AND sponsor.status = 'completed'
             ), 0) ELSE 0 END AS sponsor_amount_cny,
             CASE WHEN e.is_name_public = 1 THEN COALESCE((
               SELECT MAX(sponsor.completed_at) FROM sponsor_orders sponsor
               WHERE sponsor.entry_id = e.id
                 AND sponsor.status = 'completed'
             ), 0) ELSE 0 END AS last_sponsor_completed_at,
             EXISTS (
               SELECT 1 FROM usage_aggregates lifetime
               WHERE lifetime.entry_id = e.id
                 AND lifetime.period_type = 'all'
                 AND (
                   lifetime.token_used > 0 OR lifetime.quota > 0 OR
                   lifetime.request_count > 0
                 )
             ) AS has_usage
      FROM leaderboard_entries e
      LEFT JOIN usage_aggregates a
        ON a.entry_id = e.id
       AND a.period_type = ?
       AND a.period_key = ?
      WHERE e.active = 1
    `),
    countUsedEntries: db.prepare(`
      SELECT COUNT(*) AS count
      FROM leaderboard_entries e
      WHERE e.active = 1 AND e.participating = 1
        AND EXISTS (
          SELECT 1 FROM usage_aggregates lifetime
          WHERE lifetime.entry_id = e.id
            AND lifetime.period_type = 'all'
            AND (
              lifetime.token_used > 0 OR lifetime.quota > 0 OR
              lifetime.request_count > 0
            )
        )
    `),
    setSetting: db.prepare(`
      INSERT INTO app_settings(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
    insertSponsorOrder: db.prepare(`
      INSERT INTO sponsor_orders
        (id, request_key, user_id, entry_id, amount_cny, quota_amount,
         display_anonymously, message, status, operator_user_id,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING
    `),
    getSponsorOrder: db.prepare('SELECT * FROM sponsor_orders WHERE id = ?'),
    getSponsorOrderByRequestKey: db.prepare(
      'SELECT * FROM sponsor_orders WHERE request_key = ?',
    ),
    finishSponsorOrder: db.prepare(`
      UPDATE sponsor_orders
      SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    listSponsorHistory: db.prepare(`
      SELECT o.id, o.amount_cny, o.quota_amount, o.display_anonymously,
             o.message, o.status, o.error_message, o.created_at,
             o.updated_at, o.completed_at
      FROM sponsor_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      WHERE e.user_id = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `),
    getRenameCardBalance: db.prepare(`
      SELECT COALESCE(balance, 0) AS balance
      FROM rename_card_balances
      WHERE user_id = ?
    `),
    upsertRenameCardBalance: db.prepare(`
      INSERT INTO rename_card_balances (user_id, balance, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = excluded.balance,
        updated_at = excluded.updated_at
    `),
    addRenameCards: db.prepare(`
      INSERT INTO rename_card_balances (user_id, balance, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = balance + excluded.balance,
        updated_at = excluded.updated_at
    `),
    consumeRenameCard: db.prepare(`
      UPDATE rename_card_balances
      SET balance = balance - 1, updated_at = ?
      WHERE user_id = ? AND balance > 0
    `),
    getWeeklyFreeRenameEvent: db.prepare(`
      SELECT * FROM rename_events
      WHERE user_id = ? AND period_key = ? AND cost_type = 'free'
      ORDER BY created_at DESC
      LIMIT 1
    `),
    insertRenameEvent: db.prepare(`
      INSERT INTO rename_events
        (id, user_id, entry_id, old_name, new_name, cost_type, period_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertRenameCardOrder: db.prepare(`
      INSERT INTO rename_card_orders
        (id, request_key, user_id, entry_id, quantity, amount_cny,
         quota_amount, status, operator_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING
    `),
    getRenameCardOrder: db.prepare('SELECT * FROM rename_card_orders WHERE id = ?'),
    getRenameCardOrderByRequestKey: db.prepare(
      'SELECT * FROM rename_card_orders WHERE request_key = ?',
    ),
    finishRenameCardOrder: db.prepare(`
      UPDATE rename_card_orders
      SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    getSponsorSummary: db.prepare(`
      SELECT COALESCE(SUM(o.amount_cny), 0) AS amount_cny,
             COUNT(*) AS sponsor_count,
             COALESCE(MAX(o.completed_at), 0) AS last_completed_at
      FROM sponsor_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      WHERE e.user_id = ? AND o.status = 'completed'
    `),
    listSupportDailyUsage: db.prepare(`
      SELECT e.user_id, a.period_key, SUM(a.quota) AS quota,
             MAX(a.updated_at) AS updated_at
      FROM usage_aggregates a
      JOIN leaderboard_entries e ON e.id = a.entry_id
      WHERE e.active = 1
        AND a.period_type = 'day'
        AND a.period_key >= ?
      GROUP BY e.user_id, a.period_key
      ORDER BY e.user_id ASC, a.period_key ASC
    `),
    listSupportSponsors: db.prepare(`
      SELECT e.user_id, o.amount_cny, o.completed_at, o.status
      FROM sponsor_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      WHERE e.active = 1 AND o.status = 'completed'
      ORDER BY e.user_id ASC, o.completed_at ASC
    `),
    listSupportRenameCards: db.prepare(`
      SELECT e.user_id, o.amount_cny, o.completed_at, o.status
      FROM rename_card_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      WHERE e.active = 1 AND o.status = 'completed'
      ORDER BY e.user_id ASC, o.completed_at ASC
    `),
    listSponsorLeaderboard: db.prepare(`
      SELECT e.id, e.user_id,
             CASE WHEN e.is_name_public = 1
               THEN e.display_name ELSE '匿名赞助者'
             END AS public_name,
             SUM(o.amount_cny) AS amount_cny,
             COUNT(*) AS sponsor_count,
             MAX(o.completed_at) AS updated_at
      FROM sponsor_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      WHERE o.status = 'completed'
        AND o.completed_at >= ? AND o.completed_at < ?
      GROUP BY e.id, e.user_id
      ORDER BY amount_cny DESC, updated_at ASC, e.id ASC
    `),
    sponsorTotals: db.prepare(`
      SELECT COALESCE(SUM(amount_cny), 0) AS amount_cny,
             COUNT(*) AS sponsor_count,
             COUNT(DISTINCT user_id) AS member_count
      FROM sponsor_orders
      WHERE status = 'completed'
        AND completed_at >= ? AND completed_at < ?
    `),
    listAllSponsorOrders: db.prepare(`
      SELECT o.*, e.user_id AS entry_user_id,
             CASE WHEN e.is_name_public = 1
               THEN e.display_name ELSE e.anonymous_name
             END AS public_name
      FROM sponsor_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      ORDER BY o.created_at DESC
      LIMIT ?
    `),
    listAllRenameCardOrders: db.prepare(`
      SELECT o.*, e.user_id AS entry_user_id, e.display_name
      FROM rename_card_orders o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      ORDER BY o.created_at DESC
      LIMIT ?
    `),
    listAllRenameEvents: db.prepare(`
      SELECT * FROM rename_events
      ORDER BY created_at DESC
      LIMIT ?
    `),
    renameCardOutstanding: db.prepare(`
      SELECT COALESCE(SUM(balance), 0) AS cards FROM rename_card_balances
    `),
    insertPostpaidGrant: db.prepare(`
      INSERT INTO postpaid_grants
        (id, request_key, user_id, entry_id, tier_key, tier_name,
         credit_amount, quota_amount, outstanding_quota,
         redemption_start_id, status, operator_user_id,
         created_at, updated_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?)
      ON CONFLICT(request_key) DO NOTHING
    `),
    getPostpaidGrant: db.prepare('SELECT * FROM postpaid_grants WHERE id = ?'),
    getPostpaidGrantByRequestKey: db.prepare(
      'SELECT * FROM postpaid_grants WHERE request_key = ?',
    ),
    getOpenPostpaidGrant: db.prepare(`
      SELECT * FROM postpaid_grants
      WHERE user_id = ?
        AND status IN ('processing', 'active', 'overdue', 'unknown')
      ORDER BY created_at DESC
      LIMIT 1
    `),
    listOpenPostpaidGrantsForUser: db.prepare(`
      SELECT * FROM postpaid_grants
      WHERE user_id = ?
        AND status IN ('processing', 'active', 'overdue', 'unknown')
        AND outstanding_quota > 0
      ORDER BY due_at ASC, created_at ASC, rowid ASC
    `),
    getPostpaidExposure: db.prepare(`
      SELECT COALESCE(SUM(outstanding_quota), 0) AS outstanding_quota
      FROM postpaid_grants
      WHERE user_id = ?
        AND status IN ('processing', 'active', 'overdue', 'unknown')
        AND outstanding_quota > 0
    `),
    listOpenPostpaidGrants: db.prepare(`
      SELECT * FROM postpaid_grants
      WHERE status IN ('active', 'overdue') AND outstanding_quota > 0
      ORDER BY due_at ASC, created_at ASC, rowid ASC
    `),
    activatePostpaidGrant: db.prepare(`
      UPDATE postpaid_grants
      SET status = 'active', error_message = '', updated_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    finishPostpaidGrantFailure: db.prepare(`
      UPDATE postpaid_grants
      SET status = ?, error_message = ?, outstanding_quota = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    markPostpaidOverdue: db.prepare(`
      UPDATE postpaid_grants
      SET status = 'overdue', updated_at = ?
      WHERE status = 'active' AND outstanding_quota > 0 AND due_at < ?
    `),
    listUserPostpaidGrants: db.prepare(`
      SELECT * FROM postpaid_grants
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    listAdminPostpaidGrants: db.prepare(`
      SELECT g.*, e.username, e.source_name,
             CASE WHEN e.is_name_public = 1
               THEN e.display_name ELSE e.anonymous_name
             END AS public_name
      FROM postpaid_grants g
      JOIN leaderboard_entries e ON e.id = g.entry_id
      ORDER BY g.created_at DESC
      LIMIT ?
    `),
    insertPostpaidEvent: db.prepare(`
      INSERT OR IGNORE INTO postpaid_events
        (id, grant_id, user_id, event_type, redemption_id,
         redemption_time, quota_amount, outstanding_before,
         outstanding_after, status, created_at, updated_at)
      VALUES (?, ?, ?, 'repayment', ?, ?, ?, ?, ?, 'processing', ?, ?)
    `),
    getPostpaidEvent: db.prepare('SELECT * FROM postpaid_events WHERE id = ?'),
    getPostpaidEventByRedemption: db.prepare(`
      SELECT * FROM postpaid_events
      WHERE redemption_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `),
    getPostpaidEventByGrantRedemption: db.prepare(`
      SELECT * FROM postpaid_events
      WHERE grant_id = ? AND redemption_id = ?
    `),
    listPostpaidEventsByRedemption: db.prepare(`
      SELECT * FROM postpaid_events
      WHERE redemption_id = ?
      ORDER BY created_at ASC
    `),
    finishPostpaidEvent: db.prepare(`
      UPDATE postpaid_events
      SET status = ?, error_message = ?, updated_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    applyPostpaidRepayment: db.prepare(`
      UPDATE postpaid_grants
      SET outstanding_quota = ?,
          status = CASE WHEN ? = 0 THEN 'settled' ELSE status END,
          updated_at = ?,
          completed_at = CASE WHEN ? = 0 THEN ? ELSE completed_at END
      WHERE id = ? AND outstanding_quota = ?
        AND status IN ('active', 'overdue')
    `),
    listUserPostpaidEvents: db.prepare(`
      SELECT event.* FROM postpaid_events event
      WHERE event.user_id = ?
      ORDER BY event.created_at DESC
      LIMIT ?
    `),
    listAdminPostpaidEvents: db.prepare(`
      SELECT event.*, grant.tier_name, e.username, e.source_name,
             CASE WHEN e.is_name_public = 1
               THEN e.display_name ELSE e.anonymous_name
             END AS public_name
      FROM postpaid_events event
      JOIN postpaid_grants grant ON grant.id = event.grant_id
      JOIN leaderboard_entries e ON e.user_id = event.user_id
      ORDER BY event.created_at DESC
      LIMIT ?
    `),
    postpaidSummary: db.prepare(`
      SELECT
        COUNT(*) AS grant_count,
        COUNT(DISTINCT user_id) AS user_count,
        COALESCE(SUM(CASE
          WHEN status IN ('active', 'overdue', 'unknown')
          THEN outstanding_quota ELSE 0 END), 0) AS outstanding_quota,
        COALESCE(SUM(CASE
          WHEN status = 'overdue' THEN outstanding_quota ELSE 0 END), 0) AS overdue_quota,
        COALESCE(SUM(CASE
          WHEN status IN ('active', 'settled', 'overdue')
          THEN quota_amount ELSE 0 END), 0) AS granted_quota
      FROM postpaid_grants
    `),
    postpaidRepaidTotal: db.prepare(`
      SELECT COALESCE(SUM(quota_amount), 0) AS repaid_quota
      FROM postpaid_events WHERE status = 'completed'
    `),
    getLotteryPeriod: db.prepare(`
      SELECT * FROM lottery_periods
      WHERE rule_version = ? AND period_key = ?
    `),
    insertLotteryPeriod: db.prepare(`
      INSERT INTO lottery_periods (rule_version, period_key, settled_at)
      VALUES (?, ?, ?)
      ON CONFLICT(rule_version, period_key) DO NOTHING
    `),
    insertLotteryOpportunity: db.prepare(`
      INSERT INTO lottery_opportunities
        (rule_version, period_key, draw_rank, user_id, entry_id,
         display_name_snapshot, token_used, quota, request_count,
         prize_pool_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rule_version, period_key, draw_rank) DO NOTHING
    `),
    getLotteryWeekUpdatedAt: db.prepare(`
      SELECT COALESCE(MAX(updated_at), 0) AS updated_at
      FROM usage_aggregates
      WHERE period_type = 'week' AND period_key = ?
    `),
    listLotteryOpportunitiesBefore: db.prepare(`
      SELECT o.*,
             e.display_name AS current_display_name,
             e.anonymous_name AS current_anonymous_name,
             e.is_name_public AS current_is_name_public,
             e.participate_week AS current_participate_week,
             d.id AS draw_id,
             d.display_name_snapshot AS draw_display_name_snapshot,
             d.amount_usd AS draw_amount_usd,
             d.quota_amount AS draw_quota_amount,
             d.status AS draw_status,
             d.error_message AS draw_error_message,
             d.operator_user_id AS draw_operator_user_id,
             d.created_at AS draw_created_at,
             d.updated_at AS draw_updated_at,
             d.completed_at AS draw_completed_at
      FROM lottery_opportunities o
      JOIN leaderboard_entries e ON e.id = o.entry_id
      LEFT JOIN lottery_draws d
        ON d.rule_version = o.rule_version
       AND d.period_key = o.period_key
       AND d.draw_rank = o.draw_rank
      WHERE o.rule_version = ? AND o.period_key <= ?
      ORDER BY o.period_key ASC, o.draw_rank ASC
    `),
    insertLotteryDraw: db.prepare(`
      INSERT INTO lottery_draws
        (id, rule_version, period_key, draw_rank, user_id, entry_id,
         display_name_snapshot, amount_usd, quota_amount, status,
         operator_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)
      ON CONFLICT(rule_version, period_key, draw_rank) DO NOTHING
    `),
    getLotteryDraw: db.prepare('SELECT * FROM lottery_draws WHERE id = ?'),
    getLotteryDrawByPeriodRank: db.prepare(
      'SELECT * FROM lottery_draws WHERE rule_version = ? AND period_key = ? AND draw_rank = ?',
    ),
    listLotteryDrawsByPeriod: db.prepare(`
      SELECT * FROM lottery_draws WHERE rule_version = ? AND period_key = ?
      ORDER BY draw_rank ASC
    `),
    listLotteryWeekKeysBefore: db.prepare(`
      SELECT period_key
      FROM usage_aggregates
      WHERE period_type = 'week'
        AND period_key <= ?
      GROUP BY period_key
      HAVING SUM(quota) > 0
      ORDER BY period_key ASC
    `),
    finishLotteryDraw: db.prepare(`
      UPDATE lottery_draws
      SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'processing'
    `),
    restartLotteryDraw: db.prepare(`
      UPDATE lottery_draws
      SET status = 'processing', error_message = '', updated_at = ?
      WHERE id = ? AND status = 'failed'
    `),
    resolveUnknownLotteryDraw: db.prepare(`
      UPDATE lottery_draws
      SET status = ?, error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'unknown'
    `),
    listUnknownLotteryDraws: db.prepare(`
      SELECT d.*, e.source_name, e.username
      FROM lottery_draws d
      JOIN leaderboard_entries e ON e.id = d.entry_id
      WHERE d.rule_version = ? AND d.status = 'unknown'
      ORDER BY d.updated_at ASC
      LIMIT ?
    `),
    listLotteryDraws: db.prepare(`
      SELECT d.period_key, d.draw_rank, d.amount_usd, d.status, d.created_at,
             d.completed_at,
             CASE WHEN d.display_name_snapshot != ''
               THEN d.display_name_snapshot
               WHEN e.is_name_public = 1 AND e.participate_week = 1
               THEN e.display_name ELSE e.anonymous_name
             END AS public_name
      FROM lottery_draws d
      JOIN leaderboard_entries e ON e.id = d.entry_id
      WHERE d.rule_version = ?
      ORDER BY d.period_key DESC, d.draw_rank ASC
      LIMIT ?
    `),
  }

  return {
    raw: db,
    createEntry(entry) {
      const anonymousName = entry.anonymousName || randomAnonymousName()
      const result = statements.insertEntry.run(
        entry.userId,
        entry.username,
        -entry.userId,
        entry.username || `用户 #${entry.userId}`,
        `用户 #${entry.userId}`,
        entry.displayName,
        anonymousName,
        1,
        0,
        '',
        entry.createdAt,
      )
      return Number(result.lastInsertRowid)
    },
    ensureAnonymousEntry(userId, createdAt, sourceName = '') {
      const anonymousName = randomAnonymousName()
      statements.insertAnonymousEntry.run(
        userId,
        -userId,
        anonymousName,
        anonymousName,
        createdAt,
      )
      if (sourceName) statements.updateSourceName.run(sourceName, userId)
      return statements.getEntryByUserId.get(userId) ?? null
    },
    getEntry(id) {
      return statements.getEntry.get(id) ?? null
    },
    getEntryByUserId(userId) {
      return statements.getEntryByUserId.get(userId) ?? null
    },
    listEntries() {
      return statements.listEntries.all()
    },
    updateEntryName(id, displayName) {
      return Number(statements.updateEntryName.run(displayName, id).changes)
    },
    publishEntryName(id, isNamePublic) {
      return Number(statements.publishEntryName.run(isNamePublic ? 1 : 0, id).changes)
    },
    anonymizeEntry(id) {
      return Number(statements.anonymizeEntry.run(id).changes)
    },
    updateParticipation(id, participating) {
      return Number(statements.updateParticipation.run(participating ? 1 : 0, id).changes)
    },
    updateVisibilitySettings(id, settings) {
      const values = [
        settings.participateDay,
        settings.participateWeek,
        settings.participateMonth,
        settings.participateAll,
        settings.participateRank,
        settings.showRankBadge,
      ].map((value) => (value ? 1 : 0))
      return Number(statements.updateVisibilitySettings.run(
        ...values,
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
        id,
      ).changes)
    },
    deleteEntry(id) {
      return Number(statements.deleteEntry.run(id).changes)
    },
    upsertAggregate(value) {
      statements.upsertAggregate.run(
        value.entryId,
        value.periodType,
        value.periodKey,
        value.tokenUsed,
        value.quota,
        value.requestCount,
        value.updatedAt,
      )
    },
    listLeaderboard(periodType, key) {
      return statements.listLeaderboard.all(periodType, key)
    },
    countUsedEntries() {
      return Number(statements.countUsedEntries.get().count)
    },
    createSponsorOrder(order) {
      statements.insertSponsorOrder.run(
        order.id,
        order.requestKey,
        order.userId,
        order.entryId,
        order.amountCny,
        order.quotaAmount,
        order.displayAnonymously ? 1 : 0,
        order.message,
        order.operatorUserId,
        order.createdAt,
        order.createdAt,
      )
      return statements.getSponsorOrderByRequestKey.get(order.requestKey) ?? null
    },
    getSponsorOrder(id) {
      return statements.getSponsorOrder.get(id) ?? null
    },
    getSponsorOrderByRequestKey(requestKey) {
      return statements.getSponsorOrderByRequestKey.get(requestKey) ?? null
    },
    finishSponsorOrder(id, status, errorMessage, updatedAt) {
      const completedAt = status === 'completed' ? updatedAt : 0
      return Number(
        statements.finishSponsorOrder.run(
          status,
          errorMessage || '',
          updatedAt,
          completedAt,
          id,
        ).changes,
      )
    },
    listSponsorHistory(userId, limit = 30) {
      return statements.listSponsorHistory.all(userId, limit)
    },
    getSponsorSummary(userId) {
      return statements.getSponsorSummary.get(userId)
    },
    listSupportDailyUsage(startKey) {
      return statements.listSupportDailyUsage.all(startKey)
    },
    listSupportSponsors() {
      return statements.listSupportSponsors.all()
    },
    listSupportRenameCards() {
      return statements.listSupportRenameCards.all()
    },
    listSponsorLeaderboard(start, end) {
      return statements.listSponsorLeaderboard.all(start, end)
    },
    sponsorTotals(start, end) {
      return statements.sponsorTotals.get(start, end)
    },
    listAllSponsorOrders(limit = 200) {
      return statements.listAllSponsorOrders.all(limit)
    },
    listAllRenameCardOrders(limit = 200) {
      return statements.listAllRenameCardOrders.all(limit)
    },
    listAllRenameEvents(limit = 200) {
      return statements.listAllRenameEvents.all(limit)
    },
    renameCardOutstanding() {
      return Number(statements.renameCardOutstanding.get()?.cards || 0)
    },
    createPostpaidGrant(grant) {
      statements.insertPostpaidGrant.run(
        grant.id,
        grant.requestKey,
        grant.userId,
        grant.entryId,
        grant.tierKey,
        grant.tierName,
        grant.creditAmount,
        grant.quotaAmount,
        grant.quotaAmount,
        grant.redemptionStartId || 0,
        grant.operatorUserId,
        grant.createdAt,
        grant.createdAt,
        grant.dueAt,
      )
      return statements.getPostpaidGrantByRequestKey.get(grant.requestKey) ?? null
    },
    getPostpaidGrant(id) {
      return statements.getPostpaidGrant.get(id) ?? null
    },
    getPostpaidGrantByRequestKey(requestKey) {
      return statements.getPostpaidGrantByRequestKey.get(requestKey) ?? null
    },
    getOpenPostpaidGrant(userId) {
      return statements.getOpenPostpaidGrant.get(userId) ?? null
    },
    listOpenPostpaidGrantsForUser(userId) {
      return statements.listOpenPostpaidGrantsForUser.all(userId)
    },
    getPostpaidExposure(userId) {
      return Number(statements.getPostpaidExposure.get(userId)?.outstanding_quota || 0)
    },
    listOpenPostpaidGrants() {
      return statements.listOpenPostpaidGrants.all()
    },
    activatePostpaidGrant(id, updatedAt) {
      return Number(statements.activatePostpaidGrant.run(updatedAt, id).changes)
    },
    finishPostpaidGrantFailure(id, status, errorMessage, updatedAt) {
      const outstandingQuota = status === 'failed' ? 0 :
        Number(statements.getPostpaidGrant.get(id)?.outstanding_quota || 0)
      return Number(statements.finishPostpaidGrantFailure.run(
        status,
        errorMessage || '',
        outstandingQuota,
        updatedAt,
        id,
      ).changes)
    },
    markPostpaidOverdue(now) {
      return Number(statements.markPostpaidOverdue.run(now, now).changes)
    },
    listUserPostpaidGrants(userId, limit = 20) {
      return statements.listUserPostpaidGrants.all(userId, limit)
    },
    listAdminPostpaidGrants(limit = 100) {
      return statements.listAdminPostpaidGrants.all(limit)
    },
    createPostpaidRepayment(event) {
      statements.insertPostpaidEvent.run(
        event.id,
        event.grantId,
        event.userId,
        event.redemptionId,
        event.redemptionTime,
        event.quotaAmount,
        event.outstandingBefore,
        event.outstandingAfter,
        event.createdAt,
        event.createdAt,
      )
      return statements.getPostpaidEventByGrantRedemption.get(
        event.grantId,
        event.redemptionId,
      ) ?? null
    },
    getPostpaidEvent(id) {
      return statements.getPostpaidEvent.get(id) ?? null
    },
    getPostpaidEventByRedemption(redemptionId) {
      return statements.getPostpaidEventByRedemption.get(redemptionId) ?? null
    },
    getPostpaidEventByGrantRedemption(grantId, redemptionId) {
      return statements.getPostpaidEventByGrantRedemption.get(grantId, redemptionId) ?? null
    },
    listPostpaidEventsByRedemption(redemptionId) {
      return statements.listPostpaidEventsByRedemption.all(redemptionId)
    },
    finishPostpaidEvent(id, status, errorMessage, updatedAt) {
      return Number(statements.finishPostpaidEvent.run(
        status,
        errorMessage || '',
        updatedAt,
        id,
      ).changes)
    },
    applyPostpaidRepayment(grantId, outstandingBefore, outstandingAfter, updatedAt) {
      return Number(statements.applyPostpaidRepayment.run(
        outstandingAfter,
        outstandingAfter,
        updatedAt,
        outstandingAfter,
        updatedAt,
        grantId,
        outstandingBefore,
      ).changes)
    },
    listUserPostpaidEvents(userId, limit = 50) {
      return statements.listUserPostpaidEvents.all(userId, limit)
    },
    listAdminPostpaidEvents(limit = 200) {
      return statements.listAdminPostpaidEvents.all(limit)
    },
    postpaidSummary() {
      return {
        ...statements.postpaidSummary.get(),
        ...statements.postpaidRepaidTotal.get(),
      }
    },
    getRenameCardBalance(userId) {
      return Number(statements.getRenameCardBalance.get(userId)?.balance || 0)
    },
    addRenameCards(userId, quantity, updatedAt) {
      return Number(statements.addRenameCards.run(userId, quantity, updatedAt).changes)
    },
    consumeRenameCard(userId, updatedAt) {
      return Number(statements.consumeRenameCard.run(updatedAt, userId).changes)
    },
    getWeeklyFreeRenameEvent(userId, periodKey) {
      return statements.getWeeklyFreeRenameEvent.get(userId, periodKey) ?? null
    },
    createRenameEvent(event) {
      statements.insertRenameEvent.run(
        event.id,
        event.userId,
        event.entryId,
        event.oldName,
        event.newName,
        event.costType,
        event.periodKey,
        event.createdAt,
      )
      return event
    },
    createRenameCardOrder(order) {
      statements.insertRenameCardOrder.run(
        order.id,
        order.requestKey,
        order.userId,
        order.entryId,
        order.quantity,
        order.amountCny,
        order.quotaAmount,
        order.operatorUserId,
        order.createdAt,
        order.createdAt,
      )
      return statements.getRenameCardOrderByRequestKey.get(order.requestKey) ?? null
    },
    getRenameCardOrder(id) {
      return statements.getRenameCardOrder.get(id) ?? null
    },
    getRenameCardOrderByRequestKey(requestKey) {
      return statements.getRenameCardOrderByRequestKey.get(requestKey) ?? null
    },
    finishRenameCardOrder(id, status, errorMessage, updatedAt) {
      const completedAt = status === 'completed' ? updatedAt : 0
      return Number(
        statements.finishRenameCardOrder.run(
          status,
          errorMessage || '',
          updatedAt,
          completedAt,
          id,
        ).changes,
      )
    },
    isLotteryPeriodSettled(ruleVersion, periodKey) {
      return Boolean(statements.getLotteryPeriod.get(ruleVersion, periodKey))
    },
    getLotteryWeekUpdatedAt(periodKey) {
      return Number(statements.getLotteryWeekUpdatedAt.get(periodKey).updated_at)
    },
    settleLotteryPeriod(period) {
      db.exec('BEGIN IMMEDIATE')
      try {
        if (statements.getLotteryPeriod.get(period.ruleVersion, period.periodKey)) {
          db.exec('COMMIT')
          return false
        }
        for (const opportunity of period.opportunities) {
          statements.insertLotteryOpportunity.run(
            period.ruleVersion,
            period.periodKey,
            opportunity.rank,
            opportunity.userId,
            opportunity.entryId,
            opportunity.displayNameSnapshot,
            opportunity.tokenUsed,
            opportunity.quota,
            opportunity.requestCount,
            JSON.stringify(opportunity.prizePool),
            period.settledAt,
          )
        }
        statements.insertLotteryPeriod.run(
          period.ruleVersion,
          period.periodKey,
          period.settledAt,
        )
        db.exec('COMMIT')
        return true
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    listLotteryOpportunitiesBefore(ruleVersion, periodKey) {
      return statements.listLotteryOpportunitiesBefore.all(ruleVersion, periodKey)
    },
    createLotteryDraw(draw) {
      statements.insertLotteryDraw.run(
        draw.id,
        draw.ruleVersion || 1,
        draw.periodKey,
        draw.rank,
        draw.userId,
        draw.entryId,
        draw.displayNameSnapshot || '',
        draw.amountUsd,
        draw.quotaAmount,
        draw.operatorUserId,
        draw.createdAt,
        draw.createdAt,
      )
      return statements.getLotteryDrawByPeriodRank.get(
        draw.ruleVersion || 1,
        draw.periodKey,
        draw.rank,
      ) ?? null
    },
    getLotteryDraw(id) {
      return statements.getLotteryDraw.get(id) ?? null
    },
    getLotteryDrawByPeriodRank(ruleVersionOrPeriodKey, periodKeyOrRank, maybeRank) {
      const ruleVersion = maybeRank === undefined ? 1 : ruleVersionOrPeriodKey
      const periodKey = maybeRank === undefined ? ruleVersionOrPeriodKey : periodKeyOrRank
      const rank = maybeRank === undefined ? periodKeyOrRank : maybeRank
      return statements.getLotteryDrawByPeriodRank.get(ruleVersion, periodKey, rank) ?? null
    },
    listLotteryDrawsByPeriod(ruleVersionOrPeriodKey, maybePeriodKey) {
      const ruleVersion = maybePeriodKey === undefined ? 1 : ruleVersionOrPeriodKey
      const periodKey = maybePeriodKey === undefined ? ruleVersionOrPeriodKey : maybePeriodKey
      return statements.listLotteryDrawsByPeriod.all(ruleVersion, periodKey)
    },
    finishLotteryDraw(id, status, errorMessage, updatedAt) {
      const completedAt = status === 'completed' ? updatedAt : 0
      return Number(
        statements.finishLotteryDraw.run(
          status,
          errorMessage || '',
          updatedAt,
          completedAt,
          id,
        ).changes,
      )
    },
    restartLotteryDraw(id, updatedAt) {
      return Number(statements.restartLotteryDraw.run(updatedAt, id).changes)
    },
    resolveUnknownLotteryDraw(id, status, errorMessage, updatedAt) {
      const completedAt = status === 'completed' ? updatedAt : 0
      return Number(
        statements.resolveUnknownLotteryDraw.run(
          status,
          errorMessage || '',
          updatedAt,
          completedAt,
          id,
        ).changes,
      )
    },
    listUnknownLotteryDraws(ruleVersion, limit = 50) {
      return statements.listUnknownLotteryDraws.all(ruleVersion, limit)
    },
    listLotteryWeekKeysBefore(currentWeekKey) {
      return statements.listLotteryWeekKeysBefore.all(currentWeekKey).map((row) => row.period_key)
    },
    listLotteryDraws(ruleVersion, limit = 12) {
      return statements.listLotteryDraws.all(ruleVersion, limit)
    },
    setSetting(key, value) {
      statements.setSetting.run(key, JSON.stringify(value))
    },
    getSetting(key, fallback = null) {
      const row = statements.getSetting.get(key)
      return row ? JSON.parse(row.value) : fallback
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close() {
      db.close()
    },
  }
}
