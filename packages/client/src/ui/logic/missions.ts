/** Missions panel rules: progress wording, time left, where to hand in, the nearest board. Pure. */
import type { ActiveMission, MissionOffer, MissionType, SettlementDef } from '@murim/shared';

export const MISSION_ICON: Record<MissionType, string> = { hunt: 'target', gather: 'herb', deliver: 'parcel', purify: 'lotus', defend: 'shield', bounty: 'purse', investigate: 'search', sect: 'sect' };

/** Server range for the board query is radius + 6 tiles from the settlement centre. */
export const BOARD_QUERY_MARGIN = 6;

export function progressFraction(m: Pick<ActiveMission, 'progress' | 'target' | 'done'>): number {
  if (m.done) return 1;
  return Math.max(0, Math.min(1, m.progress / Math.max(1, m.target.count)));
}

/** "3 / 5" (clamped to the target). */
export function progressText(m: Pick<ActiveMission, 'progress' | 'target' | 'done'>): string {
  const n = m.done ? m.target.count : Math.min(m.target.count, Math.max(0, m.progress));
  return `${n} / ${m.target.count}`;
}

/** Whole world days until the mission or offer disappears (0 = ends today / over). */
export function daysLeft(expires: number, today: number): number {
  return Math.max(0, Math.floor(expires - today));
}

export type Urgency = 'ok' | 'soon' | 'last';
export function urgency(left: number): Urgency {
  return left <= 0 ? 'last' : left <= 1 ? 'soon' : 'ok';
}

/** Settlement where this mission is handed in (deliver missions go to the target settlement). */
export function turnInSettlementId(m: Pick<MissionOffer, 'type' | 'settlementId' | 'target'>): number {
  return m.type === 'deliver' && m.target.toSettlement !== undefined ? m.target.toSettlement : m.settlementId;
}

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as const;
export type Compass = (typeof DIRS)[number];

/** Compass word for the tile offset (east = +x, south = +y, as on the minimap). */
export function compass(dx: number, dy: number): Compass {
  const a = Math.atan2(dy, dx); // -pi..pi, 0 = east, +pi/2 = south
  const i = Math.round(a / (Math.PI / 4));
  return DIRS[((i % 8) + 8) % 8];
}

export interface Hint {
  name: string;
  dist: number;
  dir: Compass;
  here: boolean;
}

export function hintTo(s: Pick<SettlementDef, 'name' | 'x' | 'y' | 'radius'>, self: { x: number; y: number } | null): Hint {
  if (!self) return { name: s.name, dist: 0, dir: 'east', here: false };
  const dx = s.x - self.x;
  const dy = s.y - self.y;
  const dist = Math.round(Math.hypot(dx, dy));
  return { name: s.name, dist, dir: compass(dx, dy), here: dist <= s.radius + 4 };
}

/** Nearest settlement whose board can be queried from here, or null. */
export function boardSettlement(list: readonly SettlementDef[], self: { x: number; y: number } | null): SettlementDef | null {
  if (!self) return null;
  let best: SettlementDef | null = null;
  let bestD = Infinity;
  for (const s of list) {
    const d = Math.hypot(s.x - self.x, s.y - self.y);
    if (d <= s.radius + BOARD_QUERY_MARGIN && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function nearestSettlement(list: readonly SettlementDef[], self: { x: number; y: number } | null): SettlementDef | null {
  if (!self) return null;
  let best: SettlementDef | null = null;
  let bestD = Infinity;
  for (const s of list) {
    const d = Math.hypot(s.x - self.x, s.y - self.y);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Ready missions first, then by time left, then by title. */
export function sortActive(list: readonly ActiveMission[], today: number): ActiveMission[] {
  return [...list].sort((a, b) => Number(b.done) - Number(a.done) || daysLeft(a.expires, today) - daysLeft(b.expires, today) || a.title.localeCompare(b.title));
}

/** What the mission asks for, in one phrase source: [i18n key, params]. */
export function objectiveKey(m: Pick<MissionOffer, 'type' | 'target'>): { key: string; params: Record<string, string | number> } {
  const t = m.target;
  switch (m.type) {
    case 'hunt':
    case 'bounty':
    case 'purify':
    case 'defend':
      return { key: `ms.obj.${m.type}`, params: { n: t.count, what: t.monster ?? t.family ?? '' } };
    case 'gather':
    case 'deliver':
      return { key: `ms.obj.${m.type}`, params: { n: t.count, what: t.item ?? '' } };
    default:
      return { key: `ms.obj.${m.type}`, params: { n: t.count, what: '' } };
  }
}
