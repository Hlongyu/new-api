# New API Companion Backend

This directory contains the shrinking legacy Companion service. Rankings,
tiers, rename cards, sponsorships, quota loans, and both lottery accounting
paths are Core domains; their implementations here remain only for rollback
and one-time migration.

The service is intentionally headless. After cutover it serves only the
`/modelstatus/api` compatibility proxy. The old `/leaderboard/api` and
`/lottery/api` routes return HTTP 410, and their background workers stay off.

The initial monorepo import came from legacy Companion commit
`4ef1c81668373aaf7ba6107ce040e121884a461a`.

## Local development

Node.js 24 is the supported build and runtime environment. The service uses
Node's built-in SQLite module and has no third-party runtime dependencies.

```bash
cp .env.example .env
npm ci
npm test
node --env-file=.env src/server.js
```

The production image is built from the repository root. Do not publish or
deploy this directory as a separate image.
