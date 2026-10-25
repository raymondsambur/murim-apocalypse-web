/**
 * Live check of the siege battles: a websocket bot logs in as the test account, stands in the starting village while the
 * server (started with SIEGE_DEBUG=1) forces a siege at the settlement nearest to it, and logs what the client would see:
 * entities by side and state, casualties, blows, stage messages, the final settlement state.
 *
 *   SIEGE_DEBUG=1 SIEGE_DEBUG_FILE=<file> npm run dev:server          (server side)
 *   npx tsx --tsconfig packages/server/tsconfig.json scripts/siege-bot.ts [--url http://127.0.0.1:3000] [--cmd-file <file>]
 *        [--by blackwind|blight|azure...] [--strength 55] [--hours 3] [--defense 95] [--seconds 150] [--user lead_tester] [--pass testpass-12345]
 *
 * It only touches its own account. The server's command file is written by this script (it must run on the same machine).
 */
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { CombatEvent, EntityPatch, EntityView, S2C } from '@murim/shared';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const URL_BASE = args.get('url') ?? 'http://127.0.0.1:3000';
const USER = args.get('user') ?? 'lead_tester';
const PASS = args.get('pass') ?? 'testpass-12345';
const CMD_FILE = args.get('cmd-file') ?? path.join(process.cwd(), 'data', 'siege-debug.json');
const BY = args.get('by') ?? 'blackwind';
const STRENGTH = Number(args.get('strength') ?? 55);
const HOURS = Number(args.get('hours') ?? 3);
const DEFENSE = args.get('defense') !== undefined ? Number(args.get('defense')) : undefined;
const SECONDS = Number(args.get('seconds') ?? 160);
/** --fight 1: the bot attacks the nearest raider it sees (to exercise player participation; it is a level-1 character and will probably fall). */
const FIGHT = args.get('fight') === '1';

