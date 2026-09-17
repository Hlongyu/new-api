# Changelog

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
