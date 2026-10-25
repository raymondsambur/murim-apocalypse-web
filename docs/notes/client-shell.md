# Client shell - API summary and how to add a panel

Owner: client-shell. Audience: wave-2 UI engineers (skills & build, missions, jobs & crafting, world, social) and anyone touching `packages/client/src/{net,state,ui,i18n}`.

## Running it

| Task | Command |
|---|---|
| Client against the **mock** (no server needed) | `npx vite packages/client --port 5202 --strictPort`, open `http://localhost:5202/?mock=1` |
| Faster world clock in the mock | `?mock=1&fast=1` (one world hour = 6 s) |
| Client against the **real server** | `SIM_STUB=1 npm run dev:server` (port 3000) + `npx vite packages/client --port 5202 --strictPort`; Vite proxies `/api` and `/ws` |
| Force the placeholder renderer | add `&standin=1` (useful while `src/render` is unfinished) |
| Unit tests | `npx vitest run packages/client` |
| Type check / build | `npx tsc -p packages/client`, `npx vite build packages/client` |

Debug handles (only with `?mock=1` or the Vite dev server): `window.__murim = { store, ui, socket }`, `window.__app`, and with the mock `window.__mock = { drop(), kick(reason), failNext(n), reset(), game }` (`game.debugGive(id, qty)`, `debugGold(n)`, `debugXp(n)`, `debugHurt()`). Mock accounts live in `localStorage` (`murim.mock.db.v1`); `__mock.reset()` wipes them.

## Layout

```
index.html  src/main.ts            entry; ?mock=1 dynamic-imports net/mock.ts
src/styles.css + src/styles/*.css  design system (tokens, components, screens, hud, panels)
src/i18n/                          t()/tn()/addStrings(); en.ts (core text) + en.app.ts (screens, HUD, panels)
src/net/                           api.ts (HTTP), socket.ts (GameSocket), base64.ts, mock.ts + mockGame.ts (dev server)
src/state/                         store.ts (Store), dispatch.ts (S2C -> store + renderer), session.ts, chatCommands.ts
src/ui/app.ts                      flow: boot -> auth -> creation -> game (owns Store + SettingsStore)
src/ui/screens/                    auth, create, game (HUD composition), inkBackdrop, screen
src/ui/hud/                        playerCard, clock, minimap, chatDock, actionBar, contextCard, combatHud, npcDialog,
                                   overlays (loading / reconnect / death), invites, interaction (taps), keys, fps, inspect
src/ui/logic/                      pure, unit-tested rules behind the HUD (interact, inventory, breakthrough, npc, chat...)
src/ui/panels/                     registry.ts, manager.ts, index.ts, character, inventory, settings + placeholders
src/ui/widgets/                    bar, tabs, itemSlot/itemGrid, tooltip, modal, stepper, toast
src/ui/text/                       tips.ts (tooltip models), combat.ts (combat events / tactics in words)
src/ui/standin/render.ts           placeholder RenderModule (used only if src/render/index.ts is missing or ?standin=1)
```

## The panel API (what you will use)

A panel is **one file** plus **one import line** in `ui/panels/index.ts`.

```ts
// ui/panels/registry.ts
interface PanelDef {
  id: string;                 // 'skills', 'missions'... (keep the ids of the placeholders)
  title: string;              // i18n key
  glyph: string;              // one CJK glyph for the title seal and the action bar
  hotkey?: string;            // single letter, case-insensitive
  order?: number;             // action bar position (character 10, inventory 20, skills 30, missions 40, jobs 50, world 60, social 70, settings 90)
  width?: number;             // desktop width in px at UI scale 1 (default 420)
  watch?: StoreKey[];         // store keys that re-render the panel while open (default ['me']; [] = never)
  bar?: boolean;              // show on the action bar (default true)
  placeholder?: boolean;      // shows a "Draft" chip in the title bar
  render(root: HTMLElement, ui: UiContext): void;               // build into the empty root (called on open and on every watched change)
  update?(root, ui, changed: Set<StoreKey>): boolean | void;    // optional targeted update; return true to skip the full re-render
  onOpen?(ui): void;  onClose?(ui): void;
}
```

Behaviour of `PanelManager`: draggable windows on desktop (positions remembered in `localStorage`), full-screen sheets at <= 760 px, several open at once, hotkeys, Esc closes the top one. Re-renders are coalesced per frame and **deferred while the player is typing inside the panel** (they run on blur). Scroll positions of elements with `data-scroll-key="..."` are kept across re-renders. Module-level variables are the simplest way to keep selection / tab state (see `inventory.ts`). `ui.panels.refresh(id?)` forces a re-render, `show/toggle/close/closeAll/closeTop/isOpen/openIds/onChange/resetPositions` are public.

### `UiContext` (`ui`, passed to every panel and HUD part; `ui/context.ts`)

