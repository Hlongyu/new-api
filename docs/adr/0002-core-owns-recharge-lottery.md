# ADR 0002: Core owns the recharge lottery

The recharge lottery is a Core domain. Core stores its campaign, ticket ledger,
draw, and redemption-progress state in the main database. Redeeming a code
updates lottery progress inside the redemption transaction, and drawing commits
the ticket debit, result, and seven-day reward subscription atomically.

The Companion runtime is removed after cutover. Its SQLite volume remains
preserved for audit and rollback data recovery, while the Core image retains the
read-only one-time importer.
Core must not call administrative HTTP APIs or depend on a root personal access
token to scan redemptions, maintain hidden plans, or grant reward subscriptions.
