#!/usr/bin/env bash
# Runs ON THE SERVER as the deploy user (needs passwordless sudo). Started by scripts/deploy.ps1.
# Usage: remote-deploy.sh <release.tar>
# Stops the game, backs up the data, swaps in the new release, starts it and checks health.
# If the new release does not come up healthy, the old release and the pre-deploy data are restored.
set -euo pipefail

APP=/opt/murim-apocalypse
DATA=/var/lib/murim
BACKUPS=/var/backups/murim
SERVICE=murim-apocalypse
UNIT=/etc/systemd/system/$SERVICE.service
TAR=${1:?usage: remote-deploy.sh <release.tar>}
IN=$APP/.incoming

log() { echo "[server] $*"; }

wait_healthy() {
  local i
  for i in $(seq 1 40); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# ---- unpack and validate before touching the running game ----------------------------------
rm -rf "$IN"
mkdir -p "$IN"
tar -xf "$TAR" -C "$IN"
[ -f "$IN/dist/server.mjs" ] || { log "release has no dist/server.mjs, aborting (nothing changed)"; exit 1; }
RELEASE=$(cat "$IN/RELEASE" 2>/dev/null || echo unknown)
log "release: $RELEASE"

# Libraries: only reinstall when the lockfile changed (done before the stop, so the downtime stays short).
new_modules=0
if [ ! -d "$APP/node_modules" ] || ! cmp -s "$IN/package-lock.json" "$APP/package-lock.json"; then
  log "lockfile changed, installing libraries"
  (cd "$IN" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  new_modules=1
fi

# ---- from here on the game is down; any failure triggers a rollback -------------------------
stamp=$(date +%Y%m%d-%H%M%S)
swapped=0

rollback() {
  set +e
  trap - ERR
  log "ROLLING BACK"
  sudo systemctl stop "$SERVICE"
  if [ "$swapped" = 1 ]; then
    rm -rf "$APP/dist" && mv "$APP/dist.prev" "$APP/dist"
    if [ "$new_modules" = 1 ] && [ -d "$APP/node_modules.prev" ]; then
      rm -rf "$APP/node_modules" && mv "$APP/node_modules.prev" "$APP/node_modules"
    fi
    [ -f "$APP/package-lock.json.prev" ] && mv "$APP/package-lock.json.prev" "$APP/package-lock.json"
    [ -f "$APP/package.json.prev" ] && mv "$APP/package.json.prev" "$APP/package.json"
    [ -f "$APP/RELEASE.prev" ] && mv "$APP/RELEASE.prev" "$APP/RELEASE"
    if [ -d "$APP/deploy.prev" ]; then
      rm -rf "$APP/deploy" && mv "$APP/deploy.prev" "$APP/deploy"
      if ! cmp -s "$APP/deploy/murim-apocalypse.service" "$UNIT"; then
        sudo cp "$APP/deploy/murim-apocalypse.service" "$UNIT" && sudo systemctl daemon-reload
      fi
    fi
  fi
  if [ -d "$BACKUPS/$stamp" ]; then
    sudo rm -f "$DATA"/murim.db "$DATA"/murim.db-wal "$DATA"/murim.db-shm
    sudo cp -a "$BACKUPS/$stamp/." "$DATA/"
  fi
  sudo systemctl start "$SERVICE"
  if wait_healthy; then log "rolled back: the previous release is running again"; else log "ROLLBACK FAILED, check: journalctl -u $SERVICE"; fi
  exit 1
}
trap rollback ERR

log "stopping the game (players are saved first)"
sudo systemctl stop "$SERVICE"

log "backing up data to $BACKUPS/$stamp"
sudo mkdir -p "$BACKUPS/$stamp"
sudo cp -a "$DATA/." "$BACKUPS/$stamp/"
# keep the 10 newest backups
ls -1dt "$BACKUPS"/*/ 2>/dev/null | tail -n +11 | xargs -r sudo rm -rf

log "swapping in the new release"
rm -rf "$APP/dist.prev"
mv "$APP/dist" "$APP/dist.prev"
cp -f "$APP/package.json" "$APP/package.json.prev"
cp -f "$APP/package-lock.json" "$APP/package-lock.json.prev"
cp -f "$APP/RELEASE" "$APP/RELEASE.prev" 2>/dev/null || true
rm -rf "$APP/deploy.prev"
mv "$APP/deploy" "$APP/deploy.prev"
swapped=1
mv "$IN/dist" "$APP/dist"
cp -f "$IN/package.json" "$IN/package-lock.json" "$APP/"
if [ "$new_modules" = 1 ]; then
  rm -rf "$APP/node_modules.prev"
  mv "$APP/node_modules" "$APP/node_modules.prev"
  mv "$IN/node_modules" "$APP/node_modules"
fi
mv "$IN/deploy" "$APP/deploy"
cp -f "$IN/RELEASE" "$APP/RELEASE" 2>/dev/null || true

if ! cmp -s "$APP/deploy/murim-apocalypse.service" "$UNIT"; then
  log "service definition changed, installing it"
  sudo cp "$APP/deploy/murim-apocalypse.service" "$UNIT"
  sudo systemctl daemon-reload
fi

# Nightly backup job (timer + service). The folder is separate from the per-deploy backups on purpose.
sudo install -d -o murim -g murim /var/backups/murim-nightly
units_changed=0
for u in murim-backup.service murim-backup.timer; do
  if ! cmp -s "$APP/deploy/$u" "/etc/systemd/system/$u"; then
    sudo cp "$APP/deploy/$u" "/etc/systemd/system/$u"
    units_changed=1
  fi
done
[ "$units_changed" = 1 ] && sudo systemctl daemon-reload
sudo systemctl enable --now murim-backup.timer >/dev/null 2>&1 || true

log "starting the game"
sudo systemctl start "$SERVICE"
wait_healthy

trap - ERR
rm -rf "$IN" "$TAR"
echo "$(date -Is) $RELEASE" >> "$APP/deployed.log"
log "healthy: $(curl -fsS http://127.0.0.1:3000/api/health)"
log "deployed $RELEASE (previous release kept in dist.prev, data backup in $BACKUPS/$stamp)"
