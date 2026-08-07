# Domain Context

## Glossary

### Activity Pool (活动池)

An independently selectable lottery boundary that owns its prize configuration,
chance ledger, and draw history. In storage it is represented by a lottery
campaign. Do not use "theme" for this concept; themes only change presentation.

### Permanent Pool (常驻池)

The unique default activity pool that remains published without an activity end
operation. `赤月回响` is the permanent pool and receives automatic chances earned
from redemption-code quota.

### Redemption Progress (兑换进度)

The per-user idempotent aggregate of quota redeemed through redemption codes.
Every complete $100 grants that user one permanent-pool chance; incomplete quota
is retained separately for later scans. Root credentials are used only to read
the administrative redemption list. Only redemption IDs and quota metadata are
read; redemption keys are never stored. The authenticated user status may expose
only that user's derived totals and the amount remaining until the next chance.

### Browser Authentication (浏览器认证)

The shared rc.22 browser flow. Each page exchanges the HttpOnly Refresh Cookie at
`POST /api/user/auth/refresh` for a short-lived Access Token, user metadata, and a
Session ID. These values remain in page memory only. Companion API requests carry
only `Authorization: Bearer <token>`; the backend validates it through New API
`/api/user/self`. A 401 causes one refresh-and-retry. `X-Auth-Session` protects
refresh rotation across tabs. Root background operations continue to use the PAT
configured by `NEW_API_ROOT_ACCESS_TOKEN` and never expose it to the browser.
