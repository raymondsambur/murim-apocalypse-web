/**
 * Character progression commands: `alloc` (stat points), `build` (loadout / stance / tactics) and
 * `breakthrough` (rank-ups). XP and level-ups themselves live in `lib.grantXp`.
 * See docs/GAMEPLAY_SPEC.md section 3. Owner: gameplay-combat.
 */
import {
  BREAKTHROUGHS,
  MAX_PLAYABLE_RANK,
  STAT_KEYS,
  activeSlots,
  autoLoadout,
  breakthroughChance,
  deriveForCharacter,
  getItem,
  isBreakthroughLevel,
  levelLabel,
  rankName,
  rankOf,
  sanitizeLoadout,
  statPointsForLevel,
  xpToNext,
  type CharacterSave,
  type Cond,
  type Loadout,
  type Stance,
  type TacticRule,
} from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import './events';
import { addGold, countItem, removeItem } from './lib';

/** Tuning knobs. */
export const PROGRESSION_TUNING = {
  maxTactics: 6,
  /** Failed breakthrough: fraction of the XP bar lost, injury duration, chance the pill survives. */
  failXpLoss: 0.3,
  failInjuryMs: 30 * 60_000,
  failInjuryMaxStacks: 3,
  pillSavedChance: 0.3,
} as const;

const STANCES: readonly Stance[] = ['aggressive', 'balanced', 'defensive', 'evasive'];

function isPct(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
}

function validCond(c: Cond): boolean {
  switch (c.k) {
    case 'always':
    case 'targetBlighted':
      return true;
    case 'hpBelow':
    case 'qiBelow':
    case 'qiAbove':
    case 'enemyHpBelow':
      return isPct(c.v);
    case 'enemiesAtLeast':
      return typeof c.v === 'number' && Number.isInteger(c.v) && c.v >= 1 && c.v <= 20;
    default:
      return false;
  }
}

/** Validate and copy tactic rules against the (already sanitised) loadout; throws a GameError on bad input. */
export function validateTactics(tactics: readonly TacticRule[], loadout: Loadout): TacticRule[] {
  if (!Array.isArray(tactics) || tactics.length > PROGRESSION_TUNING.maxTactics) {
    throw new GameError('bad_build', `At most ${PROGRESSION_TUNING.maxTactics} tactic rules are allowed.`);
  }
  const out: TacticRule[] = [];
  for (const rule of tactics) {
    const cond = rule?.cond;
    const act = rule?.act;
    if (!cond || !act || !validCond(cond)) throw new GameError('bad_build', 'A tactic has an invalid condition.');
    switch (act.k) {
      case 'guard':
      case 'flee':
      case 'basic':
        out.push({ cond: { ...cond }, act: { k: act.k } });
        break;
      case 'skill':
        if (!loadout.active.includes(act.id)) throw new GameError('bad_build', 'A tactic uses a skill that is not in your loadout.');
        out.push({ cond: { ...cond }, act: { k: 'skill', id: act.id } });
        break;
      case 'item': {
        const def = getItem(act.id);
        if (!def || def.kind !== 'consumable' || def.use?.breakthrough || !(def.use?.heal || def.use?.qi || def.use?.cleanse)) {
          throw new GameError('bad_build', 'A tactic uses an item that cannot be used in combat.');
        }
        out.push({ cond: { ...cond }, act: { k: 'item', id: act.id } });
        break;
      }
      default:
        throw new GameError('bad_build', 'A tactic has an invalid action.');
    }
  }
  return out;
}

/** Validate a requested loadout: every named skill must be learned, of the right kind, and fit the slots. */
export function validateLoadout(save: CharacterSave, wanted: Loadout): Loadout {
  const slots = activeSlots(rankOf(save.level));
  const req = Array.isArray(wanted?.active) ? wanted.active : null;
  if (!req) throw new GameError('bad_build', 'Invalid loadout.');
  if (req.slice(slots).some((s) => s)) throw new GameError('bad_build', `You only have ${slots} active skill slots.`);
  const clean = sanitizeLoadout(save, wanted);
  const asked = [...req.slice(0, slots), wanted.internal, wanted.movement].filter((s): s is string => !!s);
  const got = new Set([...clean.active, clean.internal, clean.movement].filter((s): s is string => !!s));
  for (const s of asked) {
    if (!got.has(s)) throw new GameError('bad_build', 'You cannot equip a skill you have not learned (or one placed in the wrong slot).');
  }
  if (new Set(asked).size !== asked.length) throw new GameError('bad_build', 'A skill can only be equipped once.');
  return clean;
}

