# Running the game permanently on a Linux server

## Deploying changes (from the dev computer)

```
npm run deploy                 # type check, tests, build, upload, swap, health check
npm run deploy -- -SkipTests   # same without the tests
npm run deploy -- -Server 192.168.1.17   # force an address (default: Tailscale, then the home address)
```

`scripts/deploy.ps1` checks and builds locally, then uploads the release over SSH (key `~/.ssh/murim_server`, user
`ray`) and runs `deploy/remote-deploy.sh` on the server. That script stops the game (everyone is saved), copies
`/var/lib/murim` to `/var/backups/murim/<timestamp>` (newest 10 kept), swaps in the new `dist`, starts the game and
waits for `/api/health`. If the new release does not come up healthy it restores the previous `dist`, libraries and
the pre-deploy data automatically and the deploy reports failure. Players see "The server is restarting" for a few
seconds. Libraries are reinstalled on the server only when `package-lock.json` changed. `RELEASE` and
`deployed.log` in `/opt/murim-apocalypse` record what is running (commit, `-dirty` if uncommitted changes).

Manual rollback to the previous release: on the server, `sudo systemctl stop murim-apocalypse`, swap
`dist` and `dist.prev` in `/opt/murim-apocalypse`, restore a backup from `/var/backups/murim` if the data changed
(`sudo cp -a /var/backups/murim/<timestamp>/. /var/lib/murim/` after removing the current `murim.db*`), then start it.

The one-time server setup follows below.

The game runs as a systemd service: it starts at boot, restarts after a crash, and saves everyone when stopped.
Accounts, characters and the world snapshot live in `/var/lib/murim/murim.db`, outside the program folder, so
updating or reinstalling the game never touches them.

## One-time setup (on the server, with sudo)

Needs Node.js 22 or newer (`node --version`).

```bash
sudo useradd --system --home /opt/murim-apocalypse --shell /usr/sbin/nologin murim
sudo mkdir -p /opt/murim-apocalypse
# copy the built game here: dist/, package.json and (if the build needs them) node_modules/
sudo chown -R murim:murim /opt/murim-apocalypse
sudo cp deploy/murim-apocalypse.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now murim-apocalypse
```

`enable` makes it start on every boot; `--now` also starts it immediately.

## Everyday commands

```bash
systemctl status murim-apocalypse        # is it running?
journalctl -u murim-apocalypse -f        # live log
sudo systemctl restart murim-apocalypse  # restart (players are saved first)
```

## Settings

Create `/etc/murim-apocalypse.env` (optional) with lines such as:

```
ADMIN_USERS=yourname
WORLD_SEED=1337
COOKIE_SECURE=1
TRUST_PROXY=1
```

COOKIE_SECURE and TRUST_PROXY are for when the game sits behind an HTTPS reverse proxy. Apply changes with a restart.

## Backups

Everything worth keeping is in `/var/lib/murim/`. Copy it somewhere else regularly, for example nightly:

```bash
sudo systemctl stop murim-apocalypse && sudo cp -a /var/lib/murim /var/backups/murim-$(date +%F) && sudo systemctl start murim-apocalypse
```
