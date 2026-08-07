# New API Companion Backend

This directory contains the custom server-side APIs used by the New API
frontend for rankings, tiers, rename cards, sponsorships, postpaid credit,
model status, and lottery operations.

The service is intentionally headless. It serves JSON APIs under
`/leaderboard/api`, `/modelstatus/api`, and `/lottery/api`; all user-facing
pages live in `web/` and are built into the main New API application.

The initial monorepo import came from legacy Companion commit
`4ef1c81668373aaf7ba6107ce040e121884a461a`. Its `public/` tree, preview
servers, standalone Docker files, and server-side auto-update scripts were
deliberately excluded.

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
