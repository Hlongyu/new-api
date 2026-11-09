# Custom release delivery

Production uses one versioned release made of two immutable GHCR images. Two
application colors share the persistent data services, while one non-public
Worker is the only master node:

```text
Public Nginx
  └─ new_api_active
       ├─ blue Web  127.0.0.1:3102 → blue Core  127.0.0.1:3100
       └─ green Web 127.0.0.1:3202 → green Core 127.0.0.1:3200

Master Worker
  └─ new-api-worker      migrations and singleton background jobs

Persistent services
  ├─ postgres
  ├─ redis
  └─ leaderboard_data
```

Traffic Core containers run with `NODE_TYPE=slave`; they still serve API and
relay routes but do not run migrations or singleton background jobs. The
Worker runs with `NODE_TYPE=master` and has no published port. Each Web gateway
resolves `new-api` only inside its color-specific private network, preventing a
gateway from reaching the other color's Core.

## Release policy

Pushing commits or completing CI does not publish images and does not deploy
production. A release starts only when a `custom-v*` Git tag is pushed, for
example `custom-v1.0.0`.

The `Custom Delivery` workflow then:

1. verifies that the tagged commit belongs to `custom/main`;
2. builds the Core image from `Dockerfile`;
3. builds the Web/Gateway App image from `Dockerfile.app`;
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

The server deployment command accepts an explicit backup mode followed by one
Core digest, one App digest, the shared full Git commit, and the GHCR user:

```text
new-api-deploy [--backup none|online|offline] \
  <core-image@digest> <app-image@digest> <40-char-commit> <registry-user>
```

The default backup mode is `online`. Use `--backup none` only for releases with
no schema, persistent-data, accounting, or other rollback-sensitive changes.
Use `--backup offline` for high-risk migrations; that mode deliberately stops
both colors and the Worker before creating the backup.

The command reads a GHCR token from standard input. A local manual deployment
can stream the current GitHub CLI token over SSH without storing it on the
server:

```bash
gh auth token | ssh -T linode-seattle \
  "sudo /usr/local/sbin/new-api-deploy --backup none \
  'ghcr.io/hlongyu/new-api-core@sha256:<digest>' \
  'ghcr.io/hlongyu/new-api-app@sha256:<digest>' \
  '<full-commit>' 'Hlongyu'"
```

Before changing containers, the command validates both image revision labels,
checks the Core executables, validates the App Nginx config, and performs the
selected backup policy.

Deployment order is:

1. wait for the inactive color to drain any streams retained by old Nginx
   workers;
2. recreate the Worker and let the only master node run migrations;
3. recreate the inactive color and verify Core and Web directly;
4. atomically update `new_api_active`, test Nginx, and reload it;
5. verify the public status route and retain the previous color for rollback.

The selected Core/App digests are recorded together in
`/var/lib/new-api/release.env`, with per-color state in
`/var/lib/new-api/colors/`. If staging or public health checks fail, the command
switches traffic back and restores the previous Worker image.

Nginx reloads preserve existing workers, and the previous application color is
not stopped after a successful deployment. Existing streaming requests can
finish on the previous color while new requests use the new color. Manual
rollback is an atomic switch:

```text
sudo /usr/local/sbin/new-api-switch blue
sudo /usr/local/sbin/new-api-switch green
```

Database changes must remain compatible with both application versions during
the overlap. Destructive migrations still require a maintenance window and an
offline backup; blue/green routing cannot make an incompatible shared-database
migration zero-downtime.

The one-time leaderboard, quota-loan, and recharge-lottery ownership migration uses the dedicated
[Companion to Core cutover runbook](../docs/companion-core-cutover.md). Do not
bring up the Core-backed frontend until that import has completed.

## Production layout

