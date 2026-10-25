/**
 * Mock server extension for the Jobs, World and Social panels (`?mock=1`). Speaks the same messages and error codes as
 * the real modules (docs/notes/gameplay-activities.md, gameplay-social.md) with in-memory state:
 * activities (train / shift / craft with lazy settling), work sites and recipes, friends, sects, masters, duels,
 * leaderboard, nearby players and a long chronicle history for paging.
 * MockGame owns one instance and delegates to it (small additive hooks only).
 */
import {
  JOB_DEFS,
  JOB_MAX_LEVEL,
  OFFLINE_CAP_MS,
  RECIPES,
  RECIPE_LIST,
  SEASON_YIELD,
  SKILLS,
  getItem,
  jobXpToNext,
  rankOf,
  shiftYieldPerHour,
  type Activity,
  type C2S,
  type CharacterSave,
  type ChronicleEntry,
  type FriendView,
  type ItemStack,
  type JobId,
  type LeaderEntry,
  type MeView,
  type Queries,
  type QueryName,
  type RecipeView,
  type S2C,
  type SectMember,
  type SectRole,
  type SectView,
  type SiteView,
  type WorldData,
} from '@murim/shared';

export interface PbHost {
  readonly save: CharacterSave;
  readonly world: WorldData;
  send(msg: S2C): void;
  note(level: 'info' | 'good' | 'warn' | 'bad', text: string): void;
  markMe(): void;
  pos(): { x: number; y: number };
  inCombat(): boolean;
  isDead(): boolean;
  season(): number;
  giveItem(it: ItemStack): boolean;
  gainXp(n: number): void;
  setTag(tag: string): void;
  /** Player bots standing in the world (character id == entity id in the mock). */
  bots(): { id: number; name: string; level: number }[];
}

interface Person {
  id: number;
  name: string;
  level: number;
  online: boolean;
  kills: number;
}

const ROSTER: Person[] = [
  { id: 2, name: 'Wandering Sword', level: 14, online: true, kills: 188 },
  { id: 3, name: 'Moon Lotus', level: 22, online: true, kills: 410 },
  { id: 4, name: 'Iron Crane', level: 17, online: false, kills: 232 },
  { id: 5, name: 'Silent Willow', level: 9, online: false, kills: 41 },
  { id: 6, name: 'Granite Fist', level: 31, online: false, kills: 903 },
  { id: 7, name: 'Red Lantern', level: 27, online: true, kills: 522 },
  { id: 8, name: 'Pale Heron', level: 5, online: false, kills: 12 },
];

interface FakeSect {
  id: number;
  name: string;
  tag: string;
  motto: string;
  treasury: number;
  founded: number;
  members: { id: number; role: SectRole }[];
  requests: Set<number>;
}

const HOUR = 3_600_000;
const SETTLE_EVERY = 60_000;

export class MockPanelsB {
  private friends: FriendView[] = [
    { id: 3, name: 'Moon Lotus', level: 22, online: true, status: 'in' },
    { id: 4, name: 'Iron Crane', level: 17, online: false, status: 'friend' },
  ];
  private sects: FakeSect[] = [
    { id: 1, name: 'Azure Dawn Hall', tag: 'DAWN', motto: 'Light against the Blight.', treasury: 1800, founded: Date.now() - 40 * 86400_000, members: [{ id: 6, role: 'leader' }, { id: 3, role: 'elder' }, { id: 5, role: 'disciple' }], requests: new Set() },
    { id: 2, name: 'Iron Crane Society', tag: 'CRN', motto: 'Stand like the crane.', treasury: 420, founded: Date.now() - 12 * 86400_000, members: [{ id: 4, role: 'leader' }, { id: 8, role: 'outer' }], requests: new Set() },
  ];
  private nextSect = 3;
  private mySect: number | null = null;
  private myRole: SectRole = 'outer';
  private master: MeView['master'] = null;
  private disciples: MeView['disciples'] = [];
  private lastSettle = Date.now();
  private teachAt = new Map<number, number>();
  private duelOpen: { id: number; at: number } | null = null;

