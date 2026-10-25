/**
 * Mock-server rules for the Skills & Build and Missions panels and the NPC dialog (dev only, used by MockGame).
 * They follow the real server's checks and error codes (docs/notes/gameplay-combat.md, gameplay-economy.md) so the UI
 * can be exercised with `?mock=1`: `build` validation, `board` range, `maccept` / `mabandon` / `mturnin`, `rest`.
 */
import {
  MAX_ACTIVE_MISSIONS,
  activeSlots,
  getItem,
  rankOf,
  sanitizeLoadout,
  type ActiveMission,
  type C2S,
  type CharacterSave,
  type Cond,
  type MissionOffer,
  type NpcRole,
  type SettlementDef,
  type TacticRule,
} from '@murim/shared';

/** A refusal in the real server's shape: a code and a player-visible sentence. */
export class MockRefusal extends Error {
  constructor(
    readonly code: string,
    readonly text: string,
  ) {
    super(text);
  }
}

const STANCES = ['aggressive', 'balanced', 'defensive', 'evasive'];

function pct(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
}

function condOk(c: Cond): boolean {
  switch (c.k) {
    case 'always':
    case 'targetBlighted':
      return true;
    case 'hpBelow':
    case 'qiBelow':
    case 'qiAbove':
    case 'enemyHpBelow':
      return pct(c.v);
    case 'enemiesAtLeast':
      return typeof c.v === 'number' && Number.isInteger(c.v) && c.v >= 1 && c.v <= 20;
    default:
      return false;
  }
}

/** Mirrors server `validateLoadout` + `validateTactics`; returns the cleaned build or throws a `bad_build` refusal. */
export function checkBuild(save: CharacterSave, msg: Extract<C2S, { t: 'build' }>): { loadout: CharacterSave['loadout']; stance: CharacterSave['stance']; tactics: TacticRule[] } {
  const bad = (text: string) => new MockRefusal('bad_build', text);
  if (!STANCES.includes(msg.stance)) throw bad('Unknown stance.');
  const slots = activeSlots(rankOf(save.level));
  const req = Array.isArray(msg.loadout?.active) ? msg.loadout.active : null;
  if (!req) throw bad('Invalid loadout.');
  if (req.slice(slots).some((s) => s)) throw bad(`You only have ${slots} active skill slots.`);
  const clean = sanitizeLoadout(save, msg.loadout);
  const asked = [...req.slice(0, slots), msg.loadout.internal, msg.loadout.movement].filter((s): s is string => !!s);
  const got = new Set([...clean.active, clean.internal, clean.movement].filter((s): s is string => !!s));
  for (const s of asked) if (!got.has(s)) throw bad('You cannot equip a skill you have not learned (or one placed in the wrong slot).');
  if (new Set(asked).size !== asked.length) throw bad('A skill can only be equipped once.');
  if (!Array.isArray(msg.tactics) || msg.tactics.length > 6) throw bad('At most 6 tactic rules are allowed.');
  const tactics: TacticRule[] = [];
  for (const rule of msg.tactics) {
    if (!rule?.cond || !rule.act || !condOk(rule.cond)) throw bad('A tactic has an invalid condition.');
    const a = rule.act;
    if (a.k === 'guard' || a.k === 'flee' || a.k === 'basic') tactics.push({ cond: { ...rule.cond }, act: { k: a.k } });
    else if (a.k === 'skill') {
      if (!clean.active.includes(a.id)) throw bad('A tactic uses a skill that is not in your loadout.');
      tactics.push({ cond: { ...rule.cond }, act: { k: 'skill', id: a.id } });
    } else if (a.k === 'item') {
      const def = getItem(a.id);
      if (!def || def.kind !== 'consumable' || def.use?.breakthrough || !(def.use?.heal || def.use?.qi || def.use?.cleanse)) throw bad('A tactic uses an item that cannot be used in combat.');
      tactics.push({ cond: { ...rule.cond }, act: { k: 'item', id: a.id } });
    } else throw bad('A tactic has an invalid action.');
  }
  return { loadout: clean, stance: msg.stance, tactics };
}