let cookie = '';
async function api(pathname: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(URL_BASE + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

async function login(): Promise<void> {
  let r = await api('/api/login', { username: USER, password: PASS });
  if (r.status !== 200) {
    r = await api('/api/register', { username: USER, password: PASS });
    if (r.status !== 201 && r.status !== 200) throw new Error(`cannot log in or register ${USER}: ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`registered ${USER} on ${URL_BASE}`);
  }
  const me = (await api('/api/me')).json as { character: unknown | null };
  if (!me.character) {
    const roll = (await api('/api/character/roll', { reroll: false })).json as { look: unknown };
    const made = await api('/api/character/create', { name: 'Sieger', look: roll.look });
    if (made.status !== 201 && made.status !== 200) throw new Error(`character create failed: ${made.status} ${JSON.stringify(made.json)}`);
    console.log('created character Sieger');
  }
}

const ents = new Map<number, EntityView>();
const stat = { combats: 0, cend: [] as string[], hits: 0, miss: 0, down: 0, notes: [] as string[], phases: [] as string[], shouts: [] as string[], chron: [] as string[], settle: [] as string[] };
let selfId = -1;
let hitsThisSecond = 0;
let inCombat = false;
let ws: WebSocket | null = null;
const t0 = Date.now();
const stamp = (): string => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

function onMsg(m: S2C): void {
  switch (m.t) {
    case 'hello':
      selfId = m.you.entityId;
      ents.clear();
      break;
    case 'ents':
      for (const e of m.add ?? []) ents.set(e.id, e);
      for (const p of (m.upd ?? []) as EntityPatch[]) {
        const e = ents.get(p.id);
        if (e) Object.assign(e, p);
      }
      for (const id of m.del ?? []) ents.delete(id);
      break;
    case 'cfx':
    case 'combat':
      if (m.t === 'combat') {
        if (!inCombat) stat.combats++;
        inCombat = true;
      }
      for (const ev of m.ev as CombatEvent[]) {
        if (ev.k === 'hit') {
          stat.hits++;
          hitsThisSecond++;
        } else if (ev.k === 'miss') stat.miss++;
        else if (ev.k === 'down') stat.down++;
      }
      break;
    case 'cend':
      stat.cend.push(`${stamp()} ${m.result}: ${m.text}`);
      console.log(`${stamp()} COMBAT END ${m.result}: ${m.text}`);
      inCombat = false;
      break;
    case 'note':
      stat.notes.push(`${stamp()} [${m.level}] ${m.text}`);
      console.log(`${stamp()} NOTE ${m.text}`);
      break;
    case 'siege':
      stat.phases.push(`${stamp()} ${m.phase}`);
      console.log(`${stamp()} SIEGE stage message: ${m.phase} at settlement ${m.sid} by ${m.by} gate=(${m.x},${m.y})`);
      break;
    case 'chat':
      if (m.msg.ch === 'local' && m.msg.fromId !== selfId) {
        stat.shouts.push(`${m.msg.from}: ${m.msg.text}`);
        console.log(`${stamp()} SHOUT ${m.msg.from}: "${m.msg.text}"`);
      }
      break;
    case 'chron':
      for (const e of m.entries) {
        stat.chron.push(e.text);
        console.log(`${stamp()} CHRONICLE ${e.text}`);
      }
      break;
    case 'settle':
      for (const s of m.list) stat.settle.push(`${stamp()} #${s.id} ${s.status} siege=${s.siege} controller=${s.controller}`);
      break;
  }
}

function snapshot(): string {
  const all = [...ents.values()];
  const raid = all.filter((e) => e.side === 'raid');
  const def = all.filter((e) => e.side === 'def');
  const by = (list: EntityView[]): string => {
    const c = new Map<string, number>();
    for (const e of list) c.set(e.state + (e.act ? `/${e.act}` : ''), (c.get(e.state + (e.act ? `/${e.act}` : '')) ?? 0) + 1);
    return [...c.entries()].map(([k, v]) => `${k}:${v}`).join(' ');
  };
  const self = ents.get(selfId);
  const near = (e: EntityView): number => (self ? Math.hypot(e.x - self.x, e.y - self.y) : 0);
  const rd = raid.length ? Math.min(...raid.map(near)) : NaN;
  return `raiders ${raid.length} (${by(raid) || '-'}) nearest ${Number.isNaN(rd) ? '-' : rd.toFixed(0)} tiles | defenders ${def.length} (${by(def) || '-'}) | blows/s ${hitsThisSecond} | banners ${all.filter((e) => e.flag === 1).length}`;
}

async function main(): Promise<void> {
  await login();
  ws = new WebSocket(URL_BASE.replace(/^http/, 'ws') + '/ws', { headers: { cookie } });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  ws.on('message', (d) => {
    try {
      onMsg(JSON.parse(d.toString()) as S2C);
    } catch (err) {
      console.log('bad message', err);
    }
  });
  ws.on('close', (code) => console.log(`${stamp()} socket closed ${code}`));
  await new Promise((r) => setTimeout(r, 1500));
  const self = ents.get(selfId);
  console.log(`${stamp()} logged in as ${USER}; standing at (${self?.x},${self?.y}); ${ents.size} entities in view`);

  fs.mkdirSync(path.dirname(CMD_FILE), { recursive: true });
  fs.writeFileSync(CMD_FILE, JSON.stringify({ action: 'start', user: USER, by: BY, strength: STRENGTH, hours: HOURS, defense: DEFENSE }));
  console.log(`${stamp()} wrote the siege command (${BY}, strength ${STRENGTH}, ${HOURS} world hours) to ${CMD_FILE}`);

  let finished = false;
  let endAt = 0;
  const timer = setInterval(() => {
    console.log(`${stamp()} ${snapshot()}`);
    if (FIGHT && !inCombat) {
      const me = ents.get(selfId);
      const foe = [...ents.values()].filter((e) => e.side === 'raid' && e.state !== 'dead' && me && Math.hypot(e.x - me.x, e.y - me.y) < 26).sort((a, b) => Math.hypot(a.x - (me?.x ?? 0), a.y - (me?.y ?? 0)) - Math.hypot(b.x - (me?.x ?? 0), b.y - (me?.y ?? 0)))[0];
      if (foe && ws) ws.send(JSON.stringify({ t: 'interact', id: foe.id }));
    }
    hitsThisSecond = 0;
    const last = stat.phases[stat.phases.length - 1] ?? '';
    if (!endAt && /\b(hold|fall)$/.test(last)) endAt = Date.now() + 55_000;
    if (/\bend$/.test(last) || (endAt && Date.now() > endAt) || Date.now() - t0 > SECONDS * 1000) {
      finished = true;
      clearInterval(timer);
    }
  }, 1000);
  while (!finished) await new Promise((r) => setTimeout(r, 500));
  console.log('\n=== summary ===');
  console.log(`player fights: ${stat.combats}; ${stat.cend.join(' | ')}`);
  console.log(`blows seen: ${stat.hits} hits, ${stat.miss} misses, ${stat.down} down events`);
  console.log(`stages: ${stat.phases.join(', ')}`);
  console.log(`shouts: ${stat.shouts.length}`);
  console.log(`last settlement state lines:\n  ${stat.settle.slice(-4).join('\n  ')}`);
  console.log(`chronicle:\n  ${stat.chron.join('\n  ')}`);
  console.log(`entities left with a battle side: ${[...ents.values()].filter((e) => e.side).length}`);
  ws?.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
