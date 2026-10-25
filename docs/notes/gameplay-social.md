# Gameplay: social (sects, masters, friends, duels)

Owner: gameplay-social. Code: `packages/server/src/systems/{sects,masters,friends,duels,social}.ts` (+ `*.test.ts`, `social.testkit.ts`).
Audience: the Social panel / HUD (client) and the lead wiring modules together.

## Id conventions (lead's rule, implemented as written)

| Where | Id kind |
|---|---|
| `duel challenge {id}` | ENTITY id of the target player |
| `duel accept/decline {id}` | CHARACTER id of the challenger (= `invite.fromId`) |
| `friend accept/decline/remove {id}`, `sect kick/promote {id}`, `master accept/decline/dismiss/teach {id}`, `master request {id}` | CHARACTER id |
| `friend add {name}`, `sect invite {name}` | exact character name (case-insensitive) |
| `master request {npc}` | NPC id (`NpcMenu.id`) |
| `invite.fromId` | CHARACTER id (duel invites also carry `data.entity` = challenger's entity id) |

Errors are the usual `{t:'err', code, text}`; `text` is player-facing. Codes are listed per op below.

## Sects

Tables `sects`, `sect_members` (module `sects`). In-memory mirror; `save.sectId` is rewritten from the table on every save and on login (self-healing). Offline members are updated through their `characters` row (or the in-memory save of an offline worker). Players who were kicked / whose sect was disbanded while offline get a note on next login (`social_mail`).

- Roles: `leader > elder > disciple > outer`. New members start as `outer`.
- Ops (all `{t:'sect', ...}`):

| op | who | rules / error codes |
|---|---|---|
| `create {name, tag, motto?}` | no sect | rank >= 2 `rank_low`; 500 gold `no_gold`; name 3-20 chars, letters/digits/space/`'`/`-`, unique case-insens (`bad_name`, `name_taken`); tag 2-4 letters (`bad_tag`, `tag_taken`); `in_sect`. Chronicle line (importance 2) + `chron` broadcast |
| `join {sect}` | no sect | sends a join request (5 min). Leader/elders get a note; they approve by **inviting that player by name**. If an invite from that sect is open it acts as accept. `not_found`, `already_requested`, `sect_full`, `too_many_requests` |
| `invite {name}` | leader, elder | target must be online (unless approving a request), not in a sect. `no_permission`, `not_found`, `bad_target`, `target_in_sect`, `offline`, `already_invited`, `sect_full`, `slow_down` (10/min/sender, 3/min/target) |
| `accept {sect}` / `decline {sect}` | invitee | `no_invite` (expired after 5 min) |
| `leave` | members | leader gets `leader_cannot_leave` (promote a successor or disband) |
| `kick {id}` | leader: anyone else; elder: disciples + outers | `no_permission`, `bad_target`, `not_member` |
| `promote {id, role}` | leader | any role incl. `leader` (transfer: old leader becomes elder). `no_permission`, `bad_target`, `not_member`, `no_change` |
| `deposit {gold}` | any member | `bad_amount`, `no_gold`. Treasury has no withdrawal yet |
| `motto {motto}` | leader | cleaned, max 120 chars |
| `disband` | leader | clears every member's `sectId` (offline too) |

- Sect invite message: `{t:'invite', kind:'sect', fromId, from, data:{sect, name, tag}}`. The existing client mapping (`data.sect` -> `sect accept {sect}`) works. Join requests are *not* sent as invite cards.
- `MeView.sect = {id, name, tag, role}`. Entity `tag` = `[TAG]`, or `[TAG] <title>` when the player has a title (via `onPlayerSync`; `title` command keeps working).
- Level = `floor(sqrt(sum of member levels)/2)`, max 10 (cached 30 s). XP modifier +2% per level (max +20%) is registered in `getServices(ctx).xpModifiers`; it multiplies with the master bonus.
- Queries: `sect {id?}` -> `SectView | null` (no id = own sect; `treasury` and `invites` are 0 for non-members; `invites` = open invites + requests; members sorted by role, then level); `sects` -> list sorted by level, members (max 100). `player` and `leaderboard` are overridden (`{override:true}`) to fill in `sect` names.
- Sect chat: `ctx.chat.setSectResolver` -> online members.
- Limits: 50 members per sect.

## Masters and disciples

Tables `master_bonds` (source of truth, one row per disciple; NPC masters stored as `-npcId`), `master_teach` (1 h cooldown per disciple, survives dismissals), `master_rewards` (graduation reward given once per master). `save.masterId` mirrors the bond (rewritten on save/login).

- `request {npc}`: NPC master (role `master`). Needs no master, rank <= 2, within 6 tiles, reputation >= 10 with the NPC's faction (if it has one), not in combat. Accepted at once. Codes: `not_master`, `has_master`, `rank_high`, `in_combat`, `too_far`, `rep_low`.
- `request {id}`: player flow, both online. Direction is inferred from ranks: rank <= 2 asking a rank >= 3 player = "be my master" (`invite.data.role = 'disciple'`, i.e. the sender's role); rank >= 3 asking a rank <= 2 player = "be my disciple" (`data.role = 'master'`). Otherwise `bad_ranks`. Invite: `{kind:'master', fromId, from, data:{role}}`; the receiver answers `master accept/decline {id: fromId}` (the existing client mapping works). Expires after 5 min. Codes: `offline`, `bad_target`, `rank_low`, `full` (max 2 disciples), `has_master`, `rank_high`, `already_asked`, `slow_down`, `no_request` on accept/decline.
- `dismiss {id?}`: no id = disciple leaves own master (NPC or player); with id = master dismisses disciple. `no_master`, `not_disciple`.
- `teach {id, skill}`: master teaches an online disciple within 6 tiles, out of combat. Master needs the skill at level >= 3 (`skill_low`), disciple must meet rank/stat requirements and not know it (codes from `skillBlocker`: `rank_low`, `stats_low`, `already_known`), 1 h cooldown (`cooldown`). Learned at level 1, loadout auto-filled. No gold cost.
- Benefits: disciple XP +10% (+15% while a *player* master is online); NPC master: -20% skill prices (shops module applies it; also exported `discipleDiscount(p, npcId)`); player master gets 10% of the disciple's mission gold as extra tribute (floor, online or offline, note to both), +1 reputation (with the faction where the master stands highest) per disciple level-up.
- Graduation at rank 3 (checked on level-up event, every 10 s, and on login): bond ends, both get a note; the master gets 200 gold and the title `Master of <name>` **once per master** (title only replaces an empty title or an earlier `Master of ...`).
- NPC master dies (sim `npcDied`) or is dead at login: bond ends with a note.
- `MeView.master = {id, name, npc}` (`id` = NPC id when `npc`, else character id), `MeView.disciples = [{id, name, level, online}]`. Both parties get a fresh `me` when presence changes.
- `NpcMenu.disciple = {ok, reason?, already}` for NPCs with role `master` (pushed on `npcMenuDecorators`).

## Friends

Table `friends` (one row per pair, `a < b`, `status` `pending|friend`, `requested_by`).

- `add {name}`: target may be offline. Adding someone who already asked you accepts. Online target gets `{t:'invite', kind:'friend', fromId, from}`; answer with `friend accept/decline {id: fromId}`. Codes: `not_found`, `bad_target`, `already_friends`, `already_requested`, `friends_full` (50), `too_many_pending` (20 sent), `target_busy` (20 received), `slow_down` (10/min).
- `accept {id}`: `no_request`, `friends_full`, `target_full`. `decline {id}`: incoming only. `remove {id}`: removes a friend or cancels your own outgoing request (`not_friends`).
- Query `friends` -> `FriendView[]` (`status` `in` first, then `friend` online-first, then `out`).
- Friends get a `note` when someone logs in / out; on login you hear about pending requests.

## Duels

- `challenge {id: entityId, stake?}`: target online, not self, both alive and out of combat (own `combatId` and `combat.inCombat`), within 12 tiles, `stake <= floor(20% of the poorer player's gold)`. Invite: `{kind:'duel', fromId: challengerCharId, from, data:{entity, stake}}`. One open challenge per challenger, expires after 30 s, cancelled on logout. Codes: `not_found`, `bad_target`, `offline`, `dead`, `in_combat`, `too_far`, `stake_high`, `bad_stake`, `slow_down` (6/min, 1 per 10 s per pair).
- `accept {id: challengerCharId}` re-validates everything, then calls `getServices(ctx).combat.startDuel(challenger, target, stake)`; `unavailable` when no combat service exists. `decline {id}` notifies the challenger.

## Other

- `social.ts` helpers: `findCharacter`, `findCharacterByName`, `mutateCharacter` (act on offline characters safely), `Limiter`, `tellLater` (toast now, or note on next login via table `social_mail`).
- Exported: `discipleDiscount`, `sectLevelFor`, `getSectsApi(ctx)`, `getMastersApi(ctx)`, constants.
- State kept only in memory (lost on restart): sect invites / join requests, master requests, duel challenges (all short-lived).
