# Changelog

## [custom-v1.0.19] - 2026-10-21

### Added

- Automatically publish a must-read timeline announcement for the first eligible historical Challenger (最强王者), including a one-time backfill at startup. Candidates who reach the tier on the same day are ordered by the leaderboard's rank value, total score, and entry ID. Publication respects participation, exclusion, account status, and public or anonymous display names.
- Manage automatically generated announcements in the existing announcement settings: edit content, change the must-read option, or delete the item. A durable event receipt prevents retries, restarts, or deletion from publishing the same milestone again; stale settings saves preserve announcements published after the editor was loaded.
- Added standalone Grandmaster and Challenger crest artwork and a staged promotion animation: the old crest dissolves, energy draws metal fragments inward, the new crest forms and unfolds its wings, then a light strike, recoil, and highlight finish the entrance. Gold and red confetti starts only after the entrance completes and repeats until the announcement is closed.

### Changed

- Refined the reminder layout with centered short announcements, a compact close button, and independently scrolling formatted content. Removed the visible generic must-read heading, publication timestamp, and dismissal explanation; an accessible dialog title remains available to screen readers.
- Respect reduced-motion preferences by showing the complete static crest without effects. A failed previous-rank image falls back to the static Challenger crest, and settings refreshes do not restart an active entrance animation.

### Compatibility

- Added the `automatic_announcements` table through both startup migration paths. Persistence uses GORM operations compatible with SQLite, MySQL, and PostgreSQL; database behavior was tested with SQLite. The publication worker runs on primary nodes and stops after the milestone has been published.
- Existing per-account dismissal behavior is preserved. Ordinary announcements do not receive the promotion effects. Rank scoring, promotion requirements, and user balances are unchanged.

## [custom-v1.0.18] - 2026-10-21

### Added

- Added a per-item must-read option for timeline announcements. Published announcements open automatically when authenticated users enter the console, with a check every minute for users already online.
- Users can close an announcement directly, including with Escape. Dismissals are persisted per account and announcement revision, so the same version stays dismissed across browsers while new or edited announcements appear again. Multiple pending announcements are shown one at a time.
- Added translations for all seven locales and regression coverage for administrator settings, account isolation, duplicate dismissals, edited or removed announcements, publication dates, keyboard dismissal, and save-failure retries.

### Compatibility

- Added the `announcement_reads` table through the standard and fast startup migration paths using GORM operations compatible with SQLite, MySQL, and PostgreSQL. Dismissal persistence was tested with SQLite.
- Existing timeline announcements remain optional unless marked must-read. Disabled announcements and announcements with a future publication date do not trigger reminders. The global single Notice is unchanged.
- Announcement backend and frontend tests, TypeScript checks, lint, and frontend and backend builds passed.

## [custom-v1.0.17] - 2026-10-18

### Changed

- Updated all nine leaderboard tier names to four-character Chinese titles: 坚韧黑铁, 英勇青铜, 不屈白银, 荣耀黄金, 华贵铂金, 璀璨钻石, 超凡大师, 傲世宗师, and 最强王者. Updated backend rank labels, Simplified and Traditional Chinese translations, and rank progression descriptions.

### Compatibility

- Continue recognizing legacy two-character tier labels when resolving badge artwork from cached responses or historical records. Tier keys, divisions, scoring, and promotion rules remain unchanged.
- Rank engine tests, frontend badge tests, TypeScript checks, and lint passed.

## [custom-v1.0.16] - 2026-09-30

### Added

- Added eight monthly honor titles and five achievement badges. Each complete recap awards one main title and up to two badges using recorded usage, with decisions and supporting metrics persisted in the snapshot. Value Connoisseur takes priority when the unrounded monthly multiplier is strictly below 0.15 against a 0.25 baseline.
- Added honor details to the recap and the main title to downloadable keepsake posters, with translations for all seven locales. See [monthly recap rules](docs/monthly-recap.md).

### Changed

- Aligned monthly recaps with the main application's page layout, typography, cards, and theme variables. Light and dark modes now follow the site theme, with compact desktop columns and a single-column mobile layout.

### Fixed

- Calculate the estimated 1.0-rate reference price directly from historical base unit prices and token usage, including cache reads/writes and recorded tool fees, instead of dividing charged quota by the group ratio. Zero-rate requests now contribute to the reference price when historical pricing is available.
- Use recorded expression tiers, legacy token-price ratios, or per-call prices without consulting current price settings. Group discounts and request speed multipliers are excluded from the base reference price. Ambiguous tiers, unavailable dynamic prices, and unsupported usage details remain explicitly unpriced.

### Compatibility

