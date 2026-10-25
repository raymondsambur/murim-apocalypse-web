/**
 * NPC memory, gossip and talk (owner: npc-life-memory). See docs/notes/npc-life-memory.md.
 *
 *  - Towns and NPCs remember what players did (`npcmemory/memory.ts`), fed by the typed gameplay events.
 *  - Chronicle entries and notable deeds become rumors that spread between settlements (`npcmemory/rumors.ts`).
 *  - The NPC menu greeting, standing and "Talk" topics come from the handwritten dialogue library (`@murim/shared`).
 */
import { DLG_TOPICS, Rng, rankOf, type ChronicleEntry, type DlgTopic, type SimEvent } from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { makeSpreadEnv } from '../npcmemory/env';
import { setNpcMemory, type NpcMemoryApi, type RememberArgs } from '../npcmemory';
import { MEMORY_MIGRATIONS, MemoryStore, type MemoryKind } from '../npcmemory/memory';
import { buildNameIndex, parseChronicle } from '../npcmemory/parse';
import { RumorMill, type RumorFacts } from '../npcmemory/rumors';
import { greetingLine, moodLine, talkLines, talkStateOf, topicsFor, traitsOf, type TalkDeps } from '../npcmemory/talk';
import { NPCMEM, RUMOR, type Importance } from '../npcmemory/tuning';
import { MENU_RANGE, npcMenuDecorators } from './npcmenu';
import { distanceBetween } from './econ';
import { turnInSettlement } from './missions';
import { refusesService } from './shops';
import './events';

declare module '../ctx' {
  interface GameEvents {
    /** Emitted by the NPC life system when two NPCs chat (npc-life-routines). */
    npcChat: { a: number; b: number; settlementId: number };
  }
}

/** Deeds worth a rumor, and how important the rumor is. */
const RUMOR_WORTHY: Partial<Record<MemoryKind, Importance>> = {
  savedTown: 2,
  sectFounded: 2,
  rankUp: 2,
  purified: 1,
  killedBandits: 1,
  killedHollows: 1,
  deliveredGoods: 1,
  completedMission: 1,
  duelWon: 1,
  gift: 1,
  insult: 1,
};

