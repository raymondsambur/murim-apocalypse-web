// Nightly backup of the game database, run by the murim-backup systemd timer.
// Takes a consistent snapshot while the game is running (VACUUM INTO), compresses it, checks the copy opens and
// passes an integrity check, and keeps only the newest BACKUP_KEEP snapshots.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';

const src = process.env.DB_PATH ?? '/var/lib/murim/murim.db';
const dir = process.env.BACKUP_DIR ?? '/var/backups/murim-nightly';
const keep = Number(process.env.BACKUP_KEEP ?? 14);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const raw = path.join(dir, `murim-${stamp}.db`);
const gz = `${raw}.gz`;

fs.mkdirSync(dir, { recursive: true });

const live = new DatabaseSync(src, { readOnly: true });
live.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
live.close();

const copy = new DatabaseSync(raw, { readOnly: true });
const integrity = copy.prepare('PRAGMA integrity_check').get().integrity_check;
const users = copy.prepare('SELECT count(*) AS c FROM users').get().c;
const characters = copy.prepare('SELECT count(*) AS c FROM characters').get().c;
copy.close();
if (integrity !== 'ok') {
  fs.rmSync(raw, { force: true });
  console.error(`backup FAILED: integrity check said "${integrity}"`);
  process.exit(1);
}

await pipeline(fs.createReadStream(raw), zlib.createGzip(), fs.createWriteStream(gz));
fs.rmSync(raw);

const old = fs
  .readdirSync(dir)
  .filter((f) => /^murim-.*\.db\.gz$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f));

console.log(`backup ok: ${gz} (${fs.statSync(gz).size} bytes; ${users} accounts, ${characters} characters; removed ${old.length} old)`);