- Existing snapshots are preserved and display a legacy-pricing notice. Administrators must explicitly recalculate them to apply `pricing_version=2` and evaluate honors; rebuilding requires retained logs. No database schema change or balance adjustment is involved.
- Verified pricing boundaries, free usage, cache and tool charges, snapshot persistence, honor priorities, and frontend rendering/export behavior. Frontend type checks, lint, production build, and the backend build passed.

## [custom-v1.0.15] - 2026-09-30

### Changed

- Monthly recaps now open only after the Beijing calendar month ends and default to the previous month. Both the page and API reject current and future months.
- The first request calculates and persists a complete recap by user, month, and rule version. Later requests read the saved snapshot, shared by the user and administrators, rather than rescanning logs. Empty and incomplete recaps are also saved with their existing completeness indicators.

### Added

- Added administrator-only recap recalculation with a confirmation identifying the user and month. A successful rebuild replaces the snapshot; failed rebuilds preserve the previous result.
- Added database leases to coordinate first-time calculations across instances, recover interrupted builds, and prevent stale calculations from overwriting another worker's result.
- Added translations for all seven locales, snapshot lifecycle and access-control regression tests, and coverage for month selection and the rebuild confirmation flow. See [monthly recaps](docs/monthly-recap.md).

### Compatibility

- Added `monthly_recap_snapshots` through the standard and fast startup migration paths for SQLite, MySQL, and PostgreSQL. Snapshots are generated on demand; no automatic historical backfill is performed.
- First calculation and explicit recalculation depend on retained logs. Deleted logs cannot be recovered, and late-arriving records require an administrator rebuild to appear in an existing snapshot. Rebuilding after log cleanup can reduce the reported usage.
- Honor titles remain outside this release.

## [custom-v1.0.14] - 2026-09-30

### Added

- Added a personal monthly usage recap combining the `gpt-pro` and `gpt优惠` groups by Beijing calendar month. The story-style page includes model preferences, input/output and cache tokens, daily and hourly activity, active days, consecutive-day streaks, and recorded consumption.
- Added historical 1.0-rate cost estimates and an aggregate effective multiplier, with per-model details, CSV export, and a downloadable keepsake poster that excludes spending amounts.
- Added administrator user search and pagination for viewing individual users' monthly recaps. Ordinary users can access only their own recap.
- Added root-managed group-ratio webhooks with optional HMAC-SHA256 signing, persisted delivery records, automatic retries, and manual retry of failed deliveries. See [group-ratio webhooks](docs/webhooks/group-ratio.md).
- Added translations for all seven supported locales and regression coverage for recap calculations, access control, user selection, exports, and webhook behavior.

### Compatibility

- Recaps use retained request logs and their recorded group ratios; historical 1.0-rate amounts are site-price estimates, not independently verified provider list prices. Incomplete history or unpriced requests suppress the overall effective multiplier. The current month remains provisional, and deleted logs are not backfilled.
- Monthly recaps require no new database tables. Webhook delivery records use the existing additive migration paths for SQLite, MySQL, and PostgreSQL. Webhook receivers must handle duplicate and out-of-order events.
- Monthly honor titles, including the proposed below-0.15 multiplier award against a 0.25 baseline, are not included in this release.

## [custom-v1.0.13] - 2026-09-22

### Added

- Added administrator monthly accounting with immutable redemption receipts, monthly wallet-balance snapshots, and paginated per-user snapshot details. Reports distinguish consumption income from booked income and apply a one-time opening-balance reversal to October 2026 without changing user balances.
- Added per-user concurrent-request and rolling-window rate limits under System Settings → Security. Policies follow the user's group, with a default request pool and optional isolated Key-group pools; multiple Keys in the same pool share that user's limits.
- Added translations for all seven supported locales and regression coverage for monthly accounting, request-limit configuration and enforcement, and editing users with negative balances.

### Fixed

- Administrators can now save group and profile changes for users with negative wallet balances. The read-only balance no longer fails non-negative form validation, and profile updates do not submit or overwrite wallet balances.

### Compatibility

- Monthly accounting starts at midnight Beijing time on October 1, 2026; the November 1 snapshot completes the first October report. Upgrade all nodes and complete database migrations before the cutover, keep a primary node running, and disable delayed batch balance updates. New receipt, snapshot, and snapshot-detail tables use the existing migration paths; historical receipts and missed snapshots are not backfilled.
- Accounting assumes paid redemption codes are the source of wallet funding and one displayed balance unit represents CNY 1. Missing, late, or otherwise flagged snapshots require review; TOKENS display mode does not create financial snapshots. See [monthly accounting](docs/monthly-accounting.md) for the income formula and reconciliation requirements.
- Existing model rate limits remain active until the new request-limit policy is first saved. Saving the new policy replaces those legacy limits; saving an empty policy explicitly disables the new limits. Other API/IP limits remain independent.
- Request limits use local counters without Redis and require shared Redis across multiple instances. Exceeded limits return HTTP 429; an unavailable shared counter returns HTTP 503. Streaming requests retain concurrency slots until completion, while asynchronous tasks occupy slots only during HTTP handling. See [user request limits](docs/user-request-limits.md) for pool selection and deployment details.

