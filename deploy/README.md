# Custom delivery

The production delivery path builds this repository in GitHub Actions, publishes
an immutable Linux amd64 image to GHCR, and deploys that exact digest to the
Linode host. Production never builds source code and never deploys a mutable tag.

## Release flow

1. `CI` validates both Go modules, type-checks and builds the custom frontend,
   runs the Companion backend tests on pinned Node.js 24, and builds the final
   production container.
2. `Custom Delivery` publishes an SBOM, provenance, a keyless signature, and the
   immutable GHCR image after `CI` succeeds on `custom/main`.
3. Production deployment is manual. The selected commit must belong to
   `custom/main`, and the server verifies the image revision label before use.
4. The server creates PostgreSQL and Companion SQLite backups, replaces both
   application containers from the same digest, checks their health endpoints,
   and rolls both services back on failure.

The current custom frontend tests remain advisory while their `node:test`/Bun
runner migration is pending; type checking and the production build are hard
release gates. The upstream Docker Hub and release workflows remain separate
from this private delivery path.

## Production layout

```text
/opt/new-api/compose.yaml             versioned production Compose file
/etc/new-api/production.env           root-only runtime configuration and secrets
/var/lib/new-api/release.env          exact image digest currently selected
/var/lib/new-api/releases/            deployment and rollback records
/var/lib/new-api/data/                application data bind mount
/var/log/new-api/                     application log bind mount
/var/backups/new-api/                 14-day PostgreSQL and SQLite backups
/usr/local/sbin/new-api-deploy        validated deployment entry point
/usr/local/sbin/new-api-backup        backup entry point
```

`new-api_pg_data`, `new-api_redis_data`, and the configured Companion SQLite
volume are external Docker volumes. Compose cannot delete them, including
through `docker compose down --volumes`.

The image contains both runtimes but each container has one responsibility:
`new-api` runs the Go gateway on port 3000 and `new-api-companion` runs the
headless Node.js API on port 8787. The containers always use the same immutable
image digest.

The public reverse proxy is part of the delivery contract. The browser loads the
frontend from the Go service, but the frontend calls Companion through the same
origin at `/leaderboard/api`, `/modelstatus/api`, and `/lottery/api`. Route those
API prefixes to `127.0.0.1:8787` and all other paths to `127.0.0.1:3000`; do not
expose port 8787 directly. Without this routing, the Go frontend fallback returns
HTML for Companion API requests and the UI reports that leaderboard data is
unavailable. Use `deploy/server/reverse-proxy.nginx.conf.example` as the Nginx
location fragment and set `COMPANION_PUBLIC_URL` to the public leaderboard
origin, including the `/leaderboard` path.

Install the repository-owned files as root:

```text
deploy/server/compose.yaml                 -> /opt/new-api/compose.yaml
deploy/server/production.env.example       -> /etc/new-api/production.env (then set secrets)
deploy/server/reverse-proxy.nginx.conf.example -> reverse proxy configuration
deploy/server/new-api-deploy               -> /usr/local/sbin/new-api-deploy
deploy/server/new-api-deploy.sudoers       -> /etc/sudoers.d/new-api-deploy
deploy/server/new-api-backup               -> /usr/local/sbin/new-api-backup
deploy/server/new-api-backup.service       -> /etc/systemd/system/new-api-backup.service
deploy/server/new-api-backup.timer         -> /etc/systemd/system/new-api-backup.timer
```

## GitHub configuration

Repository variables:

| Name | Value |
| --- | --- |
| `PROD_HOST` | Production host name or address |
| `PROD_PORT` | Production SSH port |
| `PROD_USER` | Restricted deployment user |
| `PROD_HEALTH_URL` | Public `/api/status` URL |

Repository secrets:

| Name | Purpose |
| --- | --- |
| `PROD_SSH_KEY` | Dedicated deployment private key |
| `PROD_KNOWN_HOSTS` | Pinned production SSH host key |

The workflow's short-lived `GITHUB_TOKEN` is streamed to the deployment command
only for the GHCR pull. No persistent registry credential is stored on the host.
The deployment account has no Docker group membership and may only run the
validated deployment entry point through sudo.

## First unified cutover

The first deployment is a controlled maintenance operation because the legacy
Companion container already owns `127.0.0.1:8787`. Before dispatching the first
unified release:

1. Confirm every legacy Companion page has either moved into `web/` or been
   intentionally retired. The unified Companion is API-only and does not serve
   the old leaderboard, model-status, or lottery HTML bundles.
2. Install the repository-owned Compose, backup, and deployment files and add
   the Companion settings to `/etc/new-api/production.env`.
3. Keep `LEADERBOARD_DATA_VOLUME=new-api-leaderboard_leaderboard-data` so the
   existing SQLite volume is reused without copying the database.
4. Run `new-api-backup` and verify both `database.dump` and `leaderboard.db`.
5. Disable `new-api-leaderboard-update.timer`; do not delete the legacy
   container or its volume.
6. Dispatch the selected immutable release. The deployment command stops the
   legacy Companion only after the backup and candidate image validation pass.

If the candidate fails, the deployment command restores the previous Go image
and restarts the legacy Companion. After the unified release and rollback drill
both pass, the stopped legacy container may be removed; its data volume remains
external and retained.
