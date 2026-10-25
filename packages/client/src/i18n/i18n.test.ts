import { describe, expect, it } from 'vitest';
import { addStrings, hasKey, interpolate, t, tn } from './index';

// Every UI source file (not tests, the renderer, art or the dictionaries themselves) as raw text.
const SOURCES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts', '!../render/**', '!../art/**', '!../i18n/en*.ts', '!../net/mock*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('i18n', () => {
  it('interpolates params and leaves unknown placeholders visible', () => {
    expect(interpolate('Hello {name}, {n} left', { name: 'Han', n: 3 })).toBe('Hello Han, 3 left');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  it('picks plural forms and falls back to the key for missing strings', () => {
    addStrings({ 'test.item.one': '{n} item', 'test.item.other': '{n} items' });
    expect(tn('test.item', 1)).toBe('1 item');
    expect(tn('test.item', 4)).toBe('4 items');
    expect(t('definitely.not.a.key')).toBe('definitely.not.a.key');
    expect(hasKey('test.item.one')).toBe(true);
  });

  it('lets panel modules register their own strings', () => {
    addStrings({ 'mypanel.title': 'My panel' });
    expect(t('mypanel.title')).toBe('My panel');
  });

  it('has an English string for every literal key used in the UI source', () => {
    const KEY = /['"`]((?:val|err|auth|create|hud|chat|combat|conn|death|bar|map|clock|weather|state|role|kind|node|mission|npc|inv|char|bt|set|ph|panel|act|ctx|invite|inspect|boot|game|tip|common|stat|status|school|skillKind|weapon|itemKind|season|time|tactic|app)\.[A-Za-z0-9.]+)['"`]/g;
    const missing = new Set<string>();
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    for (const [file, text] of Object.entries(SOURCES)) {
      for (const m of text.matchAll(KEY)) if (!hasKey(m[1])) missing.add(`${m[1]}  (${file})`);
    }
    expect([...missing]).toEqual([]);
  });

  it('covers the dynamic key families (enums turned into keys at runtime)', () => {
    const families: Record<string, string[]> = {
      'chat.tab': ['local', 'world', 'sect', 'whisper', 'system'],
      'chat.ch': ['local', 'world', 'sect', 'whisper'],
      'chat.placeholder': ['local', 'world', 'sect', 'whisper'],
      weather: ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'],
      clock: ['dawn', 'day', 'dusk', 'night'],
      state: ['idle', 'walk', 'fight', 'work', 'meditate', 'craft', 'dead'],
      role: ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'],
      node: ['herb', 'rareHerb', 'ore', 'shrine', 'heart'],
      'mission.type': ['hunt', 'gather', 'deliver', 'purify', 'defend', 'bounty', 'investigate', 'sect'],
      'npc.tab': ['shop', 'teach', 'missions', 'rest', 'disciple'],
      'npc.shop': ['buy', 'sell'],
      'inv.slot': ['weapon', 'outfit', 'accessory'],
      'inv.sort': ['default', 'kind', 'rarity', 'value', 'name'],
      'combat.result': ['win', 'lose', 'fled', 'draw'],
      invite: ['friend', 'sect', 'master', 'duel'],
      status: ['bleed', 'poison', 'stun', 'slow', 'guard', 'buffAtk', 'buffDef', 'rot'],
      school: ['sword', 'blade', 'spear', 'staff', 'fist', 'internal', 'movement', 'medicine', 'poison'],
      skillKind: ['active', 'internal', 'movement'],
      weapon: ['sword', 'blade', 'spear', 'staff', 'fist'],
      itemKind: ['weapon', 'outfit', 'accessory', 'material', 'consumable', 'manual'],
      season: ['spring', 'summer', 'autumn', 'winter'],
      'tip.target': ['one', 'all', 'self'],
      'tactic.cond': ['always', 'hpBelow', 'qiBelow', 'qiAbove', 'enemyHpBelow', 'enemiesAtLeast', 'targetBlighted'],
      'tactic.act': ['skill', 'item', 'guard', 'flee', 'basic'],
    };
    const missing: string[] = [];
    for (const [prefix, names] of Object.entries(families)) for (const n of names) if (!hasKey(`${prefix}.${n}`)) missing.push(`${prefix}.${n}`);
    expect(missing).toEqual([]);
  });
});
