import { isRootConfigured } from './config.js'
import {
  currentPeriodRanges,
  previousWeekRange,
  usagePeriodRangeFromKey,
} from './time.js'

const tokenUsageSemanticsV2Setting = 'token_usage_semantics_v2_rebuilt_at'

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export class UsageSynchronizer {
  constructor({ db, client, config, onStateChange = () => {} }) {
    this.db = db
    this.client = client
    this.config = config
    this.onStateChange = onStateChange
    this.running = false
    this.timer = null
  }

  getState() {
    return {
      configured: isRootConfigured(this.config),
      running: this.running,
      lastSyncAt: this.db.getSetting('last_sync_at', 0),
      lastSyncError: this.db.getSetting('last_sync_error', ''),
    }
  }

  async sync() {
    if (this.running || !isRootConfigured(this.config)) return false
    this.running = true
    this.onStateChange(this.getState())
    try {
      const ranges = currentPeriodRanges({
        timeZone: this.config.timeZone,
        allStartTimestamp: this.config.allStartTimestamp,
      })
      const rebuildHistoricalUsage = !this.db.getSetting(
        tokenUsageSemanticsV2Setting,
        '',
      )
      const rangeKeys = new Set(
        ranges.map((range) => `${range.type}:${range.key}`),
      )
      if (rebuildHistoricalUsage) {
        for (const period of this.db.listUsageAggregatePeriods()) {
          const rangeKey = `${period.period_type}:${period.period_key}`
          if (rangeKeys.has(rangeKey)) continue
          ranges.push(usagePeriodRangeFromKey(
            period.period_type,
            period.period_key,
            {
              timeZone: this.config.timeZone,
              allStartTimestamp: this.config.allStartTimestamp,
            },
          ))
          rangeKeys.add(rangeKey)
        }
      }
      const completedWeek = previousWeekRange({ timeZone: this.config.timeZone })
      const needsCompletedWeekSync = this.db.getSetting(
        'last_finalized_week_key',
        '',
      ) !== completedWeek.key
      const completedWeekRangeKey = `week:${completedWeek.key}`
      if (needsCompletedWeekSync && !rangeKeys.has(completedWeekRangeKey)) {
        ranges.push({ type: 'week', ...completedWeek })
        rangeKeys.add(completedWeekRangeKey)
      }
      const updatedAt = Math.floor(Date.now() / 1000)
      const users = await this.client.getUsers(
        this.config.rootUserId,
        this.config.rootAccessToken,
      )
      const flows = []
      const sourceNames = new Map()
      const discoveredUsers = new Map()

      for (const user of users) {
        const userId = Number(user.id)
        if (!Number.isInteger(userId) || userId <= 0) continue
        const sourceName = String(user.display_name || user.username || '').trim()
        sourceNames.set(userId, sourceName)
      }

      for (const range of ranges) {
        const rows = await this.client.getFlow(
          range.start,
          range.end,
          this.config.rootUserId,
          this.config.rootAccessToken,
        )
        if (rows.length > 0 && rows.every((row) => !Number(row.user_id))) {
          throw new Error('当前账户不是 Root，New API 未返回 user_id')
        }
        for (const row of rows) {
          const userId = Number(row.user_id)
          if (!Number.isInteger(userId) || userId <= 0) continue
          if (!discoveredUsers.has(userId)) {
            discoveredUsers.set(
              userId,
              sourceNames.get(userId) || String(row.username || '').trim(),
            )
          }
        }
        flows.push({ range, rows })
      }

      this.db.transaction(() => {
        for (const [userId, sourceName] of discoveredUsers) {
          this.db.ensureAnonymousEntry(userId, updatedAt, sourceName)
        }
      })

      const entries = this.db.listEntries()
      const byUserId = new Map(entries.map((entry) => [entry.user_id, entry]))
      for (const { range, rows } of flows) {
        const totals = new Map()
        for (const row of rows) {
          const userId = Number(row.user_id)
          if (!byUserId.has(userId)) continue
          const current = totals.get(userId) || {
            tokenUsed: 0,
            quota: 0,
            requestCount: 0,
          }
          current.tokenUsed += number(row.token_used)
          current.quota += number(row.quota)
          current.requestCount += number(row.count)
          totals.set(userId, current)
        }

        this.db.transaction(() => {
          for (const entry of entries) {
            const total = totals.get(entry.user_id) || {
              tokenUsed: 0,
              quota: 0,
              requestCount: 0,
            }
            this.db.upsertAggregate({
              entryId: entry.id,
              periodType: range.type,
              periodKey: range.key,
              ...total,
              updatedAt,
            })
          }
        })
      }

      const now = Math.floor(Date.now() / 1000)
      if (needsCompletedWeekSync) {
        this.db.setSetting('last_finalized_week_key', completedWeek.key)
      }
      if (rebuildHistoricalUsage) {
        this.db.setSetting(tokenUsageSemanticsV2Setting, now)
      }
      this.db.setSetting('last_sync_at', now)
      this.db.setSetting('last_sync_error', '')
      return true
    } catch (error) {
      this.db.setSetting('last_sync_error', error.message)
      throw error
    } finally {
      this.running = false
      this.onStateChange(this.getState())
    }
  }

  start() {
    if (!isRootConfigured(this.config)) return
    this.sync().catch(() => {})
    this.timer = setInterval(() => this.sync().catch(() => {}), this.config.syncIntervalMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }
}
