/**
 * Runtime validation of every client -> server message (zod). Nothing reaches the game layer
 * unless it parses here; unknown fields are stripped, numbers are bounded, strings are capped.
 *
 * The final compile-time check at the bottom guarantees the schema output is assignable to `C2S`,
 * so adding a message to protocol.ts without a schema (or with a wrong one) fails type checking.
 */
import { STAT_KEYS, type C2S } from '@murim/shared';
import { z } from 'zod';

/** Largest accepted text message in bytes (checked by the gateway before parsing). */
export const MAX_MESSAGE_BYTES = 4096;

const int = (min: number, max: number) => z.number().int().min(min).max(max);
/** Entity / combat / character ids. */
const id = int(0, 2 ** 31 - 1);
/** Item, skill, recipe, mission and site ids: short identifier-like strings. */
const key = z.string().min(1).max(64).regex(/^[\w.:-]+$/);
const slot = int(0, 255);
const qty = int(1, 9999);
const name = z.string().min(1).max(32);

const cond = z.discriminatedUnion('k', [
  z.object({ k: z.literal('always') }),
  z.object({ k: z.literal('hpBelow'), v: int(0, 100) }),
  z.object({ k: z.literal('qiBelow'), v: int(0, 100) }),
  z.object({ k: z.literal('qiAbove'), v: int(0, 100) }),
  z.object({ k: z.literal('enemyHpBelow'), v: int(0, 100) }),
  z.object({ k: z.literal('enemiesAtLeast'), v: int(1, 20) }),
  z.object({ k: z.literal('targetBlighted') }),
]);

const act = z.discriminatedUnion('k', [
  z.object({ k: z.literal('skill'), id: key }),
  z.object({ k: z.literal('guard') }),
  z.object({ k: z.literal('item'), id: key }),
  z.object({ k: z.literal('flee') }),
  z.object({ k: z.literal('basic') }),
]);

const loadout = z.object({
  active: z.array(key.nullable()).max(8),
  internal: key.nullable(),
  movement: key.nullable(),
});

const sectRole = z.enum(['leader', 'elder', 'disciple', 'outer']);
const jobId = z.enum(['herbalist', 'miner', 'farmer', 'blacksmith', 'alchemist']);

