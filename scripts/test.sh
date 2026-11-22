#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
cleanup() { docker compose -f compose.test.yaml down --remove-orphans >/dev/null; }
trap cleanup EXIT INT TERM
docker build --target backend -f docker/Dockerfile -t clarix-stellar-hub-backend:local .
docker compose -f compose.test.yaml up --attach test --abort-on-container-exit --exit-code-from test
