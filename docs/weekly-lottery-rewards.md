# Weekly lottery rewards

New weekly leaderboard claims issue a standalone subscription with the drawn USD
amount converted to quota. The subscription starts when claimed and expires
exactly seven days later; quota does not reset. It uses the existing subscription
billing behavior, including wallet overflow, and does not increase wallet balance.

The subscription and completed draw commit in one database transaction. Replaying
the same rule version, week, and rank returns the original draw without issuing
another subscription or extending its expiry. Failed draws can be retried;
unresolved legacy draws still require manual verification.

For an audit, `lottery_draws` stores `amount_usd`, `quota_amount`,
`subscription_id`, `subscription_expires_at`, and `completed_at`. The associated
`user_subscriptions` row stores the total and used quota, start/end time, and
`source = weekly_lottery_reward`; its admin note references the draw ID.
Users can see rewards in the wallet subscription list and the weekly draw history.

Existing completed wallet rewards are not converted or reissued. Their new
subscription columns default to zero during the normal schema migration, and
the frontend continues to display them as previously claimed wallet rewards.
