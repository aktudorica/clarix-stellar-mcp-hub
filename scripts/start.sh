#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  umask 077
  # Only Docker is required on the host. The generated password is never printed.
  docker run --rm node:24-bookworm-slim node -e '
    const { randomBytes } = require("node:crypto");
    process.stdout.write(`POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\nAPI_PORT=4310\nWEB_PORT=4311\nLOG_LEVEL=info\n`);
  ' > .env.tmp
  mv .env.tmp .env
fi

# Upgrade existing local environments without changing their database password.
if ! grep -q '^BETTER_AUTH_SECRET=.' .env; then
  umask 077
  docker run --rm node:24-bookworm-slim node -e '
    const { randomBytes } = require("node:crypto");
    process.stdout.write(`\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\n`);
  ' >> .env
fi

if [ "${1:-}" = '--dev' ]; then
  docker compose -f compose.yaml -f compose.dev.yaml up --build --detach --wait --wait-timeout 180
else
  docker compose up --build --detach --wait --wait-timeout 180
fi