/** `{t:'q'}` is validated per query name so each handler receives correctly shaped args. */
const query = z.discriminatedUnion('name', [
  z.object({ t: z.literal('q'), id, name: z.literal('npc'), args: z.object({ id }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('npcTalk'), args: z.object({ id, topic: key }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('board'), args: z.object({ settlement: id }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('world'), args: z.object({}) }),
  z.object({ t: z.literal('q'), id, name: z.literal('chronicle'), args: z.object({ before: id.optional(), limit: int(1, 100).optional() }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('sites'), args: z.object({ settlement: id }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('recipes'), args: z.object({ site: key }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('friends'), args: z.object({}) }),
  z.object({ t: z.literal('q'), id, name: z.literal('sect'), args: z.object({ id: id.optional() }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('sects'), args: z.object({}) }),
  z.object({ t: z.literal('q'), id, name: z.literal('player'), args: z.object({ id: id.optional(), name: name.optional() }) }),
  z.object({ t: z.literal('q'), id, name: z.literal('leaderboard'), args: z.object({}) }),
  z.object({ t: z.literal('q'), id, name: z.literal('nearbyPlayers'), args: z.object({}) }),
]);

export const c2sSchema = z.union([
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('ping'), t0: z.number().finite() }),
    z.object({ t: z.literal('move'), x: int(0, 4095), y: int(0, 4095) }),
    z.object({ t: z.literal('stop') }),
    z.object({ t: z.literal('interact'), id }),
    z.object({ t: z.literal('assist'), combat: id }),
    z.object({ t: z.literal('flee') }),
    z.object({ t: z.literal('alloc'), stat: z.enum(STAT_KEYS), n: int(1, 1000) }),
    z.object({ t: z.literal('equip'), idx: slot, id: key }),
    z.object({ t: z.literal('unequip'), slot: z.enum(['weapon', 'outfit', 'accessory']) }),
    z.object({ t: z.literal('use'), idx: slot, id: key }),
    z.object({ t: z.literal('drop'), idx: slot, id: key, qty }),
    z.object({
      t: z.literal('build'),
      loadout,
      stance: z.enum(['aggressive', 'balanced', 'defensive', 'evasive']),
      tactics: z.array(z.object({ cond, act })).max(8),
    }),
    z.object({ t: z.literal('breakthrough') }),
    z.object({ t: z.literal('buy'), npc: id, item: key, qty }),
    z.object({ t: z.literal('sell'), npc: id, idx: slot, id: key, qty }),
    z.object({ t: z.literal('learn'), npc: id, skill: key }),
    z.object({ t: z.literal('rest'), npc: id }),
    z.object({ t: z.literal('maccept'), offer: key, settlement: id }),
    z.object({ t: z.literal('mabandon'), id: key }),
    z.object({ t: z.literal('mturnin'), id: key, npc: id.optional() }),
    z.object({ t: z.literal('astop') }),
    z.object({
      t: z.literal('chat'),
      ch: z.enum(['local', 'world', 'sect', 'whisper']),
      text: z.string().min(1).max(600),
      to: name.optional(),
    }),
    z.object({ t: z.literal('title'), title: z.string().max(120) }),
  ]),
  // Messages that carry a second discriminator are separate unions on `t`.
  query,
  z.discriminatedUnion('kind', [
    z.object({ t: z.literal('astart'), kind: z.literal('train'), site: key }),
    z.object({ t: z.literal('astart'), kind: z.literal('shift'), site: key, job: jobId }),
    z.object({ t: z.literal('astart'), kind: z.literal('craft'), site: key, recipe: key, qty: int(1, 99) }),
  ]),
  z.discriminatedUnion('op', [
    z.object({ t: z.literal('friend'), op: z.literal('add'), name }),
    z.object({ t: z.literal('friend'), op: z.literal('accept'), id }),
    z.object({ t: z.literal('friend'), op: z.literal('decline'), id }),
    z.object({ t: z.literal('friend'), op: z.literal('remove'), id }),
  ]),
  z.discriminatedUnion('op', [
    z.object({ t: z.literal('sect'), op: z.literal('create'), name: z.string().min(1).max(32), tag: z.string().min(1).max(8), motto: z.string().max(120).optional() }),
    z.object({ t: z.literal('sect'), op: z.literal('join'), sect: id }),
    z.object({ t: z.literal('sect'), op: z.literal('invite'), name }),
    z.object({ t: z.literal('sect'), op: z.literal('accept'), sect: id }),
    z.object({ t: z.literal('sect'), op: z.literal('decline'), sect: id }),
    z.object({ t: z.literal('sect'), op: z.literal('leave') }),
    z.object({ t: z.literal('sect'), op: z.literal('kick'), id }),
    z.object({ t: z.literal('sect'), op: z.literal('promote'), id, role: sectRole }),
    z.object({ t: z.literal('sect'), op: z.literal('deposit'), gold: int(1, 1_000_000_000) }),
    z.object({ t: z.literal('sect'), op: z.literal('motto'), motto: z.string().max(120) }),
    z.object({ t: z.literal('sect'), op: z.literal('disband') }),
  ]),
  z.discriminatedUnion('op', [
    z.object({ t: z.literal('master'), op: z.literal('request'), npc: id.optional(), id: id.optional() }),
    z.object({ t: z.literal('master'), op: z.literal('accept'), id }),
    z.object({ t: z.literal('master'), op: z.literal('decline'), id }),
    z.object({ t: z.literal('master'), op: z.literal('dismiss'), id: id.optional() }),
    z.object({ t: z.literal('master'), op: z.literal('teach'), id, skill: key }),
  ]),
  z.discriminatedUnion('op', [
    z.object({ t: z.literal('duel'), op: z.literal('challenge'), id, stake: int(0, 1_000_000_000).optional() }),
    z.object({ t: z.literal('duel'), op: z.literal('accept'), id }),
    z.object({ t: z.literal('duel'), op: z.literal('decline'), id }),
  ]),
]);

// Compile-time guarantee: whatever the schema accepts is a valid C2S.
const _assignable = (m: z.infer<typeof c2sSchema>): C2S => m;
void _assignable;

export type ParseResult = { ok: true; msg: C2S } | { ok: false; error: string };

/** Parse one raw websocket text frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { ok: false, error: 'expected an object' };
  const r = c2sSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path.join('.') ?? '';
    return { ok: false, error: path ? `invalid field "${path}"` : 'unknown message' };
  }
  return { ok: true, msg: r.data };
}
