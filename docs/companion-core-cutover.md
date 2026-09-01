# Companion to Core cutover

This runbook moves leaderboard-owned state to Core without importing old rank results. It assumes the production PostgreSQL and Companion SQLite backups have already been verified.

## What is migrated

- `leaderboard_entries` and the excluded-user list
- sponsorship orders
- rename-card balances, orders, and rename events
- weekly-lottery periods, opportunities, and draws
- quota-loan grants and repayment events from the old `postpaid_*` tables

The migration does not import `usage_aggregates`, a rank snapshot, or a calculated tier. Core replays all available `quota_data` history and merges completed sponsorship and rename-card events at their original timestamps.

The importer never grants, deducts, repays, or awards quota. Imported rows describe side effects that already happened before cutover.

## Before stopping services

1. Build and publish a Core image containing `/companion-migrate` and an App image whose frontend uses `/api/leaderboard`.
2. Set `CORE_LEADERBOARD_ENABLED=true` in `/etc/new-api/production.env`.
   Also set `CORE_LEADERBOARD_MIGRATION_REQUIRED=true`; Core will return HTTP
   503 for these APIs until the importer commits its migration marker.
3. Put the public site into maintenance mode so no final request can bypass the cutover.
4. Wait for at least one old postpaid sync interval after the final redemption. Verify its admin state has a recent `lastSyncAt`, no sync error, and no `processing` grant or repayment row.
5. Run and verify the normal PostgreSQL plus Companion SQLite backup.
6. Deploy the new immutable Core and App release while maintenance mode remains active. The migration gate makes the new Core leaderboard APIs return HTTP 503, and the new Companion no longer starts the legacy writers. Do not remove maintenance mode yet.

## Stop and migrate

Load the immutable release metadata, then stop every process that can change Core usage or Companion state. Keep PostgreSQL running.

```bash
cd /opt/new-api
set -a
source /var/lib/new-api/release.env
set +a

docker compose --project-name new-api \
  --env-file /etc/new-api/production.env \
  -f /opt/new-api/compose.yaml \
  stop web companion new-api

cutover_at="$(date +%s)"
migration_key="companion-core-$(date -u +%Y%m%dT%H%M%SZ)"
```

Run a read-only validation first.

```bash
docker compose --project-name new-api \
  --env-file /etc/new-api/production.env \
  -f /opt/new-api/compose.yaml \
  --profile tools run --rm companion-migrate \
  --source /migration/leaderboard.db \
  --cutover-at "${cutover_at}" \
  --migration-key "${migration_key}" \
  --dry-run
```

Check every reported row count. The importer refuses `processing` rows and reports the count of preserved `unknown` rows as `unresolved_rows`; inspect every unresolved record before proceeding. Then run the same command without `--dry-run`. The source and imported manifest hashes must match.

```bash
docker compose --project-name new-api \
  --env-file /etc/new-api/production.env \
  -f /opt/new-api/compose.yaml \
  --profile tools run --rm companion-migrate \
  --source /migration/leaderboard.db \
  --cutover-at "${cutover_at}" \
  --migration-key "${migration_key}"
```

The entire import and its `companion_migrations` marker commit in one database transaction. Reusing the same migration key and manifest is a no-op; reusing the key with different data or a different cutover timestamp fails.

## Start and verify

Start Core first, then Companion and Web.

```bash
docker compose --project-name new-api \
  --env-file /etc/new-api/production.env \
  -f /opt/new-api/compose.yaml \
  up -d new-api companion web
```

Verify these contracts before removing maintenance mode:

- `/api/leaderboard/me` returns the migrated profile, rename-card balance, and open quota loans.
- `/api/leaderboard/ranks` returns a Core-replayed rank.
- historical sponsorship and weekly-lottery views retain their old rows.
- redeeming a test code repays the oldest due open quota loan before crediting the remaining wallet quota.
- `/leaderboard/api/me` on Companion returns HTTP 410.
- Companion logs show neither the old usage synchronizer nor the old postpaid worker starting.

Do not manually adjust user quota during import. If validation fails after the transaction commits, keep traffic stopped and restore both PostgreSQL and Companion SQLite from the same pre-cutover backup pair.
