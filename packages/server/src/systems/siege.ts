/**
 * Siege battles system: war parties that march to a besieged town, defenders that fight them, the sim's result
 * played out. Implementation in `../siege/`; see docs/notes/siege-battles.md.
 *
 * Dev trigger: with `SIEGE_DEBUG=1` the server watches a command file (`SIEGE_DEBUG_FILE`, default `data/siege-debug.json`)
 * and starts / ends a siege at the settlement nearest to a named online player. Example:
 *   {"action":"start","user":"lead_tester","by":"blackwind","strength":45,"hours":3}
 *   {"action":"end","user":"lead_tester"}
 * The file is deleted once handled. It is only read when the environment flag is set.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GameContext, SystemModule } from '../ctx';
import { SiegeManager, nearestSettlementId } from '../siege';
import { getMonsterApi } from './monsters/state';

interface DebugCommand {
  action?: 'start' | 'end';
  user?: string;
  settlement?: number;
  by?: string;
  strength?: number;
  hours?: number;
  /** Set the settlement's defense (0-100) before the siege starts, to steer the sim's roll. */
  defense?: number;
}

function debugWatcher(ctx: GameContext, mgr: SiegeManager): void {
  const file = process.env.SIEGE_DEBUG_FILE ?? path.join(process.cwd(), 'data', 'siege-debug.json');
  ctx.log.warn(`SIEGE_DEBUG is on: watching ${file}`);
  ctx.every(1500, () => {
    let raw: string;
    try {
      if (!fs.existsSync(file)) return;
      raw = fs.readFileSync(file, 'utf8');
      fs.rmSync(file, { force: true });
    } catch {
      return;
    }
    let cmd: DebugCommand;
    try {
      cmd = JSON.parse(raw) as DebugCommand;
    } catch {
      ctx.log.warn('siege debug: unreadable command file');
      return;
    }
    const p = cmd.user ? ctx.players.all().find((x) => x.username === cmd.user || x.name === cmd.user) : undefined;
    const sid = typeof cmd.settlement === 'number' ? cmd.settlement : p ? nearestSettlementId(ctx, p.entity.x, p.entity.y) : -1;
    if (sid < 0 || !ctx.world.settlements[sid]) {
      ctx.log.warn('siege debug: no settlement (name an online user or a settlement id)');
      return;
    }
    if (cmd.action === 'end') {
      ctx.log.warn(`siege debug: end of the siege at ${sid} -> ${mgr.forceEnd(sid)}`);
      return;
    }
    const by = cmd.by ?? 'blight';
    const ok = mgr.forceSiege(sid, by, cmd.strength ?? 40, cmd.hours ?? 3);
    if (ok && typeof cmd.defense === 'number') ctx.sim.state.settlements[sid].defense = cmd.defense;
    ctx.log.warn(`siege debug: ${by} besiege ${ctx.world.settlements[sid].name} -> ${ok}`);
  });
}

export const register: SystemModule = (ctx) => {
  const mon = getMonsterApi(ctx);
  if (!mon) throw new Error('the siege system needs the monster module (register it first)');
  const mgr = new SiegeManager(ctx, mon);
  mgr.start();
  if (process.env.SIEGE_DEBUG === '1') debugWatcher(ctx, mgr);
};
