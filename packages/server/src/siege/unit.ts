/** One fighter of a battle: a raider (a real `monster` entity) or a defender (a clone of a guard / master / militia). */
import type { Point } from '@murim/shared';
import type { Entity } from '../ctx';
import type { Fighter, Side } from './skirmish';
import type { DefenderKind, RaiderKind } from './party';

export type UnitMode =
  /** Defender waiting (alert) / raider with no order. */
  | 'idle'
  /** Raider walking in column towards the forming line. */
  | 'march'
  /** Raider standing in the forming line. */
  | 'form'
  /** Running at the enemy / the gate. */
  | 'charge'
  /** Raider fighting a player in the real combat engine. */
  | 'player'
  /** Raider ransacking the plaza. */
  | 'sack'
  /** Defender cheering. */
  | 'cheer'
  /** Running away (rout) - removed on arrival. */
  | 'flee'
  /** Defender fallen (corpse visible for a few seconds). */
  | 'down'
  /** Gone from the field (carried off, escaped, killed). */
  | 'out';

export class Unit implements Fighter {
  mode: UnitMode = 'idle';
  target: Unit | null = null;
  targetAt = 0;
  nextHitAt = 0;
  /** Where the unit should stand (forming line slot, defence slot). */
  slot: Point | null = null;
  /** The unit has been given its current movement order. */
  ordered = false;
  /** Raiders: start walking at this time. */
  moveAt = 0;
  /** Time of the last mode change / fall. */
  since = 0;
  /** Raiders: do not look for players before this time. */
  ignorePlayersUntil = 0;
  /** Raiders: busy walking up to a player until this time (the fight loop leaves them alone). */
  chaseUntil = 0;
  /** Revive time of a fallen defender (0 = never). */
  reviveAt = 0;
  /** Skill id named in the blow events (picks the hit effect and weapon smear on the client). */
  skill = 'basic';
  marchSpeed = 0.8;
  runSpeed = 1.5;
  /** Where a unit that fled stops to rest or leaves the map from. */
  fleeTo: Point | null = null;

  constructor(
    readonly side: Side,
    readonly ent: Entity,
    readonly kind: RaiderKind | DefenderKind,
    readonly power: number,
    readonly toughness: number,
    readonly npcId?: number,
  ) {}

  get id(): number {
    return this.ent.id;
  }
  get x(): number {
    return this.ent.x;
  }
  get y(): number {
    return this.ent.y;
  }
  get hp(): number {
    return this.ent.hp ?? 0;
  }
  set hp(v: number) {
    this.ent.hp = v;
  }
  get maxHp(): number {
    return this.ent.maxHp ?? 1;
  }
}

/** Can this unit still be fought / ordered about? */
export const isLive = (u: Unit): boolean => u.mode !== 'down' && u.mode !== 'out';