```text
/opt/new-api/compose.yaml
/opt/new-api/compose.application.yaml
/opt/new-api/compose.worker.yaml
/etc/new-api/production.env
/etc/nginx/conf.d/new-api-active-upstream.conf
/var/lib/new-api/release.env
/var/lib/new-api/active-color
/var/lib/new-api/colors/
/var/lib/new-api/releases/
/var/lib/new-api/data/
/var/log/new-api/
/var/backups/new-api/
/usr/local/sbin/new-api-deploy
/usr/local/sbin/new-api-backup
```

The PostgreSQL, Redis, and preserved legacy SQLite volumes are external. The
Compose project does not delete them during application recreation. The SQLite
volume is read-only to the migration tool and remains included in backups.

Install repository-owned server files as root:

```text
deploy/server/compose.yaml                      -> /opt/new-api/compose.yaml
deploy/server/compose.application.yaml          -> /opt/new-api/compose.application.yaml
deploy/server/compose.worker.yaml               -> /opt/new-api/compose.worker.yaml
deploy/server/production.env.example            -> /etc/new-api/production.env
deploy/server/reverse-proxy.nginx.conf.example  -> public reverse proxy configuration
deploy/server/new-api-active-upstream.conf.example -> /etc/nginx/conf.d/new-api-active-upstream.conf
deploy/server/new-api-deploy                    -> /usr/local/sbin/new-api-deploy
deploy/server/new-api-switch                    -> /usr/local/sbin/new-api-switch
deploy/server/new-api-blue-green-bootstrap      -> /usr/local/sbin/new-api-blue-green-bootstrap
deploy/server/new-api-deploy.sudoers            -> /etc/sudoers.d/new-api-deploy
deploy/server/new-api-backup                    -> /usr/local/sbin/new-api-backup
deploy/server/new-api-backup.service            -> /etc/systemd/system/new-api-backup.service
deploy/server/new-api-backup.timer              -> /etc/systemd/system/new-api-backup.timer
```

The public TLS sites, the private Origin site, and restricted WireGuard API
sites send application traffic to `new_api_active`. All four application ports
remain loopback-only.

`CORE_GOMEMLIMIT` in `production.env` optionally sets the Go runtime's soft
memory budget for each traffic-serving Core. The default `off` preserves Go's
normal GC behavior; for example, `768MiB` can leave room for other services on a
shared 4 GiB host. Size it for the workload and host capacity. It is not a hard
RSS/container limit: live requests and non-Go memory can exceed it. Apply it to
the inactive color before switching; existing connections keep their current
process until they drain.

For large request bodies, enable the existing `performance_setting.disk_cache_enabled`
option and choose `performance_setting.disk_cache_threshold_mb` (for example, 4)
and `performance_setting.disk_cache_max_size_mb` for the server. Keep the cache
directory on disk, not a memory-backed tmpfs. Incoming bodies remain replayable
until request completion; fully consumed outbound bodies are released before
generation finishes. Static billing parameter snapshots retain only their
queried fields, while dynamic parameter expressions still require the full
body. The Go memory budget alone cannot replace this reduction in live data.

The `new-api` and `web` services in `compose.yaml` are retained under the
`legacy` profile only for transition and recovery. A normal persistent-service
`docker compose up` cannot accidentally start a second master application.

## One-time blue/green bootstrap

Install the repository-owned files first, then run:

```text
sudo /usr/local/sbin/new-api-blue-green-bootstrap
```

The bootstrap starts blue as a slave using the currently deployed images,
switches public Nginx to blue, waits for connections to the legacy gateway to
drain, and finally replaces the legacy traffic-serving master with the
non-public Worker. It keeps PostgreSQL and Redis running throughout.

## Existing server transition

Older `release.env` files contain only `APP_IMAGE`. On the first combined
manual release, `new-api-deploy` reads the current bootstrap `CORE_IMAGE` from
`production.env`, preserves both current images for rollback, and writes the
new combined release format.

Keep `new-api-backup.timer` enabled. Keep legacy auto-update timers, Watchtower,
Cron pull jobs, and GitHub deployment jobs disabled or absent.
