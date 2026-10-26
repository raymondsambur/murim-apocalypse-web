import type { SettlementKind } from '../terrain';
import type { SkillSchool } from './skills';

export type Ideology = 'righteous' | 'heterodox' | 'neutral' | 'outlaw';

export interface FactionDef {
  id: string;
  name: string;
  short: string;
  desc: string;
  ideology: Ideology;
  color: string;
  schools: SkillSchool[];
  homeKind: SettlementKind;
  /** Base military power, wealth and influence at world start. */
  power: number;
  wealth: number;
}

export const FACTIONS: FactionDef[] = [
  {
    id: 'azure',
    name: 'Azure Cloud Sect',
    short: 'Azure Cloud',
    desc: 'The orthodox sword sect that has defended the borderlands for three centuries. Disciplined, proud, and losing disciples to the Blight.',
    ideology: 'righteous',
    color: '#5fa4e8',
    schools: ['sword', 'internal', 'medicine'],
    homeKind: 'sectHall',
    power: 70,
    wealth: 55,
  },
  {
    id: 'tiger',
    name: 'Mount Tiger Fist Clan',
    short: 'Tiger Fist',
    desc: 'A martial clan of fist fighters and staff-wielders who hold the old fort. Blunt, loyal, and quick to anger.',
    ideology: 'righteous',
    color: '#e0a23a',
    schools: ['fist', 'staff', 'internal'],
    homeKind: 'fort',
    power: 75,
    wealth: 45,
  },
  {
    id: 'jade',
    name: 'Jade Merchant Guild',
    short: 'Jade Guild',
    desc: 'Caravan lords who keep the roads and markets alive. They sell to everyone, and they remember debts.',
    ideology: 'neutral',
    color: '#5cc29a',
    schools: ['movement', 'medicine', 'spear'],
    homeKind: 'town',
    power: 40,
    wealth: 90,
  },
  {
    id: 'crimson',
    name: 'Crimson Lotus Cult',
    short: 'Crimson Lotus',
    desc: 'A heterodox order of poisoners and blood-art practitioners. They claim the Blight is a doorway to power.',
    ideology: 'heterodox',
    color: '#d1465a',
    schools: ['poison', 'blade', 'internal'],
    homeKind: 'town',
    power: 60,
    wealth: 50,
  },
  {
    id: 'blackwind',
    name: 'Black Wind Bandits',
    short: 'Black Wind',
    desc: 'Outlaws who prey on caravans and refugees. Brutal, but they are not above taking a contract against the Hollows.',
    ideology: 'outlaw',
    color: '#8a8f99',
    schools: ['blade', 'movement', 'spear'],
    homeKind: 'village',
    power: 55,
    wealth: 30,
  },
];

export const FACTION_BY_ID: Record<string, FactionDef> = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

/** Starting relations, -100 (blood feud) to 100 (sworn allies). */
export function initialRelation(a: string, b: string): number {
  const key = [a, b].sort().join('|');
  const table: Record<string, number> = {
    'azure|crimson': -70,
    'azure|blackwind': -55,
    'azure|jade': 25,
    'azure|tiger': 45,
    'crimson|jade': -10,
    'crimson|tiger': -45,
    'blackwind|crimson': 10,
    'blackwind|jade': -35,
    'blackwind|tiger': -45,
    'jade|tiger': 20,
  };
  return table[key] ?? 0;
}

export const REPUTATION_TITLES: [number, string][] = [
  [-100, 'Enemy'],
  [-50, 'Distrusted'],
  [-10, 'Unwelcome'],
  [10, 'Stranger'],
  [30, 'Acquaintance'],
  [60, 'Trusted'],
  [85, 'Honored'],
];

export function reputationTitle(v: number): string {
  let title = REPUTATION_TITLES[0][1];
  for (const [min, name] of REPUTATION_TITLES) if (v >= min) title = name;
  return title;
}
