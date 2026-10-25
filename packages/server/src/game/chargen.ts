/**
 * Character creation flow behind `/api/character/roll` and `/api/character/create`.
 * The first roll is free and persisted in `pending_rolls` (so a page reload cannot reroll for free);
 * `REROLLS` more are allowed. One character per account.
 */
import { randomBytes } from 'node:crypto';
import {
  ORIGINS,
  REROLLS,
  Rng,
  SKILLS,
  TALENTS,
  clampLook,
  getItem,
  newCharacterSave,
  randomLook,
  rollCharacter,
  type CharacterSave,
  type Look,
  type Roll,
  type RollPreview,
  type SettlementDef,
  type SettlementKind,
  type WorldData,
} from '@murim/shared';
import { validateCharacterName } from '../auth';
import type { Db } from '../db';

export interface Failure {
  ok: false;
  status: number;
  error: string;
}

export interface PendingRoll {
  roll: Roll;
  look: Look;
}

function cryptoSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

function isRoll(v: unknown): v is Roll {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Roll;
  return typeof r.origin === 'string' && r.origin in ORIGINS && Array.isArray(r.talents) && r.talents.every((t) => typeof t === 'string' && t in TALENTS) && typeof r.stats === 'object' && r.stats !== null;
}

function parsePending(json: string): PendingRoll | null {
  try {
    const p = JSON.parse(json) as Partial<PendingRoll>;
    if (!isRoll(p.roll) || typeof p.look !== 'object' || p.look === null) return null;
    return { roll: p.roll, look: clampLook(p.look) };
  } catch {
    return null;
  }
}

function itemLine(id: string, qty: number): string {
  const name = getItem(id)?.name ?? id;
  return qty > 1 ? `${name} x${qty}` : name;
}

export function previewOf(p: PendingRoll, rerollsLeft: number): RollPreview {
  const o = ORIGINS[p.roll.origin];
  const skills = o.skills.map((s) => SKILLS[s]?.name ?? s);
  // newCharacterSave grants Iron Fist when the origin teaches no active art.
  if (!o.skills.some((s) => SKILLS[s]?.kind === 'active') && SKILLS.fist_iron) skills.push(SKILLS.fist_iron.name);
  return {
    roll: p.roll,
    talents: p.roll.talents.map((id) => ({ id, name: TALENTS[id].name, desc: TALENTS[id].desc, positive: TALENTS[id].positive })),
    origin: { id: o.id, name: o.name, desc: o.desc, gold: o.gold, items: o.items.map((i) => itemLine(i.id, i.qty)), skills },
    look: p.look,
    rerollsLeft,
  };
}

/** Home settlement for an origin: one whose kind is in `homeKinds`, preferring the starting village (id 0). */
export function pickHome(world: WorldData, homeKinds: readonly SettlementKind[]): SettlementDef {
  const start = world.settlements[0];
  const fits = world.settlements.filter((s) => homeKinds.includes(s.kind));
  if (fits.length === 0) return start;
  if (fits.some((s) => s.id === start.id)) return start;
  let best = fits[0];
  let bestD = Infinity;
  for (const s of fits) {
    const d = Math.hypot(s.x - start.x, s.y - start.y);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export class CharacterService {
  constructor(
    private readonly db: Db,
    private readonly world: WorldData,
    private readonly now: () => number,
    private readonly seed: () => number = cryptoSeed,
  ) {}

  /** Rerolls the account may still spend (0 once a character exists). */
  rerollsLeft(userId: number): number {
    if (this.db.getCharacterByUser(userId)) return 0;
    return Math.max(0, REROLLS - (this.db.getPendingRoll(userId)?.rerollsUsed ?? 0));
  }

  /**
   * `reroll: false` returns the pending roll (rolling the free first one if needed);
   * `reroll: true` or omitted spends a reroll once a roll exists.
   */
  roll(userId: number, reroll?: boolean): { ok: true; preview: RollPreview } | Failure {
    if (this.db.getCharacterByUser(userId)) return { ok: false, status: 403, error: 'You already have a character.' };
    const row = this.db.getPendingRoll(userId);
    let pending = row ? parsePending(row.json) : null;
    let used = pending ? (row?.rerollsUsed ?? 0) : 0;
    if (!pending) {
      const rng = new Rng(this.seed());
      pending = { roll: rollCharacter(rng), look: randomLook(rng) };
      used = 0;
      this.db.setPendingRoll(userId, JSON.stringify(pending), used);
    } else if (reroll !== false) {
      if (used >= REROLLS) return { ok: false, status: 400, error: 'You have no rerolls left. Keep this character.' };
      pending = { roll: rollCharacter(new Rng(this.seed())), look: pending.look };
      used++;
      this.db.setPendingRoll(userId, JSON.stringify(pending), used);
    }
    return { ok: true, preview: previewOf(pending, Math.max(0, REROLLS - used)) };
  }

  create(userId: number, body: unknown): { ok: true; save: CharacterSave } | Failure {
    if (this.db.getCharacterByUser(userId)) return { ok: false, status: 403, error: 'You already have a character.' };
    const row = this.db.getPendingRoll(userId);
    const pending = row ? parsePending(row.json) : null;
    if (!row || !pending) return { ok: false, status: 400, error: 'Roll a character first.' };
    const req = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const nameCheck = validateCharacterName(req.name);
    if (!nameCheck.ok) return { ok: false, status: 400, error: nameCheck.error };
    const look = typeof req.look === 'object' && req.look !== null ? clampLook(req.look as Look) : pending.look;
    if (this.db.isNameTaken(nameCheck.name)) return { ok: false, status: 409, error: 'That name is taken.' };

    const home = pickHome(this.world, ORIGINS[pending.roll.origin].homeKinds);
    const now = this.now();
    const result = this.db.transaction(() => {
      const r = this.db.createCharacter(
        userId,
        nameCheck.name,
        (id) => newCharacterSave({ id, name: nameCheck.name, look, roll: pending.roll, homeSettlement: home.id, spawn: home.spawn, now, rerolls: row.rerollsUsed }),
        now,
      );
      if (r.ok) this.db.deletePendingRoll(userId);
      return r;
    });
    if (!result.ok) {
      return result.conflict === 'name' ? { ok: false, status: 409, error: 'That name is taken.' } : { ok: false, status: 403, error: 'You already have a character.' };
    }
    return { ok: true, save: result.save };
  }
}
