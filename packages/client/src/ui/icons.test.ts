import { describe, expect, it } from 'vitest';
import { FACTIONS, ITEMS, JOB_DEFS, MONSTERS, SKILLS } from '@murim/shared';

const SKILL_SCHOOLS_LIST = ['sword', 'blade', 'spear', 'staff', 'fist', 'internal', 'movement', 'medicine', 'poison'];
import { ICON_NAMES, emblemDataUri, emblemSvg, factionIconName, hasIcon, iconSvg, rankIconName } from './icons';
import {
  ITEM_GLYPH_ICON,
  JOB_GLYPH_ICON,
  MONSTER_GLYPH_ICON,
  SCHOOL_ICON,
  SKILL_GLYPH_ICON,
  itemIconName,
  jobIconName,
  monsterIconName,
  skillIconName,
} from './glyphMap';
import { PHASE_ICON, WEATHER_ICON } from './format';
import { STATUS_ICON } from './text/combat';
import { INVITE_ICON } from './logic/invites';
import { KIND_ICON } from './logic/world';
import { MISSION_ICON } from './logic/missions';

const CJK = /[⺀-鿿＀-￯]/;

describe('icon registry', () => {
  it('has the required families', () => {
    const need = [
      // panels and chrome
      'character', 'bag', 'skills', 'missions', 'jobs', 'world', 'social', 'settings', 'chat', 'close', 'menu',
      // currency and stats
      'coin', 'might', 'agility', 'vitality', 'spirit', 'insight', 'fortune',
      // weapons
      'sword', 'blade', 'spear', 'staff', 'fist',
      // items
      'outfit', 'ring', 'herb', 'ginseng', 'ore', 'ingot', 'hide', 'fang', 'meat', 'grain', 'cloth', 'wine', 'badge', 'core', 'dew',
      'pillHeal', 'pillQi', 'antidote', 'pillBreak', 'pillTrain', 'manual', 'cookedMeat',
      // schools
      'palm', 'internal', 'movement', 'medicine', 'poison', 'tier1', 'tier2', 'tier3', 'tier4',
      // jobs
      'herb', 'pickaxe', 'grain', 'anvil', 'cauldron', 'training',
      // weather and time
      'sun', 'moon', 'cloud', 'rain', 'storm', 'fog', 'snow', 'dawn', 'dusk',
      // statuses and settlements
      'bleed', 'stun', 'slow', 'guard', 'buffAtk', 'buffDef', 'rot', 'thriving', 'stable', 'struggling', 'besieged', 'fallen',
      // misc
      'logo', 'brokenRoad', 'unknown', 'rank1', 'rank8',
    ];
    for (const n of need) expect(hasIcon(n), n).toBe(true);
    expect(ICON_NAMES.length).toBeGreaterThan(150);
  });

  it('renders valid, theme-aware, CJK-free SVG', () => {
    for (const n of ICON_NAMES) {
      const svg = iconSvg(n, { size: 24 });
      expect(svg.startsWith('<svg'), n).toBe(true);
      expect(svg, n).toContain('currentColor');
      expect(svg, n).toContain('viewBox="0 0 24 24"');
      expect(svg, n).not.toMatch(/NaN|undefined/);
      expect(CJK.test(svg), n).toBe(false);
      expect((svg.match(/<path /g) ?? []).length, n).toBeGreaterThan(0);
    }
  });

  it('falls back to a generic icon for unknown names, never to text', () => {
    expect(hasIcon('not-an-icon')).toBe(false);
    expect(iconSvg('not-an-icon')).toBe(iconSvg('unknown'));
    expect(iconSvg('sword', { title: 'A "sword"' })).toContain('aria-label="A &quot;sword&quot;"');
    expect(iconSvg('sword')).toContain('aria-hidden="true"');
  });

  it('has faction and rank helpers', () => {
    for (const f of FACTIONS) expect(factionIconName(f.id), f.id).not.toBe('flag');
    expect(factionIconName('nobody')).toBe('flag');
    expect(rankIconName(0)).toBe('rank1');
    expect(rankIconName(99)).toBe('rank8');
  });

  it('has an emblem and a CJK-free favicon', () => {
    expect(emblemSvg()).toContain('<svg');
    const uri = decodeURIComponent(emblemDataUri());
    expect(uri.startsWith('data:image/svg+xml,<svg')).toBe(true);
    expect(CJK.test(uri)).toBe(false);
  });
});