  constructor(private readonly host: PbHost) {}

  // ---- shared views -------------------------------------------------------------------------------------------
  meSect(): MeView['sect'] {
    const s = this.sects.find((x) => x.id === this.mySect);
    return s ? { id: s.id, name: s.name, tag: s.tag, role: this.myRole } : null;
  }
  meMaster(): MeView['master'] {
    return this.master;
  }
  meDisciples(): MeView['disciples'] {
    return this.disciples;
  }

  /** Long history so the chronicle can be paged: ids 1..n, oldest first. */
  history(day: number): ChronicleEntry[] {
    const texts: [ChronicleEntry['kind'], string, 1 | 2 | 3, number?][] = [
      ['weather', 'A cold front settled over the northern passes.', 1],
      ['economy', 'Grain prices fell after a good harvest.', 1],
      ['faction', 'The Black Wind Bandits raided a caravan on the eastern road.', 2],
      ['settlement', 'A festival began in the village.', 1, 0],
      ['blight', 'The Blight crept closer to the old watchtower.', 2],
      ['npc', 'Master Baek took a new student.', 1],
      ['legend', 'A wandering legend was seen on the mountain road.', 3],
      ['faction', 'The Crimson Lotus Cult and the Azure Cloud Sect clashed at the river.', 3],
      ['season', 'The season turned.', 2],
      ['player', 'A wanderer cleansed a Hollow grove.', 2],
    ];
    const out: ChronicleEntry[] = [];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const [kind, text, importance, sid] = texts[i % texts.length];
      out.push({ id: i + 1, day: Math.max(0, day - Math.floor((n - i) / 2)), hour: (6 + i * 5) % 24, kind, text: `${text}`, importance, settlementId: sid, t: Date.now() - (n - i) * 1800_000 });
    }
    return out;
  }

  // ---- ticking ----------------------------------------------------------------------------------------------------
  tick(now: number): void {
    if (this.host.save.activity && now - this.lastSettle >= SETTLE_EVERY) {
      this.lastSettle = now;
      this.settle(now);
    }
    if (this.duelOpen && now - this.duelOpen.at > 30_000) this.duelOpen = null;
  }

  /** Debug: pretend `ms` more time has passed for the running activity. */
  warp(ms: number): void {
    const a = this.host.save.activity;
    if (!a) return;
    a.since -= ms;
    a.settled -= ms;
    this.settle(Date.now());
    this.host.markMe();
  }

  interrupt(): void {
    if (!this.host.save.activity) return;
    this.settle(Date.now());
    this.finish('moved');
  }

  // ---- activities ---------------------------------------------------------------------------------------------------
  private err(code: string, text: string): void {
    this.host.send({ t: 'err', code, text });
  }

  private sitesOf(sid: number) {
    return this.host.world.settlements.find((s) => s.id === sid)?.sites ?? [];
  }
  private findSite(id: string) {
    for (const s of this.host.world.settlements) {
      const w = s.sites.find((x) => x.id === id);
      if (w) return { site: w, settlement: s };
    }
    return null;
  }
  private dist(x: number, y: number): number {
    const p = this.host.pos();
    return Math.hypot(p.x - x, p.y - y);
  }
  private count(id: string): number {
    return this.host.save.inventory.filter((s) => s.id === id).reduce((n, s) => n + s.qty, 0);
  }
  private take(id: string, qty: number): void {
    let left = qty;
    const inv = this.host.save.inventory;
    for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
      if (inv[i].id !== id) continue;
      const n = Math.min(left, inv[i].qty);
      inv[i].qty -= n;
      left -= n;
      if (inv[i].qty <= 0) inv.splice(i, 1);
    }
  }

  private begin(a: Activity): void {
    this.host.save.activity = a;
    this.lastSettle = Date.now();
    this.host.markMe();
  }

  private start(m: Extract<C2S, { t: 'astart' }>): void {
    const { save } = this.host;
    if (this.host.isDead()) return this.err('dead', 'You cannot do that while dead.');
    if (this.host.inCombat()) return this.err('in_combat', 'You cannot do that while fighting.');
    if (save.activity) return this.err('busy', 'You are already busy. Stop what you are doing first.');
    const f = this.findSite(m.site);
    if (!f) return this.err('no_site', 'There is no such place.');
    const now = Date.now();
    if (m.kind === 'train') {
      if (f.site.kind === 'dojo') {
        if (this.dist(f.site.x, f.site.y) > 6) return this.err('too_far', 'Walk up to the dojo first.');
      } else if (this.dist(f.settlement.x, f.settlement.y) > f.settlement.radius) return this.err('too_far', 'You can only train inside a settlement.');
      this.begin({ kind: 'train', since: now, settled: now, site: f.site.id, carry: {} });
      this.host.note('info', f.site.kind === 'dojo' ? 'You settle down to train at the dojo (x1.5 experience).' : 'You sit down to meditate.');
    } else if (m.kind === 'shift') {
      const def = JOB_DEFS[m.job];
      if (!def) return this.err('bad_job', 'Unknown trade.');
      if (def.mode !== 'gather') return this.err('bad_job', `${def.name}s work by crafting, not by shifts.`);
      if (f.site.kind !== def.site) return this.err('wrong_site', `A ${def.name} cannot work here.`);
      if (this.dist(f.site.x, f.site.y) > 3) return this.err('too_far', 'Walk up to the work site first.');
      this.begin({ kind: 'shift', job: def.id, since: now, settled: now, site: f.site.id, carry: {} });
      this.host.note('info', `You begin a ${def.name} shift.`);
    } else {
      const r = RECIPES[m.recipe];
      if (!r) return this.err('no_recipe', 'Unknown recipe.');
      if (f.site.kind !== JOB_DEFS[r.job].site) return this.err('wrong_site', 'That cannot be made here.');
      if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > 20) return this.err('bad_qty', 'You can craft 1-20 at a time.');
      const lim = Math.min(20, Math.floor(OFFLINE_CAP_MS / (r.seconds * 1000)));
      if (m.qty > lim) return this.err('too_long', `That batch would exceed the 8-hour work limit; craft at most ${lim}.`);
      if (save.jobs[r.job].lv < r.level) return this.err('low_level', `Requires ${JOB_DEFS[r.job].name} level ${r.level}.`);
      if (this.dist(f.site.x, f.site.y) > 6) return this.err('too_far', 'Walk up to the workshop first.');
      for (const [id, n] of r.inputs) {
        if (this.count(id) < n * m.qty) return this.err('no_materials', `You need ${n * m.qty}x ${getItem(id)?.name ?? id} (you have ${this.count(id)}).`);
      }
      for (const [id, n] of r.inputs) this.take(id, n * m.qty);
      this.begin({ kind: 'craft', recipe: r.id, remaining: m.qty, since: now, settled: now, site: f.site.id, carry: {} });
      this.host.note('info', `You begin crafting ${m.qty}x ${r.name}.`);
    }
  }

  private stop(): void {
    const a = this.host.save.activity;
    if (!a) return this.err('idle', 'You are not doing anything.');
    this.settle(Date.now());
    this.finish('stopped');
    this.host.note('info', 'You stop.');
  }

  private finish(reason: 'stopped' | 'moved' | 'done' | 'cap'): void {
    const a = this.host.save.activity;
    if (!a) return;
    if (a.kind === 'craft' && a.remaining > 0) {
      const r = RECIPES[a.recipe];
      const forfeit = reason === 'stopped' || reason === 'moved' ? 1 : 0;
      const units = Math.max(0, a.remaining - forfeit);
      if (r) for (const [id, n] of r.inputs) this.host.giveItem({ id, qty: n * units });
    }
    this.host.save.activity = null;
    if (reason === 'cap') this.host.note('warn', 'You have reached the 8-hour work limit; your work has ended.');
    if (reason === 'done') this.host.note('good', 'Your crafting is finished.');
    this.host.markMe();
  }

  private carryTake(a: Activity, key: string, amount: number): number {
    const carry = (a.carry ??= {});
    const total = (carry[key] ?? 0) + amount;
    const whole = Math.floor(total + 1e-9);
    carry[key] = total - whole;
    return whole;
  }

  private jobXp(job: JobId, xp: number): void {
    const st = this.host.save.jobs[job];
    st.xp += xp;
    while (st.lv < JOB_MAX_LEVEL && st.xp >= jobXpToNext(st.lv)) {
      st.xp -= jobXpToNext(st.lv);
      st.lv++;
      this.host.note('good', `Your ${JOB_DEFS[job].name} skill rose to level ${st.lv}.`);
    }
  }

  private settle(now: number): void {
    const a = this.host.save.activity;
    if (!a) return;
    const end = Math.min(now, a.since + OFFLINE_CAP_MS);
    const ms = end - a.settled;
    if (ms <= 0) {
      if (now >= a.since + OFFLINE_CAP_MS) this.finish('cap');
      return;
    }
    const gained: string[] = [];
    if (a.kind === 'train') {
      const s = this.host.save.stats;
      const dojo = this.findSite(a.site)?.site.kind === 'dojo';
      const perHour = (12 + 2 * s.insight + s.spirit) * (dojo ? 1.5 : 1);
      const xp = this.carryTake(a, 'xp', (perHour * ms) / HOUR);
      if (xp > 0) {
        this.host.gainXp(xp);
        gained.push(`${xp} cultivation XP`);
      }
      a.settled = end;
    } else if (a.kind === 'shift') {
      const lv = this.host.save.jobs[a.job].lv;
      const mult = (SEASON_YIELD as Record<string, number[] | undefined>)[a.job]?.[this.host.season() % 4] ?? 1;
      const y = shiftYieldPerHour(a.job, lv, mult);
      for (const [id, n] of y.items) {
        const whole = this.carryTake(a, id, (n * ms) / HOUR);
        if (whole > 0 && this.host.giveItem({ id, qty: whole })) gained.push(`${whole}x ${getItem(id)?.name ?? id}`);
      }
      const gold = this.carryTake(a, 'gold', (y.gold * ms) / HOUR);
      if (gold > 0) {
        this.host.save.gold += gold;
        gained.push(`${gold} gold`);
      }
      const xp = this.carryTake(a, 'jobxp', (y.xp * ms) / HOUR);
      if (xp > 0) this.jobXp(a.job, xp);
      a.settled = end;
    } else {
      const r = RECIPES[a.recipe];
      const per = (r?.seconds ?? 10) * 1000;
      const units = Math.min(a.remaining, Math.floor(ms / per));
      if (units > 0 && r) {
        this.host.giveItem({ id: r.output[0], qty: r.output[1] * units });
        this.jobXp(r.job, r.xp * units);
        a.remaining -= units;
        a.settled += units * per;
        gained.push(`${r.output[1] * units}x ${getItem(r.output[0])?.name ?? r.output[0]}`);
      }
    }
    if (gained.length) this.host.note('info', `Since the last update: ${gained.join('; ')}.`);
    if (a.kind === 'craft' && a.remaining <= 0) return this.finish('done');
    if (now >= a.since + OFFLINE_CAP_MS) return this.finish('cap');
    this.host.markMe();
  }

  // ---- queries ----------------------------------------------------------------------------------------------------------
  private siteViews(sid: number): SiteView[] {
    return this.sitesOf(sid).map((w) => {
      const job = Object.values(JOB_DEFS).find((j) => j.site === w.kind)?.id;
      const v: SiteView = { id: w.id, kind: w.kind, x: w.x, y: w.y, settlementId: w.settlementId };
      if (job) v.job = job;
      if (w.kind === 'dojo') v.trainBonus = 1.5;
      return v;
    });
  }

  private recipeViews(siteId: string): RecipeView[] {
    const f = this.findSite(siteId);
    if (!f) throw new Error('No such place.');
    const job = Object.values(JOB_DEFS).find((j) => j.site === f.site.kind)?.id;
    if (!job || JOB_DEFS[job].mode !== 'craft') return [];
    const save = this.host.save;
    return RECIPE_LIST.filter((r) => r.job === job).map((r) => {
      const missing = r.inputs.find(([id, n]) => this.count(id) < n);
      const reason = save.activity
        ? 'You are busy.'
        : this.host.inCombat()
          ? 'You are fighting.'
          : save.jobs[r.job].lv < r.level
            ? `Requires ${JOB_DEFS[r.job].name} level ${r.level}.`
            : this.dist(f.site.x, f.site.y) > 6
              ? 'Walk up to the workshop first.'
              : missing
                ? `You need ${missing[1]}x ${getItem(missing[0])?.name ?? missing[0]} (you have ${this.count(missing[0])}).`
                : null;
      const v: RecipeView = { id: r.id, name: r.name, job: r.job, level: r.level, inputs: r.inputs, output: r.output, seconds: r.seconds, canCraft: !reason };
      if (reason) v.reason = reason;
      return v;
    });
  }

  private person(id: number): Person | undefined {
    return ROSTER.find((p) => p.id === id);
  }
  private personByName(name: string): Person | undefined {
    return ROSTER.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  }

  private sectView(s: FakeSect, member: boolean): SectView {
    const me = this.host.save;
    const members: SectMember[] = s.members.map((m) => {
      const p = this.person(m.id);
      return { id: m.id, name: p?.name ?? `#${m.id}`, level: p?.level ?? 1, role: m.role, online: !!p?.online };
    });
    if (this.mySect === s.id) members.push({ id: me.id, name: me.name, level: me.level, role: this.myRole, online: true });
    const total = members.reduce((n, m) => n + m.level, 0);
    return { id: s.id, name: s.name, tag: s.tag, motto: s.motto, level: Math.min(10, Math.floor(Math.sqrt(total) / 2)), treasury: member ? s.treasury : 0, founded: s.founded, members, invites: member ? s.requests.size : 0 };
  }

  answer<N extends QueryName>(name: N, args: Queries[N]['args']): Queries[N]['res'] | undefined {
    const a = args as Record<string, unknown>;
    switch (name) {
      case 'sites':
        return this.siteViews(a.settlement as number) as Queries[N]['res'];
      case 'recipes':
        return this.recipeViews(String(a.site)) as Queries[N]['res'];
      case 'friends': {
        const order = { in: 0, friend: 1, out: 2 } as const;
        return [...this.friends].sort((x, y) => order[x.status] - order[y.status] || Number(y.online) - Number(x.online)) as Queries[N]['res'];
      }
      case 'sect': {
        const s = this.sects.find((x) => x.id === ((a.id as number | undefined) ?? this.mySect));
        return (s ? this.sectView(s, s.id === this.mySect) : null) as Queries[N]['res'];
      }
      case 'sects':
        return this.sects.map((s) => ({ id: s.id, name: s.name, tag: s.tag, level: this.sectView(s, false).level, members: s.members.length + (this.mySect === s.id ? 1 : 0), motto: s.motto })) as Queries[N]['res'];
      case 'leaderboard': {
        const sectOf = (id: number) => this.sects.find((s) => s.members.some((m) => m.id === id))?.name ?? null;
        const me = this.host.save;
        const rows: LeaderEntry[] = [...ROSTER.map((p) => ({ id: p.id, name: p.name, level: p.level, kills: p.kills, sect: sectOf(p.id) })), { id: me.id, name: me.name, level: me.level, kills: me.kills, sect: this.meSect()?.name ?? null }];
        return rows.sort((x, y) => y.level - x.level || y.kills - x.kills) as Queries[N]['res'];
      }
      case 'nearbyPlayers':
        return this.host.bots().map((b) => ({ id: b.id, name: b.name, level: b.level })) as Queries[N]['res'];
      case 'player': {
        const p = a.name ? this.personByName(String(a.name)) : this.person(Number(a.id));
        if (!p) return undefined;
        return { id: p.id, name: p.name, level: p.level, look: this.host.save.look, title: '', sect: this.sects.find((s) => s.members.some((m) => m.id === p.id))?.name ?? null, kills: p.kills, deaths: 3, equipment: { weapon: null, outfit: null, accessory: null }, stats: this.host.save.stats, rank: rankOf(p.level) } as Queries[N]['res'];
      }
      default:
        return undefined;
    }
  }

  // ---- commands ------------------------------------------------------------------------------------------------------------
  handle(msg: C2S): void {
    switch (msg.t) {
      case 'astart':
        return this.start(msg);
      case 'astop':
        return this.stop();
      case 'friend':
        return this.friendOp(msg);
      case 'sect':
        return this.sectOp(msg);
      case 'master':
        return this.masterOp(msg);
      case 'duel':
        return this.duelOp(msg);
      default:
        return;
    }
  }

  private friendOp(m: Extract<C2S, { t: 'friend' }>): void {
    const h = this.host;
    if (m.op === 'add') {
      const p = this.personByName(m.name);
      if (!p) return this.err('not_found', 'No character has that name.');
      const ex = this.friends.find((f) => f.id === p.id);
      if (ex?.status === 'friend') return this.err('already_friends', `${p.name} is already your friend.`);
      if (ex?.status === 'out') return this.err('already_requested', `You have already asked ${p.name}.`);
      if (ex?.status === 'in') {
        ex.status = 'friend';
        return h.note('good', `${p.name} is now your friend.`);
      }
      this.friends.push({ id: p.id, name: p.name, level: p.level, online: p.online, status: 'out' });
      h.note('info', `Friend request sent to ${p.name}.`);
      window.setTimeout(() => {
        const f = this.friends.find((x) => x.id === p.id && x.status === 'out');
        if (f) {
          f.status = 'friend';
          h.note('good', `${p.name} accepted your friend request.`);
        }
      }, 6000);
      return;
    }
    const f = this.friends.find((x) => x.id === m.id);
    if (m.op === 'accept') {
      if (f?.status !== 'in') return this.err('no_request', 'There is no friend request from that player.');
      f.status = 'friend';
      return h.note('good', `${f.name} is now your friend.`);
    }
    if (m.op === 'decline') {
      if (f?.status !== 'in') return this.err('no_request', 'There is no friend request from that player.');
      this.friends = this.friends.filter((x) => x !== f);
      return;
    }
    if (!f) return this.err('not_friends', 'That player is not on your friend list.');
    this.friends = this.friends.filter((x) => x !== f);
  }

  private mine(): FakeSect | null {
    return this.sects.find((s) => s.id === this.mySect) ?? null;
  }

  private joinSect(s: FakeSect, role: SectRole): void {
    this.mySect = s.id;
    this.myRole = role;
    this.host.setTag(`[${s.tag}]`);
    this.host.markMe();
  }
  private leaveSect(): void {
    this.mySect = null;
    this.host.setTag('');
    this.host.markMe();
  }

  private sectOp(m: Extract<C2S, { t: 'sect' }>): void {
    const h = this.host;
    const me = h.save;
    const s = this.mine();
    const order: Record<SectRole, number> = { leader: 3, elder: 2, disciple: 1, outer: 0 };
    switch (m.op) {
      case 'create': {
        if (s) return this.err('in_sect', 'You already belong to a sect. Leave it first.');
        if (rankOf(me.level) < 2) return this.err('rank_low', 'Only Second-Rate fighters or better may found a sect.');
        const name = m.name.trim();
        if (name.length < 3 || name.length > 20) return this.err('bad_name', 'A sect name must be 3 to 20 characters.');
        if (!/^[A-Za-z]{2,4}$/.test(m.tag)) return this.err('bad_tag', 'A sect tag is 2 to 4 letters.');
        if (this.sects.some((x) => x.name.toLowerCase() === name.toLowerCase())) return this.err('name_taken', 'A sect with that name already exists.');
        if (this.sects.some((x) => x.tag.toLowerCase() === m.tag.toLowerCase())) return this.err('tag_taken', 'A sect with that tag already exists.');
        if (me.gold < 500) return this.err('no_gold', 'Founding a sect costs 500 gold.');
        me.gold -= 500;
        const ns: FakeSect = { id: this.nextSect++, name, tag: m.tag.toUpperCase(), motto: (m.motto ?? '').slice(0, 120), treasury: 0, founded: Date.now(), members: [], requests: new Set() };
        this.sects.push(ns);
        this.joinSect(ns, 'leader');
        return h.note('good', `You founded ${ns.name}.`);
      }
      case 'join': {
        if (s) return this.err('in_sect', 'You already belong to a sect.');
        const t = this.sects.find((x) => x.id === m.sect);
        if (!t) return this.err('not_found', 'That sect does not exist.');
        h.note('info', `Your request to join ${t.name} was sent. It expires in 5 minutes.`);
        window.setTimeout(() => {
          if (!this.mySect) {
            h.send({ t: 'invite', kind: 'sect', fromId: t.members[0]?.id ?? 6, from: this.person(t.members[0]?.id ?? 6)?.name ?? 'Elder', data: { sect: t.id, name: t.name, tag: t.tag } });
          }
        }, 4000);
        return;
      }
      case 'accept': {
        if (s) return this.err('in_sect', 'You already belong to a sect.');
        const t = this.sects.find((x) => x.id === m.sect);
        if (!t) return this.err('no_invite', 'That invitation has expired.');
        this.joinSect(t, 'outer');
        return h.note('good', `You joined ${t.name}.`);
      }
      case 'decline':
        return;
      case 'invite': {
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (order[this.myRole] < 2) return this.err('no_permission', 'Only the leader and elders can invite.');
        const p = this.personByName(m.name);
        if (!p) return this.err('not_found', 'No such character.');
        if (!p.online) return this.err('offline', `${p.name} is not online.`);
        if (s.members.some((x) => x.id === p.id)) return this.err('target_in_sect', `${p.name} already belongs to a sect.`);
        h.note('info', `You invited ${p.name} to ${s.name}.`);
        window.setTimeout(() => {
          if (!s.members.some((x) => x.id === p.id)) {
            s.members.push({ id: p.id, role: 'outer' });
            h.note('info', `${p.name} has joined the sect.`);
          }
        }, 3000);
        return;
      }
      case 'leave':
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (this.myRole === 'leader') return this.err('leader_cannot_leave', 'Promote a successor to leader first, or disband the sect.');
        this.leaveSect();
        return h.note('info', `You left ${s.name}.`);
      case 'kick': {
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (order[this.myRole] < 2) return this.err('no_permission', 'Only the leader and elders can remove members.');
        const t = s.members.find((x) => x.id === m.id);
        if (!t) return this.err('not_member', 'That character is not in your sect.');
        if (this.myRole === 'elder' && order[t.role] >= 2) return this.err('no_permission', 'Elders can only remove disciples and outer members.');
        s.members = s.members.filter((x) => x !== t);
        return h.note('info', `${this.person(m.id)?.name ?? 'The member'} was removed from the sect.`);
      }
      case 'promote': {
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (this.myRole !== 'leader') return this.err('no_permission', 'Only the leader can change ranks.');
        const t = s.members.find((x) => x.id === m.id);
        if (!t) return this.err('not_member', 'That character is not in your sect.');
        if (t.role === m.role) return this.err('no_change', 'They already hold that rank.');
        if (m.role === 'leader') this.myRole = 'elder';
        t.role = m.role;
        h.markMe();
        return h.note('good', `${this.person(m.id)?.name} is now ${m.role}.`);
      }
      case 'deposit': {
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (!Number.isInteger(m.gold) || m.gold < 1) return this.err('bad_amount', 'Deposit a whole number of gold.');
        if (me.gold < m.gold) return this.err('no_gold', 'You do not have that much gold.');
        me.gold -= m.gold;
        s.treasury += m.gold;
        h.markMe();
        return h.note('good', `You deposited ${m.gold} gold.`);
      }
      case 'motto':
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (this.myRole !== 'leader') return this.err('no_permission', 'Only the leader can change the motto.');
        s.motto = m.motto.slice(0, 120);
        return;
      case 'disband':
        if (!s) return this.err('no_sect', 'You are not in a sect.');
        if (this.myRole !== 'leader') return this.err('no_permission', 'Only the leader can disband the sect.');
        this.sects = this.sects.filter((x) => x !== s);
        this.leaveSect();
        return h.note('info', `You disbanded ${s.name}.`);
    }
  }

  private masterOp(m: Extract<C2S, { t: 'master' }>): void {
    const h = this.host;
    const me = h.save;
    switch (m.op) {
      case 'request': {
        if (m.npc !== undefined) {
          if (this.master) return this.err('has_master', 'You already have a master.');
          if (rankOf(me.level) > 2) return this.err('rank_high', 'You are too advanced to be a disciple.');
          if ((me.reputation.azure ?? 0) < 10) return this.err('rep_low', 'Master Baek wants you to earn 10 reputation with Azure Cloud first.');
          this.master = { id: m.npc, name: 'Master Baek', npc: true };
          h.markMe();
          return h.note('good', 'Master Baek accepts you as a disciple. Cultivation comes faster and their teachings cost 20% less.');
        }
        const p = this.person(m.id ?? -1);
        if (!p || !p.online) return this.err('offline', 'That player is not online.');
        const mine = rankOf(me.level);
        const theirs = rankOf(p.level);
        if (!((mine <= 2 && theirs >= 3) || (mine >= 3 && theirs <= 2))) return this.err('bad_ranks', 'A master must be First-Rate or higher and a disciple Second-Rate or lower.');
        h.note('info', mine <= 2 ? `You asked ${p.name} to take you as a disciple.` : `You offered to take ${p.name} as a disciple.`);
        window.setTimeout(() => {
          if (mine <= 2) this.master = { id: p.id, name: p.name, npc: false };
          else if (this.disciples.length < 2) this.disciples.push({ id: p.id, name: p.name, level: p.level, online: p.online });
          h.markMe();
          h.note('good', mine <= 2 ? `${p.name} is now your master.` : `${p.name} is now your disciple.`);
        }, 2500);
        return;
      }
      case 'accept':
      case 'decline':
        return;
      case 'dismiss': {
        if (m.id === undefined) {
          if (!this.master) return this.err('no_master', 'You have no master.');
          this.master = null;
          h.markMe();
          return h.note('info', 'You have left your master.');
        }
        const d = this.disciples.find((x) => x.id === m.id);
        if (!d) return this.err('not_disciple', 'That player is not your disciple.');
        this.disciples = this.disciples.filter((x) => x !== d);
        h.markMe();
        return h.note('info', `${d.name} is no longer your disciple.`);
      }
      case 'teach': {
        const d = this.disciples.find((x) => x.id === m.id);
        if (!d) return this.err('not_disciple', 'That player is not your disciple.');
        if (!d.online) return this.err('offline', 'Your disciple must be online to be taught.');
        const def = SKILLS[m.skill];
        if (!def) return this.err('bad_skill', 'Unknown skill.');
        if ((me.skills[m.skill]?.lv ?? 0) < 3) return this.err('skill_low', `You must have mastered ${def.name} to level 3 to teach it.`);
        const last = this.teachAt.get(d.id) ?? 0;
        if (Date.now() - last < 3_600_000) return this.err('cooldown', `You can teach ${d.name} again in ${Math.ceil((3_600_000 - (Date.now() - last)) / 60000)} minute(s).`);
        this.teachAt.set(d.id, Date.now());
        return h.note('good', `You taught ${d.name} ${def.name}.`);
      }
    }
  }

  private duelOp(m: Extract<C2S, { t: 'duel' }>): void {
    const h = this.host;
    if (m.op !== 'challenge') return;
    const bot = h.bots().find((b) => b.id === m.id);
    if (!bot) return this.err('not_found', 'There is nobody to challenge there.');
    const max = Math.floor(h.save.gold * 0.2);
    if ((m.stake ?? 0) > max) return this.err('stake_high', `The stake may be at most ${max} gold (20% of the poorer fighter's gold).`);
    this.duelOpen = { id: m.id, at: Date.now() };
    h.note('info', `You challenged ${bot.name}${m.stake ? ` for ${m.stake} gold` : ''}. The challenge lasts 30 seconds.`);
  }
}
