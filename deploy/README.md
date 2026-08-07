# Custom App delivery

Production is split into a stable official Core and a separately delivered
custom App. The custom App contains the repository-owned frontend, the Nginx
same-origin gateway, and the Companion backend. Routine releases never rebuild,
replace, or restart Core, PostgreSQL, or Redis.

## Release model

```text
Official Core image (fixed digest)
  └─ new-api            Go API on 127.0.0.1:3000

Custom App image (one immutable digest per commit)
  ├─ new-api-web        custom frontend + route gateway on 127.0.0.1:3002
  └─ new-api-companion  custom backend on 127.0.0.1:8787

Persistent services
  ├─ postgres           official application database
  ├─ redis              official cache
  └─ leaderboard_data   Companion SQLite data
```

The Web/Gateway sends `/api`, relay protocol routes, and billing routes to Core.
It sends `/leaderboard/api`, `/modelstatus/api`, and `/lottery/api` to Companion,
and serves the custom SPA for every remaining browser route. This keeps all
browser calls same-origin without embedding the custom frontend into the
official Go binary.

## Release flow

1. `CI` validates the official Go source, builds the custom frontend, tests the
   Companion backend on pinned Node.js 24, and builds `Dockerfile.app`.
2. After `CI` succeeds on `custom/main`, `Custom Delivery` publishes
   `ghcr.io/hlongyu/new-api-app` with an immutable digest, SBOM, provenance, and
   keyless signature.
3. Production deployment remains manual. The selected commit must belong to
   `custom/main`, and the server verifies the image revision label.
4. The server backs up PostgreSQL and Companion SQLite, then recreates only
   `new-api-companion` and `new-api-web` from the selected App digest.
5. Health checks verify the unchanged Core through the new gateway and verify
   that Companion reports the selected full Git commit. A failed App release
   rolls back only the two custom containers.

The current custom frontend tests remain advisory while their `node:test`/Bun
runner migration is pending; type checking and the production build are hard
release gates. The upstream Docker Hub and release workflows remain separate
from this private delivery path.

## What a routine release changes

| Component | Routine custom release |
| --- | --- |
| Official Core container | Unchanged; no restart |
| PostgreSQL container and volume | Unchanged |
| Redis container and volume | Unchanged |
| Custom Web/Gateway | Recreated from the new App digest |
| Companion backend | Recreated from the same App digest |
| Companion SQLite volume | Reused in place |

An official Core upgrade is a separate maintenance operation. Change
`CORE_IMAGE` to a reviewed immutable upstream digest, take and verify a backup,
then deliberately recreate only `new-api`. Do not combine a Core upgrade with a
custom App release or automate it from `Custom Delivery`.

## Production layout

```text
/opt/new-api/compose.yaml             versioned production Compose file
/etc/new-api/production.env           root-only configuration, Core digest, secrets
/var/lib/new-api/release.env          selected custom App digest and revision
/var/lib/new-api/releases/            custom App deployment and rollback records
/var/lib/new-api/data/                Core data bind mount
/var/log/new-api/                     Core log bind mount
/var/backups/new-api/                 14-day PostgreSQL and SQLite backups
/usr/local/sbin/new-api-deploy        custom App deployment entry point
/usr/local/sbin/new-api-backup        backup entry point
```

`new-api_pg_data`, `new-api_redis_data`, and the configured Companion SQLite
volume are external Docker volumes. Compose cannot delete them, including
through `docker compose down --volumes`.

The public reverse proxy sends all application traffic to the Web/Gateway at
`127.0.0.1:3002`. Core port `3000` and Companion port `8787` remain loopback-only
implementation endpoints. Use
`deploy/server/reverse-proxy.nginx.conf.example` inside the public HTTPS server
block. Set `COMPANION_PUBLIC_URL` to the public leaderboard origin, including
the `/leaderboard` path.

Install the repository-owned files as root:

```text
deploy/server/compose.yaml                      -> /opt/new-api/compose.yaml
deploy/server/production.env.example            -> /etc/new-api/production.env
deploy/server/reverse-proxy.nginx.conf.example  -> public reverse proxy configuration
deploy/server/new-api-deploy                    -> /usr/local/sbin/new-api-deploy
deploy/server/new-api-deploy.sudoers            -> /etc/sudoers.d/new-api-deploy
deploy/server/new-api-backup                    -> /usr/local/sbin/new-api-backup
deploy/server/new-api-backup.service            -> /etc/systemd/system/new-api-backup.service
deploy/server/new-api-backup.timer              -> /etc/systemd/system/new-api-backup.timer
```

## GitHub configuration

Repository variables:

| Name | Value |
| --- | --- |
| `PROD_HOST` | Production host name or address |
| `PROD_PORT` | Production SSH port |
| `PROD_USER` | Restricted deployment user |
| `PROD_HEALTH_URL` | Public `/healthz` URL served through Web/Gateway |

Repository secrets:

| Name | Purpose |
| --- | --- |
| `PROD_SSH_KEY` | Dedicated deployment private key |
| `PROD_KNOWN_HOSTS` | Pinned production SSH host key |

The workflow's short-lived `GITHUB_TOKEN` is streamed to the deployment command
only for the GHCR pull. No persistent registry credential is stored on the host.
The deployment account has no Docker group membership and may only run the
validated deployment entry point through sudo.

## First decoupled cutover

The first App deployment does not stop Core. It starts the custom Web/Gateway on
the unused loopback port `3002`, so it can be fully tested before public traffic
is switched.

1. Install the Compose, backup, deployment, and reverse-proxy files. Fill in
   `/etc/new-api/production.env`, including the reviewed immutable
   `CORE_IMAGE` digest.
2. Keep `LEADERBOARD_DATA_VOLUME=new-api-leaderboard_leaderboard-data` so the
   existing Companion SQLite volume is reused without copying data.
3. Run `new-api-backup` and verify `database.dump`, `leaderboard.db`, and their
   checksum files.
4. Disable `new-api-leaderboard-update.timer`; retain the legacy container and
   volume for rollback.
5. Dispatch the selected immutable App release. The deploy command validates
   the image and backup before replacing Companion. It creates Web/Gateway on
   port `3002`; Core continues serving port `3000` throughout.
6. Verify `http://127.0.0.1:3002/api/status`,
   `http://127.0.0.1:3002/healthz`, login, relay requests, and the leaderboard.
7. Change the public reverse proxy upstream from `127.0.0.1:3000` to
   `127.0.0.1:3002`, validate its configuration, and reload it atomically.
8. Perform a rollback drill by selecting the previous App digest. Core and the
   data services must remain untouched during both deploy and rollback.

If the first candidate fails before the public proxy switch, the command removes
the failed custom containers and restarts the legacy Companion when applicable.
The public site continues to use Core on port `3000`. After the cutover and
rollback drill both pass, the stopped legacy container may be removed; its data
volume remains external and retained.
