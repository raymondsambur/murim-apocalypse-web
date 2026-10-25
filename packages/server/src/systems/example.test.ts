/**
 * Executable version of the "how to add a system" example in docs/notes/server-core.md.
 * It exercises the extension API the way gameplay modules will: commands, interactions, timers,
 * entities with typed data, module migrations, hooks and cross-system events.
 */
import { describe, expect, it } from 'vitest';
import { DataKey, GameError, NPC_DATA, type GameContext, type SystemModule } from '../ctx';
import { makeHarness } from '../testkit';

const REST_PRICE = 5;

interface WolfState {
  spawnId: number;
  hits: number;
}
const WOLF = new DataKey<WolfState>('wolf');

declare module '../ctx' {
  interface GameEvents {
    wolfBitten: { player: import('../ctx').Player; wolf: import('../ctx').Entity };
  }
}

export const register: SystemModule = (ctx: GameContext) => {
  // 1. Own tables: versioned per module, applied once.
  ctx.db.migrateModule('example', ['CREATE TABLE example_stays (char_id INTEGER NOT NULL, at INTEGER NOT NULL)']);

  // 2. A client command. Throw GameError to refuse; anything else becomes a generic 'internal' error.
  ctx.command('rest', (p, m) => {
    const npc = ctx.npcEntity(m.npc);
    if (!npc || Math.hypot(npc.x - p.entity.x, npc.y - p.entity.y) > 3) throw new GameError('too_far', 'Walk up to the innkeeper first.');
    if (p.save.gold < REST_PRICE) throw new GameError('no_gold', 'You cannot afford a room.');
    p.save.gold -= REST_PRICE;
    p.save.hp = p.entity.maxHp ?? p.save.hp;
    ctx.db.run('INSERT INTO example_stays (char_id, at) VALUES (?, ?)', p.charId, ctx.now());
    ctx.markDirty(p); // persist soon
    ctx.markMe(p); // refresh the client's `me` view and the entity's hp
    ctx.notify(p, 'good', 'You wake fully rested.');
  });

  // 3. Entities with module-private state, spawned at registration time.
  const spawn = ctx.world.settlements[0].spawn;
  const wolf = ctx.entities.create({ kind: 'monster', name: 'Grey Wolf', x: spawn.x + 2, y: spawn.y, sprite: 'wolf', lv: 2, hp: 30, maxHp: 30 });
  WOLF.set(wolf, { spawnId: 1, hits: 0 });

  // 4. What happens when a player walks up to something (the core does the walking).
  ctx.onInteract('monster', (p, e) => {
    const st = WOLF.get(e);
    if (!st) return false;
    st.hits++;
    e.hp = Math.max(0, (e.hp ?? 0) - 10);
    ctx.entities.touch(e); // visible fields changed: clients get a patch this tick
    ctx.events.emit('wolfBitten', { player: p, wolf: e });
    return true;
  });

  // 5. Timers run on the game loop; handlers can never crash it.
  ctx.every(1000, () => {
    for (const e of ctx.entities.ofKind('monster')) {
      if (WOLF.get(e) && (e.hp ?? 0) < (e.maxHp ?? 0)) {
        e.hp = Math.min(e.maxHp!, (e.hp ?? 0) + 1);
        ctx.entities.touch(e);
      }
    }
  });

  // 6. Decorate what the core sends and keeps.
  ctx.onBuildMe((p, me) => {
    if (p.data.example) me.master = { id: 1, name: 'Example Master', npc: true };
  });
  ctx.onSave((p) => {
    p.save.title ||= '';
  });
};

describe('example system (the documented pattern)', () => {
  it('commands, entities, interaction, timers, events and tables work together', () => {
    const h = makeHarness();
    register(h.game.ctx);

    const { p, conn } = h.join('Hero');
    const bitten: string[] = [];
    h.game.ctx.events.on('wolfBitten', (ev) => void bitten.push(`${ev.player.name}:${ev.wolf.name}`));

    // Interaction walks to the wolf and triggers the handler.
    h.tick(2);
    const wolf = h.game.entities.ofKind('monster')[0];
    h.say(p, { t: 'interact', id: wolf.id });
    h.tick(40);
    expect(bitten).toEqual(['Hero:Grey Wolf']);
    // Bitten for 10, then healing 1 hp per second while the player walked up.
    expect(wolf.hp).toBeGreaterThanOrEqual(20);
    expect(wolf.hp).toBeLessThan(30);
    const patch = conn.of('ents').flatMap((m) => m.upd ?? []).find((u) => u.id === wolf.id && u.hp !== undefined && u.hp < 30);
    expect(patch).toBeTruthy();

    // The timer keeps healing it.
    const before = wolf.hp!;
    h.tick(20);
    expect(wolf.hp).toBeGreaterThan(before);

    // The rest command: refusals and success.
    const npcEntity = h.game.entities.nearest(p.entity.x, p.entity.y, 3, (e) => e.kind === 'npc') ?? h.game.entities.nearest(p.entity.x, p.entity.y, 30, (e) => e.kind === 'npc')!;
    h.game.movement.teleport(p.entity, npcEntity.x, npcEntity.y);
    const npc = { id: NPC_DATA.get(npcEntity)!.npcId };
    p.save.gold = 2;
    h.say(p, { t: 'rest', npc: npc.id });
    h.tick();
    expect(conn.last('err')?.code).toBe('no_gold');
    p.save.gold = 50;
    p.save.hp = 1;
    h.say(p, { t: 'rest', npc: npc.id });
    h.tick();
    expect(p.save.gold).toBe(45);
    expect(p.save.hp).toBe(p.entity.maxHp);
    expect(h.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM example_stays')?.n).toBe(1);
    expect(conn.last('note')?.text).toBe('You wake fully rested.');

    p.data.example = true;
    h.game.ctx.markMe(p);
    h.tick(4);
    expect(conn.last('me')?.me.master?.name).toBe('Example Master');
    h.close();
  });
});
