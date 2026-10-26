/**
 * Master-disciple bonds: NPC masters, player masters, benefits (XP, skill discount, tribute), teaching, graduation.
 * Owner: gameplay-social. Rules: docs/GAMEPLAY_SPEC.md section 9. Ids in ops are CHARACTER ids (NPC masters are
 * addressed by NPC id in `request` and stored as `masterId = -npcId`).
 *
 * Table `master_bonds` is the source of truth (one row per disciple); `save.masterId` mirrors it and is re-synced
 * on every save and login. `master_teach` keeps the 1 h teaching cooldown per disciple (survives dismissals) and
 * `master_rewards` records the one-off graduation reward of each master.
 */
import { FACTIONS, SKILLS, rankOf, type NpcMenu, type NpcState } from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { distanceBetween, learnSkill, skillBlocker } from './econ';
import { addGold, addReputation } from './lib';
import { npcMenuDecorators } from './npcmenu';
import { getServices } from './services';
import { INVITE_TTL_MS, Limiter, findCharacter, mutateCharacter, setupMail, tellLater, throttle } from './social';
import './events';

export const MASTER_MIN_RANK = 3;
export const DISCIPLE_MAX_RANK = 2;
export const MAX_DISCIPLES = 2;
export const NPC_MASTER_REP = 10;
export const MASTER_RANGE = 6;
export const DISCIPLE_XP_BONUS = 0.1;
export const DISCIPLE_XP_BONUS_ONLINE = 0.15;
export const TRIBUTE_RATE = 0.1;
export const NPC_DISCIPLE_DISCOUNT = 0.8;
export const TEACH_COOLDOWN_MS = 60 * 60 * 1000;
export const TEACH_MIN_SKILL_LEVEL = 3;
export const GRADUATION_RANK = 3;
export const GRADUATION_GOLD = 200;

/** Price multiplier at NPC `npcId` for this player's skill purchases (0.8 for the disciples of that NPC). */
export function discipleDiscount(p: Player, npcId: number): number {
  return p.save.masterId === -npcId ? NPC_DISCIPLE_DISCOUNT : 1;
}

interface Bond {
  discipleId: number;
  /** Positive: master character id. Negative: NPC master (-npcId). */
  masterId: number;
  since: number;
}

interface Offer {
  from: number;
  to: number;
  /** What the sender wants to be: the receiver's master ('master') or disciple ('disciple')... see `senderRole`. */
  senderRole: 'master' | 'disciple';
  expires: number;
}

export interface MastersApi {
  masterOf(discipleId: number): number | null;
  disciplesOf(masterId: number): number[];
}
const apis = new WeakMap<GameContext, MastersApi>();
export function getMastersApi(ctx: GameContext): MastersApi | undefined {
  return apis.get(ctx);
}

