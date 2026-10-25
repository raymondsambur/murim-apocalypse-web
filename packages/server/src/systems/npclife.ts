/**
 * NPC life system: daily routines, needs, shelter and mobilisation for the sim's named NPCs.
 * Implementation in `../npclife/`; other systems read it through `getNpcLife(ctx)`.
 */
import type { SystemModule } from '../ctx';
import { npcLifeController } from '../npclife';

export const register: SystemModule = (ctx) => {
  npcLifeController(ctx).start();
};
