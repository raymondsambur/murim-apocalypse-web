/**
 * NPC memory, gossip and rule-based talk: the public API other systems use.
 *
 *   const mem = getNpcMemory(ctx);                      // undefined if the module is not registered
 *   mem?.remember({ charId, kind: 'gift', place: 3 });  // towns and NPCs remember it
 *   mem?.townStanding(3, charId);                       // 'unknown' | 'noted' | 'welcomed' | 'honoured' | 'feared' | 'despised'
 *   mem?.recall(npcId, charId);                         // what one NPC remembers personally
 */
import type { DlgStanding, DlgTopic, NpcState } from '@murim/shared';
import type { GameContext, Player } from '../ctx';
import type { GameSpreadEnv } from './env';
import type { MemoryKind, MemoryStore, Recall, Sums } from './memory';
import type { RumorMill } from './rumors';

export interface RememberArgs {
  charId: number;
  kind: MemoryKind;
  /** Settlement id where it happened (the town that remembers). */
  place: number;
  magnitude?: number;
  /** Also remembered personally by this NPC. */
  npcId?: number;
}

export interface NpcMemoryApi {
  readonly store: MemoryStore;
  readonly mill: RumorMill;
  readonly env: GameSpreadEnv;
  /** Remember a deed (and start a rumor when it crosses a milestone). */
  remember(args: RememberArgs): void;
  townStanding(settlementId: number, charId: number): DlgStanding;
  townStandingDetail(settlementId: number, charId: number): { standing: DlgStanding; renown: number; sums: Sums };
  recall(npcId: number, charId: number): Recall;
  /** The greeting this NPC would give right now. */
  greeting(p: Player, npc: NpcState): string;
  /** Lines for a talk topic. */
  talk(p: Player, npc: NpcState, topic: Exclude<DlgTopic, 'greet'>): string[];
}

const registry = new WeakMap<GameContext, NpcMemoryApi>();

export function getNpcMemory(ctx: GameContext): NpcMemoryApi | undefined {
  return registry.get(ctx);
}

export function setNpcMemory(ctx: GameContext, api: NpcMemoryApi): void {
  registry.set(ctx, api);
}

export { MemoryStore, KIND_DEFS, MEMORY_KINDS, standingOf, weightFor } from './memory';
export type { MemoryKind, Recall } from './memory';
export { RumorMill, distortFacts, gossipiness } from './rumors';
export type { Rumor, RumorFacts, SpreadEnv } from './rumors';
export { NPCMEM, RUMOR } from './tuning';