describe('every icon name the UI references exists', () => {
  const tables: Record<string, Record<string, string>> = {
    PHASE_ICON, WEATHER_ICON, STATUS_ICON, INVITE_ICON, KIND_ICON, MISSION_ICON,
    ITEM_GLYPH_ICON, SKILL_GLYPH_ICON, MONSTER_GLYPH_ICON, JOB_GLYPH_ICON, SCHOOL_ICON,
  };
  for (const [name, table] of Object.entries(tables)) {
    it(name, () => {
      for (const [k, v] of Object.entries(table)) expect(hasIcon(v), `${name}.${k} -> ${v}`).toBe(true);
    });
  }

  it('icon names passed to icon()/glyph:/emptyGlyph in the sources exist', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const missing: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (/\.test\.ts$|glyphMap|icons\.ts$/.test(file)) continue;
      const re = /(?:\bicon|\bglyph|\bseal)\(\s*'([A-Za-z0-9]+)'|(?:\bglyph|\bemptyGlyph):\s*'([A-Za-z0-9]+)'/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const name = m[1] ?? m[2];
        if (!hasIcon(name)) missing.push(`${file}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('shared-data glyphs all map to an icon', () => {
  it('items', () => {
    const glyphs = new Set(Object.values(ITEMS).map((d) => d.glyph));
    for (const g of glyphs) expect(ITEM_GLYPH_ICON[g], `item glyph ${g}`).toBeDefined();
    for (const d of Object.values(ITEMS)) {
      const n = itemIconName(d);
      expect(hasIcon(n), d.id).toBe(true);
      expect(n, d.id).not.toBe('unknown');
    }
    expect(itemIconName(ITEMS.pill_qi_s)).toBe('pillQi');
    expect(itemIconName(ITEMS.pill_heal_s)).toBe('pillHeal');
    expect(itemIconName(ITEMS.w_spear_2)).toBe('spear');
  });

  it('skills', () => {
    const glyphs = new Set(Object.values(SKILLS).map((d) => d.glyph));
    for (const g of glyphs) expect(SKILL_GLYPH_ICON[g], `skill glyph ${g}`).toBeDefined();
    for (const d of Object.values(SKILLS)) expect(hasIcon(skillIconName(d)), d.id).toBe(true);
    for (const s of SKILL_SCHOOLS_LIST) expect(hasIcon(SCHOOL_ICON[s]), s).toBe(true);
  });

  it('monsters and jobs', () => {
    for (const m of Object.values(MONSTERS)) {
      expect(MONSTER_GLYPH_ICON[m.glyph], `monster glyph ${m.glyph}`).toBeDefined();
      expect(hasIcon(monsterIconName(m)), m.id).toBe(true);
    }
    for (const j of Object.values(JOB_DEFS)) {
      expect(JOB_GLYPH_ICON[j.glyph], `job glyph ${j.glyph}`).toBeDefined();
      expect(hasIcon(jobIconName(j)), j.id).toBe(true);
    }
  });

  it('unknown input falls back to a generic icon, not the character', () => {
    expect(itemIconName({ id: 'x', kind: 'material', glyph: 'Z' })).toBe('ore');
    expect(itemIconName(undefined)).toBe('unknown');
    expect(skillIconName({ id: 'x', school: 'poison', glyph: '?' })).toBe('poison');
    expect(monsterIconName({ id: 'x', family: 'bandit', glyph: '?' })).toBe('mask');
  });
});
