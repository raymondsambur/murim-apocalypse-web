/** Which actions an entity offers, and what a quick (right-click / long-press / second tap) does. Pure. */
import type { EntityView, NodeKind, SectRole } from '@murim/shared';

export type ContextActionId = 'talk' | 'attack' | 'assist' | 'gather' | 'inspect' | 'whisper' | 'friend' | 'sectInvite' | 'duel';

export interface ContextAction {
  id: ContextActionId;
  /** i18n key of the button label. */
  label: string;
  /** Icon name (see icons.ts). */
  glyph: string;
  primary?: boolean;
  danger?: boolean;
  /** i18n key explaining why the action is unavailable. */
  disabled?: string;
}

export interface ActionContext {
  selfId: number | null;
  selfDead: boolean;
  inCombat: boolean;
  sectRole: SectRole | null;
}

const NODE_LABEL: Record<NodeKind, { label: string; glyph: string }> = {
  herb: { label: 'act.gather', glyph: 'herb' },
  rareHerb: { label: 'act.gather', glyph: 'herb' },
  ore: { label: 'act.mine', glyph: 'pickaxe' },
  shrine: { label: 'act.pray', glyph: 'lotus' },
  heart: { label: 'act.purify', glyph: 'lotus' },
};

/** Roles of a sect that may invite others. */
export function canInviteToSect(role: SectRole | null): boolean {
  return role === 'leader' || role === 'elder';
}

export function contextActions(e: EntityView, ctx: ActionContext): ContextAction[] {
  if (ctx.selfId !== null && e.id === ctx.selfId) return [];
  const dead = e.state === 'dead';
  switch (e.kind) {
    case 'npc':
      return [{ id: 'talk', label: 'act.talk', glyph: 'chat', primary: true, disabled: ctx.selfDead ? 'act.whyDead' : undefined }];
    case 'monster': {
      const out: ContextAction[] = [];
      const busy = ctx.selfDead ? 'act.whyDead' : ctx.inCombat ? 'act.whyInCombat' : dead ? 'act.whyDown' : undefined;
      out.push({ id: 'attack', label: 'act.attack', glyph: 'swords', primary: true, danger: true, disabled: busy });
      if (e.combatId !== undefined && e.state === 'fight') out.push({ id: 'assist', label: 'act.assist', glyph: 'shield', disabled: busy });
      return out;
    }
    case 'node': {
      const n = NODE_LABEL[e.nodeKind ?? 'herb'];
      return [{ id: 'gather', label: n.label, glyph: n.glyph, primary: true, disabled: ctx.selfDead ? 'act.whyDead' : ctx.inCombat ? 'act.whyInCombat' : undefined }];
    }
    case 'player': {
      const online = e.online !== false;
      const out: ContextAction[] = [{ id: 'inspect', label: 'act.inspect', glyph: 'inspect', primary: true }];
      out.push({ id: 'whisper', label: 'act.whisper', glyph: 'whisper', disabled: online ? undefined : 'act.whyOffline' });
      out.push({ id: 'friend', label: 'act.friend', glyph: 'friend' });
      if (canInviteToSect(ctx.sectRole)) out.push({ id: 'sectInvite', label: 'act.sectInvite', glyph: 'sect' });
      out.push({ id: 'duel', label: 'act.duel', glyph: 'swords', disabled: !online ? 'act.whyOffline' : ctx.inCombat ? 'act.whyInCombat' : ctx.selfDead ? 'act.whyDead' : dead ? 'act.whyDown' : undefined });
      return out;
    }
  }
}

/** The action triggered by right-click, long-press or tapping an already selected entity. */
export function quickAction(e: EntityView, ctx: ActionContext): ContextAction | null {
  const list = contextActions(e, ctx);
  return list.find((a) => a.primary && !a.disabled) ?? null;
}

/** Short kind label key for the context card subtitle. */
export function entityKindKey(e: EntityView): string {
  switch (e.kind) {
    case 'npc':
      return `role.${e.role ?? 'villager'}`;
    case 'monster':
      return e.elite === 2 ? 'kind.boss' : e.elite === 1 ? 'kind.elite' : 'kind.monster';
    case 'node':
      return `node.${e.nodeKind ?? 'herb'}`;
    case 'player':
      return e.online === false ? 'kind.playerAway' : 'kind.player';
  }
}

/** Icon name used as a portrait for entities without a Look. */
export function entityIcon(e: EntityView): string {
  if (e.kind === 'monster') return e.elite ? 'skull' : 'paw';
  if (e.kind === 'node') return NODE_LABEL[e.nodeKind ?? 'herb'].glyph;
  if (e.kind === 'npc') return 'character';
  return 'master';
}

/** Distance in tiles between two things with x/y. */
export function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