export function register(ctx: GameContext): void {
  const guard = (p: Player): void => {
    if (p.entity.state === 'dead') throw new GameError('dead', 'You are dead.');
    if (p.combatId !== null) throw new GameError('in_combat', 'You cannot do that while fighting.');
  };

  const clampVitals = (p: Player): void => {
    const d = deriveForCharacter(p.save, ctx.now());
    p.save.hp = Math.min(p.save.hp, d.maxHp);
    p.save.qi = Math.min(p.save.qi, d.maxQi);
  };

  ctx.command('alloc', (p, m) => {
    guard(p);
    if (!STAT_KEYS.includes(m.stat)) throw new GameError('bad_stat', 'Unknown stat.');
    if (!Number.isInteger(m.n) || m.n <= 0) throw new GameError('bad_amount', 'Invalid amount.');
    if (m.n > p.save.statPoints) throw new GameError('no_points', 'You do not have that many stat points.');
    p.save.stats[m.stat] += m.n;
    p.save.statPoints -= m.n;
    clampVitals(p);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('build', (p, m) => {
    guard(p);
    if (!STANCES.includes(m.stance)) throw new GameError('bad_build', 'Unknown stance.');
    const loadout = validateLoadout(p.save, m.loadout);
    const tactics = validateTactics(m.tactics, loadout);
    p.save.loadout = loadout;
    p.save.stance = m.stance;
    p.save.tactics = tactics;
    clampVitals(p);
    ctx.markDirty(p);
    ctx.markMe(p);
  });

  ctx.command('breakthrough', (p) => {
    guard(p);
    const s = p.save;
    const rank = rankOf(s.level);
    const req = BREAKTHROUGHS[rank];
    if (!isBreakthroughLevel(s.level) || !req || rank >= MAX_PLAYABLE_RANK) {
      throw new GameError('no_breakthrough', rank >= MAX_PLAYABLE_RANK ? 'The next realm is sealed to you for now.' : 'You are not at the peak of your stage yet.');
    }
    if (s.xp < xpToNext(s.level)) throw new GameError('xp_not_full', 'Your cultivation is not yet full.');
    if (countItem(s, req.pill) < 1) throw new GameError('no_pill', `You need a ${getItem(req.pill)?.name ?? req.pill}.`);
    if (s.gold < req.gold) throw new GameError('no_gold', `A breakthrough costs ${req.gold} gold.`);

    const d = deriveForCharacter(s, ctx.now());
    const chance = breakthroughChance(rank, d.total.spirit, d.total.insight);
    const ok = ctx.rng.chance(chance);
    addGold(s, -req.gold);
    if (ok || !ctx.rng.chance(PROGRESSION_TUNING.pillSavedChance)) removeItem(s, req.pill, 1);

    if (ok) {
      const from = s.level;
      s.level = from + 1;
      s.xp = 0;
      s.statPoints += statPointsForLevel(s.level);
      const newRank = rankOf(s.level);
      const slots = activeSlots(newRank);
      const auto = autoLoadout(s.skills, newRank, s.equipment.weapon ? getItem(s.equipment.weapon.id)?.weaponType : undefined);
      const used = new Set(s.loadout.active.filter((x): x is string => !!x));
      while (s.loadout.active.length < slots) {
        const pick = auto.active.find((id): id is string => !!id && !used.has(id)) ?? null;
        if (pick) used.add(pick);
        s.loadout.active.push(pick);
      }
      const after = deriveForCharacter(s, ctx.now());
      s.hp = after.maxHp;
      s.qi = after.maxQi;
      p.data.btFull = false;
      ctx.send(p, { t: 'fx', kind: 'breakthrough', entity: p.entity.id, text: levelLabel(s.level) });
      ctx.notify(p, 'good', `Breakthrough! You enter the ${rankName(s.level)} realm.`);
      if (newRank >= 3) ctx.sim.record(`${s.name} has broken through to the ${rankName(s.level)} realm.`, newRank >= 4 ? 3 : 2, s.lastTown, 'player');
      ctx.events.emit('playerLevelUp', { player: p, from, to: s.level });
    } else {
      const lost = Math.round(xpToNext(s.level) * PROGRESSION_TUNING.failXpLoss);
      s.xp = Math.max(0, s.xp - lost);
      const now = ctx.now();
      const current = s.injuryUntil > now ? s.injuryStacks : 0;
      s.injuryStacks = Math.min(PROGRESSION_TUNING.failInjuryMaxStacks, current + 1);
      s.injuryUntil = Math.max(s.injuryUntil, now + PROGRESSION_TUNING.failInjuryMs);
      s.hp = Math.max(1, Math.round(s.hp * 0.5));
      p.data.btFull = false;
      ctx.notify(p, 'bad', 'Your qi deviates and the breakthrough fails! You are injured and some cultivation is lost.');
      ctx.after(PROGRESSION_TUNING.failInjuryMs + 200, () => {
        if (ctx.players.byCharId(p.charId) === p) ctx.markMe(p);
      });
    }
    clampVitals(p);
    ctx.markDirty(p);
    ctx.markMe(p);
  });
}
