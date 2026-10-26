/**
 * Dev-only game simulation behind the MockServer (`?mock=1`). It speaks the real `S2C` / `C2S` protocol and uses the
 * real shared rules (combat engine, derived stats, items, skills) so every screen can be exercised without the server:
 * wandering NPCs / monsters / bots, walking, fights, shops, teaching, missions, chat, invites, queries.
 * Randomness here is intentionally `Math.random`-free where cheap, but nothing in this file is game logic that ships.
 */
import {
  BREAKTHROUGHS,
  DLG_TRAITS,
  FACTIONS,
  INVENTORY_SLOTS,
  MAX_ACTIVE_MISSIONS,
  MONSTERS,
  PROTOCOL_VERSION,
  RECIPE_LIST,
  Rng,
  SKILLS,
  STEP_MS,
  ambientLook,
  breakthroughChance,
  buildMonsterCombatant,
  buildPlayerCombatant,
  composeLine,
  deriveForCharacter,
  findPath,
  getItem,
  getSkill,
  isBreakthroughLevel,
  isEquipment,
  isOver,
  monsterStats,
  nearestWalkable,
  randomLook,
  rankOf,
  residentTarget,
  sanitizeLoadout,
  stackValue,
  statPointsForLevel,
  strHash,
  stepBeat,
  tileSpeed,
  winner,
  worldPathGrid,
  xpToNext,
  type ActiveMission,
  type C2S,
  type ChatChannel,
  type ChronicleEntry,
  type CombatEvent,
  type CombatState,
  type DlgInput,
  type DlgRumorKind,
  type DlgTrait,
  type CharacterSave,
  type Combatant,
  type Dir,
  type EntityView,
  type EquipSlot,
  type FighterView,
  type ItemStack,
  type MeView,
  type MissionOffer,
  type MonsterDef,
  type NpcMenu,
  type NpcRole,
  type PathGrid,
  type Point,
  type PublicProfile,
  type Queries,
  type QueryName,
  type S2C,
  type SettlementView,
  type ShopEntry,
  type TeachEntry,
  type TimeView,
  type WeatherKind,
  type WorldData,
} from '@murim/shared';
import { encodeBase64 } from './base64';
import { MockPanelsB } from './mockPanelsB';
import { MockRefusal, checkAccept, checkBuild, checkTurnIn, nearBoard, offerOf, refreshCollect, restPrice as mockRestPrice, takeGoods, ACCEPT_MARGIN, BOARD_MARGIN } from './mockPanelsA';

export interface MockPeer {
  send(msg: S2C): void;
}

export interface MockGameOptions {
  world: WorldData;
  save: CharacterSave;
  peer: MockPeer;
  /** One world hour per 6 s instead of 60 s. */
  fast?: boolean;
  persist(save: CharacterSave): void;
  seed?: number;
}

interface MEnt {
  v: EntityView;
  path: Point[];
  stepEnd: number;
  wander?: { home: Point; radius: number; next: number };
  def?: MonsterDef;
  level?: number;
  npc?: { role: NpcRole; title: string; faction: string | null; greeting: string; level: number };
  bot?: boolean;
  respawnAt?: number;
  origin?: EntityView;
}

const NPC_GREETINGS: Partial<Record<NpcRole, string[]>> = {
  elder: ['The Blight creeps closer each season. Will you lend your blade to the village?', 'Peace is a memory here, young one. But work, we have plenty.'],
  merchant: ['Fine goods, fair prices. Everything has a price - even peace of mind.', 'Welcome, welcome! The roads are hard, but my stock is sound.'],
  smith: ['Steel does not care who swings it. Let me make sure it holds.'],
  alchemist: ['Careful with those herbs. One wrong leaf and the cure becomes the poison.'],
  innkeeper: ['A bed, a meal, and a quiet corner. What more does a wanderer need?'],
  master: ['You carry yourself well. Show me you can carry a lesson too.'],
  guard: ['Move along, citizen. Eyes open. The Hollows do not knock.'],
  wanderer: ['I have walked every road between here and the sea. Ask me anything - for a coin.'],
};

const FIRST_NAMES = ['Mu', 'Lian', 'Dae', 'Yu', 'Hana', 'Baek', 'Jin', 'Seo', 'Ryu', 'Han', 'Soo', 'Wol'];

export function dirFromStep(dx: number, dy: number): Dir {
  const sx = dx - dy;
  const sy = dx + dy;
  if (sx > 0 && sy >= 0) return 0;
  if (sx <= 0 && sy > 0) return 1;
  if (sx < 0 && sy <= 0) return 2;
  return 3;
}

export class MockGame {
  private readonly world: WorldData;
  private readonly grid: PathGrid;
  private readonly peer: MockPeer;
  private readonly rng: Rng;
  private ents = new Map<number, MEnt>();
  private save: CharacterSave;
  private self!: MEnt;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startReal = Date.now();
  private startHours = 9.2;
  private startDay = 12;
  private hourMs: number;
  private weather: WeatherKind[] = ['clear', 'cloudy', 'rain'];
  private chronicle: ChronicleEntry[] = [];
  private settlements: SettlementView[] = [];
  private talkCount = 0;
  private boards = new Map<number, MissionOffer[]>();
  private combat: { id: number; state: CombatState; monster: MEnt; nextBeat: number; fleeing: boolean; ended: boolean } | null = null;
  private combatSeq = 1;
  private pendingInteract: { id: number; since: number } | null = null;
  private nextEntId = 100;
  private lastTimeSent = 0;
  private lastSave = 0;
  private dirtyMe = false;
  private lastChron = Date.now();
  private botTalk = Date.now() + 14000;
  private inviteAt = Date.now() + 12000;
  private deathAt = 0;
  private gatherAt = 0;
  private gatherNode: MEnt | null = null;
  private username: string;
  private persist: (s: CharacterSave) => void;
  private tag = '';
  /** Jobs / World / Social extension (activities, friends, sects, masters...). */
  private pb!: MockPanelsB;

  constructor(o: MockGameOptions & { username?: string }) {
    this.world = o.world;
    this.grid = worldPathGrid(o.world);
    this.peer = o.peer;
    this.save = o.save;
    this.persist = o.persist;
    this.username = o.username ?? 'tester';
    this.rng = new Rng(o.seed ?? (Date.now() & 0x7fffffff));
    this.hourMs = o.fast ? 6000 : 60000;
    this.populate();
    this.makeSettlements();
    this.makeChronicle();
    this.pb = new MockPanelsB({
      save: this.save,
      world: this.world,
      send: (m) => this.send(m),
      note: (l, t) => this.note(l, t),
      markMe: () => this.markMe(),
      pos: () => ({ x: this.self.v.x, y: this.self.v.y }),
      inCombat: () => !!this.combat && !this.combat.ended,
      isDead: () => this.save.hp <= 0,
      season: () => this.time().season,
      giveItem: (it) => this.giveItem(it),
      gainXp: (n) => this.gainXp(n),
      setTag: (tag) => {
        this.tag = tag;
        this.self.v.tag = tag || undefined;
        this.send({ t: 'ents', upd: [{ id: 1, tag: tag || undefined }] });
      },
      bots: () => [...this.ents.values()].filter((e) => e.bot).map((e) => ({ id: e.v.id, name: e.v.name, level: e.v.lv ?? 1 })),
    });
    this.chronicle = this.pb.history(this.startDay);
  }