```ts
interface UiContext {
  state: Store;                       // get(key) / subscribe(keys, fn) / selfId() / selfEntity() / entityByName() / selfVitals() / serverNow()
  net: { send(msg: C2S): boolean; query<N>(name, args): Promise<Queries[N]['res']>; connected; latency };
  gameView: GameViewApi;              // centerOn, setSelected, setZoom, nearby(r), getEntity(id), fx(...) ...
  render: RenderModule;               // drawLookPreview, lookSwatches (prefer ui/portrait.ts drawLook(), see below)
  panels: PanelManager;  settings: SettingsStore;  t: typeof t;
  toast(text, level?): void;          confirm(o: ConfirmOptions): Promise<boolean>;
  tooltips: { item, skill, talent };  // builders returning DOM, see widgets
  chat(prefill?): void;               // focus the chat input, e.g. ui.chat('/w Name ')
  inspectPlayer({ id?, name? }): void;  select(entityId | null): void;  interact(entityId): void;  closeNpc(): void;  logout(): void;
}
```

`query` rejects with `QueryError` (`code: 'timeout' | 'disconnected' | 'server'`, `serverCode`); turn it into text with `queryErrorMessage(e)` from `ui/errors.ts`.

### Store keys (`state/store.ts`)

`me` (MeView), `entities` (Map id -> EntityView, kept in sync with `ents`), `time`, `settlements` (Map), `chronicle`, `chat` (per channel `{lines, unread}`), `chatTab`, `notes`, `combat` (`{view, log, names, ended}`), `combatResult`, `npc` (NpcMenu | null), `conn`, `selected`, `invites`, `world` (DecodedWorld), `serverOffset`, `latency`, `lastWhisper`, `kicked`. Subscribe with `ui.state.subscribe('me', fn)` (returns an unsubscribe). Reducers (`applyMe`, `addChat`, `addNote`, ...) are called by `dispatch.ts`; panels normally only read.

### Widgets (`ui/widgets`, `ui/dom.ts`, `ui/forms.ts`, `ui/portrait.ts`)

```ts
h('div', { class: 'card', onclick }, ...children)                 // DOM builder; mount(el, ...children) replaces children
bar('hp'|'qi'|'xp'|'gold'|'job'|'enemy', { label, tag?, size?: 'sm'|'md'|'lg', text? }) -> { el, set(value, max, text?) }
tabs([{ id, label, glyph?, badge? }], onSelect, { initial?, label?, cls? }) -> { el, select(id, notify?), setBadge(id, n), current() }
itemSlot(stack | null, { size?, onClick?, emptyGlyph?, selected?, tipOptions? }) -> HTMLButtonElement   // rarity border + glyph + qty + tooltip
itemGrid(stacks, slots, { order?, selected?, onClick(stack, idx, el)?, tipOptions?(stack, idx)?, enabled?, label? })
attachTooltip(el, () => Node | string, { delay? })                                  // hover / focus / long-press
itemTooltip(stack, opts?) skillTooltip(id, level?, opts?) talentTooltip(id)          // DOM; models in ui/text/tips.ts are pure
openModal((close) => Child, { title, glyph?, cls? }) / confirmModal({ title, text?, ok?, cancel?, danger? }): Promise<boolean>
stepper({ value, min, max, label, onChange }) -> { el, get(), set(v), setMax(m) }
toast(text, level?, { ttl?, action? })
textField({ id, label, validate?, ... }) -> { el, input, get(), validate(show?), setError(msg) }   // ui/forms.ts
drawLook(render, canvas, look, cssW, cssH, scale, opts?)                              // crisp for the device pixel ratio; falls back to the stand-in preview if the real one paints nothing
```

Formatting and rules helpers: `ui/format.ts` (`fmtInt`, `fmtCompact`, `fmtDuration`, `rankColor`, `worldClock`, `seasonName`...), `ui/text/combat.ts` (`describeCombatEvent`, `describeTactic`, `skillName`, `statusName`, `STATUS_GLYPH`), `ui/text/tips.ts` (`itemTipModel`, `skillTipModel`, `requirementLines`, `passiveLines`, `sellPrice`), `ui/logic/*` (`breakthroughStatus(me)`, `sortOrder`, `npcTabs`, `contextActions`, ...). All DOM-free and covered by tests.

### i18n

Every string goes through `t('key', { param })` (`tn('key', n)` picks `key.one` / `key.other`). Core text is in `i18n/en.ts` and `i18n/en.app.ts`. **A panel may keep its strings in its own file**: `addStrings({ 'skills.title': '...' })` at module scope. `i18n.test.ts` fails the build if a literal key used anywhere in the UI source has no English string.

### CSS

