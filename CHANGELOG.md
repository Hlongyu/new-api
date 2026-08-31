# Changelog

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
