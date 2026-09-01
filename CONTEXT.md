# new-api Domain Language

This glossary names the billing and entitlement concepts shared by subscription administration and quota consumption.

## Language

**Custom subscription grant**:
An administrator-issued subscription entitlement whose validity, quota cadence, and negotiated price are fixed on the individual subscription rather than inherited from a public plan.
_Avoid_: Custom plan, private plan

**Entitlement window**:
The half-open time range from an inclusive start instant to an exclusive end instant during which a subscription may fund usage.
_Avoid_: Duration

**Quota window**:
A segment of an entitlement window that receives its own quota allowance and ends at the next refresh boundary.
_Avoid_: Billing cycle

**Refresh anchor**:
The dated local-time boundary from which all recurring quota windows are calculated in a named time zone.
_Avoid_: Reset time

**Rank score**:
A daily contribution derived from billed quota, completed sponsorships, and completed rename-card purchases that advances a user's rank.
_Avoid_: Experience, activity points

**Rank state**:
The user's current tier, division, score, pending score, and promotion progress produced by replaying rank scores.
_Avoid_: Rank snapshot, leaderboard position

**Leaderboard profile**:
The user's public or anonymous leaderboard identity together with per-board participation preferences.
_Avoid_: Leaderboard entry, rank account

**Quota credit account**:
A user's aggregate outstanding wallet-quota advance balance, governed by a monthly due boundary and backed by an auditable transaction ledger.
_Avoid_: Individual quota loan, borrowed token

**Quota credit transaction**:
A drawdown or repayment entry in a quota credit account's ledger. Stored loan rows are allocation details, not independent eligibility requirements.
_Avoid_: Settled loan, quota loan record

**Postpaid settlement**:
The idempotent reconciliation of one API request to its actual billed quota after upstream execution.
_Avoid_: Quota loan, wallet credit

**Recharge lottery ticket**:
An auditable lottery entitlement granted from redemption-code quota or an
operator batch and consumed atomically by a recharge-lottery draw.
_Avoid_: Weekly lottery opportunity

**Recharge lottery reward**:
A seven-day quota subscription created in the same Core transaction that
consumes recharge-lottery tickets and records the draw result.
_Avoid_: Wallet credit, weekly lottery prize
