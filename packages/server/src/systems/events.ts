/**
 * Cross-system events (typed bus: `ctx.events.on/emit`). Declared once here so every gameplay
 * module agrees on the payloads. This file only augments `GameEvents`; import it for its types.
 */
import type { ActiveMission, MonsterFamily, NodeKind } from '@murim/shared';
import type { Player } from '../ctx';

export interface MonsterKilledEvent {
  /** Players who earned credit for the kill (damage share >= 10%). */
  killers: Player[];
  /** Entity id of the monster (already hidden/removed or about to be). */
  entityId: number;
  /** `MONSTERS` key, e.g. 'wolf'. */
  defId: string;
  family: MonsterFamily;
  level: number;
  elite: 0 | 1 | 2;
  x: number;
  y: number;
  /** World spawn point id, or null for dynamic spawns (siege waves, bounty targets, heart bosses). */
  spawnId: number | null;
  /** Settlement id when this monster belonged to that settlement's siege wave. */
  siege: number | null;
  /** Character id when this was a personal bounty target. */
  bountyFor: number | null;
  /** Blight heart id when this was a heart guardian boss. */
  heartId: number | null;
}

declare module '../ctx' {
  interface GameEvents {
    monsterKilled: MonsterKilledEvent;
    playerLevelUp: { player: Player; from: number; to: number };
    playerDied: { player: Player };
    missionCompleted: { player: Player; mission: ActiveMission };
    nodeGathered: { player: Player; kind: NodeKind; x: number; y: number };
  }
}
