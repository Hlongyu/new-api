# Changelog

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
