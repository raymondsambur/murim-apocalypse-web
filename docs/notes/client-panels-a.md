# Client panels A - Skills & Build, Missions, NPC dialog on the real server

Owner: client-panels-A. Files: `ui/panels/{skills,missions}.ts`, `styles/panels/{skills,missions}.css`, `ui/logic/{build,missions}.ts` (+ small additions to `ui/logic/npc.ts`), `ui/logic/panelsA.test.ts`, `net/mockPanelsA.ts` (used by `net/mockGame.ts`), `ui/hud/npcDialog.ts` (fixes).

## Skills & Build (K)
Tabs Arts / Loadout / Stance / Tactics. All edits go into a module-level **draft**; the bottom bar shows "Unsaved changes" with Apply / Revert. Apply sends `{t:'build', loadout, stance, tactics}` after the same checks as the server (`logic/build.ts: validateDraft`); a refusal arrives as the normal `err` toast and the draft stays editable (the "Saving..." state clears after 3.5 s without a `me`). When the server `me` changes and the draft was clean it follows; if dirty it is kept and reconciled (new rank slots, forgotten arts).
- Loadout: active slots = `activeSlots(rank)`, one internal and one movement slot. Tap a slot, then an art (works on touch); desktop also supports drag from the tray onto a slot, slot to slot (swap) and slot back to the tray (empty). Passive preview = `deriveForCharacter` with the draft loadout vs the saved one.
- Tactics: up to 6 rules, friendly editors per `Cond` / `Act` (value ranges as the server: percentages 0..100 integer, `enemiesAtLeast` 1..20), skills only from the draft loadout, items only combat consumables (bag plus ones already used), up/down/delete/add/reset, plain-English summary through `describeTactic`. A rule whose skill left the loadout is flagged and blocks Apply.
- Typing in a number field updates the draft and the Apply bar in place (no re-render, so focus is kept).
- Strings: `sk.*`, `build.*` via `addStrings` in `skills.ts`.

## Missions (M)
- Active: sorted ready first, progress bar `progress / count`, type seal, level, days left (world days from `time`, red on the last day), objective sentence, reward chips (xp, gold, reputation, item slots), hand-in hint (settlement name, distance and compass direction, or "you are close"), "Ready to hand in" highlight and a badge on the tab, Abandon with confirm, completed counter line.
- Board: nearest settlement within `radius + 6` tiles of the player (the server's `board` range); offers with level, minimum rank, days left, rewards; Accept disabled with the reason (already accepted, 6 missions, rank, one bounty at a time); out of range shows the nearest town and direction. Re-queried on open, after Accept and on the refresh button.
- Reacts to `{t:'mission'}` (store merges into `me.c.missions`) and to every `me`. Strings: `ms.*`.

## NPC dialog vs the real server (fixed)
1. The real server never re-sends `{t:'npc'}` after buy / sell / learn / rest / mturnin (only `me` + a toast). The dialog now re-queries `q npc` (debounced 250 ms) when `menuSignature(me)` (gold, bag, skill count, mission ids/done, reputation, level) changes, so prices, `ok` flags and turn-ins stay current. The mock no longer pushes the menu either, so this path is exercised.
2. Rest: the server refuses `not_needed` only when hp/qi are full **and** not injured; the dialog disabled the button on full hp/qi even when injured. Fixed (`restNeeded`).
3. Manuals are never bought by any shop; they are no longer listed in the Sell tab.
4. `maccept` gives `one_bounty`; the dialog now disables a second bounty with a reason (`npc.mission.oneBounty` in `en.app.ts`).

## Mismatches found (for the lead)
- Sell price shown by the client is `floor(stackValue * sellMult)`; the server multiplies by the market price (`clamp(priceMult, 0.6, 1.5)`) and the menu does not expose it, so the real payout can differ. Suggest adding `sellPrices` to `NpcMenu.shop` or sending per-item multipliers.
- A shop only accepts its trade (general / weapons / medicine / food). `NpcMenu` does not say which, so the Sell tab lists everything and relies on the `shop_refuses` toast. Suggest `shop.kind` or `shop.accepts: string[]`.
- `build` has no server-side check that an `item` tactic is in the bag (only that it is a combat consumable); the client warns ("none in your bag") but allows it.
- `mission` updates carry no message when a mission is handed in, abandoned or expires (documented); the panels simply drop it from `me.c.missions`. `completedMissions` rises with the same `me`.
- Mission "where to hand in": the server takes the turn-in at elder / guard / master / merchant of `settlementId` (deliver: `target.toSettlement`); there is no NPC id or tile in `ActiveMission`, so the hint is the settlement name plus distance and compass direction.
- The mock's `err` replies for `mturnin` etc. now use the real codes (`not_done`, `no_taker`, `too_far`, `gone`, `duplicate`, `too_many`, `rank_low`, `one_bounty`, `bad_build`, `not_needed`, `no_gold`, `in_combat`).

## Mock additions (`?mock=1`)
`checkBuild` (server-equivalent validation), board range (`too_far`), accept removes the offer from the board, abandon returns it, turn-in needs a done mission and the right NPC, gather progress follows the bag, rest price `10 + 3 * level` and clears injury. Debug: `__mock.game.debugLearn('all')` (or one skill id), `debugGold(n)`, `debugGive(id, qty)`.

## Known gaps
- No automated DOM tests (the vitest environment is node); logic is covered by `ui/logic/panelsA.test.ts`.
- The Arts tab has no "forget" or sort options; hotkey K and M only.
- The mock board has no deliver or defend offers.
