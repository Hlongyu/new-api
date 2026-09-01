# Custom release delivery

Production uses one versioned release made of two immutable GHCR images:

```text
Core image
  └─ new-api             Go API on 127.0.0.1:3000

App image
  ├─ new-api-web         custom frontend and gateway on 127.0.0.1:3002
  └─ new-api-companion   custom backend on 127.0.0.1:8787

Persistent services
  ├─ postgres
  ├─ redis
  └─ leaderboard_data
```

The gateway sends Core API, relay, leaderboard, and recharge-lottery routes to
`new-api`. Only the legacy model-status compatibility API is sent to
`new-api-companion`; browser routes and the recharge-lottery assets are served
by the Web image.

## Release policy

Pushing commits or completing CI does not publish images and does not deploy
production. A release starts only when a `custom-v*` Git tag is pushed, for
example `custom-v1.0.0`.

The `Custom Delivery` workflow then:

1. verifies that the tagged commit belongs to `custom/main`;
2. builds the Core image from `Dockerfile`;
3. builds the Web/Companion App image from `Dockerfile.app`;
4. publishes both images to GHCR with version and full-commit tags;
5. signs both immutable image digests;
6. uploads `release-manifest.json` containing both digest references.

The workflow contains no production deployment job, SSH key, production host,
or server update command. Publishing a tag cannot restart production.

## Create a release

After CI succeeds on the desired `custom/main` commit:

```bash
git tag -a custom-v1.0.0 <full-commit> -m 'custom-v1.0.0'
git push origin custom-v1.0.0
```

Use the two digest references from the workflow summary or downloaded release
manifest. Do not deploy mutable tags such as `latest`.

## Manual production deployment

The server deployment command accepts exactly one Core digest, one App digest,
the shared full Git commit, and the GHCR user:

```text
new-api-deploy <core-image@digest> <app-image@digest> <40-char-commit> <registry-user>
```

The command reads a GHCR token from standard input. A local manual deployment
can stream the current GitHub CLI token over SSH without storing it on the
server:

```bash
gh auth token | ssh -T linode-seattle \
  "sudo /usr/local/sbin/new-api-deploy \
  'ghcr.io/hlongyu/new-api-core@sha256:<digest>' \
  'ghcr.io/hlongyu/new-api-app@sha256:<digest>' \
  '<full-commit>' 'Hlongyu'"
```

Before changing containers, the command validates both image revision labels,
checks the Core executable, validates Companion JavaScript and Nginx config,
and runs `new-api-backup.service`.

Deployment order is:

1. recreate Core and wait for `/api/status`;
2. recreate Companion and verify its release commit;
3. recreate Web/Gateway and verify Core and Companion through the gateway.

The selected Core/App digests are recorded together in
`/var/lib/new-api/release.env`. If any health check fails, the command restores
the previous Core/App pair and recreates all three application containers.

Core updates restart the API process. Schedule releases that include database
migrations or historical backfills for a maintenance window.

The one-time leaderboard, quota-loan, and recharge-lottery ownership migration uses the dedicated
[Companion to Core cutover runbook](../docs/companion-core-cutover.md). Do not
bring up the Core-backed frontend until that import has completed.

## Production layout

```text
/opt/new-api/compose.yaml
/etc/new-api/production.env
/var/lib/new-api/release.env
/var/lib/new-api/releases/
/var/lib/new-api/data/
/var/log/new-api/
/var/backups/new-api/
/usr/local/sbin/new-api-deploy
/usr/local/sbin/new-api-backup
```

The PostgreSQL, Redis, and rollback-only Companion SQLite volumes are external.
The Compose project does not delete them during application recreation.

Install repository-owned server files as root:

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

The public reverse proxy sends application traffic to the Web/Gateway at
`127.0.0.1:3002`. Core and Companion remain loopback-only implementation
endpoints.

## Existing server transition

Older `release.env` files contain only `APP_IMAGE`. On the first combined
manual release, `new-api-deploy` reads the current bootstrap `CORE_IMAGE` from
`production.env`, preserves both current images for rollback, and writes the
new combined release format.

Keep `new-api-backup.timer` enabled. Keep legacy auto-update timers, Watchtower,
Cron pull jobs, and GitHub deployment jobs disabled or absent.
