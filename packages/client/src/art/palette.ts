/**
 * Palette tables: character appearance, terrain per season, water, Blight and UI accents.
 * Ink-and-lacquer mood: muted naturals, warm parchment lights, violet-shifted shadows,
 * cinnabar and gold accents. Pure data + helpers (unit tested against LOOK_RANGES).
 */
import { FACTION_BY_ID, LOOK_RANGES } from '@murim/shared';
import { hex, shade, type Col } from './color';

// ---------------------------------------------------------------------------
// Character appearance (indices from Look)
// ---------------------------------------------------------------------------

export const SKIN_CSS = ['#f3dcc6', '#e8c3a1', '#d6a47c', '#bb855c', '#966343', '#6a4630'];
export const HAIR_CSS = ['#1d1a21', '#3d2a20', '#6b4129', '#8f3a24', '#26324c', '#8d8c90', '#e4e2e6', '#a8783a'];
export const OUTFIT_CSS = ['#2b2a33', '#e4ddcb', '#33457c', '#4a87c2', '#a8333b', '#3e8a66', '#7a5a3a', '#6c4a8c', '#c29a38', '#5d6772'];
export const SASH_CSS = ['#c8452d', '#d9b867', '#efeae0', '#24212b', '#4b9b5b', '#3b6bb2', '#8b4ba9', '#d97a2b'];

export const SKIN_NAMES = ['Porcelain', 'Fair', 'Wheat', 'Tan', 'Bronze', 'Umber'];
export const HAIR_STYLE_NAMES = ['Short crop', 'Topknot', 'Long loose', 'High ponytail', 'Braid', 'Shaven', 'Scholar cap'];
export const HAIR_COLOR_NAMES = ['Ink black', 'Dark brown', 'Chestnut', 'Auburn', 'Raven blue', 'Ash grey', 'Silver white', 'Honey'];
export const OUTFIT_NAMES = ['Commoner tunic', 'Scholar robe', 'Warrior jacket', 'Sect robe'];
export const OUTFIT_COLOR_NAMES = ['Ink', 'Undyed', 'Indigo', 'Azure', 'Crimson', 'Jade', 'Earth', 'Violet', 'Ochre', 'Slate'];
export const SASH_NAMES = ['Cinnabar', 'Gold', 'White', 'Black', 'Green', 'Blue', 'Purple', 'Amber'];
export const ACCESSORY_NAMES = ['None', 'Headband', 'Bamboo hat', 'Half mask', 'Hairpin'];

/** Colour ramp [shadow, base, light] from a base colour. */
export interface Ramp {
  d: Col;
  b: Col;
  l: Col;
  /** Deep shadow / outline-adjacent tone. */
  dd: Col;
}

export function ramp(base: Col | string, dark = 0.72, light = 1.18): Ramp {
  const b = typeof base === 'string' ? hex(base) : base;
  return { d: shade(b, dark), b, l: shade(b, light), dd: shade(b, dark * 0.7) };
}

const pick = <T>(arr: readonly T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length];

export const lookRamps = {
  skin: (i: number) => ramp(pick(SKIN_CSS, i), 0.8, 1.1),
  hair: (i: number) => ramp(pick(HAIR_CSS, i), 0.68, i === 6 ? 1.06 : i === 0 || i === 4 ? 1.2 : 1.32),
  outfit: (i: number) => ramp(pick(OUTFIT_CSS, i), 0.7, 1.16),
  sash: (i: number) => ramp(pick(SASH_CSS, i), 0.72, 1.18),
};

/** Swatches exported to the character-creation UI. Lengths equal LOOK_RANGES. */
export const lookSwatches = {
  skin: SKIN_CSS.slice(0, LOOK_RANGES.skin),
  hair: HAIR_CSS.slice(0, LOOK_RANGES.hairColor),
  outfit: OUTFIT_CSS.slice(0, LOOK_RANGES.outfitColor),
  sash: SASH_CSS.slice(0, LOOK_RANGES.sashColor),
};

// ---------------------------------------------------------------------------
// World accents
// ---------------------------------------------------------------------------

export const INK = hex('#1c1820');
export const INK_SOFT = hex('#2c2630');
export const LACQUER = hex('#a8302a');
export const LACQUER_DARK = hex('#6e1f1f');
export const GOLD = hex('#d9b867');
export const GOLD_DARK = hex('#9a7a38');
export const PARCHMENT = hex('#e9dcc0');
export const PLASTER = hex('#e6dcc6');
export const TIMBER = hex('#5a3a26');
export const STONE = hex('#8e8a82');

/** Neutral roof tile colour used when a settlement has no controller. */
export const ROOF_NEUTRAL = '#4e5a68';

export function factionColor(id: string | null | undefined): string | null {
  if (!id) return null;
  return FACTION_BY_ID[id]?.color ?? null;
}

/** Roof base tone per controlling faction (glazed tiles tinted toward the faction colour). */
export const FACTION_ROOF: Record<string, string> = {
  azure: '#3f5f86',
  tiger: '#8a6232',
  jade: '#3c7060',
  crimson: '#7c2f34',
  blackwind: '#38363e',
};

// ---------------------------------------------------------------------------
// Terrain palettes: [dark, base, light, accent] per season (0 spring .. 3 winter)
// ---------------------------------------------------------------------------

