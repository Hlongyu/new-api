# Custom delivery

The production delivery path builds this repository in GitHub Actions, publishes
an immutable Linux amd64 image to GHCR, and deploys that exact digest to the
Linode host. Production never builds source code and never deploys a mutable tag.

## Release flow

1. `CI` validates both Go modules, type-checks and builds the custom frontend,
   and builds the final production container.
2. `Custom Delivery` publishes an SBOM, provenance, a keyless signature, and the
   immutable GHCR image after `CI` succeeds on `custom/main`.
3. Production deployment is manual. The selected commit must belong to
   `custom/main`, and the server verifies the image revision label before use.
4. The server creates a PostgreSQL backup, replaces only the application
   container, checks local and public health endpoints, and rolls back on failure.

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
/var/backups/new-api/                 14-day local PostgreSQL backups
/usr/local/sbin/new-api-deploy        validated deployment entry point
/usr/local/sbin/new-api-backup        backup entry point
```

`new-api_pg_data` and `new-api_redis_data` are external Docker volumes. Compose
cannot delete them, including through `docker compose down --volumes`.

Install the repository-owned files as root:

```text
deploy/server/compose.yaml                 -> /opt/new-api/compose.yaml
deploy/server/production.env.example       -> /etc/new-api/production.env (then set secrets)
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
