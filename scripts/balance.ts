import { Rng } from '../packages/shared/src/rng';
import { simulate } from '../packages/shared/src/combat';
import { autoAllocate, autoLoadout, buildPlayerCombatant, newCharacterSave } from '../packages/shared/src/character';
import { rollCharacter, randomLook } from '../packages/shared/src/stats';
import { MONSTERS, buildMonsterCombatant, pickSpecies } from '../packages/shared/src/data/monsters';
import { SKILLS } from '../packages/shared/src/data/skills';
import { rankOf } from '../packages/shared/src/ranks';
import type { CharacterSave } from '../packages/shared/src/types';

const rng = new Rng(2024);

function typicalChar(level: number, build: 'sword' | 'fist' | 'blade'): CharacterSave {
  const roll = rollCharacter(new Rng(7));
  // Normalise the roll so balance is not dominated by a lucky seed.
  for (const k of Object.keys(roll.stats) as (keyof typeof roll.stats)[]) roll.stats[k] = 10;
  roll.talents = [];
  roll.origin = 'wandering_beggar';
  const save = newCharacterSave({ id: 1, name: 'T', look: randomLook(new Rng(1)), roll, homeSettlement: 0, spawn: { x: 0, y: 0 }, now: 0, rerolls: 0 });
  const rank = rankOf(level);
  const points = (level - 1) * 2 + (rank - 1) * 5;
  save.stats = autoAllocate(save.stats, points, { might: 3, agility: 2, vitality: 3, spirit: 2, insight: 1, fortune: 1 });
  save.level = level;
  const tier = Math.min(5, 1 + Math.floor((level - 1) / 9));
  const wt = build;
  save.equipment.weapon = { id: `w_${wt}_${tier}`, qty: 1, r: 0 };
  save.equipment.outfit = { id: `o_${Math.min(5, tier)}`, qty: 1, r: 0 };
  // Skills by tier available at this rank.
  save.skills = {};
  for (const s of Object.values(SKILLS)) {
    if (s.req.rank <= rank && (s.school === wt || s.school === 'internal' || s.school === 'medicine' || s.school === 'movement')) {
      save.skills[s.id] = { lv: Math.min(10, 1 + Math.floor(level / 4)), xp: 0 };
    }
  }
  save.loadout = autoLoadout(save.skills, rank, wt);
  save.inventory = [{ id: 'pill_heal_s', qty: 3 }];
  return save;
}

function run(level: number, build: 'sword' | 'fist' | 'blade', family: 'beast' | 'bandit' | 'blight', packN: number, trials = 250) {
  let wins = 0;
  let hpLeft = 0;
  let beats = 0;
  for (let t = 0; t < trials; t++) {
    const r = new Rng(rng.int(1, 1e9));
    const save = typicalChar(level, build);
    const player = buildPlayerCombatant(save, 1, 0);
    const species = pickSpecies(r, family, level);
    const mons = Array.from({ length: packN }, (_, i) => buildMonsterCombatant(species, level, 100 + i));
    const res = simulate([player], mons, r);
    if (res.winner === 0) {
      wins++;
      hpLeft += player.hp / player.maxHp;
    }
    beats += res.beats;
  }
  return { win: wins / trials, hp: wins ? hpLeft / wins : 0, beats: beats / trials };
}

const levels = [1, 3, 5, 9, 14, 20, 27, 36, 45];
for (const build of ['sword', 'fist', 'blade'] as const) {
  console.log(`\n== ${build} ==`);
  for (const L of levels) {
    const row: string[] = [];
    for (const [fam, n] of [['beast', 1], ['beast', 3], ['bandit', 1], ['bandit', 3], ['blight', 1], ['blight', 3]] as const) {
      const r = run(L, build, fam, n, 200);
      row.push(`${fam[0]}x${n} ${(r.win * 100).toFixed(0).padStart(3)}%/${(r.hp * 100).toFixed(0).padStart(2)}%/${r.beats.toFixed(0).padStart(2)}b`);
    }
    console.log(`L${String(L).padStart(2)}: ${row.join('  ')}`);
  }
}
console.log('\n(format: winrate / avg hp left on win / avg beats)', Object.keys(MONSTERS).length, 'monster species');