## [custom-v1.0.12] - 2026-09-17

### Added

- Record the model reported by upstream Chat Completions and Responses APIs, including streaming, buffered streaming, and conversions between the two protocols.
- Show the upstream response model in request-log details for both administrators and users. When it differs from the requested model, show the returned model and a difference indicator directly in the log list.
- Added translations for all seven supported locales and regression coverage for model capture, omitted stream fields, channel retries, user-log visibility, and matching/mismatching model display.

### Changed

- Matching response models preserve the original model badge without an extra icon or popover. Existing channel-mapping indicators remain available.

### Compatibility

- The response model is stored separately in log metadata; request models, channel mappings, and billing behavior are unchanged. No database schema migration is required.
- Earlier logs and responses without a model remain supported without inferring a response model. Historical logs are not backfilled.

## [custom-v1.0.10] - 2026-09-16

### Added

- Added monthly wallet-consumption rebates with administrator calculation, review, and explicit issuance from subscription management. Eligible spending above $750 earns 5% of the whole month's wallet consumption; spending above $1,500 earns 10% instead. Approved rebates grant a one-year subscription without periodic quota resets.
- Added current-month wallet, subscription, and total consumption to the personal wallet, plus a searchable, paginated administrator view that includes users with no consumption.
- Added the ECLIPSE II game to the Game Center with its supplied artwork and an external launch link to https://d2r.xxcd.top in a new tab. Added translations for all seven supported locales.

### Changed

- Administrator quota grants now issue a one-year subscription instead of modifying wallet balance. The quota-grant action no longer accepts subtraction or balance overrides.
- Subscription views now distinguish monthly rebates, weekly lottery rewards, administrator grants, and purchased plans.

### Compatibility

- Monthly consumption uses net funding amounts from primary-database postpaid settlement records and Beijing calendar-month boundaries. Subscription spending and violation charges do not earn rebates; historical consumption without funding-split records is not backfilled.
- Rebate approval rechecks the reviewed bill revision and current consumption. Issuance is transactional and idempotent; later refunds or adjustments flag discrepancies for manual review rather than automatically issuing or reclaiming quota. Ambiguous legacy Midjourney refunds block issuance pending review.
- Background reconciliation does not issue rewards automatically. Existing issued rebate snapshots remain available for auditing.
- Added the monthly rebate table and settlement start-time index through the existing migration paths.
- ECLIPSE II remains independently hosted with its own accounts and saves; the new entry does not integrate game authentication or billing.

## [custom-v1.0.9] - 2026-09-14

### Changed

- Weekly leaderboard lottery claims now grant a standalone reward subscription that expires seven days after claiming, instead of increasing wallet balance.
- Weekly lottery pages show the subscription reward, expiry time, and a link to view reward subscriptions in the wallet.

### Added

- Draw records now link to the issued subscription and retain the reward amount, quota, completion time, and subscription expiry for auditing.
- Regression coverage for subscription spending and expiry, duplicate claims, failed-draw retries, transaction rollback, and legacy reward display.

### Compatibility

- Existing completed wallet rewards remain unchanged and are not converted or reissued. Pending opportunities grant subscriptions when claimed after the update.
- Subscription issuance and the completed draw are committed in one transaction; repeated claims do not issue another subscription or extend its expiry.
- The new draw columns use the existing additive GORM migration path for SQLite, MySQL, and PostgreSQL.

## [custom-v1.0.6] - 2026-08-31

### Added

- Added admin-only custom subscription grants that do not require or expose a public subscription plan.
- Added fixed entitlement start and end times, IANA time zones, and anchored hourly, daily, weekly, or monthly quota refresh intervals.
- Added negotiated USD price snapshots, internal admin notes, grant auditing, schedule previews, and per-subscription quota resets.

### Changed

- Custom subscription quota is entered in USD and converted with the same quota conversion used by existing subscription plans.
- Active subscription checks now require `start_time <= now < end_time`, preventing future subscriptions from funding requests early.
- Subscription pre-consume, postpaid settlement, background reset, self-service queries, and admin queries now support custom subscription instances.
- Self-service responses keep internal grant notes private, while admin subscription responses include grant metadata.

### Compatibility

- Existing public plans and plan-based subscriptions keep their existing API routes and behavior.
- Custom subscriptions use `plan_id: 0` and `source: admin_custom`; remaining quota is still `amount_total - amount_used`.
- Database migration is additive and runs through the existing GORM migration path for SQLite, MySQL, and PostgreSQL.