type Season4 = [string[], string[], string[], string[]];
const same = (p: string[], winter: string[]): Season4 => [p, p, p, winter];

/** Indexed by terrain code T. */
export const TERRAIN_PAL: Season4[] = [
  /* DeepWater */ same(['#1c4268', '#245380', '#2e6492', '#163558'], ['#1e3e5e', '#26506f', '#305f80', '#172f4a']),
  /* Water */ same(['#2f7795', '#3d8aa2', '#58a3b0', '#d8eeee'], ['#3a7690', '#4b8aa0', '#6aa3b4', '#e4f2f6']),
  /* Grass */ [
    ['#5a8a38', '#73a545', '#93c159', '#f2bfd0'],
    ['#3e6c2d', '#54873a', '#6ea146', '#e9d37a'],
    ['#6c682b', '#8a8335', '#a69a43', '#c66a2a'],
    ['#b6c1cd', '#d5dde6', '#eef2f7', '#7b8a69'],
  ],
  /* Plains */ [
    ['#7a9a44', '#93b354', '#aec866', '#ece3a4'],
    ['#7a8c3d', '#96a449', '#b2ba5b', '#d9c171'],
    ['#9a8640', '#b8a050', '#cfb866', '#a3592a'],
    ['#bcc4cd', '#d9e0e7', '#eff3f7', '#a39a72'],
  ],
  /* Forest */ [
    ['#2e5226', '#3d692e', '#4e7e38', '#86703e'],
    ['#25452a', '#32592e', '#416b34', '#5f5130'],
    ['#4b4124', '#62552c', '#7a6834', '#bb622a'],
    ['#a8b2bf', '#c5cdd8', '#e1e7ee', '#4d5943'],
  ],
  /* Dirt */ same(['#6b5138', '#87694a', '#a3845c', '#5a4531'], ['#8b8378', '#a8a196', '#cecbc5', '#6a5e50']),
  /* Road */ same(['#66625b', '#8b877d', '#a8a498', '#4a4640'], ['#959ba3', '#b6bcc4', '#dce1e7', '#6c6860']),
  /* Plaza */ same(['#837a6a', '#a39a86', '#c0b7a0', '#635b50'], ['#a2a6ac', '#c0c4ca', '#e0e4e8', '#7a746a']),
  /* Rock */ same(['#47433f', '#5d5852', '#767068', '#35312e'], ['#56545a', '#6c6a70', '#8a888e', '#3a383e']),
  /* Hill */ [
    ['#687c43', '#80944e', '#98aa5f', '#8b867b'],
    ['#5c6c3b', '#748248', '#8c9856', '#8b867b'],
    ['#786c39', '#938245', '#ab9855', '#8b867b'],
    ['#aeb6c0', '#cad1da', '#e6ebf1', '#7d7971'],
  ],
  /* Sand */ same(['#b69c68', '#d1b883', '#e3ce9b', '#9a845a'], ['#c5c1b5', '#dad6cc', '#edeae3', '#a69c87']),
  /* Snow */ same(['#a7b6ca', '#cfdae7', '#edf2f8', '#ffffff'], ['#a7b6ca', '#d2dcea', '#f0f5fa', '#ffffff']),
  /* Bridge */ same(['#4e3420', '#74522f', '#93703f', '#36241a'], ['#5e4a3a', '#86705a', '#c9c4bd', '#3e2e22']),
  /* Farm */ [
    ['#4c3421', '#68482c', '#7d5a38', '#82c652'],
    ['#4c3421', '#68482c', '#7d5a38', '#4d9838'],
    ['#4c3421', '#6a4a2e', '#7e5a38', '#d9b14a'],
    ['#8a8580', '#b4b2ae', '#dde3ea', '#6b5a48'],
  ],
  /* Ruin */ same(['#524d47', '#726c65', '#8f887e', '#2c2826'], ['#6e6c6e', '#8e8c8e', '#c2c6cc', '#3a3638']),
];

export const WATER = {
  shallow: hex('#5aa7ad'),
  mid: hex('#3b85a0'),
  deep: hex('#275d85'),
  abyss: hex('#1b3f66'),
  foam: hex('#dff0ee'),
  ice: hex('#b9d6e3'),
  iceLight: hex('#dcedf5'),
  iceCrack: hex('#8fb3c6'),
};

export const BLIGHT = {
  deep: hex('#2a1832'),
  mid: hex('#4a2a5a'),
  vein: hex('#b866ff'),
  glow: hex('#dca6ff'),
  ooze: hex('#7a2f9a'),
};

/** Minimap terrain colours (season agnostic), indexed by T. */
export const MINIMAP_CSS = [
  '#1d3f63', '#3a7f9c', '#5d8b3e', '#8fa252', '#33582f', '#8f714c', '#9c968a', '#b2a893',
  '#5e5852', '#7c8a50', '#d4bb86', '#dde5ee', '#8a6238', '#7a5a34', '#6f6962',
];

/** Name colours. */
export const NAME_COLORS = {
  self: '#fff3c4',
  player: '#cfe3ff',
  npc: '#e9cf7d',
  villager: '#a8d8a0',
  hostile: '#ff7a66',
  elite: '#ffa64d',
  boss: '#ff5ab0',
  node: '#d8f0c8',
  offline: '#9aa0aa',
};
