/**
 * Fan sim events returned by `sim.recordKill` / `sim.damageHeart` out to clients the way the core does for the
 * hourly events (chronicle lines, settlement changes, blight patches). Owner: gameplay-combat.
 */
import type { ChronicleEntry, SimEvent } from '@murim/shared';
import type { GameContext } from '../../ctx';

const BLIGHT_FULL_THRESHOLD = 4000;

export function publishSimEvents(ctx: GameContext, events: readonly SimEvent[]): void {
  if (!events.length) return;
  const chron: ChronicleEntry[] = [];
  const settle = new Set<number>();
  const blight = new Set<number>();
  for (const ev of events) {
    if (ev.k === 'chron') chron.push(ev.entry);
    else if (ev.k === 'settle') settle.add(ev.id);
    else if (ev.k === 'siege') settle.add(ev.settlementId);
    else if (ev.k === 'blight') for (const i of ev.idx) blight.add(i);
  }
  if (chron.length) ctx.broadcast({ t: 'chron', entries: chron });
  if (settle.size) {
    const list = [...settle].flatMap((id) => {
      try {
        return [ctx.sim.settlementView(id)];
      } catch {
        return [];
      }
    });
    if (list.length) ctx.broadcast({ t: 'settle', list });
  }
  if (blight.size > BLIGHT_FULL_THRESHOLD) ctx.broadcast({ t: 'blight', full: ctx.sim.blightBase64() });
  else if (blight.size) {
    const idx = [...blight].sort((a, b) => a - b);
    const map = ctx.sim.state.blight;
    ctx.broadcast({ t: 'blight', idx, val: idx.map((i) => map[i] ?? 0) });
  }
}
