# GHCR Release And Rollback

This is the target Docker release path. It does not replace the currently
deployed systemd/Nginx path until the VPS has been deliberately migrated and
the production gates have been verified.

## Release tracks

The shared Fastify backend and the public menu have independent immutable
version tags:

```text
api-v1.2.3   -> ghcr.io/OWNER/REPOSITORY-api:1.2.3
menu-v1.4.0  -> ghcr.io/OWNER/REPOSITORY-menu:1.4.0
```

A release tag identifies both the Git commit and the image digest. The
workflows also publish a long Git SHA tag for inspection. Do not use `latest`
in production. The POS gets its own image and `pos-vX.Y.Z` track when its
frontend becomes a separate deployable application; the current repository
does not publish a POS image.

Create and push a tag only after local validation:

```bash
pnpm typecheck
pnpm --filter @cafe/api test:database
pnpm --filter @cafe/web test
pnpm --filter @cafe/web build
git tag api-v0.1.0
git push origin api-v0.1.0
```

Use a separate `menu-v...` tag for a menu-only release. A commit can carry
both tags when both artifacts are intentionally released together.

## VPS release manifest

On the VPS, keep a root-owned or deployment-user-owned `.env` beside the
Compose file. It must contain exact image references, not floating tags:

```dotenv
CAFE_API_IMAGE=ghcr.io/OWNER/REPOSITORY-api:1.2.3
CAFE_MENU_IMAGE=ghcr.io/OWNER/REPOSITORY-menu:1.4.0
CAFE_API_ENV_FILE=/opt/cafe-menu/runtime/api.env
POSTGRES_DB=cafe_management
POSTGRES_USER=cafe_app
POSTGRES_PASSWORD=replace-with-secret
```

Keep API secrets in `runtime/api.env`; never put them in Git, a Dockerfile, or
an image label. Authenticate the VPS to GHCR with a read-only package token.
The Compose volume is the authoritative database; uploads and other runtime
data must remain on persistent volumes or explicitly preserved host paths.
The API environment must include independent `TABLE_QR_TOKEN_SECRET` and
`TABLE_CONTEXT_COOKIE_SECRET` values. Configure Nginx so `/t/<token>` access
logs record only a redacted `/t/[redacted]` path (or disable access logging for
that location); raw printed tokens must not enter proxy logs.

Provision printable eligible-table QRs only from a trusted operations host
against the intended database. Keep the generated directory outside Git and
back it up for reprinting:

```bash
pnpm --filter @cafe/api provision:table-qrs -- --all-eligible \
  --base-url https://runncafe.ir --output-dir /secure/run-cafe-table-qrs
```

Use `--table "1"` for one table. Never use `--rotate` until the replacement
printout is ready for immediate placement because the old QR and its existing
browser contexts become invalid at once.

## Deploy and rollback

Before changing the manifest, record the current manifest and create the
normal database/volume backup. Then pull the exact images, run reviewed
migrations, and start the stack:

```bash
docker compose --env-file .env -f compose.production.yaml pull
docker compose --env-file .env -f compose.production.yaml run --rm api ./node_modules/.bin/prisma migrate deploy
docker compose --env-file .env -f compose.production.yaml up -d
docker compose --env-file .env -f compose.production.yaml ps
```

Verify API liveness/readiness and the menu through the public Nginx/HTTPS
route. Record the image digests and Git commit in the release log.

To roll back, restore the previous exact image references from the saved
manifest, pull them, and restart. Do not roll back database migrations by
default; use a forward fix unless a reviewed, tested down-migration exists.
If the stack cannot start, restore the previous manifest and use the database
backup/restore procedure before retrying.
