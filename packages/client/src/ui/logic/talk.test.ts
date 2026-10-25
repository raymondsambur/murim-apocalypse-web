import type { NpcMenu } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { npcTabs } from './npc';

const menu = (o: Partial<NpcMenu>): NpcMenu => ({ id: 1, name: 'N', role: 'villager', title: '', faction: null, settlementId: 0, look: {} as never, level: 1, greeting: '', turnIns: [], ...o });

describe('talk tab', () => {
  it('appears last, and alone for NPCs that only talk', () => {
    const talk = { topics: [{ id: 'news', label: 'Any news?' }] };
    expect(npcTabs(menu({ talk }))).toEqual(['talk']);
    expect(npcTabs(menu({ role: 'elder', talk }))).toEqual(['missions', 'talk']);
    expect(npcTabs(menu({ shop: { entries: [], sellMult: 0.5 }, restPrice: 5, talk }))).toEqual(['shop', 'rest', 'talk']);
  });
});
