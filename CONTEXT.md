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
