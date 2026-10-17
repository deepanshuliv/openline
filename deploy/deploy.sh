#!/usr/bin/env bash
# Update openline on the shared VM: pull, build under the shared lock, recreate
# the containers that bind-mount config (DEPLOYMENT.md section 6, item 16), and
# remove only this project's dangling images.
set -euo pipefail
cd /opt/apps/openline

compose() { docker compose -p openline -f docker-compose.prod.yml "$@"; }

git pull --ff-only
flock /opt/apps/.build.lock docker compose -p openline -f docker-compose.prod.yml up -d --build
compose up -d --force-recreate --no-deps gateway retention
docker images -q -f dangling=true -f label=openline.image=app | xargs -r docker image rm
compose ps
curl -fsS http://127.0.0.1:8100/health && echo
