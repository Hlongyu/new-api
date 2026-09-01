# ADR 0002: Core owns the recharge lottery

The recharge lottery is a Core domain. Core stores its campaign, ticket ledger,
draw, and redemption-progress state in the main database. Redeeming a code
updates lottery progress inside the redemption transaction, and drawing commits
the ticket debit, result, and seven-day reward subscription atomically.

Companion retains its implementation only for rollback and one-time migration.
Core must not call administrative HTTP APIs or depend on a root personal access
token to scan redemptions, maintain hidden plans, or grant reward subscriptions.
