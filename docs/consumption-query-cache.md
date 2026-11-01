# Persistent monthly consumption summaries

Consumption queries use durable database summaries, not an expiring process cache.

## First query and incremental updates

- The first query of a Beijing calendar month establishes an upper settlement ID and backfills in transactions of at most 500 requests. The checkpoint is committed with the contributions and aggregate changes. A failed/interrupted query resumes from that checkpoint.
- Completed months are never automatically reset or rebuilt. Restarting the service or changing filters does not scan historical requests again.
- Each settlement write, including refunds and zero-charge requests, sets `postpaid_settlements.consumption_dirty` in the same billing transaction. Subsequent queries select only dirty rows through a composite index on `(consumption_dirty, started_at)`.
- Consume-log writers persist immutable request attribution in the main database before writing the separate/optional log database, and mark an existing settlement dirty. Log-before-settlement and settlement-before-log arrival both work. Conflicting group/owner attribution fails closed.
- The incremental updater subtracts the request's previous contribution and adds its current contribution. Updates, contribution replacement, dirty-flag acknowledgement and checkpoint updates commit atomically. Duplicate notifications cannot double count a request.
- Original contributions preserve attribution when historical logs are removed. Unattributed history remains explicitly unattributed; current group ownership is never used to invent historical attribution.

## Tables and query scope

- `consumption_months`: month, initial backfill boundary, committed cursor, completion status and update time.
- `consumption_attributions`: request ID, group, owner snapshot and conflict state.
- `consumption_contributions`: last applied amounts/counts for each settlement, for exact delta corrections.
- `consumption_aggregates`: monthly totals keyed by group, owner snapshot and consuming user. Wallet/subscription amounts and separate request counts preserve mixed-funding semantics.

Both ordinary and fast startup migration paths create the tables and the settlement dirty column/index. There is no TTL. All application instances share these tables and serialize each month's updates using its checkpoint row lock; SQLite uses its writer lock.

Filtering/grouping reads aggregate rows, applies owner permissions, and calculates per-group exclusions in memory. No raw request metadata is exposed. `generated_at` is the last committed summary update time. A query processes pending changes before returning; concurrent writes after that boundary are picked up by the next query. The initial backfill can be expensive, but is performed only once and uses bounded batches rather than loading a month's raw requests into memory.

## Upgrade and operations

- Run migrations before serving traffic. Deploy all writers with this version: old writers do not maintain dirty flags or durable attribution.
- Instances configured to skip migrations must have the new tables, column and index created explicitly before replacement.
- Controlled imports/repairs bypassing normal writers must call `MarkConsumptionRequestsDirty` for affected request IDs (at most 500 per call). Direct SQL changes without marking are not automatically discovered. Existing contributions intentionally survive raw log cleanup.
- Never delete/reset checkpoints or contributions as an ordinary cache cleanup. They are persisted reporting state, not disposable TTL caches.
- The monthly accounting section's snapshot-window calculation remains a separate authoritative query path; the persistent calendar-month query does not alter wallet balances, raw settlements or accounting snapshots.
