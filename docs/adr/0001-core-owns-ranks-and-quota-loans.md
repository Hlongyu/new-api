# Core owns ranks and quota loans

The Core service is the system of record for leaderboard profiles, rank-score replay, sponsorships, rename cards, weekly-lottery history, and quota loans.

Rank state is rebuilt from all available Core `quota_data` history. Completed sponsorship and rename-card orders are replayed on their original completion dates. Companion rank results and `usage_aggregates` are not imported, and there is no artificial rank-system start time.

Companion data is accepted only by an idempotent offline migration. The migration preserves leaderboard profiles, exclusions, sponsorships, rename-card balances and history, weekly-lottery periods/opportunities/draws, and quota-loan grants/repayments. It does not execute wallet side effects while importing those facts.

After cutover, the quota credit account is granted inside the Core wallet transaction and repaid inside the Core redemption transaction. Eligibility is based on the user's aggregate outstanding amount. Drawdowns remain available up to the rank-derived limit until an unpaid amount crosses its monthly due boundary; after that boundary, the account becomes overdue and no new drawdown is allowed until the entire aggregate outstanding balance is repaid. Individual loan rows remain only as auditable allocation records and do not define separate eligibility requirements.

The Companion runtime, its usage synchronizer, quota-loan repayment worker, and legacy leaderboard APIs are removed. This removes runtime Root-token calls and cross-database settlement races from these features at the cost of a one-time maintenance-window migration and full historical rank replay. Its SQLite volume remains preserved as an offline archive.
