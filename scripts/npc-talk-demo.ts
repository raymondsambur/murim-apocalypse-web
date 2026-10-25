/**
 * Prints sample conversations from the rule-based dialogue library (no AI): different NPC voices, situations, standings,
 * rumors and how a story changes as it travels.
 *
 *   npx tsx --tsconfig packages/server/tsconfig.json scripts/npc-talk-demo.ts [seed=1]
 */
import { ALL_FRAGMENTS, Rng, composeLine, libraryStats, noteUsed, type DlgInput, type DlgRecent, type DlgRole, type DlgTopic, type DlgTrait } from '@murim/shared';
import { RumorMill, type RumorFacts, type SpreadEnv } from '../packages/server/src/npcmemory/rumors';

const seed = Number(process.argv[2] ?? 1);
const stats = libraryStats();
console.log(`Library: ${stats.total} fragments`);
console.log(Object.entries(stats.byKey).map(([k, v]) => `${k}=${v}`).join('  '));

const SLOTS = {
  player: 'Seo Mu',
  settlement: 'Reed Ford',
  kind: 'village',
  faction: 'Azure Cloud',
  controller: 'Azure Cloud',
  rank: 'Second-Rate',
  trade: 'grain',
  price: 'dear',
  elder: 'Elder Moon',
  smith: 'Gu Hwan',
  innkeeper: 'Aunt Seo',
  master: 'Master Yu',
  merchant: 'Jin Tae',
  alchemist: 'Healer Wi',
  guards: 'three',
  folk: '120',
};

function base(over: Partial<DlgInput>): DlgInput {
  return {
    topic: 'greet',
    seed,
    hour: 500,
    role: 'villager',
    traits: ['kind'],
    weather: 'clear',
    time: 'day',
    season: 'spring',
    states: ['calm'],
    standing: 'unknown',
    moods: ['content'],
    deeds: [],
    slots: { ...SLOTS, npc: 'Someone' },
    ...over,
  };
}

function scene(title: string, npc: { name: string; role: DlgRole; traits: DlgTrait[] }, over: Partial<DlgInput>, topics: (DlgTopic | 'rumor')[]): void {
  console.log(`\n=== ${title}: ${npc.name} (${npc.role}; ${npc.traits.join(', ')}) ===`);
  const recent: DlgRecent = {};
  let n = 0;
  for (const topic of topics) {
    const inp = base({ ...over, topic, role: npc.role, traits: npc.traits, recent, seed: seed * 1000 + n++, hour: 500 + n, slots: { ...SLOTS, ...over.slots, npc: npc.name } });
    const out = composeLine(inp);
    if (out) noteUsed(recent, out.ids, inp.hour);
    console.log(`  [${topic}] ${out?.text ?? '(nothing)'}`);
  }
}

const all: DlgTopic[] = ['greet', 'news', 'town', 'folk', 'me', 'blight', 'work'];

scene('Gruff guard at the gate', { name: 'Han Ju', role: 'guard', traits: ['gruff', 'weary'] }, { time: 'night', weather: 'rain', moods: ['tired'] }, all);
scene('Gossipy innkeeper', { name: 'Aunt Seo', role: 'innkeeper', traits: ['cheerful', 'cunning'] }, { time: 'dusk' }, all);
scene('Scholarly elder in a famine', { name: 'Elder Moon', role: 'elder', traits: ['scholarly', 'kind'] }, { states: ['famine'], moods: ['hungry'], season: 'winter', weather: 'snow' }, all);
scene('Greedy merchant, player is an honoured hero', { name: 'Jin Tae', role: 'merchant', traits: ['greedy', 'boastful'] }, { standing: 'honoured', deeds: [{ kind: 'savedTown', weight: 7, ageHours: 60 }, { kind: 'killedBandits', weight: 4, ageHours: 30 }] }, ['greet', 'me', 'greet', 'me', 'work']);
scene('Devout physician in a plague', { name: 'Healer Wi', role: 'physician', traits: ['devout', 'honest'] }, { states: ['plague'], moods: ['worried'] }, ['greet', 'town', 'blight', 'work', 'news']);
scene('Weary farmer, a feared duellist asks', { name: 'Old Baek', role: 'villager', traits: ['weary', 'superstitious'] }, { standing: 'feared', deeds: [{ kind: 'duelWon', weight: 6, ageHours: 20 }], states: ['blighted'], moods: ['afraid'] }, ['greet', 'me', 'blight', 'work']);
scene('Legend, siege day', { name: 'Black Wind Jin', role: 'legend', traits: ['gruff', 'honest'] }, { states: ['siege'], slots: { title: 'the Hollow King' } }, ['greet', 'work', 'blight']);
scene('Town that despises the player', { name: 'Smith Gu', role: 'smith', traits: ['stern', 'honest'] }, { standing: 'despised', deeds: [{ kind: 'insult', weight: 5, ageHours: 12 }] }, ['greet', 'me', 'town']);

// ---------------------------------------------------------------------------
// One story, five tellings
// ---------------------------------------------------------------------------

console.log('\n=== How a rumor changes on the road: five settlements, a chain of tellers ===');
const NAMES = ['Reed Ford', 'Iron Gate', 'Tea Hill', 'Black Market', 'Far Peak'];
const POS: [number, number][] = [[0, 0], [40, 0], [90, 10], [150, 20], [220, 40]];
const TRAITS: string[][] = [['honest'], ['boastful', 'cheerful'], ['weary', 'stern'], ['superstitious', 'cunning'], ['boastful']];
const env: SpreadEnv = {
  neighbors: (i) => [i - 1, i + 1].filter((j) => j >= 0 && j < 5),
  distance: (a, b) => Math.hypot(POS[a][0] - POS[b][0], POS[a][1] - POS[b][1]),
  road: () => 'open',
  alive: () => true,
  gossip: () => 0.9,
  npcs: (s) => Array.from({ length: 6 }, (_, i) => ({ id: s * 100 + i, traits: TRAITS[s], role: i === 0 ? 'innkeeper' : 'villager' })),
  factionIds: () => ['azure', 'tiger', 'jade', 'crimson', 'blackwind'],
  settlementIds: () => [0, 1, 2, 3, 4],
};
const mill = new RumorMill(null, new Rng(seed));
const facts: RumorFacts = { kind: 'hollowSiege', place: 0, n: 12, sev: 0 };
const rumor = mill.add({ topic: 'chronicle', facts, importance: 3, origin: 0, hour: 0 }, env)!;
for (let h = 1; h < 400 && Object.keys(rumor.known).length < 5; h++) mill.stepHour(env, h);
const nameOf = (i: number | undefined): string | undefined => (i === undefined ? undefined : NAMES[i]);
for (const sid of Object.keys(rumor.known).map(Number)) {
  const k = rumor.known[sid];
  const rum = { kind: k.facts.kind, truth: k.truth, about: 'other' as const, slots: { 'rumor.place': nameOf(k.facts.place)!, ...(k.facts.n ? { 'rumor.n': String(k.facts.n) } : {}), 'rumor.age': 'a few days ago' } };
  const out = composeLine(base({ topic: 'rumor', seed: seed + sid, role: 'villager', traits: TRAITS[sid] as DlgTrait[], rumor: rum }));
  console.log(`  ${NAMES[sid].padEnd(13)} learned at hour ${String(k.since).padStart(3)} (hop ${k.hops}, truth ${k.truth.toFixed(2)}, kind ${k.facts.kind}, n=${k.facts.n}): ${out?.text}`);
}
console.log(`\nTotal distinct fragments in the library: ${ALL_FRAGMENTS.length}`);