export function register(ctx: GameContext): void {
  ctx.db.migrateModule('npcmemory', MEMORY_MIGRATIONS);
  const store = new MemoryStore(ctx.db);
  store.load();
  const mill = new RumorMill(ctx.db, new Rng(ctx.rng.int(1, 2 ** 31 - 1)));
  mill.load();
  const env = makeSpreadEnv(ctx);
  const names = buildNameIndex(ctx.world.settlements);
  const deps: TalkDeps = { ctx, memory: store, mill };
  const hourNow = (): number => ctx.sim.clock().totalHours;

  // ---- API ----------------------------------------------------------------------------------------

  function remember(args: RememberArgs, opts: { rumor?: boolean } = {}): void {
    const hour = hourNow();
    const res = store.remember({ subject: args.charId, kind: args.kind, place: args.place, magnitude: args.magnitude, npcId: args.npcId, atHour: hour });
    const importance = RUMOR_WORTHY[args.kind];
    if (!res.milestone || importance === undefined || opts.rumor === false) return;
    const p = ctx.players.byCharId(args.charId);
    if (!p) return;
    // Big rank-ups and large hauls travel further.
    const imp: Importance = args.kind === 'rankUp' && (args.magnitude ?? 1) < 3 ? 1 : res.total >= 30 && importance === 1 ? 2 : importance;
    const facts: RumorFacts = { kind: 'playerDeed', who: p.name, deed: args.kind as RumorFacts['deed'], place: args.place, n: Math.round(res.total), sev: 0 };
    mill.add({ topic: 'player', facts, importance: imp, subjectIds: [args.charId], origin: args.place, hour, truth: 0.92, key: `p:${p.name}:${args.kind}:${args.place}` }, env);
  }

  const api: NpcMemoryApi = {
    store,
    mill,
    env,
    remember: (args) => remember(args),
    townStanding: (sid, charId) => store.townStanding(sid, charId, hourNow()).standing,
    townStandingDetail: (sid, charId) => store.townStanding(sid, charId, hourNow()),
    recall: (npcId, charId) => store.recall(npcId, charId, hourNow()),
    greeting: (p, npc) => greetingLine(deps, p, npc),
    talk: (p, npc, topic) => talkLines(deps, p, npc, topic),
  };
  setNpcMemory(ctx, api);

  // ---- nearest settlement helpers -------------------------------------------------------------------

  function settlementNear(x: number, y: number, extra: number = NPCMEM.killRadiusExtra): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const s of ctx.world.settlements) {
      const d = Math.hypot(s.x - x, s.y - y) - s.radius;
      if (d <= extra && d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  // ---- memory sources -----------------------------------------------------------------------------------------

  /** Kills made during a siege, per settlement x player, to credit `savedTown` when the siege ends and the town stands. */
  const siegeKills = new Map<number, Map<number, number>>();

  const offs = [
    ctx.events.on('monsterKilled', (ev) => {
      const sid = ev.siege ?? settlementNear(ev.x, ev.y);
      if (sid === null || sid === undefined) return;
      const kind: MemoryKind | null = ev.family === 'bandit' ? 'killedBandits' : ev.family === 'blight' ? 'killedHollows' : null;
      if (!kind) return;
      const mag = (ev.elite === 2 ? 4 : ev.elite === 1 ? 2 : 1) * (ev.siege !== null ? 1.5 : 1);
      for (const p of ev.killers) {
        remember({ charId: p.charId, kind, place: sid, magnitude: mag });
        if (ev.siege !== null) {
          let m = siegeKills.get(ev.siege);
          if (!m) siegeKills.set(ev.siege, (m = new Map()));
          m.set(p.charId, (m.get(p.charId) ?? 0) + mag);
        }
      }
    }),
    ctx.events.on('missionCompleted', ({ player, mission }) => {
      const place = turnInSettlement(mission);
      const kind: MemoryKind = mission.type === 'deliver' ? 'deliveredGoods' : mission.type === 'purify' ? 'purified' : mission.type === 'defend' ? 'savedTown' : 'completedMission';
      const mag = mission.type === 'bounty' ? 2 : mission.type === 'defend' ? 1 : 1;
      remember({ charId: player.charId, kind, place, magnitude: mag, npcId: mission.giverId });
    }),
    ctx.events.on('playerLevelUp', ({ player, from, to }) => {
      const rank = rankOf(to);
      if (rank <= rankOf(from)) return;
      remember({ charId: player.charId, kind: 'rankUp', place: player.save.lastTown, magnitude: rank });
    }),
    ctx.events.on('playerDied', ({ player }) => {
      const sid = settlementNear(player.entity.x, player.entity.y, 8);
      if (sid !== null) remember({ charId: player.charId, kind: 'diedNearby', place: sid }, { rumor: false });
    }),
  ];
  // The routines engineer announces chats between NPCs; hearing it is optional.
  const bus = ctx.events as unknown as { on(type: string, h: (ev: { a: number; b: number; settlementId: number }) => void): () => void };
  offs.push(bus.on('npcChat', (ev) => void mill.chat(ev.a, ev.b, ev.settlementId, hourNow())));

  // ---- chronicle -> rumors ---------------------------------------------------------------------------------------

  function onChronicle(entry: ChronicleEntry, hour: number): void {
    const parsed = parseChronicle(entry, names);
    if (!parsed) return;
    if (entry.importance === 1 && !mill.rng.chance(RUMOR.minorChance)) return;
    const f = parsed.facts;
    let origin = f.place ?? entry.settlementId;
    if (origin === undefined) {
      // Political news starts in a settlement of the faction involved, else anywhere.
      const owned = ctx.world.settlements.filter((s) => f.faction && ctx.sim.settlementView(s.id).controller === f.faction);
      const pool = owned.length ? owned : ctx.world.settlements;
      origin = mill.rng.pick(pool).id;
    }
    let subjects: number[] = [];
    let key: string | undefined;
    if (parsed.topic === 'player' && f.who) {
      const p = ctx.players.byName(f.who);
      if (p) {
        subjects = [p.charId];
        if (f.kind === 'heartSealed') remember({ charId: p.charId, kind: 'sealedHeart', place: origin }, { rumor: false });
        else if (f.deed) store.remember({ subject: p.charId, kind: f.deed, place: origin, atHour: hour });
      }
      key = `p:${f.who}:${f.deed ?? f.kind}:${origin}`;
    }
    mill.add({ topic: parsed.topic, facts: { ...f, place: f.place ?? origin }, importance: entry.importance, subjectIds: subjects, origin, hour, key }, env);
  }

  function onSiegeEnd(sid: number): void {
    const kills = siegeKills.get(sid);
    siegeKills.delete(sid);
    if (!kills) return;
    let held = true;
    try {
      held = ctx.sim.settlementView(sid).status !== 'fallen';
    } catch {
      held = false;
    }
    if (!held) return;
    for (const [charId, n] of kills) if (n >= 3) remember({ charId, kind: 'savedTown', place: sid, magnitude: Math.min(4, n / 3) });
  }

  offs.push(
    ctx.onHour((events: SimEvent[]) => {
      const hour = hourNow();
      env.refresh();
      for (const ev of events) {
        if (ev.k === 'chron') onChronicle(ev.entry, hour);
        else if (ev.k === 'siege' && !ev.start) onSiegeEnd(ev.settlementId);
        else if (ev.k === 'siege' && ev.start) siegeKills.delete(ev.settlementId);
      }
      mill.stepHour(env, hour);
      if (hour % 24 === 0) {
        store.prune(hour);
        talkStateOf(deps).prune(hour);
      }
      store.flush();
      mill.flush();
    }),
  );

  offs.push(
    ctx.every(15_000, () => {
      store.flush();
    }),
  );
  ctx.onShutdown(() => {
    store.flush();
    mill.flush();
  });

  // ---- NPC menu and talk query -----------------------------------------------------------------------------------

  const decorate = (p: Player, npc: Parameters<(typeof npcMenuDecorators)[number]>[1], menu: Parameters<(typeof npcMenuDecorators)[number]>[2]): void => {
    // The decorator list is module-global; ignore calls for players of another context (several harnesses in one test file).
    if (ctx.players.byCharId(p.charId) !== p) return;
    const hour = hourNow();
    store.noteTalk(npc.id, p.charId, npc.settlementId, hour);
    menu.standing = store.townStanding(npc.settlementId, p.charId, hour).standing;
    if (menu.greeting === `${npc.name} turns away from you.`) return;
    menu.greeting = greetingLine(deps, p, npc);
    menu.talk = { topics: topicsFor(npc), mood: moodLine(npc), traits: traitsOf(npc) };
  };
  npcMenuDecorators.push(decorate);
  ctx.onShutdown(() => {
    const i = npcMenuDecorators.indexOf(decorate);
    if (i >= 0) npcMenuDecorators.splice(i, 1);
  });

  ctx.query('npcTalk', (p, args) => {
    const npc = Number.isInteger(args.id) ? ctx.sim.npc(args.id) : undefined;
    const ent = npc ? ctx.npcEntity(npc.id) : undefined;
    if (!npc || !npc.alive || !ent) throw new GameError('not_found', 'There is nobody there.');
    if (distanceBetween(p.entity, ent) > MENU_RANGE) throw new GameError('too_far', `Walk closer to ${npc.name} first.`);
    const topic = args.topic as DlgTopic;
    if (!(DLG_TOPICS as readonly string[]).includes(topic) || topic === 'greet') throw new GameError('bad_topic', `${npc.name} does not understand the question.`);
    if (refusesService(p.save, npc)) return { lines: [`${npc.name} turns away from you.`] };
    store.noteTalk(npc.id, p.charId, npc.settlementId, hourNow());
    return { lines: talkLines(deps, p, npc, topic) };
  });

  void offs;
}