  // ---- lifecycle -------------------------------------------------------------------------------------
  start(): void {
    this.send({
      t: 'hello',
      you: this.me(),
      time: this.time(),
      settlements: this.settlements,
      chronicle: this.chronicle.slice(-12),
      blight: this.blightMap(),
      serverNow: Date.now(),
      protocol: PROTOCOL_VERSION,
    });
    this.send({ t: 'ents', add: [...this.ents.values()].map((e) => ({ ...e.v })) });
    this.timer = setInterval(() => this.tick(), 100);
    this.note('info', `Welcome back, ${this.save.name}. (Mock server: nothing here is saved on a real server.)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persist(this.save);
  }

  private send(msg: S2C): void {
    this.peer.send(msg);
  }

  private note(level: 'info' | 'good' | 'warn' | 'bad', text: string): void {
    this.send({ t: 'note', level, text });
  }

  // ---- world population -----------------------------------------------------------------------------------
  private walkableNear(x: number, y: number, r = 4): Point {
    return nearestWalkable(this.grid, Math.round(x), Math.round(y), r) ?? { x: Math.round(x), y: Math.round(y) };
  }

  private addEnt(v: Omit<EntityView, 'id'>, extra: Partial<MEnt> = {}): MEnt {
    const id = this.nextEntId++;
    const e: MEnt = { v: { ...v, id } as EntityView, path: [], stepEnd: 0, ...extra };
    e.origin = { ...e.v };
    this.ents.set(id, e);
    return e;
  }

  private populate(): void {
    const w = this.world;
    const home = w.settlements.find((s) => s.id === this.save.lastTown) ?? w.settlements[0];
    const cx = home.spawn.x;
    const cy = home.spawn.y;
    const save = this.save;
    const start = this.walkableNear(save.x || cx, save.y || cy, 6);
    save.x = start.x;
    save.y = start.y;

    this.self = {
      v: {
        id: 1,
        kind: 'player',
        name: save.name,
        x: save.x,
        y: save.y,
        face: 0,
        state: 'idle',
        look: save.look,
        lv: save.level,
        hp: save.hp,
        maxHp: deriveForCharacter(save).maxHp,
        weapon: getItem(save.equipment.weapon?.id ?? '')?.weaponType,
        rank: rankOf(save.level),
        online: true,
        tag: this.tag || undefined,
      },
      path: [],
      stepEnd: 0,
    };
    this.ents.set(1, this.self);

    const r = new Rng(w.seed ^ 0x77);
    const npcs: { name: string; role: NpcRole; title: string; faction: string | null; level: number; dx: number; dy: number }[] = [
      { name: 'Elder Mu', role: 'elder', title: 'Village Elder', faction: null, level: 18, dx: 2, dy: -3 },
      { name: 'Lian the Merchant', role: 'merchant', title: 'Caravan Trader', faction: 'jade', level: 9, dx: -3, dy: 2 },
      { name: 'Smith Dae', role: 'smith', title: 'Blacksmith', faction: null, level: 12, dx: 4, dy: 3 },
      { name: 'Yu the Alchemist', role: 'alchemist', title: 'Herbalist & Alchemist', faction: null, level: 14, dx: -4, dy: -2 },
      { name: 'Hana', role: 'innkeeper', title: 'Innkeeper', faction: null, level: 6, dx: 1, dy: 5 },
      { name: 'Master Baek', role: 'master', title: 'Sword Master of the Azure Cloud', faction: 'azure', level: 31, dx: 6, dy: -1 },
      { name: 'Guard Seo', role: 'guard', title: 'Gate Guard', faction: 'azure', level: 10, dx: -6, dy: 0 },
      { name: 'Guard Ryu', role: 'guard', title: 'Gate Guard', faction: 'azure', level: 11, dx: 0, dy: -6 },
      { name: 'Old Han', role: 'wanderer', title: 'Roadside Storyteller', faction: null, level: 5, dx: 3, dy: 6 },
    ];
    for (const n of npcs) {
      const p = this.walkableNear(cx + n.dx, cy + n.dy, 5);
      const greetings = NPC_GREETINGS[n.role] ?? ['Hello.'];
      this.addEnt(
        { kind: 'npc', name: n.name, x: p.x, y: p.y, face: r.pick([0, 1, 2, 3] as const), state: 'idle', look: randomLook(r), role: n.role, lv: n.level, faction: n.faction ?? undefined, tag: n.title, rank: rankOf(n.level) },
        { npc: { role: n.role, title: n.title, faction: n.faction, greeting: r.pick(greetings), level: n.level }, wander: n.role === 'wanderer' || n.role === 'merchant' ? { home: p, radius: 3, next: Date.now() + 2000 } : undefined },
      );
    }

    // the nameless townsfolk the real server spawns near players (shared/crowd.ts)
    for (let i = 0; i < 24; i++) {
      const p = this.walkableNear(cx + r.int(-9, 9), cy + r.int(-9, 9), 6);
      this.addEnt({ kind: 'ambient', name: '', x: p.x, y: p.y, face: r.pick([0, 1, 2, 3] as const), state: 'idle', look: ambientLook(r.int(0, 23)), role: 'villager' }, { wander: { home: p, radius: 6, next: Date.now() + 1000 + i * 300 } });
    }

    const species = ['boar', 'wolf', 'wolf', 'viper', 'thug', 'thug', 'hollow', 'chief'];
    species.forEach((id, i) => {
      const def = MONSTERS[id];
      const ang = (i / species.length) * Math.PI * 2 + 0.4;
      const dist = 9 + (i % 4) * 2.5;
      const p = this.walkableNear(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.8, 5);
      const level = Math.max(def.minLevel, Math.min(def.maxLevel, 2 + i));
      const st = monsterStats(def, level);
      this.addEnt(
        { kind: 'monster', name: def.name, x: p.x, y: p.y, face: 0, state: 'idle', sprite: def.sprite, lv: level, hp: st.maxHp, maxHp: st.maxHp, elite: def.boss ? 2 : def.elite ? 1 : 0 },
        { def, level, wander: { home: p, radius: 4, next: Date.now() + 1500 + i * 700 } },
      );
    });

    const nodes: [string, number, number][] = [
      ['herb', 5, 6],
      ['herb', -7, 5],
      ['rareHerb', 8, -6],
      ['ore', -8, -5],
      ['ore', 7, 8],
    ];
    for (const [kind, dx, dy] of nodes) {
      const p = this.walkableNear(cx + dx, cy + dy, 6);
      const nodeNames: Record<string, string> = { herb: 'Qi-Gathering Grass', rareHerb: 'Hundred-Year Ginseng', ore: 'Iron Vein' };
      this.addEnt({ kind: 'node', name: nodeNames[kind], x: p.x, y: p.y, face: 0, state: 'idle', sprite: kind === 'ore' ? 'ore' : 'herb', nodeKind: kind as 'herb' | 'rareHerb' | 'ore' });
    }

    for (const [name, dx, dy, lv] of [
      ['Wandering Sword', 4, 2, 14],
      ['Moon Lotus', -5, 4, 22],
    ] as const) {
      const p = this.walkableNear(cx + dx, cy + dy, 5);
      this.addEnt(
        { kind: 'player', name, x: p.x, y: p.y, face: 1, state: 'idle', look: randomLook(r), lv, rank: rankOf(lv), online: true, tag: name === 'Moon Lotus' ? 'Azure' : undefined, weapon: 'sword', hp: 400, maxHp: 400 },
        { bot: true, wander: { home: p, radius: 5, next: Date.now() + 3000 } },
      );
    }
  }

  private makeSettlements(): void {
    const statuses = ['thriving', 'stable', 'stable', 'struggling', 'besieged', 'stable', 'fallen', 'thriving'] as const;
    this.settlements = this.world.settlements.map((s, i) => ({
      id: s.id,
      controller: FACTIONS[i % FACTIONS.length].id,
      status: statuses[i % statuses.length],
      prosperity: 40 + ((i * 17) % 55),
      population: residentTarget(s.kind, s.population, s.population),
      defense: 30 + ((i * 11) % 60),
      blight: (i * 23) % 140,
      siege: statuses[i % statuses.length] === 'besieged',
      flags: i % 3 === 0 ? ['festival'] : [],
    }));
    for (const s of this.world.settlements) this.boards.set(s.id, this.makeBoard(s.id));
  }

  private makeBoard(settlementId: number): MissionOffer[] {
    const day = this.startDay;
    const mk = (n: number, o: Partial<MissionOffer> & Pick<MissionOffer, 'type' | 'title' | 'desc' | 'target'>): MissionOffer => ({
      id: `m-${settlementId}-${n}-${day}`,
      settlementId,
      minRank: 1,
      level: 2 + n,
      reward: { xp: 60 + n * 30, gold: 20 + n * 15 },
      expires: day + 5,
      ...o,
    });
    return [
      mk(0, { type: 'hunt', title: 'Thin the Wolf Pack', desc: 'Wolves have been taking livestock at the edge of the village.', target: { monster: 'wolf', count: 3 }, reward: { xp: 90, gold: 35, rep: { faction: 'azure', amount: 3 } } }),
      mk(1, { type: 'gather', title: 'Herbs for the Healer', desc: 'Yu is short of Qi-Gathering Grass for tonight’s pills.', target: { item: 'herb', count: 4 }, reward: { xp: 70, gold: 28, items: [{ id: 'pill_heal_s', qty: 2 }] } }),
      mk(2, { type: 'bounty', title: 'Bandit Insignia Bounty', desc: 'The magistrate pays well for proof of bandit kills.', target: { monster: 'thug', count: 2 }, reward: { xp: 130, gold: 60, rep: { faction: 'jade', amount: 4 } } }),
      mk(3, { type: 'purify', title: 'Cleanse the Hollow Grove', desc: 'The Blight has taken root nearby. Destroy the Hollows and let the sun back in.', target: { monster: 'hollow', count: 3 }, minRank: 2, reward: { xp: 260, gold: 120, items: [{ id: 'pill_heal_m', qty: 1 }] } }),
    ];
  }

  private makeChronicle(): void {
    const day = this.startDay;
    const lines: [string, ChronicleEntry['kind'], 1 | 2 | 3][] = [
      ['Heavy rain eased the drought in the central plains.', 'weather', 1],
      ['The Azure Cloud Sect reopened the northern pass.', 'faction', 2],
      ['A caravan of the Jade Merchant Guild reached the capital safely.', 'economy', 1],
      ['The Blight Heart in the eastern marsh stirs again.', 'blight', 3],
    ];
    this.chronicle = lines.map(([text, kind, importance], i) => ({ id: i + 1, day: day - (lines.length - i), hour: 6 + i * 3, kind, text, importance, t: Date.now() - (lines.length - i) * 3600_000 }));
  }

  private blightMap(): string {
    const { w, h } = this.world;
    const a = new Uint8Array(w * h);
    const hx = Math.round(w * 0.78);
    const hy = Math.round(h * 0.3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.max(0, Math.round(220 - Math.hypot(x - hx, y - hy) * 7));
    return encodeBase64(a);
  }

  // ---- derived views ------------------------------------------------------------------------------------------
  private time(): TimeView {
    const elapsedHours = (Date.now() - this.startReal) / this.hourMs;
    let hours = this.startHours + elapsedHours;
    let day = this.startDay;
    while (hours >= 24) {
      hours -= 24;
      day++;
    }
    const absSeason = Math.floor(day / 30);
    return { hours, day, season: absSeason % 4, year: Math.floor(absSeason / 4), hourMs: this.hourMs, t: Date.now(), weather: this.weather };
  }

  private me(): MeView {
    const c = this.save;
    return {
      c: JSON.parse(JSON.stringify(c)) as CharacterSave,
      d: deriveForCharacter(c, Date.now()),
      xpNext: xpToNext(c.level),
      entityId: 1,
      combatId: this.combat && !this.combat.ended ? this.combat.id : null,
      sect: this.pb.meSect(),
      master: this.pb.meMaster(),
      disciples: this.pb.meDisciples(),
      now: Date.now(),
    };
  }

  private markMe(): void {
    this.dirtyMe = true;
  }

  private maxHp(): number {
    return deriveForCharacter(this.save, Date.now()).maxHp;
  }

  // ---- tick ------------------------------------------------------------------------------------------------------------
  private tick(): void {
    const now = Date.now();
    const upd: { id: number; [k: string]: unknown }[] = [];
    const add: EntityView[] = [];
    const del: number[] = [];

    for (const e of this.ents.values()) {
      if (e.respawnAt && now >= e.respawnAt) {
        e.respawnAt = undefined;
        e.v = { ...(e.origin as EntityView), id: e.v.id };
        if (e.def && e.level) {
          const st = monsterStats(e.def, e.level);
          e.v.hp = e.v.maxHp = st.maxHp;
        }
        add.push({ ...e.v });
        continue;
      }
      if (e.respawnAt) continue;
      if (e.v.state === 'dead') continue;
      this.stepEntity(e, now, upd);
      // wandering AI
      const wd = e.wander;
      const fighting = this.combat?.monster === e;
      if (wd && !e.path.length && now >= wd.next && !fighting && e !== this.self) {
        const tx = wd.home.x + Math.round((this.rng.next() - 0.5) * 2 * wd.radius);
        const ty = wd.home.y + Math.round((this.rng.next() - 0.5) * 2 * wd.radius);
        const t2 = nearestWalkable(this.grid, tx, ty, 2);
        if (t2) {
          const p = findPath(this.grid, Math.round(e.v.x), Math.round(e.v.y), t2.x, t2.y, 400);
          if (p && p.length) e.path = p;
        }
        wd.next = now + 2500 + this.rng.next() * 6000;
      }
    }

    if (this.pendingInteract) this.checkPendingInteract(now, upd);
    this.pb.tick(now);

    if (this.combat && now >= this.combat.nextBeat) this.combatBeat(now, upd);
    if (this.gatherNode && now >= this.gatherAt) this.finishGather(upd);
    if (this.deathAt && now >= this.deathAt) this.respawnSelf(upd);

    // periodic server chatter
    if (now - this.lastTimeSent > 5000) {
      this.lastTimeSent = now;
      this.send({ t: 'time', time: this.time() });
    }
    if (now - this.lastChron > 45000) {
      this.lastChron = now;
      const entry: ChronicleEntry = { id: this.chronicle.length + 1, day: this.time().day, hour: Math.floor(this.time().hours), kind: 'faction', text: this.rng.pick(['Black Wind Bandits raided a caravan on the eastern road.', 'A festival began in Greenreed Village.', 'The Crimson Lotus Cult gained influence in the south.', 'Hollows were sighted near the old watchtower.']), importance: this.rng.pick([1, 2, 3] as const), t: now };
      this.chronicle.push(entry);
      this.send({ t: 'chron', entries: [entry] });
    }
    if (now >= this.botTalk) {
      this.botTalk = now + 22000 + this.rng.next() * 15000;
      const bot = [...this.ents.values()].find((e) => e.bot);
      if (bot) this.send({ t: 'chat', msg: { ch: 'local', from: bot.v.name, fromId: bot.v.id, text: this.rng.pick(['Anyone seen a good smith around here?', 'Careful, the wolves are restless today.', 'The Blight is spreading east, stay on the road.', 'Selling herbs, cheap!']), t: now, tag: bot.v.tag } });
    }
    if (this.inviteAt && now >= this.inviteAt) {
      this.inviteAt = 0;
      this.send({ t: 'invite', kind: 'friend', fromId: 3, from: 'Moon Lotus' });
    }

    if (upd.length) this.send({ t: 'ents', upd: upd as never });
    if (add.length) this.send({ t: 'ents', add });
    if (del.length) this.send({ t: 'ents', del });
    if (this.dirtyMe) {
      this.dirtyMe = false;
      this.send({ t: 'me', me: this.me() });
    }
    if (now - this.lastSave > 4000) {
      this.lastSave = now;
      this.persist(this.save);
    }
  }

  private stepEntity(e: MEnt, now: number, upd: { id: number; [k: string]: unknown }[]): void {
    const v = e.v;
    // finish the step in progress
    if (v.nx !== undefined && v.ny !== undefined && now >= e.stepEnd) {
      v.x = v.nx;
      v.y = v.ny;
      v.nx = v.ny = v.step = undefined;
      if (e === this.self) {
        this.save.x = v.x;
        this.save.y = v.y;
      }
      if (!e.path.length) {
        v.state = 'idle';
        upd.push({ id: v.id, x: v.x, y: v.y, nx: v.x, ny: v.y, step: 0, state: 'idle' });
      }
    }
    if (v.nx === undefined && e.path.length) {
      if (this.combat && e === this.self) {
        e.path = [];
        return;
      }
      const next = e.path.shift()!;
      const sp = tileSpeed(this.world, next.x, next.y);
      if (sp <= 0) {
        e.path = [];
        return;
      }
      const ms = Math.round(STEP_MS / sp / (e === this.self ? 1 + this.save.stats.agility * 0.004 : 1));
      v.face = dirFromStep(next.x - v.x, next.y - v.y);
      v.nx = next.x;
      v.ny = next.y;
      v.step = ms;
      v.state = 'walk';
      e.stepEnd = now + ms;
      upd.push({ id: v.id, x: v.x, y: v.y, nx: next.x, ny: next.y, step: ms, face: v.face, state: 'walk' });
    }
  }

  // ---- movement + interaction ------------------------------------------------------------------------------------------
  private pathTo(x: number, y: number): boolean {
    const t = nearestWalkable(this.grid, x, y, 3);
    if (!t) return false;
    const sx = this.self.v.nx ?? Math.round(this.self.v.x);
    const sy = this.self.v.ny ?? Math.round(this.self.v.y);
    const p = findPath(this.grid, sx, sy, t.x, t.y);
    if (!p) return false;
    this.self.path = p;
    return true;
  }

  private dist(e: MEnt): number {
    return Math.hypot(e.v.x - this.self.v.x, e.v.y - this.self.v.y);
  }

  private interact(id: number): void {
    const e = this.ents.get(id);
    if (!e || e === this.self || e.respawnAt) return this.send({ t: 'err', code: 'bad_target', text: 'That is no longer there.' });
    if (this.combat && !this.combat.ended) return this.note('warn', 'You are in the middle of a fight.');
    if (this.save.hp <= 0) return;
    this.pendingInteract = { id, since: Date.now() };
    if (this.dist(e) > 1.6) this.pathTo(e.v.x, e.v.y);
  }

  private checkPendingInteract(now: number, upd: { id: number; [k: string]: unknown }[]): void {
    const p = this.pendingInteract!;
    const e = this.ents.get(p.id);
    if (!e || e.respawnAt || now - p.since > 20000) {
      this.pendingInteract = null;
      return;
    }
    if (this.dist(e) <= 1.6) {
      this.pendingInteract = null;
      this.self.path = [];
      this.execInteract(e, upd);
    } else if (!this.self.path.length && this.self.v.nx === undefined) {
      this.pathTo(e.v.x, e.v.y);
      if (!this.self.path.length) this.pendingInteract = null;
    }
  }

  private execInteract(e: MEnt, upd: { id: number; [k: string]: unknown }[]): void {
    switch (e.v.kind) {
      case 'npc':
        this.send({ t: 'npc', menu: this.npcMenu(e) });
        break;
      case 'monster':
        this.startCombat(e, upd);
        break;
      case 'node':
        this.gatherNode = e;
        this.gatherAt = Date.now() + 1600;
        this.self.v.state = 'work';
        upd.push({ id: 1, state: 'work' });
        break;
      default:
        break;
    }
  }

  private finishGather(upd: { id: number; [k: string]: unknown }[]): void {
    const node = this.gatherNode!;
    this.gatherNode = null;
    this.self.v.state = 'idle';
    upd.push({ id: 1, state: 'idle' });
    const item = node.v.nodeKind === 'ore' ? 'ore_iron' : node.v.nodeKind === 'rareHerb' ? 'herb_rare' : 'herb';
    const qty = 1 + (this.rng.next() < 0.4 ? 1 : 0);
    this.giveItem({ id: item, qty });
    this.note('good', `You gather ${qty} × ${getItem(item)!.name}.`);
    this.send({ t: 'fx', kind: 'gather', entity: 1 });
    this.progressMissions((m) => m.type === 'gather' && m.target.item === item, qty);
    node.respawnAt = Date.now() + 15000;
    this.send({ t: 'ents', del: [node.v.id] });
    this.markMe();
  }

  // ---- combat -----------------------------------------------------------------------------------------------------------------
  private startCombat(m: MEnt, upd: { id: number; [k: string]: unknown }[]): void {
    const def = m.def!;
    const player = buildPlayerCombatant(this.save, 1, 0, Date.now());
    const foe = buildMonsterCombatant(def, m.level ?? 1, m.v.id, 1);
    foe.hp = Math.min(foe.maxHp, m.v.hp ?? foe.maxHp);
    const state: CombatState = { combatants: [player, foe], beat: 0 };
    this.combat = { id: this.combatSeq++, state, monster: m, nextBeat: Date.now() + 900, fleeing: false, ended: false };
    this.self.path = [];
    this.self.v.state = 'fight';
    this.self.v.combatId = this.combat.id;
    m.v.state = 'fight';
    m.v.combatId = this.combat.id;
    m.path = [];
    upd.push({ id: 1, state: 'fight', combatId: this.combat.id }, { id: m.v.id, state: 'fight', combatId: this.combat.id });
    this.sendCombat([]);
    this.markMe();
  }

  private fighterViews(): FighterView[] {
    return this.combat!.state.combatants.map((c) => ({
      id: c.id,
      name: c.name,
      side: c.side,
      lv: c.level,
      hp: Math.round(c.hp),
      maxHp: Math.round(c.maxHp),
      qi: Math.round(c.qi),
      maxQi: Math.round(c.maxQi),
      status: c.status.map((s) => s.kind),
      player: c.isPlayer,
      alive: c.alive,
      fled: c.fled,
    }));
  }

  private sendCombat(ev: CombatEvent[]): void {
    const c = this.combat!;
    this.send({ t: 'combat', c: { id: c.id, beat: c.state.beat, fighters: this.fighterViews(), x: this.self.v.x, y: this.self.v.y, duel: false }, ev });
    this.send({ t: 'cfx', ev });
  }

  private combatBeat(now: number, upd: { id: number; [k: string]: unknown }[]): void {
    const c = this.combat!;
    if (c.ended) return;
    const player = c.state.combatants[0];
    const foe = c.state.combatants[1];
    if (c.fleeing) {
      player.tactics = [{ cond: { k: 'always' }, act: { k: 'flee' } }, ...this.save.tactics];
      c.fleeing = false;
    } else player.tactics = this.save.tactics;
    const ev = stepBeat(c.state, this.rng);
    c.nextBeat = now + 1000;
    this.syncFromCombat(player, foe, upd);
    this.sendCombat(ev);
    if (player.fled) return this.finishCombat('fled', upd);
    if (isOver(c.state)) {
      const w = winner(c.state);
      this.finishCombat(w === 0 ? 'win' : w === 1 ? 'lose' : 'draw', upd);
    } else if (c.state.beat >= 80) this.finishCombat('draw', upd);
  }

  private syncFromCombat(player: Combatant, foe: Combatant, upd: { id: number; [k: string]: unknown }[]): void {
    this.save.hp = Math.max(0, Math.round(player.hp));
    this.save.qi = Math.max(0, Math.round(player.qi));
    this.self.v.hp = this.save.hp;
    const m = this.combat!.monster;
    m.v.hp = Math.max(0, Math.round(foe.hp));
    upd.push({ id: 1, hp: this.save.hp }, { id: m.v.id, hp: m.v.hp });
    this.markMe();
  }

  private finishCombat(result: 'win' | 'lose' | 'fled' | 'draw', upd: { id: number; [k: string]: unknown }[]): void {
    const c = this.combat!;
    c.ended = true;
    const m = c.monster;
    const def = m.def!;
    this.self.v.combatId = undefined;
    m.v.combatId = undefined;
    let reward: { xp: number; gold: number; items: ItemStack[] } | undefined;
    let text = '';
    if (result === 'win') {
      const st = monsterStats(def, m.level ?? 1);
      const gold = this.rng.int(st.gold[0], st.gold[1]);
      const items: ItemStack[] = [];
      for (const l of def.loot) if (this.rng.next() < l.chance) items.push({ id: l.item, qty: this.rng.int(l.min, l.max) });
      reward = { xp: st.xp, gold, items };
      text = `${def.name} falls.`;
      this.gainXp(st.xp);
      this.save.gold += gold;
      for (const it of items) this.giveItem(it);
      this.save.kills++;
      this.progressMissions((mm) => (mm.type === 'hunt' || mm.type === 'bounty' || mm.type === 'purify') && mm.target.monster === def.id, 1);
      m.v.state = 'dead';
      m.respawnAt = Date.now() + 14000;
      upd.push({ id: m.v.id, state: 'dead', hp: 0, combatId: null as never });
      this.send({ t: 'fx', kind: 'loot', entity: 1 });
      this.self.v.state = 'idle';
      setTimeout(() => this.send({ t: 'ents', del: [m.v.id] }), 1400);
    } else if (result === 'lose') {
      text = `${def.name} has defeated you.`;
      this.save.deaths++;
      this.save.hp = 0;
      this.self.v.state = 'dead';
      this.self.v.hp = 0;
      m.v.state = 'idle';
      this.deathAt = Date.now() + 6500;
      upd.push({ id: 1, state: 'dead', hp: 0 });
      this.send({ t: 'fx', kind: 'death', entity: 1 });
    } else {
      text = result === 'fled' ? 'You slip away from the fight.' : 'Both sides draw back, exhausted.';
      this.self.v.state = 'idle';
      m.v.state = 'idle';
    }
    upd.push({ id: 1, state: this.self.v.state, combatId: null as never }, { id: m.v.id, state: m.v.state === 'dead' ? 'dead' : m.v.state, combatId: null as never });
    this.send({ t: 'cend', id: c.id, result, reward, text });
    this.combat = null;
    this.markMe();
  }

  private respawnSelf(upd: { id: number; [k: string]: unknown }[]): void {
    this.deathAt = 0;
    const town = this.world.settlements.find((s) => s.id === this.save.lastTown) ?? this.world.settlements[0];
    const p = this.walkableNear(town.spawn.x, town.spawn.y, 4);
    const loss = Math.floor(this.save.gold * 0.1);
    this.save.gold -= loss;
    this.save.x = p.x;
    this.save.y = p.y;
    this.save.hp = Math.round(this.maxHp() * 0.6);
    this.save.injuryUntil = Date.now() + 10 * 60_000;
    this.save.injuryStacks = Math.min(5, this.save.injuryStacks + 1);
    Object.assign(this.self.v, { x: p.x, y: p.y, state: 'idle', hp: this.save.hp, nx: undefined, ny: undefined, step: undefined });
    this.self.path = [];
    upd.push({ id: 1, x: p.x, y: p.y, state: 'idle', hp: this.save.hp });
    this.note('warn', `You wake at ${town.name}, injured. You lost ${loss} gold.`);
    this.markMe();
  }

  // ---- progression -----------------------------------------------------------------------------------------------------------------
  private gainXp(n: number): void {
    const s = this.save;
    s.xp += n;
    let leveled = false;
    while (s.xp >= xpToNext(s.level) && !isBreakthroughLevel(s.level) && s.level < 45) {
      s.xp -= xpToNext(s.level);
      s.level++;
      s.statPoints += statPointsForLevel(s.level);
      leveled = true;
    }
    if (isBreakthroughLevel(s.level)) s.xp = Math.min(s.xp, xpToNext(s.level));
    this.self.v.lv = s.level;
    this.self.v.rank = rankOf(s.level);
    this.self.v.maxHp = this.maxHp();
    if (leveled) {
      this.note('good', `Your cultivation deepens. You reach level ${s.level}.`);
      this.send({ t: 'fx', kind: 'levelup', entity: 1 });
      s.hp = this.maxHp();
      s.qi = deriveForCharacter(s).maxQi;
    }
    this.markMe();
  }

  private giveItem(it: ItemStack): boolean {
    const def = getItem(it.id);
    if (!def) return false;
    const inv = this.save.inventory;
    if (!isEquipment(def)) {
      const ex = inv.find((s) => s.id === it.id && s.qty < def.stack);
      if (ex) {
        const add = Math.min(def.stack - ex.qty, it.qty);
        ex.qty += add;
        if (it.qty > add) return this.giveItem({ ...it, qty: it.qty - add });
        return true;
      }
    }
    if (inv.length >= INVENTORY_SLOTS) {
      this.note('warn', 'Your pack is full.');
      return false;
    }
    inv.push({ ...it, uid: isEquipment(def) ? it.uid ?? `u${this.nextEntId++}` : undefined });
    return true;
  }

  private takeItem(idx: number, id: string, qty: number): ItemStack | null {
    const inv = this.save.inventory;
    const st = inv[idx];
    if (!st || st.id !== id || qty < 1 || st.qty < qty) return null;
    const out = { ...st, qty };
    st.qty -= qty;
    if (st.qty <= 0) inv.splice(idx, 1);
    return out;
  }

  private progressMissions(match: (m: ActiveMission) => boolean, n: number): void {
    for (const m of this.save.missions) {
      if (m.done || !match(m)) continue;
      m.progress = Math.min(m.target.count, m.progress + n);
      if (m.progress >= m.target.count) {
        m.done = true;
        this.note('good', `Mission ready to turn in: ${m.title}`);
      }
      this.send({ t: 'mission', update: JSON.parse(JSON.stringify(m)) as ActiveMission });
    }
  }

  // ---- NPC menus ---------------------------------------------------------------------------------------------------------------------------
  private entry(id: string, mult = 1.25, stock: number | null = null): ShopEntry {
    const def = getItem(id)!;
    return { id, price: Math.max(1, Math.round(def.value * mult)), stock };
  }

  private teachList(master: MEnt): TeachEntry[] {
    const rank = rankOf(this.save.level);
    const d = deriveForCharacter(this.save);
    const ids = Object.values(SKILLS).filter((s) => s.req.rank <= 3).map((s) => s.id);
    void master;
    return ids.map((id) => {
      const s = SKILLS[id];
      const learned = !!this.save.skills[id];
      let reason: string | undefined;
      if (rank < s.req.rank) reason = `Requires ${['Third-Rate', 'Second-Rate', 'First-Rate'][s.req.rank - 1] ?? 'higher'} rank.`;
      for (const [k, v] of Object.entries(s.req.stats ?? {})) if (!reason && d.total[k as keyof typeof d.total] < (v as number)) reason = `Requires ${k} ${v}.`;
      return { skill: id, gold: s.req.gold, learned, ok: !reason, reason };
    });
  }

  private npcMenu(e: MEnt): NpcMenu {
    const info = e.npc!;
    const sid = this.world.settlements.find((s) => s.id === this.save.lastTown)?.id ?? 0;
    refreshCollect(this.save);
    const turnIns = ['elder', 'guard', 'master', 'merchant'].includes(info.role) ? this.save.missions.filter((m) => m.done && (m.type === 'deliver' && m.target.toSettlement !== undefined ? m.target.toSettlement : m.settlementId) === sid).map((m) => m.id) : [];
    const menu: NpcMenu = { id: e.v.id, name: e.v.name, role: info.role, title: info.title, faction: info.faction, settlementId: sid, look: e.v.look!, level: info.level, greeting: info.greeting, turnIns };
    switch (info.role) {
      case 'merchant':
        menu.shop = { sellMult: 0.5, entries: [this.entry('pill_heal_s', 1.1), this.entry('pill_qi_s', 1.1), this.entry('cooked_meat'), this.entry('antidote'), this.entry('cloth'), this.entry('a_agility_1', 1.5, 3), this.entry('a_fortune_1', 1.5, 2), this.entry('wine')] };
        break;
      case 'smith':
        menu.shop = { sellMult: 0.55, entries: [this.entry('w_sword_1', 1.2, 4), this.entry('w_blade_1', 1.2, 4), this.entry('w_spear_1', 1.2, 4), this.entry('w_staff_1', 1.2, 4), this.entry('w_fist_1', 1.2, 4), this.entry('w_sword_2', 1.3, 2), this.entry('o_1', 1.2, 5), this.entry('o_2', 1.3, 2), this.entry('ingot_iron')] };
        break;
      case 'alchemist':
        menu.shop = { sellMult: 0.5, entries: [this.entry('pill_heal_s', 1.2), this.entry('pill_heal_m', 1.2), this.entry('pill_qi_m', 1.2), this.entry('antidote'), this.entry('pill_break_1', 1.3, 2), this.entry('pill_train', 1.3, 3), this.entry('herb', 1.6)] };
        break;
      case 'innkeeper':
        menu.restPrice = mockRestPrice(this.save.level);
        menu.shop = { sellMult: 0.4, entries: [this.entry('cooked_meat', 1.2), this.entry('wine', 1.2)] };
        break;
      case 'master': {
        menu.teaches = this.teachList(e);
        const rank = rankOf(this.save.level);
        menu.disciple = { ok: rank >= 2, reason: rank >= 2 ? undefined : 'Reach Second-Rate before asking to become a disciple.', already: false };
        break;
      }
      default:
        break;
    }
    this.addTalk(menu, e);
    return menu;
  }

  /** Mock of the rule-based talk system: real shared dialogue library, fake situation. */
  private mockTraits(name: string): DlgTrait[] {
    const h = strHash(name);
    return [DLG_TRAITS[h % DLG_TRAITS.length], DLG_TRAITS[(h >>> 7) % DLG_TRAITS.length]].filter((t, i, a) => a.indexOf(t) === i);
  }

  private talkInput(e: MEnt, topic: DlgInput['topic'], seed: number): DlgInput {
    const info = e.npc!;
    const town = this.world.settlements.find((s) => s.id === this.save.lastTown) ?? this.world.settlements[0];
    const st = ['unknown', 'noted', 'welcomed', 'honoured', 'feared', 'despised'] as const;
    const standing = st[Math.min(st.length - 1, Math.floor(this.save.completedMissions / 2))] ?? 'unknown';
    return {
      topic,
      seed,
      hour: Math.floor(Date.now() / 60000),
      role: info.role,
      traits: this.mockTraits(e.v.name),
      weather: 'clear',
      time: 'day',
      season: 'spring',
      states: ['calm'],
      standing: standing === 'unknown' ? 'unknown' : standing,
      moods: ['content'],
      deeds: this.save.kills > 3 ? [{ kind: 'killedBandits', weight: 3, ageHours: 30 }] : [],
      slots: { player: this.save.name, npc: e.v.name, settlement: town.name, kind: town.kind, rank: 'Third-Rate', trade: 'grain', price: 'fair', ...(info.title ? { title: info.title } : {}) },
    };
  }

  private addTalk(menu: NpcMenu, e: MEnt): void {
    const traits = this.mockTraits(e.v.name);
    menu.greeting = composeLine(this.talkInput(e, 'greet', e.v.id * 7 + Math.floor(Date.now() / 20000)))?.text ?? menu.greeting;
    menu.talk = {
      topics: [
        { id: 'news', label: 'Any news?' },
        { id: 'town', label: 'How is the town?' },
        { id: 'folk', label: 'Who lives here?' },
        { id: 'me', label: 'What do you think of me?' },
        { id: 'blight', label: 'About the Blight' },
        { id: 'work', label: 'About your work' },
      ],
      mood: traits.join(', '),
      traits,
    };
    menu.standing = this.talkInput(e, 'greet', 0).standing;
  }

  private talkAnswer(id: number, topic: string): { lines: string[] } {
    const e = this.ents.get(id);
    if (!e?.npc) throw new MockRefusal('not_found', 'There is nobody there.');
    if (!['news', 'town', 'folk', 'me', 'blight', 'work'].includes(topic)) throw new MockRefusal('bad_topic', 'They do not understand the question.');
    const seed = e.v.id * 31 + (this.talkCount = (this.talkCount ?? 0) + 1);
    const kinds: DlgRumorKind[] = ['fell', 'siege', 'famine', 'heartSealed', 'war', 'legendSeen'];
    const other = this.world.settlements[(id + 1) % this.world.settlements.length];
    const lines: string[] = [];
    if (topic === 'news') {
      for (let i = 0; i < 2; i++) {
        const kind = kinds[(seed + i * 2) % kinds.length];
        const truth = [0.9, 0.55, 0.25][(seed + i) % 3];
        const inp = this.talkInput(e, 'rumor', seed + i);
        inp.rumor = { kind, truth, about: 'other', slots: { 'rumor.place': other.name, 'rumor.who': 'Seo Mugyeom', 'rumor.faction': 'the Azure Cloud Sect', 'rumor.faction2': 'the Black Wind Bandits', 'rumor.age': 'two days ago', 'rumor.n': 'a dozen or so' } };
        const out = composeLine(inp);
        if (out) lines.push(out.text);
      }
    }
    if (lines.length === 0) lines.push(composeLine(this.talkInput(e, topic as DlgInput['topic'], seed))?.text ?? 'They shrug.');
    return { lines };
  }

  // ---- command handling ------------------------------------------------------------------------------------------------------------------
  handle(msg: C2S): void {
    switch (msg.t) {
      case 'ping':
        return this.send({ t: 'pong', t0: msg.t0, now: Date.now() });
      case 'q':
        return this.query(msg.id, msg.name, msg.args);
      case 'move': {
        if (this.combat) return this.note('warn', 'You cannot walk away from a fight - try fleeing.');
        if (this.save.hp <= 0) return;
        this.pendingInteract = null;
        this.gatherNode = null;
        if (!this.pathTo(msg.x, msg.y)) this.note('warn', 'There is no way to get there.');
        else this.pb.interrupt();
        return;
      }
      case 'stop':
        this.self.path = [];
        this.pendingInteract = null;
        return;
      case 'interact':
        return this.interact(msg.id);
      case 'assist':
        return this.note('info', 'There is nobody to assist.');
      case 'flee':
        if (this.combat) this.combat.fleeing = true;
        return;
      case 'alloc': {
        const n = Math.max(1, Math.min(msg.n, this.save.statPoints));
        if (this.save.statPoints < 1) return;
        this.save.stats[msg.stat] += n;
        this.save.statPoints -= n;
        this.self.v.maxHp = this.maxHp();
        return this.markMe();
      }
      case 'equip':
        return this.equip(msg.idx, msg.id);
      case 'unequip': {
        const st = this.save.equipment[msg.slot];
        if (!st) return;
        if (this.save.inventory.length >= INVENTORY_SLOTS) return this.note('warn', 'Your pack is full.');
        this.save.equipment[msg.slot] = null;
        this.save.inventory.push(st);
        this.refreshWeapon();
        return this.markMe();
      }
      case 'use':
        return this.use(msg.idx, msg.id);
      case 'drop': {
        if (this.takeItem(msg.idx, msg.id, msg.qty)) this.markMe();
        return;
      }
      case 'build': {
        if (this.combat && !this.combat.ended) return this.refuse(new MockRefusal('in_combat', 'You cannot do that while fighting.'));
        if (this.save.hp <= 0) return this.refuse(new MockRefusal('dead', 'You are dead.'));
        try {
          const b = checkBuild(this.save, msg);
          this.save.loadout = b.loadout;
          this.save.stance = b.stance;
          this.save.tactics = b.tactics;
        } catch (e) {
          return this.refuse(e);
        }
        return this.markMe();
      }
      case 'breakthrough':
        return this.breakthrough();
      case 'buy':
        return this.buy(msg.npc, msg.item, msg.qty);
      case 'sell':
        return this.sell(msg.npc, msg.idx, msg.id, msg.qty);
      case 'learn':
        return this.learn(msg.npc, msg.skill);
      case 'rest': {
        const e = this.ents.get(msg.npc);
        const price = mockRestPrice(this.save.level);
        if (!e?.npc || e.npc.role !== 'innkeeper') return this.refuse(new MockRefusal('not_innkeeper', 'They do not rent rooms.'));
        const injured = this.save.injuryStacks > 0 && this.save.injuryUntil > Date.now();
        if (!injured && this.save.hp >= this.maxHp() && this.save.qi >= deriveForCharacter(this.save).maxQi) return this.refuse(new MockRefusal('not_needed', 'You are already fully rested.'));
        if (this.save.gold < price) return this.refuse(new MockRefusal('no_gold', `A room costs ${price} gold.`));
        this.save.gold -= price;
        this.save.injuryUntil = 0;
        this.save.injuryStacks = 0;
        this.save.hp = this.maxHp();
        this.save.qi = deriveForCharacter(this.save).maxQi;
        this.self.v.hp = this.save.hp;
        this.send({ t: 'fx', kind: 'heal', entity: 1 });
        this.note('good', 'You sleep soundly and wake fully restored.');
        return this.markMe();
      }
      case 'maccept': {
        const board = this.boards.get(msg.settlement);
        const offer = board?.find((o) => o.id === msg.offer);
        try {
          if (!nearBoard(this.world.settlements.find((s) => s.id === msg.settlement), this.self.v, ACCEPT_MARGIN)) throw new MockRefusal('too_far', 'You are too far from the board.');
          checkAccept(this.save, offer);
        } catch (e) {
          return this.refuse(e);
        }
        if (board) this.boards.set(msg.settlement, board.filter((o) => o.id !== offer!.id));
        const am: ActiveMission = { ...JSON.parse(JSON.stringify(offer)), progress: 0, acceptedDay: this.time().day, done: false };
        this.save.missions.push(am);
        this.send({ t: 'mission', update: am });
        this.note('good', `Mission accepted: ${offer!.title}`);
        this.collectCheck();
        return this.markMe();
      }
      case 'mabandon': {
        const gone = this.save.missions.find((m) => m.id === msg.id);
        // Like the real server: no `mission` message, the mission is simply absent from the next `me`; the offer returns to the board.
        if (gone) this.boards.set(gone.settlementId, [...(this.boards.get(gone.settlementId) ?? []), offerOf(gone)]);
        this.save.missions = this.save.missions.filter((m) => m.id !== msg.id);
        return this.markMe();
      }
      case 'mturnin': {
        const m = this.save.missions.find((x) => x.id === msg.id);
        const taker = this.ents.get(msg.npc ?? -1);
        try {
          checkTurnIn(this.save, m, taker?.npc && this.dist(taker) <= 6 ? { role: taker.npc.role, settlementId: this.settlementOf(taker) } : undefined);
        } catch (e) {
          return this.refuse(e);
        }
        if (m.type === 'gather' || m.type === 'deliver') takeGoods(this.save, m.target.item!, m.target.count);
        this.save.missions = this.save.missions.filter((x) => x.id !== msg.id);
        this.save.completedMissions++;
        this.save.gold += m.reward.gold;
        for (const it of m.reward.items ?? []) this.giveItem({ ...it });
        if (m.reward.rep) this.save.reputation[m.reward.rep.faction] = Math.min(100, (this.save.reputation[m.reward.rep.faction] ?? 0) + m.reward.rep.amount);
        this.gainXp(m.reward.xp);
        this.note('good', `Mission complete: ${m.title} (+${m.reward.xp} XP, +${m.reward.gold} gold)`);
        return this.markMe();
      }
      case 'astart':
      case 'astop':
        return this.pb.handle(msg);
      case 'chat':
        return this.chat(msg.ch, msg.text, msg.to);
      case 'friend':
      case 'sect':
      case 'master':
      case 'duel':
        return this.pb.handle(msg);
      case 'title':
        this.save.title = msg.title.slice(0, 24);
        return this.markMe();
    }
  }

  private refreshWeapon(): void {
    this.self.v.weapon = getItem(this.save.equipment.weapon?.id ?? '')?.weaponType;
    this.send({ t: 'ents', upd: [{ id: 1, weapon: this.self.v.weapon }] });
    this.self.v.maxHp = this.maxHp();
  }

  private equip(idx: number, id: string): void {
    const st = this.save.inventory[idx];
    const def = st ? getItem(st.id) : undefined;
    if (!st || st.id !== id || !def?.slot) return;
    const slot: EquipSlot = def.slot;
    const prev = this.save.equipment[slot];
    this.save.inventory.splice(idx, 1);
    if (prev) this.save.inventory.splice(idx, 0, prev);
    this.save.equipment[slot] = st;
    this.refreshWeapon();
    this.markMe();
  }

  private use(idx: number, id: string): void {
    const st = this.save.inventory[idx];
    const def = st ? getItem(st.id) : undefined;
    if (!st || st.id !== id || !def?.use) return;
    const u = def.use;
    if (u.breakthrough) return this.note('info', 'Use the Breakthrough option in the Character panel.');
    if (u.teach) {
      if (this.save.skills[u.teach]) return this.note('warn', 'You already know this art.');
      this.save.skills[u.teach] = { lv: 1, xp: 0 };
      this.note('good', `You study the manual and learn ${getSkill(u.teach)?.name}.`);
      this.send({ t: 'fx', kind: 'learn', entity: 1 });
    }
    if (u.heal) this.save.hp = Math.min(this.maxHp(), this.save.hp + u.heal);
    if (u.qi) this.save.qi = Math.min(deriveForCharacter(this.save).maxQi, this.save.qi + u.qi);
    if (u.xp) this.gainXp(u.xp);
    this.self.v.hp = this.save.hp;
    this.send({ t: 'ents', upd: [{ id: 1, hp: this.save.hp }] });
    this.takeItem(idx, id, 1);
    if (u.heal) this.send({ t: 'fx', kind: 'heal', entity: 1 });
    this.markMe();
  }

  private breakthrough(): void {
    const s = this.save;
    const rank = rankOf(s.level);
    const req = BREAKTHROUGHS[rank];
    if (!isBreakthroughLevel(s.level) || !req) return this.note('warn', 'You are not ready to break through.');
    if (s.xp < xpToNext(s.level)) return this.note('warn', 'Your cultivation is not complete.');
    const pillIdx = s.inventory.findIndex((i) => i.id === req.pill);
    if (pillIdx < 0) return this.note('warn', 'You need the right pill.');
    if (s.gold < req.gold) return this.note('warn', 'You cannot afford the offering.');
    this.takeItem(pillIdx, req.pill, 1);
    s.gold -= req.gold;
    const d = deriveForCharacter(s);
    if (this.rng.next() < breakthroughChance(rank, d.total.spirit, d.total.insight)) {
      s.level++;
      s.xp = 0;
      s.statPoints += statPointsForLevel(s.level);
      this.self.v.lv = s.level;
      this.self.v.rank = rankOf(s.level);
      this.self.v.maxHp = this.maxHp();
      s.hp = this.maxHp();
      this.note('good', `Breakthrough! You ascend to ${['', 'Second-Rate', 'First-Rate', 'Peak', 'Transcendent'][rank] ?? 'a new realm'}.`);
      this.send({ t: 'fx', kind: 'breakthrough', entity: 1 });
    } else {
      s.xp = Math.floor(s.xp * 0.6);
      s.injuryUntil = Date.now() + 10 * 60_000;
      s.injuryStacks = Math.min(5, s.injuryStacks + 1);
      this.note('bad', 'Qi deviation! The breakthrough fails and you are injured.');
    }
    this.markMe();
  }

  private shopOf(npcId: number): { e: MEnt; menu: NpcMenu } | null {
    const e = this.ents.get(npcId);
    if (!e?.npc) return null;
    return { e, menu: this.npcMenu(e) };
  }

  private buy(npcId: number, item: string, qty: number): void {
    const s = this.shopOf(npcId);
    const entry = s?.menu.shop?.entries.find((x) => x.id === item);
    if (!s || !entry || qty < 1) return this.note('warn', 'They do not sell that.');
    const cost = entry.price * qty;
    if (this.save.gold < cost) return this.note('warn', 'You cannot afford that.');
    const def = getItem(item)!;
    const stack: ItemStack = isEquipment(def) ? { id: item, qty: 1, r: 0 } : { id: item, qty };
    const times = isEquipment(def) ? qty : 1;
    for (let i = 0; i < times; i++) if (!this.giveItem({ ...stack })) return this.markMe();
    this.save.gold -= cost;
    this.note('good', `You buy ${qty} × ${def.name} for ${cost} gold.`);
    this.markMe();
  }

  private sell(npcId: number, idx: number, id: string, qty: number): void {
    const s = this.shopOf(npcId);
    if (!s?.menu.shop) return;
    const st = this.save.inventory[idx];
    if (!st) return;
    const unit = Math.max(1, Math.floor(stackValue(st) * s.menu.shop.sellMult));
    const taken = this.takeItem(idx, id, qty);
    if (!taken) return;
    this.save.gold += unit * taken.qty;
    this.note('good', `You sell ${taken.qty} × ${getItem(id)?.name} for ${unit * taken.qty} gold.`);
    this.markMe();
  }

  private learn(npcId: number, skill: string): void {
    const s = this.shopOf(npcId);
    const entry = s?.menu.teaches?.find((x) => x.skill === skill);
    if (!s || !entry || entry.learned) return;
    if (!entry.ok) return this.note('warn', entry.reason ?? 'You are not ready for this art.');
    if (this.save.gold < entry.gold) return this.note('warn', 'You cannot afford the tuition.');
    this.save.gold -= entry.gold;
    this.save.skills[skill] = { lv: 1, xp: 0 };
    this.note('good', `${s.e.v.name} teaches you ${getSkill(skill)?.name}.`);
    this.send({ t: 'fx', kind: 'learn', entity: 1 });
    this.markMe();
  }

  private chat(ch: Exclude<ChatChannel, 'system'>, text: string, to?: string): void {
    const now = Date.now();
    const base = { from: this.save.name, fromId: 1, text, t: now, tag: this.tag || undefined };
    if (ch === 'sect') return this.send({ t: 'err', code: 'no_sect', text: 'You are not in a sect.' });
    if (ch === 'whisper') {
      const target = [...this.ents.values()].find((e) => e.v.kind === 'player' && e.v.name.toLowerCase() === (to ?? '').toLowerCase());
      if (!target) return this.send({ t: 'err', code: 'no_player', text: `No player named "${to}" is online.` });
      this.send({ t: 'chat', msg: { ...base, ch, to: target.v.name } });
      setTimeout(() => this.send({ t: 'chat', msg: { ch: 'whisper', from: target.v.name, fromId: target.v.id, text: 'Hello! Sorry, I am busy right now - find me in the village later.', t: Date.now(), to: this.save.name } }), 1500);
      return;
    }
    this.send({ t: 'chat', msg: { ...base, ch } });
    if (ch === 'local' && /hello|hi\b/i.test(text)) {
      const bot = [...this.ents.values()].find((e) => e.bot);
      if (bot) setTimeout(() => this.send({ t: 'chat', msg: { ch: 'local', from: bot.v.name, fromId: bot.v.id, text: 'Greetings, traveller!', t: Date.now() } }), 1200);
    }
  }

  // ---- queries ---------------------------------------------------------------------------------------------------------------------------
  private query(id: number, name: QueryName, args: Queries[QueryName]['args']): void {
    try {
      const data = this.answer(name, args as never);
      this.send({ t: 'res', id, ok: true, data });
    } catch (e) {
      if (e instanceof MockRefusal) this.send({ t: 'res', id, ok: false, err: e.code, data: { text: e.text } });
      else this.send({ t: 'res', id, ok: false, err: e instanceof Error ? e.message : 'failed' });
    }
  }

  private profileOf(e: MEnt): PublicProfile {
    const isSelf = e === this.self;
    const save = this.save;
    const stats = isSelf ? save.stats : { might: 12, agility: 14, vitality: 11, spirit: 9, insight: 8, fortune: 7 };
    return {
      id: isSelf ? save.id : e.v.id,
      name: e.v.name,
      level: e.v.lv ?? 1,
      look: e.v.look ?? save.look,
      title: isSelf ? save.title : 'Wandering Blade',
      sect: e.v.tag ?? null,
      kills: isSelf ? save.kills : 44,
      deaths: isSelf ? save.deaths : 3,
      equipment: isSelf ? save.equipment : { weapon: { id: 'w_sword_2', qty: 1, r: 2, aff: [['might', 2]] }, outfit: { id: 'o_2', qty: 1, r: 1 }, accessory: null },
      stats,
      rank: rankOf(e.v.lv ?? 1),
    };
  }

  private answer<N extends QueryName>(name: N, args: Queries[N]['args']): Queries[N]['res'] {
    const a = args as Record<string, unknown>;
    const fromPb = this.pb.answer(name, args);
    if (fromPb !== undefined) return fromPb;
    switch (name) {
      case 'npc': {
        const e = this.ents.get(a.id as number);
        if (!e?.npc) throw new Error('no such npc');
        return this.npcMenu(e) as Queries[N]['res'];
      }
      case 'npcTalk':
        return this.talkAnswer(a.id as number, a.topic as string) as Queries[N]['res'];
      case 'board': {
        const sid = a.settlement as number;
        const st = this.world.settlements.find((x) => x.id === sid);
        if (!st) throw new MockRefusal('not_found', 'There is no such settlement.');
        if (!nearBoard(st, this.self.v, BOARD_MARGIN)) throw new MockRefusal('too_far', `Walk closer to ${st.name} to read its board.`);
        return { offers: this.boards.get(sid) ?? [], settlement: this.settlements.find((s) => s.id === sid) ?? this.settlements[0] } as Queries[N]['res'];
      }
      case 'world':
        return {
          settlements: this.settlements,
          factions: FACTIONS.map((f, i) => ({ id: f.id, power: f.power + i, wealth: f.wealth, influence: 40 + i * 7, atWarWith: f.id === 'crimson' ? ['azure'] : [], alliedWith: f.id === 'tiger' ? ['azure'] : [], settlements: this.world.settlements.filter((_, k) => k % FACTIONS.length === i).map((s) => s.id), goal: 'Expand influence' })),
          chronicle: this.chronicle,
          hearts: [{ id: 1, x: Math.round(this.world.w * 0.78), y: Math.round(this.world.h * 0.3), strength: 72 }],
          time: this.time(),
          online: 3,
        } as Queries[N]['res'];
      case 'chronicle': {
        const before = (a.before as number | undefined) ?? Infinity;
        return this.chronicle.filter((c) => c.id < before).slice(-((a.limit as number | undefined) ?? 30)) as Queries[N]['res'];
      }
      case 'sites': {
        const s = this.world.settlements.find((x) => x.id === a.settlement);
        const jobBy: Record<string, string | undefined> = { herbHut: 'herbalist', mine: 'miner', farm: 'farmer', smithy: 'blacksmith', alchemyLab: 'alchemist' };
        return (s?.sites ?? []).map((x) => ({ id: x.id, kind: x.kind, x: x.x, y: x.y, settlementId: x.settlementId, job: jobBy[x.kind], trainBonus: x.kind === 'dojo' ? 1.5 : undefined })) as Queries[N]['res'];
      }
      case 'recipes': {
        const kind = String(a.site).includes('smith') ? 'blacksmith' : 'alchemist';
        return RECIPE_LIST.filter((r) => r.job === kind).map((r) => {
          const lvOk = this.save.jobs[r.job].lv >= r.level;
          const haveAll = r.inputs.every(([id, n]) => this.save.inventory.filter((i) => i.id === id).reduce((q, i) => q + i.qty, 0) >= n);
          return { id: r.id, name: r.name, job: r.job, level: r.level, inputs: r.inputs, output: r.output, seconds: r.seconds, canCraft: lvOk && haveAll, reason: !lvOk ? `Requires ${r.job} level ${r.level}` : !haveAll ? 'Missing materials' : undefined };
        }) as Queries[N]['res'];
      }
      case 'friends':
        return [
          { id: 3, name: 'Moon Lotus', level: 22, online: true, status: 'friend' },
          { id: 4, name: 'Iron Crane', level: 17, online: false, status: 'friend' },
        ] as Queries[N]['res'];
      case 'sect':
        return null as Queries[N]['res'];
      case 'sects':
        return [
          { id: 1, name: 'Azure Dawn Hall', tag: 'Dawn', level: 3, members: 12, motto: 'Light against the Blight.' },
          { id: 2, name: 'Iron Crane Society', tag: 'Crane', level: 2, members: 7, motto: 'Stand like the crane.' },
        ] as Queries[N]['res'];
      case 'player': {
        const nm = String(a.name ?? '').toLowerCase();
        const e = [...this.ents.values()].find((x) => x.v.kind === 'player' && (x.v.name.toLowerCase() === nm || x.v.id === a.id));
        return (e ? this.profileOf(e) : null) as Queries[N]['res'];
      }
      case 'leaderboard':
        return [
          { id: 3, name: 'Moon Lotus', level: 22, kills: 410, sect: 'Azure' },
          { id: 2, name: 'Wandering Sword', level: 14, kills: 188, sect: null },
          { id: this.save.id, name: this.save.name, level: this.save.level, kills: this.save.kills, sect: null },
        ] as Queries[N]['res'];
      case 'nearbyPlayers':
        return [...this.ents.values()].filter((e) => e.bot).map((e) => ({ id: e.v.id, name: e.v.name, level: e.v.lv ?? 1 })) as Queries[N]['res'];
      default:
        throw new Error('not_implemented');
    }
  }

  private refuse(e: unknown): void {
    if (e instanceof MockRefusal) this.send({ t: 'err', code: e.code, text: e.text });
    else throw e;
  }

  private settlementOf(e: MEnt): number {
    // All mock NPCs live in the home settlement.
    void e;
    return this.world.settlements.find((s) => s.id === this.save.lastTown)?.id ?? 0;
  }

  /** Gather / deliver progress follows the bag, like the real server's once-a-second poll. */
  private collectCheck(): void {
    for (const m of refreshCollect(this.save)) this.send({ t: 'mission', update: JSON.parse(JSON.stringify(m)) as ActiveMission });
  }

  // ---- dev hooks ---------------------------------------------------------------------------------------------------------------------------------
  /** Used by the debug console: `__mock.game.give('pill_break_1', 1)` etc. */
  debugGive(id: string, qty = 1): void {
    this.giveItem({ id, qty });
    this.markMe();
  }
  /** `__mock.game.debugLearn('sword_plum')` or `debugLearn('all')`: learn skills to exercise the Skills panel. */
  debugLearn(id: string): void {
    const ids = id === 'all' ? Object.keys(SKILLS) : [id];
    for (const k of ids) if (SKILLS[k] && !this.save.skills[k]) this.save.skills[k] = { lv: 1 + (k.length % 4), xp: 5 };
    this.markMe();
  }
  debugXp(n: number): void {
    this.gainXp(n);
  }
  debugGold(n: number): void {
    this.save.gold += n;
    this.markMe();
  }
  /** Pretend the running activity has been going on `ms` longer (e.g. `__mock.game.debugWarp(3600e3)`). */
  debugWarp(ms: number): void {
    this.pb.warp(ms);
  }
  debugHurt(): void {
    this.save.hp = 0;
    this.self.v.state = 'dead';
    this.deathAt = Date.now() + 6500;
    this.send({ t: 'ents', upd: [{ id: 1, state: 'dead', hp: 0 }] });
    this.markMe();
  }
}