export function register(ctx: GameContext): void {
  setupMail(ctx);
  ctx.db.migrateModule('masters', [
    `CREATE TABLE master_bonds (
       disciple_id INTEGER PRIMARY KEY,
       master_id INTEGER NOT NULL,
       since INTEGER NOT NULL,
       tribute INTEGER NOT NULL DEFAULT 0
     );
     CREATE INDEX master_bonds_master ON master_bonds(master_id);
     CREATE TABLE master_teach (disciple_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);
     CREATE TABLE master_rewards (master_id INTEGER PRIMARY KEY, at INTEGER NOT NULL);`,
  ]);

  const bonds = new Map<number, Bond>();
  for (const r of ctx.db.all<{ disciple_id: number; master_id: number; since: number }>('SELECT disciple_id, master_id, since FROM master_bonds')) {
    bonds.set(Number(r.disciple_id), { discipleId: Number(r.disciple_id), masterId: Number(r.master_id), since: Number(r.since) });
  }
  const offers = new Map<string, Offer>();
  const names = new Map<number, string>();
  const reqLimit = new Limiter(ctx, 6, 60_000);
  const targetLimit = new Limiter(ctx, 3, 60_000);

  const nameOf = (id: number): string => {
    let n = names.get(id);
    if (!n) {
      n = findCharacter(ctx, id)?.name ?? 'Unknown';
      if (n !== 'Unknown') names.set(id, n);
    }
    return n;
  };
  const disciplesOf = (masterId: number): Bond[] => {
    const out: Bond[] = [];
    for (const b of bonds.values()) if (b.masterId === masterId) out.push(b);
    return out;
  };
  const okey = (from: number, to: number): string => `${from}>${to}`;
  const liveOffer = (key: string): Offer | undefined => {
    const o = offers.get(key);
    if (!o) return undefined;
    if (o.expires <= ctx.now()) {
      offers.delete(key);
      return undefined;
    }
    return o;
  };

  const syncSave = (discipleId: number): void => {
    const want = bonds.get(discipleId)?.masterId ?? null;
    mutateCharacter(ctx, discipleId, (s) => {
      s.masterId = want;
    });
  };

  const createBond = (discipleId: number, masterId: number): void => {
    const now = ctx.now();
    ctx.db.transaction(() => {
      ctx.db.run('INSERT INTO master_bonds (disciple_id, master_id, since) VALUES (?, ?, ?)', discipleId, masterId, now);
    });
    bonds.set(discipleId, { discipleId, masterId, since: now });
    syncSave(discipleId);
    const m = ctx.players.byCharId(masterId);
    if (m) ctx.markMe(m);
  };

  const endBond = (discipleId: number): Bond | undefined => {
    const b = bonds.get(discipleId);
    if (!b) return undefined;
    ctx.db.run('DELETE FROM master_bonds WHERE disciple_id = ?', discipleId);
    bonds.delete(discipleId);
    syncSave(discipleId);
    if (b.masterId > 0) {
      const m = ctx.players.byCharId(b.masterId);
      if (m) ctx.markMe(m);
    }
    return b;
  };

  // ---- eligibility ------------------------------------------------------------------

  /** Why `p` cannot become a disciple of the NPC `npc` (null when they can). */
  const npcBlocker = (p: Player, npc: NpcState): { code: string; text: string } | null => {
    if (bonds.has(p.charId) || p.save.masterId) return { code: 'has_master', text: 'You already have a master.' };
    if (rankOf(p.save.level) > DISCIPLE_MAX_RANK) return { code: 'rank_high', text: 'Only Third-Rate and Second-Rate fighters can be taken as disciples.' };
    if (p.combatId !== null) return { code: 'in_combat', text: 'Finish your fight first.' };
    const ent = ctx.npcEntity(npc.id);
    if (!ent || distanceBetween(ent, p.entity) > MASTER_RANGE) return { code: 'too_far', text: `Walk up to ${npc.name} first.` };
    if (npc.faction && (p.save.reputation[npc.faction] ?? 0) < NPC_MASTER_REP) {
      const f = FACTIONS.find((x) => x.id === npc.faction);
      return { code: 'rep_low', text: `${npc.name} wants you to earn ${NPC_MASTER_REP} reputation with ${f?.short ?? npc.faction} first.` };
    }
    return null;
  };

  const masterBlocker = (m: Player): { code: string; text: string } | null => {
    if (rankOf(m.save.level) < MASTER_MIN_RANK) return { code: 'rank_low', text: 'Only First-Rate masters or better can take disciples.' };
    if (disciplesOf(m.charId).length >= MAX_DISCIPLES) return { code: 'full', text: `${m.name} already has ${MAX_DISCIPLES} disciples.` };
    return null;
  };
  const discipleBlocker = (d: Player): { code: string; text: string } | null => {
    if (bonds.has(d.charId) || d.save.masterId) return { code: 'has_master', text: `${d.name} already has a master.` };
    if (rankOf(d.save.level) > DISCIPLE_MAX_RANK) return { code: 'rank_high', text: `${d.name} is too advanced to be a disciple.` };
    return null;
  };
  const fail = (b: { code: string; text: string } | null): void => {
    if (b) throw new GameError(b.code, b.text);
  };

  // ---- commands ----------------------------------------------------------------------

  const requestNpc = (p: Player, npcId: number): void => {
    const npc = ctx.sim.npc(npcId);
    if (!npc || !npc.alive || npc.role !== 'master') throw new GameError('not_master', 'That person does not take disciples.');
    fail(npcBlocker(p, npc));
    createBond(p.charId, -npc.id);
    ctx.notify(p, 'good', `${npc.name} accepts you as a disciple. Cultivation comes faster and their teachings cost 20% less.`);
    ctx.markDirty(p);
    ctx.markMe(p);
  };

  const requestPlayer = (p: Player, targetId: number): void => {
    const target = ctx.players.byCharId(targetId);
    if (!target || !target.online) throw new GameError('offline', 'That player is not online.');
    if (target === p) throw new GameError('bad_target', 'You cannot choose yourself.');
    const mine = rankOf(p.save.level);
    const theirs = rankOf(target.save.level);
    let senderRole: Offer['senderRole'];
    if (mine <= DISCIPLE_MAX_RANK && theirs >= MASTER_MIN_RANK) {
      fail(discipleBlocker(p));
      fail(masterBlocker(target));
      senderRole = 'disciple';
    } else if (mine >= MASTER_MIN_RANK && theirs <= DISCIPLE_MAX_RANK) {
      fail(masterBlocker(p));
      fail(discipleBlocker(target));
      senderRole = 'master';
    } else {
      throw new GameError('bad_ranks', 'A master must be First-Rate or higher and a disciple Second-Rate or lower.');
    }
    const key = okey(p.charId, target.charId);
    if (liveOffer(key)) throw new GameError('already_asked', 'You have already asked them.');
    throttle(reqLimit, `s${p.charId}`, 'You are sending too many requests.');
    throttle(targetLimit, `t${target.charId}`, 'That player has received too many requests; try later.');
    offers.set(key, { from: p.charId, to: target.charId, senderRole, expires: ctx.now() + INVITE_TTL_MS });
    ctx.send(target, { t: 'invite', kind: 'master', fromId: p.charId, from: p.name, data: { role: senderRole } });
    ctx.notify(p, 'info', senderRole === 'disciple' ? `You asked ${target.name} to take you as a disciple.` : `You offered to take ${target.name} as a disciple.`);
  };

  const accept = (p: Player, fromId: number): void => {
    const o = liveOffer(okey(fromId, p.charId));
    const other = ctx.players.byCharId(fromId);
    if (!o || !other || !other.online) throw new GameError('no_request', 'That request has expired.');
    const master = o.senderRole === 'master' ? other : p;
    const disciple = o.senderRole === 'master' ? p : other;
    fail(masterBlocker(master));
    fail(discipleBlocker(disciple));
    offers.delete(okey(fromId, p.charId));
    createBond(disciple.charId, master.charId);
    ctx.notify(master, 'good', `${disciple.name} is now your disciple.`);
    ctx.notify(disciple, 'good', `${master.name} is now your master. You gain +${DISCIPLE_XP_BONUS * 100}% cultivation (+${DISCIPLE_XP_BONUS_ONLINE * 100}% while they are online).`);
    ctx.markMe(master);
    ctx.markMe(disciple);
  };

  const decline = (p: Player, fromId: number): void => {
    const key = okey(fromId, p.charId);
    if (!liveOffer(key)) throw new GameError('no_request', 'That request has expired.');
    offers.delete(key);
    const other = ctx.players.byCharId(fromId);
    if (other?.online) ctx.notify(other, 'info', `${p.name} declined.`);
  };

  const dismiss = (p: Player, id?: number): void => {
    if (id === undefined) {
      const b = bonds.get(p.charId);
      if (!b) throw new GameError('no_master', 'You have no master.');
      endBond(p.charId);
      if (b.masterId > 0) tellLater(ctx, b.masterId, 'info', `${p.name} has left your tutelage.`);
      ctx.notify(p, 'info', 'You have left your master.');
      ctx.markMe(p);
      return;
    }
    const b = bonds.get(id);
    if (!b || b.masterId !== p.charId) throw new GameError('not_disciple', 'That player is not your disciple.');
    endBond(id);
    tellLater(ctx, id, 'warn', `${p.name} has dismissed you as a disciple.`);
    ctx.notify(p, 'info', `${nameOf(id)} is no longer your disciple.`);
    ctx.markMe(p);
  };

  const teach = (p: Player, id: number, skillId: string): void => {
    const b = bonds.get(id);
    if (!b || b.masterId !== p.charId) throw new GameError('not_disciple', 'That player is not your disciple.');
    const d = ctx.players.byCharId(id);
    if (!d || !d.online) throw new GameError('offline', 'Your disciple must be online to be taught.');
    if (p.combatId !== null || d.combatId !== null) throw new GameError('in_combat', 'Not while fighting.');
    if (distanceBetween(p.entity, d.entity) > MASTER_RANGE) throw new GameError('too_far', 'Your disciple must be close by.');
    const def = SKILLS[skillId];
    if (!def) throw new GameError('bad_skill', 'Unknown skill.');
    if ((p.save.skills[skillId]?.lv ?? 0) < TEACH_MIN_SKILL_LEVEL) throw new GameError('skill_low', `You must have mastered ${def.name} to level ${TEACH_MIN_SKILL_LEVEL} to teach it.`);
    const blocker = skillBlocker(d.save, skillId);
    if (blocker) throw new GameError(blocker.code, blocker.text.replace(/^You /, `${d.name} `).replace(/^Requires/, `${d.name} needs`));
    const last = ctx.db.get<{ at: number }>('SELECT at FROM master_teach WHERE disciple_id = ?', id);
    const wait = last ? Number(last.at) + TEACH_COOLDOWN_MS - ctx.now() : 0;
    if (wait > 0) throw new GameError('cooldown', `You can teach ${d.name} again in ${Math.ceil(wait / 60000)} minute(s).`);
    ctx.db.run('INSERT INTO master_teach (disciple_id, at) VALUES (?, ?) ON CONFLICT(disciple_id) DO UPDATE SET at = excluded.at', id, ctx.now());
    learnSkill(ctx, d, skillId);
    ctx.notify(d, 'good', `${p.name} taught you ${def.name}.`);
    ctx.notify(p, 'good', `You taught ${d.name} ${def.name}.`);
  };

  ctx.command('master', (p, m) => {
    switch (m.op) {
      case 'request':
        if (m.npc !== undefined) return requestNpc(p, m.npc);
        if (m.id !== undefined) return requestPlayer(p, m.id);
        throw new GameError('bad_request', 'Choose a master.');
      case 'accept':
        return accept(p, m.id);
      case 'decline':
        return decline(p, m.id);
      case 'dismiss':
        return dismiss(p, m.id);
      case 'teach':
        return teach(p, m.id, m.skill);
    }
  });

  // ---- benefits -----------------------------------------------------------------------

  getServices(ctx).xpModifiers.push((p) => {
    const b = bonds.get(p.charId);
    if (!b) return 1;
    if (b.masterId > 0 && ctx.players.byCharId(b.masterId)?.online) return 1 + DISCIPLE_XP_BONUS_ONLINE;
    return 1 + DISCIPLE_XP_BONUS;
  });

  ctx.events.on('missionCompleted', ({ player, mission }) => {
    const b = bonds.get(player.charId);
    if (!b || b.masterId <= 0) return;
    const tribute = Math.floor(mission.reward.gold * TRIBUTE_RATE);
    if (tribute < 1) return;
    mutateCharacter(ctx, b.masterId, (s) => addGold(s, tribute));
    ctx.db.run('UPDATE master_bonds SET tribute = tribute + ? WHERE disciple_id = ?', tribute, player.charId);
    tellLater(ctx, b.masterId, 'good', `Your disciple ${player.name} sends you ${tribute} gold in tribute.`);
    ctx.notify(player, 'info', `Your master receives ${tribute} gold in tribute from your mission.`);
  });

  /** +1 legacy reputation (with the faction the master stands highest with) per disciple level-up. */
  const legacy = (masterId: number): void => {
    mutateCharacter(ctx, masterId, (s) => {
      let best: string | null = null;
      let bestRep = -Infinity;
      for (const f of FACTIONS) {
        const v = s.reputation[f.id];
        if (v !== undefined && v > bestRep) {
          best = f.id;
          bestRep = v;
        }
      }
      if (best) addReputation(s, best, 1);
    });
  };

  const graduate = (discipleId: number): void => {
    const b = endBond(discipleId);
    if (!b) return;
    const name = nameOf(discipleId);
    tellLater(ctx, discipleId, 'good', b.masterId > 0 ? `You have graduated from ${nameOf(b.masterId)}'s tutelage. Walk your own path!` : `You have graduated from your master's tutelage. Walk your own path!`);
    if (b.masterId > 0) {
      const first = !ctx.db.get('SELECT 1 AS x FROM master_rewards WHERE master_id = ?', b.masterId);
      if (first) {
        ctx.db.run('INSERT INTO master_rewards (master_id, at) VALUES (?, ?)', b.masterId, ctx.now());
        mutateCharacter(ctx, b.masterId, (s) => {
          addGold(s, GRADUATION_GOLD);
          if (!s.title || s.title.startsWith('Master of ')) s.title = `Master of ${name}`;
        });
        tellLater(ctx, b.masterId, 'good', `Your disciple ${name} has graduated! You receive ${GRADUATION_GOLD} gold and the title "Master of ${name}".`);
      } else {
        tellLater(ctx, b.masterId, 'good', `Your disciple ${name} has graduated.`);
      }
    }
    const d = ctx.players.byCharId(discipleId);
    if (d) ctx.markMe(d);
  };

  const checkGraduation = (p: Player): void => {
    if (bonds.has(p.charId) && rankOf(p.save.level) >= GRADUATION_RANK) graduate(p.charId);
  };

  ctx.events.on('playerLevelUp', ({ player }) => {
    const b = bonds.get(player.charId);
    if (!b) return;
    if (rankOf(player.save.level) >= GRADUATION_RANK) {
      graduate(player.charId);
      return;
    }
    if (b.masterId > 0) legacy(b.masterId);
  });

  ctx.every(10_000, () => {
    for (const id of [...bonds.keys()]) {
      const p = ctx.players.byCharId(id);
      if (p?.online) checkGraduation(p);
    }
    const now = ctx.now();
    for (const [k, o] of offers) if (o.expires <= now) offers.delete(k);
  });

  // NPC masters who die release their disciples.
  ctx.onHour((events) => {
    for (const ev of events) {
      if (ev.k !== 'npcDied') continue;
      for (const b of disciplesOf(-ev.id)) {
        endBond(b.discipleId);
        tellLater(ctx, b.discipleId, 'warn', 'Your master has passed away. Their legacy lives on in you.');
      }
    }
  });

  // ---- views and decorations ------------------------------------------------------------

  ctx.onBuildMe((p, me) => {
    const b = bonds.get(p.charId);
    me.master = null;
    if (b) {
      if (b.masterId < 0) {
        const npc = ctx.sim.npc(-b.masterId);
        if (npc) me.master = { id: npc.id, name: npc.name, npc: true };
      } else {
        me.master = { id: b.masterId, name: nameOf(b.masterId), npc: false };
      }
    }
    me.disciples = disciplesOf(p.charId).map((d) => {
      const live = ctx.players.byCharId(d.discipleId);
      const lv = live ? live.save.level : (findCharacter(ctx, d.discipleId)?.level ?? 1);
      return { id: d.discipleId, name: nameOf(d.discipleId), level: lv, online: !!live?.online };
    });
  });

  npcMenuDecorators.push((p, npc: NpcState, menu: NpcMenu) => {
    if (npc.role !== 'master') return;
    // the disciples of the compound who train under this master (named NPCs, see sim/disciples.ts)
    const mine = ctx.sim.npcs(npc.settlementId).filter((n) => n.role === 'disciple' && n.mentor === npc.id);
    if (mine.length) menu.students = { outer: mine.filter((n) => n.title !== 'Inner Disciple').length, inner: mine.filter((n) => n.title === 'Inner Disciple').length };
    const already = p.save.masterId === -npc.id;
    if (already) {
      menu.disciple = { ok: false, already: true, reason: 'You are already their disciple.' };
      return;
    }
    const why = npcBlocker(p, npc);
    menu.disciple = why ? { ok: false, already: false, reason: why.text } : { ok: true, already: false };
  });

  ctx.onSave((p) => {
    p.save.masterId = bonds.get(p.charId)?.masterId ?? null;
  });

  ctx.onLogin((p) => {
    const b = bonds.get(p.charId);
    if (b && b.masterId < 0 && !ctx.sim.npc(-b.masterId)?.alive) {
      endBond(p.charId);
      ctx.notify(p, 'warn', 'Your master has passed away.');
    } else {
      const want = bonds.get(p.charId)?.masterId ?? null;
      if (p.save.masterId !== want) {
        p.save.masterId = want;
        ctx.markDirty(p);
        ctx.markMe(p);
      }
    }
    checkGraduation(p);
    const mine = disciplesOf(p.charId);
    if (mine.length) {
      const on = mine.filter((d) => ctx.players.byCharId(d.discipleId)?.online).length;
      if (on) ctx.notify(p, 'info', `${on} of your disciples ${on === 1 ? 'is' : 'are'} online.`);
    }
    // Disciples and masters see each other's presence in their `me` view.
    const b2 = bonds.get(p.charId);
    if (b2 && b2.masterId > 0) {
      const m = ctx.players.byCharId(b2.masterId);
      if (m) ctx.markMe(m);
    }
    for (const d of mine) {
      const dp = ctx.players.byCharId(d.discipleId);
      if (dp) ctx.markMe(dp);
    }
  });
  ctx.onLogout((p) => {
    for (const d of disciplesOf(p.charId)) {
      const dp = ctx.players.byCharId(d.discipleId);
      if (dp) ctx.markMe(dp);
    }
    const b = bonds.get(p.charId);
    if (b && b.masterId > 0) {
      const m = ctx.players.byCharId(b.masterId);
      if (m) ctx.markMe(m);
    }
  });

  apis.set(ctx, { masterOf: (id) => bonds.get(id)?.masterId ?? null, disciplesOf: (id) => disciplesOf(id).map((b) => b.discipleId) });
}