Design tokens are CSS variables in `styles/tokens.css` (`--gold`, `--cinnabar`, `--paper-*`, `--text*`, `--good/--bad/--warn/--info`...). Re-use classes from `styles/components.css`: `.btn` (+ `-primary -gold -ghost -danger -sm -xs`), `.btn-icon`, `.chip` (+ `-good -bad -warn -gold -info`), `.card`, `.scroll` (light parchment for quotes), `.sect-title`, `.kv` (key/value list), `.field/.input/.select/.switch/.range`, `.tabs`, `.slot`, `.item-grid`, `.bar-*`. Panel-specific CSS: create `src/styles/panels/<name>.css` and `import '../../styles/panels/<name>.css'` from your panel file (Vite bundles it). Keep tap targets >= 2.5rem (the `.btn*` classes do this on coarse pointers), use `rem` so the UI-scale setting works, and put narrow-screen rules under `@media (max-width: 760px)` (same breakpoint as `NARROW_QUERY` in `ui/dom.ts`).

## Example: adding a panel

```ts
// packages/client/src/ui/panels/friends.ts
import { addStrings, t } from '../../i18n';
import { h, mount } from '../dom';
import { queryErrorMessage } from '../errors';
import { registerPanel } from './registry';

addStrings({ 'friends.title': 'Friends', 'friends.empty': 'No friends yet.' });

registerPanel({
  id: 'social',                      // replaces the placeholder with the same id (the later registration wins)
  title: 'friends.title',
  glyph: '友',
  hotkey: 'f',
  order: 70,
  watch: ['me'],
  onOpen: (ui) => void ui.net.query('friends', {}).catch((e) => ui.toast(queryErrorMessage(e), 'bad')),
  render(root, ui) {
    const me = ui.state.get('me');
    mount(root, h('p', { class: 'empty-note' }, t('friends.empty')), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ui.chat('/w ') }, t('act.whisper')));
    void me;
  },
});
```

Then delete the `import './social'` placeholder line (or overwrite the placeholder file) in `ui/panels/index.ts`, and add the import for your file. Placeholders to replace: `skills` (K), `missions` (M), `jobs` (J), `world` (O), `social` (F).

## Behaviour worth knowing

- **Flow** (`ui/app.ts`): `GET /api/me` -> auth screen / creation / game. Creation calls `POST /api/character/roll {reroll:false}` for the pending (or first, free) roll and `{reroll:true}` to reroll. Entering the game loads `/api/world`, decodes the grids, creates the `GameView`, opens the socket and shows a loading overlay until `hello`.
- **Connection**: `GameSocket` reconnects with exponential backoff (500 ms .. 15 s, +-25 % jitter); each `hello` rebuilds the entity table. Overlay states: loading, reconnecting (attempt + countdown + "Retry now"), replaced (4001), expired (4002), banned (4003), kicked, failed. A refused WebSocket upgrade (HTTP 401) looks like a network error, so while reconnecting (attempts 2, 4, 8...) the client asks `/api/me`; a 401 sends the player back to sign-in.
- **Interaction**: tap ground = `move` + target marker (cleared on arrival); tap entity = select + context card; tap the selected entity again, right-click or long-press = quick action (Talk / Attack / Gather / Inspect). Hotkeys: C I K M J O F, Enter or `/` focuses chat, Esc closes dialog -> sheets -> panels -> selection.
- **Entity patches**: the store follows the server convention that a walk ends with `nx = x, ny = y, step = 0` (treated as "standing still").
- **Placeholder renderer**: `ui/renderLoader.ts` uses `src/render/index.ts` when present; `drawLook` falls back to the stand-in sprite if the real `drawLookPreview` paints nothing.

## Not done / placeholders

Skills & Build, Missions, Jobs & Crafting, World, Social are labelled placeholder panels (with live one-line data). Settings has no audio options (no audio yet). The NPC dialog (shop / teach / missions / rest / disciple) is complete against the protocol but was exercised only against the mock; the real server does not send `npc` menus yet.

## Contract notes (found while building)

1. `RollPreview.origin.items` / `.skills` are display strings from the real server (`"Raw Meat x3"`, `"Piercing Spear"`); the client resolves them by name (and by id for the mock). Document it or send ids + qty.
2. Entity id vs character id is ambiguous in `DuelOp.id`, `MasterOp.id`, `FriendOp.id`, `invite.fromId`, `ChatMsg.fromId` and `Queries.player.args.id`. The client only knows entity ids for things in the world and uses **names** for friend/sect invites and player inspection, and the entity id for `duel challenge`.
3. Failed queries arrive as `{ok:false, err: code, data:{text}}`; `Queries`/`S2C` types do not mention `data.text`. The client shows `text` when present.
4. `POST /api/logout` exists on the server but not in `protocol.ts`.
5. `render/api.ts`: `LookPreviewOptions.scale` is treated as the absolute sprite-pixel scale (the client passes `scale x devicePixelRatio`); the real `drawLookPreview` is still a no-op, so portraits use the stand-in. `PickResult.entityId` may be the player itself; the client ignores it.