// ---- missions ---------------------------------------------------------------------------------------------------------------

export const BOARD_MARGIN = 6;
export const ACCEPT_MARGIN = 4;
export const TURNIN_ROLES: NpcRole[] = ['elder', 'guard', 'master', 'merchant'];

export function nearBoard(s: SettlementDef | undefined, at: { x: number; y: number }, margin: number): boolean {
  return !!s && Math.hypot(s.x - at.x, s.y - at.y) <= s.radius + margin;
}

export function offerOf(m: ActiveMission): MissionOffer {
  const { progress: _p, acceptedDay: _a, done: _d, ...offer } = m;
  void _p;
  void _a;
  void _d;
  return JSON.parse(JSON.stringify(offer)) as MissionOffer;
}

/** Throws the refusal the real `maccept` would give, or returns nothing when the offer can be taken. */
export function checkAccept(save: CharacterSave, offer: MissionOffer | undefined): asserts offer is MissionOffer {
  if (!offer) throw new MockRefusal('gone', 'That posting is gone.');
  if (save.missions.some((m) => m.id === offer.id)) throw new MockRefusal('duplicate', 'You already carry that mission.');
  if (save.missions.length >= MAX_ACTIVE_MISSIONS) throw new MockRefusal('too_many', `You can carry at most ${MAX_ACTIVE_MISSIONS} missions.`);
  if (rankOf(save.level) < offer.minRank) throw new MockRefusal('rank_low', 'Your rank is too low for this posting.');
  if (offer.type === 'bounty' && save.missions.some((m) => m.type === 'bounty')) throw new MockRefusal('one_bounty', 'You already hunt a bounty target.');
}

export function bagCount(save: CharacterSave, id: string): number {
  return save.inventory.filter((s) => s.id === id).reduce((a, s) => a + s.qty, 0);
}

/** Gather / deliver progress follows the bag (the real server polls once a second). Returns the missions that changed. */
export function refreshCollect(save: CharacterSave): ActiveMission[] {
  const changed: ActiveMission[] = [];
  for (const m of save.missions) {
    if ((m.type !== 'gather' && m.type !== 'deliver') || !m.target.item) continue;
    const have = Math.min(m.target.count, bagCount(save, m.target.item));
    const done = have >= m.target.count;
    if (m.progress !== have || m.done !== done) {
      m.progress = have;
      m.done = done;
      changed.push(m);
    }
  }
  return changed;
}

/** Throws `not_done` / `no_taker` like the real `mturnin`. `settlementOf` is the settlement the NPC belongs to. */
export function checkTurnIn(save: CharacterSave, m: ActiveMission | undefined, npc: { role: NpcRole; settlementId: number } | undefined): asserts m is ActiveMission {
  if (!m) throw new MockRefusal('not_found', 'You carry no such mission.');
  refreshCollect(save);
  if (!m.done) {
    const need = m.target.count - m.progress;
    throw new MockRefusal('not_done', m.type === 'gather' || m.type === 'deliver' ? `You are still missing ${need}.` : 'That mission is not finished yet.');
  }
  const home = m.type === 'deliver' && m.target.toSettlement !== undefined ? m.target.toSettlement : m.settlementId;
  if (!npc || !TURNIN_ROLES.includes(npc.role) || npc.settlementId !== home) throw new MockRefusal('no_taker', 'Nobody here can take this report. Look for the elder, a guard, a master or a merchant of the right settlement.');
}

export function takeGoods(save: CharacterSave, id: string, qty: number): void {
  let left = qty;
  for (let i = save.inventory.length - 1; i >= 0 && left > 0; i--) {
    const s = save.inventory[i];
    if (s.id !== id) continue;
    const n = Math.min(s.qty, left);
    s.qty -= n;
    left -= n;
    if (s.qty <= 0) save.inventory.splice(i, 1);
  }
}

// ---- inn ------------------------------------------------------------------------------------------------------------------------

export function restPrice(level: number): number {
  return 10 + 3 * level;
}

