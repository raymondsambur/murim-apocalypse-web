/**
 * Social panel (F): friends, sect, master and disciples, nearby players and the ranking.
 * Server rules and ID conventions: docs/notes/gameplay-social.md and the ID RULES comment in shared/protocol.ts.
 * Incoming invites are rendered by the shell (ui/hud/invites.ts) and answered with the same ops; this panel only
 * shows the resulting state.
 */
import { SKILLS, rankName, rankOf, type EntityView, type FriendView, type LeaderEntry, type SectRole, type SectView } from '@murim/shared';
import '../../styles/panels/social.css';
import { addStrings, t, tn } from '../../i18n';
import type { UiContext } from '../context';
import { h, mount } from '../dom';
import { queryErrorMessage } from '../errors';
import { fmtInt, rankColor } from '../format';
import { QueryCache } from '../logic/queryCache';
import {
  DISCIPLE_MAX_RANK,
  DUEL_RANGE,
  MAX_DISCIPLES,
  MASTER_MIN_RANK,
  MOTTO_MAX,
  NPC_MASTER_REP,
  ROLES,
  SECT_CREATE_GOLD,
  foundGate,
  groupFriends,
  masterEligibility,
  memberActions,
  memberCounts,
  normalizeSectName,
  sectPerms,
  sectXpBonus,
  sortMembers,
  teachableSkills,
  validateFriendName,
  validateSectName,
  validateSectTag,
} from '../logic/social';
import { openModal } from '../widgets/modal';
import { tabs } from '../widgets/tabs';
import { attachTooltip } from '../widgets/tooltip';
import { registerPanel } from './registry';
import { icon } from '../icons';

addStrings({
  'soc.title': 'Social',
  'soc.tabs': 'Social sections',
  'soc.tab.friends': 'Friends',
  'soc.tab.sect': 'Sect',
  'soc.tab.master': 'Master',
  'soc.tab.nearby': 'Nearby',
  'soc.tab.ranking': 'Ranking',
  'soc.loading': 'Loading…',
  'soc.retry': 'Try again',
  'soc.online': 'Online',
  'soc.offline': 'Offline',
  'soc.lvl': 'Lv {n}',
  'soc.whisper': 'Whisper',
  'soc.inspect': 'Inspect',
  // friends
  'soc.fr.add': 'Add a friend',
  'soc.fr.addPh': 'Exact character name',
  'soc.fr.addBtn': 'Send request',
  'soc.fr.in': 'Requests received',
  'soc.fr.list': 'Friends',
  'soc.fr.out': 'Requests sent',
  'soc.fr.empty': 'No friends yet. Add someone by name, or from the Nearby tab.',
  'soc.fr.accept': 'Accept',
  'soc.fr.decline': 'Decline',
  'soc.fr.remove': 'Remove',
  'soc.fr.cancel': 'Cancel',
  'soc.fr.removeTitle': 'Remove friend',
  'soc.fr.removeText': 'Remove {name} from your friends?',
  'soc.fr.count': '{online} of {total} online',
  // validation
  'soc.val.friendRequired': 'Enter a name.',
  'soc.val.friendSelf': 'That is you.',
  'soc.val.nameRequired': 'Enter a name.',
  'soc.val.nameShort': 'At least 3 characters.',
  'soc.val.nameLong': 'At most 20 characters.',
  'soc.val.nameChars': 'Letters, digits, spaces, apostrophes and hyphens only.',
  'soc.val.tagRequired': 'Enter a tag.',
  'soc.val.tagBad': 'The tag is 2 to 4 letters.',
  // sect
  'soc.sect.none': 'You belong to no sect.',
  'soc.sect.browse': 'Sects to join',
  'soc.sect.browseEmpty': 'No sects exist yet. Found the first one!',
  'soc.sect.membersN.one': '{n} member',
  'soc.sect.membersN.other': '{n} members',
  'soc.sect.join': 'Ask to join',
  'soc.sect.joinTip': 'Sends a request. A leader or elder approves it by inviting you.',
  'soc.sect.found': 'Found a sect',
  'soc.sect.foundCost': 'Needs {rank} rank or better and {gold} gold.',
  'soc.sect.name': 'Sect name',
  'soc.sect.tag': 'Tag (2-4 letters)',
  'soc.sect.motto': 'Motto (optional)',
  'soc.sect.foundBtn': 'Found sect ({gold} gold)',
  'soc.sect.foundConfirm': 'Found "{name}" [{tag}] for {gold} gold?',
  'soc.found.needRank': 'You must reach Second-Rate rank first.',
  'soc.found.needGold': 'You need {n} gold (you have {have}).',
  'soc.sect.level': 'Level {n}',
  'soc.sect.bonus': '+{n}% XP for all members',
  'soc.sect.treasury': 'Treasury',
  'soc.sect.founded': 'Founded',
  'soc.sect.noMotto': 'No motto set.',
  'soc.sect.role.leader': 'Leader',
  'soc.sect.role.elder': 'Elder',
  'soc.sect.role.disciple': 'Disciple',
  'soc.sect.role.outer': 'Outer member',
  'soc.sect.you': '(you)',
  'soc.sect.invite': 'Invite a player',
  'soc.sect.invitePh': 'Exact character name',
  'soc.sect.inviteBtn': 'Invite',
  'soc.sect.inviteHint': '{n} open invitations and requests. Approve a join request by inviting that player by name.',
  'soc.sect.inviteNote': 'Only leaders and elders can invite.',
  'soc.sect.deposit': 'Deposit gold',
  'soc.sect.depositBtn': 'Deposit',
  'soc.sect.depositNote': 'The treasury cannot be withdrawn yet.',
  'soc.sect.mottoSave': 'Save motto',
  'soc.sect.mottoEdit': 'Edit motto',
  'soc.sect.leave': 'Leave sect',
  'soc.sect.leaveTitle': 'Leave {name}?',
  'soc.sect.leaveText': 'You can join again later with an invitation.',
  'soc.sect.leaderLeave': 'As leader you must promote a successor first, or disband the sect.',
  'soc.sect.disband': 'Disband sect',
  'soc.sect.disbandTitle': 'Disband {name}?',
  'soc.sect.disbandText': 'Every member is removed and the treasury is lost. This cannot be undone.',
  'soc.sect.kick': 'Remove',
  'soc.sect.kickTitle': 'Remove {name}?',
  'soc.sect.kickText': '{name} will be removed from the sect.',
  'soc.sect.setRole': 'Rank of {name}',
  'soc.sect.promoteLeader': 'Make {name} the leader? You become an elder.',
  'soc.sect.membersTitle': 'Members ({online}/{total} online)',
  'soc.sect.sent': 'Request sent.',
  // master
  'soc.ma.master': 'Your master',
  'soc.ma.npc': 'Master {name} (teacher of the realm)',
  'soc.ma.player': 'Master {name}',
  'soc.ma.leave': 'Leave master',
  'soc.ma.leaveTitle': 'Leave your master?',
  'soc.ma.leaveText': 'You lose the cultivation bonus and the skill discount.',
  'soc.ma.benefits': 'Disciples gain +10% experience (+15% while a player master is online); NPC masters also sell skills 20% cheaper.',
  'soc.ma.disciples': 'Your disciples ({n}/{max})',
  'soc.ma.noDisciples': 'You have no disciples.',
  'soc.ma.teach': 'Teach',
  'soc.ma.teachPick': 'Skill to teach',
  'soc.ma.teachNone': 'Reach level 3 in a skill to teach it.',
  'soc.ma.teachTip': 'The disciple must be nearby and online. One lesson per hour per disciple.',
  'soc.ma.dismiss': 'Dismiss',
  'soc.ma.dismissTitle': 'Dismiss {name}?',
  'soc.ma.dismissText': '{name} is no longer your disciple.',
  'soc.ma.find': 'Find a master',
  'soc.ma.findNpc': 'Talk to a master of the realm in a settlement; with reputation {rep} in their faction they accept a Third- or Second-Rate student at once.',
  'soc.ma.findPlayer': 'Or ask a First-Rate or better player. Enter their name:',
  'soc.ma.take': 'Take a disciple',
  'soc.ma.takeText': 'First-Rate masters can teach up to {max} students of Second-Rate or lower. Enter the name of a candidate:',
  'soc.ma.askBtn': 'Send request',
  'soc.ma.askPh': 'Exact character name',
  'soc.ma.ineligible': 'Your rank is between disciple and master. Players at rank {a} or lower can become disciples; players at rank {b} or higher can take them.',
  'soc.ma.sent': 'Request sent to {name}.',
  'soc.ma.notFound': 'No character named "{name}".',
  'soc.ma.lookup': 'Looking up…',
  'soc.ma.askDisciple': 'Ask to be disciple',
  'soc.ma.askMaster': 'Offer to teach',
  // nearby
  'soc.nb.empty': 'Nobody else is nearby.',
  'soc.nb.duel': 'Duel',
  'soc.nb.duelTip': 'Challenge to a duel (within {n} tiles). They have 30 seconds to accept.',
  'soc.nb.duelTitle': 'Challenge {name}?',
  'soc.nb.duelText': 'Optional stake in gold (each side pays it; at most 20% of the poorer fighter’s gold).',
  'soc.nb.duelGo': 'Challenge',
  'soc.nb.noEntity': 'Too far away to challenge.',
  'soc.nb.friend': 'Add friend',
  'soc.nb.sect': 'Invite',
  'soc.nb.refresh': 'Refresh',
  // ranking
  'soc.rk.empty': 'The ranking is empty.',
  'soc.rk.kills': '{n} kills',
  'soc.rk.you': 'You',
});

interface Caches {
  friends: QueryCache<FriendView[]>;
  sect: QueryCache<SectView | null>;
  sects: QueryCache<{ id: number; name: string; tag: string; level: number; members: number; motto: string }[]>;
  nearby: QueryCache<{ id: number; name: string; level: number }[]>;
  board: QueryCache<LeaderEntry[]>;
}
let caches: Caches | null = null;
function C(ui: UiContext): Caches {
  const err = queryErrorMessage;
  return (caches ??= {
    friends: new QueryCache(() => ui.net.query('friends', {}), err),
    sect: new QueryCache(() => ui.net.query('sect', {}), err),
    sects: new QueryCache(() => ui.net.query('sects', {}), err),
    nearby: new QueryCache(() => ui.net.query('nearbyPlayers', {}), err),
    board: new QueryCache(() => ui.net.query('leaderboard', {}), err),
  });
}

type TabId = 'friends' | 'sect' | 'master' | 'nearby' | 'ranking';
let tab: TabId = 'friends';
let timer: number | null = null;
let sectKey = '';
let unsubInvites: (() => void) | null = null;

// form state survives re-renders
const form = { friend: '', invite: '', deposit: 100, foundName: '', foundTag: '', foundMotto: '', mottoEdit: '', mottoEditing: false, ask: '' };

const done = (ui: UiContext) => () => ui.panels.refresh('social');
const send = (ui: UiContext, msg: Parameters<UiContext['net']['send']>[0], reload: (keyof Caches)[] = []) => {
  const ok = ui.net.send(msg);
  if (ok) {
    window.setTimeout(() => {
      for (const k of reload) C(ui)[k].ensure(done(ui), '', 0, true);
    }, 600);
  }
  return ok;
};

function pill(online: boolean): HTMLElement {
  return h('span', { class: ['soc-dot', online ? 'on' : 'off'], role: 'img', 'aria-label': online ? t('soc.online') : t('soc.offline') });
}

function who(name: string, level: number, online?: boolean): HTMLElement {
  return h('span', { class: 'soc-who' }, online === undefined ? null : pill(online), h('strong', {}, name), h('span', { class: 'soc-lvl', style: { color: rankColor(level) } }, t('soc.lvl', { n: level })));
}

function loadingOrError<T>(c: QueryCache<T>, ui: UiContext, retry: () => void): HTMLElement | null {
  if (c.data !== null) return null;
  if (c.error) return h('div', { class: 'soc-err' }, h('p', { class: 'tone-bad' }, c.error), h('button', { class: 'btn btn-sm', type: 'button', onclick: retry }, t('soc.retry')));
  void ui;
  return h('p', { class: 'empty-note' }, t('soc.loading'));
}

function entityByCharName(ui: UiContext, name: string): EntityView | undefined {
  return ui.state.entityByName(name, 'player');
}

function nameForm(opts: { label: string; placeholder: string; button: string; value: string; onInput: (v: string) => void; validate: (v: string) => string | null; onSubmit: (v: string) => void; id: string }): HTMLElement {
  const err = h('div', { class: 'field-error', role: 'alert' });
  const input = h('input', { class: 'input', id: opts.id, type: 'text', placeholder: opts.placeholder, maxlength: '24', autocomplete: 'off', value: opts.value, 'aria-describedby': `${opts.id}-err` });
  err.id = `${opts.id}-err`;
  const btn = h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, opts.button);
  const form = h(
    'form',
    {
      class: 'soc-inline-form',
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        const v = input.value.trim();
        const bad = opts.validate(v);
        err.textContent = bad ? t(bad) : '';
        input.setAttribute('aria-invalid', String(!!bad));
        if (bad) return;
        opts.onSubmit(v);
        input.value = '';
        opts.onInput('');
      },
    },
    h('label', { class: 'field-label', for: opts.id }, opts.label),
    h('div', { class: 'soc-inline-row' }, input, btn),
    err,
  );
  input.addEventListener('input', () => opts.onInput(input.value));
  return form;
}

// ---- Friends --------------------------------------------------------------------------------------------------------

function friendsTab(ui: UiContext): HTMLElement[] {
  const c = C(ui).friends;
  c.ensure(done(ui));
  const me = ui.state.get('me')!;
  const add = nameForm({
    id: 'soc-friend-add',
    label: t('soc.fr.add'),
    placeholder: t('soc.fr.addPh'),
    button: t('soc.fr.addBtn'),
    value: form.friend,
    onInput: (v) => (form.friend = v),
    validate: (v) => validateFriendName(v, me.c.name),
    onSubmit: (v) => send(ui, { t: 'friend', op: 'add', name: v }, ['friends']),
  });
  const out: HTMLElement[] = [add];
  const wait = loadingOrError(c, ui, () => c.ensure(done(ui), '', 0, true));
  if (wait) return [...out, wait];
  const g = groupFriends(c.data!);
  const row = (f: FriendView, actions: HTMLElement[]) => h('li', { class: 'soc-row' }, who(f.name, f.level, f.status === 'friend' ? f.online : undefined), h('span', { class: 'soc-actions' }, actions));
  const btn = (label: string, onclick: () => void, cls = 'btn btn-xs', title?: string) => h('button', { class: cls, type: 'button', onclick, title }, label);
  if (g.incoming.length) {
    out.push(
      h('div', { class: 'sect-title' }, t('soc.fr.in')),
      h('ul', { class: 'soc-list' }, g.incoming.map((f) => row(f, [btn(t('soc.fr.accept'), () => send(ui, { t: 'friend', op: 'accept', id: f.id }, ['friends']), 'btn btn-xs btn-primary'), btn(t('soc.fr.decline'), () => send(ui, { t: 'friend', op: 'decline', id: f.id }, ['friends']), 'btn btn-xs btn-ghost')]))),
    );
  }
  out.push(h('div', { class: 'sect-title' }, t('soc.fr.list'), ' ', h('span', { class: 'jobs-fine' }, t('soc.fr.count', { online: g.friends.filter((f) => f.online).length, total: g.friends.length }))));
  if (!g.friends.length) out.push(h('p', { class: 'empty-note' }, t('soc.fr.empty')));
  else
    out.push(
      h(
        'ul',
        { class: 'soc-list' },
        g.friends.map((f) =>
          row(f, [
            btn(t('soc.whisper'), () => ui.chat(`/w ${f.name} `), 'btn btn-xs'),
            btn(t('soc.inspect'), () => ui.inspectPlayer({ id: f.id, name: f.name }), 'btn btn-xs btn-ghost'),
            btn(
              t('soc.fr.remove'),
              async () => {
                if (await ui.confirm({ title: t('soc.fr.removeTitle'), text: t('soc.fr.removeText', { name: f.name }), ok: t('soc.fr.remove'), danger: true })) send(ui, { t: 'friend', op: 'remove', id: f.id }, ['friends']);
              },
              'btn btn-xs btn-ghost',
            ),
          ]),
        ),
      ),
    );
  if (g.outgoing.length) out.push(h('div', { class: 'sect-title' }, t('soc.fr.out')), h('ul', { class: 'soc-list' }, g.outgoing.map((f) => row(f, [btn(t('soc.fr.cancel'), () => send(ui, { t: 'friend', op: 'remove', id: f.id }, ['friends']), 'btn btn-xs btn-ghost')]))));
  return out;
}

// ---- Sect --------------------------------------------------------------------------------------------------------------------

function roleChip(role: SectRole): HTMLElement {
  return h('span', { class: ['chip', role === 'leader' ? 'chip-gold' : role === 'elder' ? 'chip-info' : ''] }, t(`soc.sect.role.${role}`));
}

function sectTab(ui: UiContext): HTMLElement[] {
  const me = ui.state.get('me')!;
  return me.sect ? ownSect(ui, me.sect.role) : noSect(ui);
}

function noSect(ui: UiContext): HTMLElement[] {
  const me = ui.state.get('me')!;
  const sects = C(ui).sects;
  sects.ensure(done(ui));
  const out: HTMLElement[] = [h('p', { class: 'empty-note' }, t('soc.sect.none')), h('div', { class: 'sect-title' }, t('soc.sect.browse'))];
  const wait = loadingOrError(sects, ui, () => sects.ensure(done(ui), '', 0, true));
  if (wait) out.push(wait);
  else if (!sects.data!.length) out.push(h('p', { class: 'empty-note' }, t('soc.sect.browseEmpty')));
  else
    out.push(
      h(
        'ul',
        { class: 'soc-list' },
        sects.data!.map((s) => {
          const b = h('button', { class: 'btn btn-xs btn-primary', type: 'button', onclick: () => send(ui, { t: 'sect', op: 'join', sect: s.id }) }, t('soc.sect.join'));
          attachTooltip(b, () => t('soc.sect.joinTip'));
          return h('li', { class: 'soc-row soc-sect-row' }, h('span', { class: 'soc-who' }, h('strong', {}, s.name), h('span', { class: 'chip' }, `[${s.tag}]`), h('span', { class: 'jobs-fine' }, t('soc.sect.level', { n: s.level }), ' · ', tn('soc.sect.membersN', s.members))), h('span', { class: 'soc-actions' }, b), s.motto ? h('div', { class: 'soc-motto' }, `“${s.motto}”`) : null);
        }),
      ),
    );

  // founding
  const gate = foundGate(me.c.level, me.c.gold);
  const err = (id: string) => h('div', { class: 'field-error', id, role: 'alert' });
  const nameErr = err('soc-found-name-err');
  const tagErr = err('soc-found-tag-err');
  const nameIn = h('input', { class: 'input', id: 'soc-found-name', type: 'text', maxlength: '20', value: form.foundName, autocomplete: 'off', 'aria-describedby': 'soc-found-name-err' });
  const tagIn = h('input', { class: 'input soc-tag-input', id: 'soc-found-tag', type: 'text', maxlength: '4', value: form.foundTag, autocomplete: 'off', 'aria-describedby': 'soc-found-tag-err' });
  const mottoIn = h('input', { class: 'input', id: 'soc-found-motto', type: 'text', maxlength: String(MOTTO_MAX), value: form.foundMotto, autocomplete: 'off' });
  const check = (show: boolean) => {
    const a = validateSectName(nameIn.value);
    const b = validateSectTag(tagIn.value);
    if (show || nameIn.value) nameErr.textContent = a ? t(a) : '';
    if (show || tagIn.value) tagErr.textContent = b ? t(b) : '';
    nameIn.setAttribute('aria-invalid', String(!!a && show));
    tagIn.setAttribute('aria-invalid', String(!!b && show));
    return !a && !b;
  };
  nameIn.addEventListener('input', () => {
    form.foundName = nameIn.value;
    check(false);
  });
  tagIn.addEventListener('input', () => {
    form.foundTag = tagIn.value;
    check(false);
  });
  mottoIn.addEventListener('input', () => (form.foundMotto = mottoIn.value));
  const go = h('button', { class: 'btn btn-primary', type: 'submit', disabled: !gate.ok }, t('soc.sect.foundBtn', { gold: SECT_CREATE_GOLD }));
  const foundForm = h(
    'form',
    {
      class: 'card soc-found',
      onsubmit: async (ev: Event) => {
        ev.preventDefault();
        if (!gate.ok || !check(true)) return;
        const name = normalizeSectName(nameIn.value);
        const tag = tagIn.value.trim();
        if (await ui.confirm({ title: t('soc.sect.found'), text: t('soc.sect.foundConfirm', { name, tag: tag.toUpperCase(), gold: SECT_CREATE_GOLD }), ok: t('soc.sect.found') })) {
          send(ui, { t: 'sect', op: 'create', name, tag, motto: mottoIn.value.trim() || undefined }, ['sect', 'sects']);
        }
      },
    },
    h('div', { class: 'sect-title' }, t('soc.sect.found')),
    h('p', { class: 'jobs-fine' }, t('soc.sect.foundCost', { rank: 'Second-Rate', gold: SECT_CREATE_GOLD })),
    gate.ok ? null : h('ul', { class: 'soc-unmet' }, gate.unmet.map((u) => h('li', { class: 'tone-warn' }, t(u.key, u.params)))),
    h('label', { class: 'field-label', for: 'soc-found-name' }, t('soc.sect.name')),
    nameIn,
    nameErr,
    h('label', { class: 'field-label', for: 'soc-found-tag' }, t('soc.sect.tag')),
    tagIn,
    tagErr,
    h('label', { class: 'field-label', for: 'soc-found-motto' }, t('soc.sect.motto')),
    mottoIn,
    go,
  );
  out.push(foundForm);
  return out;
}

function ownSect(ui: UiContext, role: SectRole): HTMLElement[] {
  const me = ui.state.get('me')!;
  const c = C(ui).sect;
  sectKey = `${me.sect!.id}:${role}`;
  c.ensure(done(ui), sectKey, 10_000);
  const wait = loadingOrError(c, ui, () => c.ensure(done(ui), '', 0, true));
  if (wait) return [wait];
  const v = c.data;
  if (!v) return [h('p', { class: 'empty-note' }, t('soc.sect.none'))];
  const perms = sectPerms(role);
  const counts = memberCounts(v);
  const out: HTMLElement[] = [];
  const reload = ['sect' as const];

  // header
  out.push(
    h(
      'section',
      { class: 'card soc-sect-head' },
      h('div', { class: 'soc-sect-title' }, h('span', { class: 'seal', 'aria-hidden': 'true' }, icon('sect')), h('div', {}, h('strong', { class: 'soc-sect-name' }, v.name), h('div', { class: 'chip-row' }, h('span', { class: 'chip chip-gold' }, `[${v.tag}]`), h('span', { class: 'chip' }, t('soc.sect.level', { n: v.level })), h('span', { class: 'chip chip-good' }, t('soc.sect.bonus', { n: Math.round(sectXpBonus(v.level) * 100) })), roleChip(role)))),
      h('dl', { class: 'kv' }, h('dt', {}, t('soc.sect.treasury')), h('dd', {}, `${fmtInt(v.treasury)} ${t('common.gold')}`), h('dt', {}, t('soc.sect.founded')), h('dd', {}, new Date(v.founded).toLocaleDateString())),
      form.mottoEditing && perms.motto
        ? h(
            'form',
            {
              class: 'soc-inline-form',
              onsubmit: (ev: Event) => {
                ev.preventDefault();
                form.mottoEditing = false;
                send(ui, { t: 'sect', op: 'motto', motto: form.mottoEdit.trim() }, reload);
                ui.panels.refresh('social');
              },
            },
            h('div', { class: 'soc-inline-row' }, h('input', { class: 'input', type: 'text', maxlength: String(MOTTO_MAX), value: form.mottoEdit, 'aria-label': t('soc.sect.motto'), oninput: (ev: Event) => (form.mottoEdit = (ev.target as HTMLInputElement).value) }), h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, t('soc.sect.mottoSave'))),
          )
        : h('div', { class: 'soc-motto' }, v.motto ? `“${v.motto}”` : t('soc.sect.noMotto'), perms.motto ? h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => { form.mottoEditing = true; form.mottoEdit = v.motto; ui.panels.refresh('social'); } }, t('soc.sect.mottoEdit')) : null),
    ),
  );

  // invite
  if (perms.invite) {
    out.push(
      nameForm({
        id: 'soc-sect-invite',
        label: t('soc.sect.invite'),
        placeholder: t('soc.sect.invitePh'),
        button: t('soc.sect.inviteBtn'),
        value: form.invite,
        onInput: (x) => (form.invite = x),
        validate: (x) => validateFriendName(x, me.c.name),
        onSubmit: (x) => send(ui, { t: 'sect', op: 'invite', name: x }, reload),
      }),
    );
    if (v.invites > 0) out.push(h('p', { class: 'jobs-fine' }, t('soc.sect.inviteHint', { n: v.invites })));
  }

  // members
  out.push(h('div', { class: 'sect-title' }, t('soc.sect.membersTitle', counts)));
  const members = sortMembers(v.members);
  out.push(
    h(
      'ul',
      { class: 'soc-list', 'aria-label': t('soc.sect.membersTitle', counts) },
      members.map((m) => {
        const acts = memberActions(role, me.c.id, m);
        const isSelf = m.id === me.c.id;
        const actions: HTMLElement[] = [];
        if (!isSelf) actions.push(h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => ui.chat(`/w ${m.name} `) }, t('soc.whisper')));
        if (acts.promoteTo.length) {
          actions.push(
            h(
              'select',
              {
                class: 'select soc-role-select',
                'aria-label': t('soc.sect.setRole', { name: m.name }),
                onchange: async (ev: Event) => {
                  const sel = ev.target as HTMLSelectElement;
                  const next = sel.value as SectRole;
                  sel.value = m.role;
                  if (next === 'leader' && !(await ui.confirm({ title: t('soc.sect.setRole', { name: m.name }), text: t('soc.sect.promoteLeader', { name: m.name }), ok: t('common.confirm') }))) return;
                  send(ui, { t: 'sect', op: 'promote', id: m.id, role: next }, reload);
                },
              },
              h('option', { value: m.role, selected: true }, t(`soc.sect.role.${m.role}`)),
              ...acts.promoteTo.map((r) => h('option', { value: r }, t(`soc.sect.role.${r}`))),
            ),
          );
        }
        if (acts.kick) {
          actions.push(
            h(
              'button',
              {
                class: 'btn btn-xs btn-danger',
                type: 'button',
                onclick: async () => {
                  if (await ui.confirm({ title: t('soc.sect.kickTitle', { name: m.name }), text: t('soc.sect.kickText', { name: m.name }), ok: t('soc.sect.kick'), danger: true })) send(ui, { t: 'sect', op: 'kick', id: m.id }, reload);
                },
              },
              t('soc.sect.kick'),
            ),
          );
        }
        return h('li', { class: 'soc-row' }, h('span', { class: 'soc-who' }, pill(m.online), h('strong', {}, m.name), isSelf ? h('span', { class: 'jobs-fine' }, t('soc.sect.you')) : null, h('span', { class: 'soc-lvl', style: { color: rankColor(m.level) } }, t('soc.lvl', { n: m.level })), acts.promoteTo.length ? null : roleChip(m.role)), h('span', { class: 'soc-actions' }, actions));
      }),
    ),
  );

  // deposit
  const dep = h('input', { class: 'input soc-gold-input', type: 'number', min: '1', max: String(Math.max(1, me.c.gold)), value: String(Math.min(form.deposit, Math.max(1, me.c.gold))), 'aria-label': t('soc.sect.deposit'), oninput: (ev: Event) => (form.deposit = Number((ev.target as HTMLInputElement).value)) });
  out.push(
    h(
      'form',
      {
        class: 'soc-inline-form',
        onsubmit: (ev: Event) => {
          ev.preventDefault();
          const n = Math.floor(Number(dep.value));
          if (n >= 1 && n <= me.c.gold) send(ui, { t: 'sect', op: 'deposit', gold: n }, reload);
        },
      },
      h('label', { class: 'field-label', for: 'soc-deposit' }, t('soc.sect.deposit')),
      h('div', { class: 'soc-inline-row' }, Object.assign(dep, { id: 'soc-deposit' }), h('button', { class: 'btn btn-sm', type: 'submit', disabled: me.c.gold < 1 }, t('soc.sect.depositBtn'))),
      h('p', { class: 'jobs-fine' }, t('soc.sect.depositNote')),
    ),
  );

  // leave / disband
  const danger: HTMLElement[] = [];
  if (perms.leave) {
    danger.push(
      h(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          type: 'button',
          onclick: async () => {
            if (await ui.confirm({ title: t('soc.sect.leaveTitle', { name: v.name }), text: t('soc.sect.leaveText'), ok: t('soc.sect.leave'), danger: true })) send(ui, { t: 'sect', op: 'leave' }, reload);
          },
        },
        t('soc.sect.leave'),
      ),
    );
  } else {
    danger.push(h('p', { class: 'jobs-fine' }, t('soc.sect.leaderLeave')));
  }
  if (perms.disband) {
    danger.push(
      h(
        'button',
        {
          class: 'btn btn-sm btn-danger',
          type: 'button',
          onclick: async () => {
            if (await ui.confirm({ title: t('soc.sect.disbandTitle', { name: v.name }), text: t('soc.sect.disbandText'), ok: t('soc.sect.disband'), danger: true })) send(ui, { t: 'sect', op: 'disband' }, reload);
          },
        },
        t('soc.sect.disband'),
      ),
    );
  }
  out.push(h('div', { class: 'soc-danger' }, danger));
  return out;
}

// ---- Master ----------------------------------------------------------------------------------------------------------------------

/** Look a character up by name (query `player`) and run `then` with the character id. */
async function withCharId(ui: UiContext, name: string, then: (id: number, profile: { name: string; level: number }) => void): Promise<void> {
  try {
    const p = await ui.net.query('player', { name });
    if (!p) return ui.toast(t('soc.ma.notFound', { name }), 'warn');
    then(p.id, p);
  } catch (e) {
    ui.toast(queryErrorMessage(e), 'bad');
  }
}

function masterTab(ui: UiContext): HTMLElement[] {
  const me = ui.state.get('me')!;
  const out: HTMLElement[] = [];
  out.push(h('p', { class: 'jobs-fine' }, t('soc.ma.benefits')));

  if (me.master) {
    const m = me.master;
    out.push(
      h('div', { class: 'sect-title' }, t('soc.ma.master')),
      h(
        'div',
        { class: 'card soc-master' },
        h('span', { class: 'seal', 'aria-hidden': 'true' }, icon('master')),
        h('div', { class: 'soc-master-body' }, h('strong', {}, m.npc ? t('soc.ma.npc', { name: m.name }) : t('soc.ma.player', { name: m.name }))),
        h('span', { class: 'soc-actions' }, m.npc ? null : h('button', { class: 'btn btn-xs', type: 'button', onclick: () => ui.chat(`/w ${m.name} `) }, t('soc.whisper')), h('button', { class: 'btn btn-xs btn-danger', type: 'button', onclick: async () => { if (await ui.confirm({ title: t('soc.ma.leaveTitle'), text: t('soc.ma.leaveText'), ok: t('soc.ma.leave'), danger: true })) send(ui, { t: 'master', op: 'dismiss' }); } }, t('soc.ma.leave'))),
      ),
    );
  }

  const elig = masterEligibility(me.c.level);
  const ask = (label: string, text: string, role: 'disciple' | 'master') =>
    nameForm({
      id: `soc-master-ask-${role}`,
      label,
      placeholder: t('soc.ma.askPh'),
      button: t('soc.ma.askBtn'),
      value: form.ask,
      onInput: (v) => (form.ask = v),
      validate: (v) => validateFriendName(v, me.c.name),
      onSubmit: (v) =>
        void withCharId(ui, v, (id, p) => {
          const r = rankOf(p.level);
          if (role === 'disciple' && r < MASTER_MIN_RANK) return ui.toast(t('soc.ma.ineligible', { a: DISCIPLE_MAX_RANK, b: MASTER_MIN_RANK }), 'warn');
          if (role === 'master' && r > DISCIPLE_MAX_RANK) return ui.toast(t('soc.ma.ineligible', { a: DISCIPLE_MAX_RANK, b: MASTER_MIN_RANK }), 'warn');
          if (send(ui, { t: 'master', op: 'request', id })) ui.toast(t('soc.ma.sent', { name: p.name }), 'good');
        }),
    });
  void ask;

  if (!me.master && elig === 'canBeDisciple') {
    out.push(h('div', { class: 'sect-title' }, t('soc.ma.find')), h('p', { class: 'jobs-fine' }, t('soc.ma.findNpc', { rep: NPC_MASTER_REP })), h('p', { class: 'jobs-fine' }, t('soc.ma.findPlayer')), ask(t('soc.ma.askDisciple'), '', 'disciple'));
  }

  // disciples (masters only; shown also when there are some)
  if (elig === 'canBeMaster' || me.disciples.length) {
    out.push(h('div', { class: 'sect-title' }, t('soc.ma.disciples', { n: me.disciples.length, max: MAX_DISCIPLES })));
    const skills = teachableSkills(me.c.skills);
    if (!me.disciples.length) out.push(h('p', { class: 'empty-note' }, t('soc.ma.noDisciples')));
    else
      out.push(
        h(
          'ul',
          { class: 'soc-list' },
          me.disciples.map((d) => {
            const sel = h('select', { class: 'select soc-role-select', 'aria-label': t('soc.ma.teachPick') }, ...skills.map((s) => h('option', { value: s.id }, `${SKILLS[s.id]?.name ?? s.id} (${s.lv})`)));
            const teach = h('button', { class: 'btn btn-xs btn-primary', type: 'button', disabled: !skills.length || !d.online, onclick: () => send(ui, { t: 'master', op: 'teach', id: d.id, skill: sel.value }) }, t('soc.ma.teach'));
            attachTooltip(teach, () => (skills.length ? t('soc.ma.teachTip') : t('soc.ma.teachNone')));
            return h(
              'li',
              { class: 'soc-row soc-wrap' },
              who(d.name, d.level, d.online),
              h(
                'span',
                { class: 'soc-actions' },
                skills.length ? sel : null,
                teach,
                h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => ui.chat(`/w ${d.name} `) }, t('soc.whisper')),
                h('button', { class: 'btn btn-xs btn-danger', type: 'button', onclick: async () => { if (await ui.confirm({ title: t('soc.ma.dismissTitle', { name: d.name }), text: t('soc.ma.dismissText', { name: d.name }), ok: t('soc.ma.dismiss'), danger: true })) send(ui, { t: 'master', op: 'dismiss', id: d.id }); } }, t('soc.ma.dismiss')),
              ),
            );
          }),
        ),
      );
    if (elig === 'canBeMaster' && me.disciples.length < MAX_DISCIPLES) out.push(h('div', { class: 'sect-title' }, t('soc.ma.take')), h('p', { class: 'jobs-fine' }, t('soc.ma.takeText', { max: MAX_DISCIPLES })), ask(t('soc.ma.askMaster'), '', 'master'));
  }
  if (elig === 'neither') out.push(h('p', { class: 'empty-note' }, t('soc.ma.ineligible', { a: DISCIPLE_MAX_RANK, b: MASTER_MIN_RANK })));
  return out;
}

// ---- Nearby ------------------------------------------------------------------------------------------------------------------------

function nearbyTab(ui: UiContext): HTMLElement[] {
  const c = C(ui).nearby;
  c.ensure(done(ui), '', 4000);
  const me = ui.state.get('me')!;
  const wait = loadingOrError(c, ui, () => c.ensure(done(ui), '', 0, true));
  if (wait) return [wait];
  if (!c.data!.length) return [h('p', { class: 'empty-note' }, t('soc.nb.empty')), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => c.ensure(done(ui), '', 0, true) }, t('soc.nb.refresh'))];
  const selfEnt = ui.state.selfEntity();
  const myElig = masterEligibility(me.c.level);
  return [
    h(
      'ul',
      { class: 'soc-list' },
      c.data!.map((p) => {
        // nearbyPlayers returns CHARACTER ids; duel challenges need the ENTITY id, so resolve through the entity table by name.
        const ent = entityByCharName(ui, p.name);
        const dist = ent && selfEnt ? Math.hypot(ent.x - selfEnt.x, ent.y - selfEnt.y) : Infinity;
        const duelOk = !!ent && dist <= DUEL_RANGE && !me.combatId && me.c.hp > 0;
        const duel = h(
          'button',
          {
            class: 'btn btn-xs btn-danger',
            type: 'button',
            disabled: !duelOk,
            onclick: () => openDuel(ui, p.name, ent!.id),
          },
          t('soc.nb.duel'),
        );
        attachTooltip(duel, () => (ent ? t('soc.nb.duelTip', { n: DUEL_RANGE }) : t('soc.nb.noEntity')));
        const lvRank = rankOf(p.level);
        const canAsk = (myElig === 'canBeDisciple' && !me.master && lvRank >= MASTER_MIN_RANK) || (myElig === 'canBeMaster' && lvRank <= DISCIPLE_MAX_RANK && me.disciples.length < MAX_DISCIPLES);
        return h(
          'li',
          { class: 'soc-row soc-wrap' },
          h('span', { class: 'soc-who' }, h('strong', {}, p.name), h('span', { class: 'soc-lvl', style: { color: rankColor(p.level) } }, t('soc.lvl', { n: p.level })), h('span', { class: 'jobs-fine' }, rankName(p.level))),
          h(
            'span',
            { class: 'soc-actions' },
            h('button', { class: 'btn btn-xs', type: 'button', onclick: () => ui.inspectPlayer({ id: p.id, name: p.name }) }, t('soc.inspect')),
            h('button', { class: 'btn btn-xs', type: 'button', onclick: () => ui.chat(`/w ${p.name} `) }, t('soc.whisper')),
            h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => send(ui, { t: 'friend', op: 'add', name: p.name }, ['friends']) }, t('soc.nb.friend')),
            me.sect && sectPerms(me.sect.role).invite ? h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => send(ui, { t: 'sect', op: 'invite', name: p.name }) }, t('soc.nb.sect')) : null,
            canAsk ? h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => send(ui, { t: 'master', op: 'request', id: p.id }) }, myElig === 'canBeDisciple' ? t('soc.ma.askDisciple') : t('soc.ma.askMaster')) : null,
            duel,
          ),
        );
      }),
    ),
    h('button', { class: 'btn btn-xs btn-ghost', type: 'button', onclick: () => c.ensure(done(ui), '', 0, true) }, t('soc.nb.refresh')),
  ];
}

function openDuel(ui: UiContext, name: string, entityId: number): void {
  const me = ui.state.get('me')!;
  const max = Math.floor(me.c.gold * 0.2);
  const input = h('input', { class: 'input', type: 'number', min: '0', max: String(max), value: '0', 'aria-label': t('common.gold'), 'data-autofocus': '' });
  openModal(
    (close) =>
      h(
        'form',
        {
          class: 'soc-duel',
          onsubmit: (ev: Event) => {
            ev.preventDefault();
            const stake = Math.max(0, Math.min(max, Math.floor(Number(input.value) || 0)));
            ui.net.send({ t: 'duel', op: 'challenge', id: entityId, stake: stake || undefined });
            close();
          },
        },
        h('p', {}, t('soc.nb.duelText')),
        h('label', { class: 'field-label' }, `${t('common.gold')} (0-${fmtInt(max)})`),
        input,
        h('div', { class: 'soc-duel-actions' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, t('common.cancel')), h('button', { class: 'btn btn-danger', type: 'submit' }, t('soc.nb.duelGo'))),
      ),
    { title: t('soc.nb.duelTitle', { name }), glyph: 'swords' },
  );
}

// ---- Ranking -------------------------------------------------------------------------------------------------------------------------

function rankingTab(ui: UiContext): HTMLElement[] {
  const c = C(ui).board;
  c.ensure(done(ui), '', 30_000);
  const wait = loadingOrError(c, ui, () => c.ensure(done(ui), '', 0, true));
  if (wait) return [wait];
  const me = ui.state.get('me')!;
  if (!c.data!.length) return [h('p', { class: 'empty-note' }, t('soc.rk.empty'))];
  const rows = [...c.data!].sort((a, b) => b.level - a.level || b.kills - a.kills);
  return [
    h(
      'ol',
      { class: 'soc-rank' },
      rows.map((e, i) =>
        h(
          'li',
          { class: ['soc-row', e.id === me.c.id && 'self'] },
          h('span', { class: 'soc-pos' }, String(i + 1)),
          h('span', { class: 'soc-who' }, h('button', { class: 'world-link', type: 'button', onclick: () => ui.inspectPlayer({ id: e.id, name: e.name }) }, e.name), e.id === me.c.id ? h('span', { class: 'chip chip-gold' }, t('soc.rk.you')) : null, e.sect ? h('span', { class: 'chip' }, e.sect) : null),
          h('span', { class: 'soc-rank-stats' }, h('span', { style: { color: rankColor(e.level) } }, t('soc.lvl', { n: e.level })), h('span', { class: 'jobs-fine' }, t('soc.rk.kills', { n: fmtInt(e.kills) }))),
        ),
      ),
    ),
  ];
}

// ---- panel ---------------------------------------------------------------------------------------------------------------------------------

registerPanel({
  id: 'social',
  title: 'soc.title',
  glyph: 'social',
  hotkey: 'f',
  order: 70,
  width: 460,
  watch: ['me'],
  onOpen(ui) {
    const c = C(ui);
    for (const k of Object.keys(c) as (keyof Caches)[]) c[k].invalidate();
    if (timer !== null) window.clearInterval(timer);
    timer = window.setInterval(() => {
      if (!ui.panels.isOpen('social')) return;
      if (tab === 'nearby') C(ui).nearby.ensure(done(ui), '', 0, true);
      else if (tab === 'friends') C(ui).friends.ensure(done(ui), '', 20_000);
      else if (tab === 'sect' && sectKey && ui.state.get('me')?.sect) C(ui).sect.ensure(done(ui), sectKey, 8000);
    }, 6000);
    unsubInvites?.();
    unsubInvites = ui.state.subscribe('invites', () => {
      window.setTimeout(() => C(ui).friends.ensure(done(ui), '', 0, true), 800);
    });
  },
  onClose() {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    unsubInvites?.();
    unsubInvites = null;
  },
  render(root, ui) {
    const me = ui.state.get('me');
    if (!me) {
      root.append(h('p', { class: 'empty-note' }, t('common.loading')));
      return;
    }
    const incoming = C(ui).friends.data?.filter((f) => f.status === 'in').length ?? 0;
    const tb = tabs(
      [
        { id: 'friends', label: t('soc.tab.friends'), glyph: 'friend', badge: incoming },
        { id: 'sect', label: t('soc.tab.sect'), glyph: 'sect' },
        { id: 'master', label: t('soc.tab.master'), glyph: 'master' },
        { id: 'nearby', label: t('soc.tab.nearby'), glyph: 'nearby' },
        { id: 'ranking', label: t('soc.tab.ranking'), glyph: 'ranking' },
      ],
      (id) => {
        tab = id as TabId;
        ui.panels.refresh('social');
      },
      { initial: tab, label: t('soc.tabs'), cls: 'tabs-tight' },
    );
    const body = h('div', { class: 'soc-body', role: 'tabpanel' });
    const parts = tab === 'friends' ? friendsTab(ui) : tab === 'sect' ? sectTab(ui) : tab === 'master' ? masterTab(ui) : tab === 'nearby' ? nearbyTab(ui) : rankingTab(ui);
    body.append(...parts);
    mount(root, tb.el, body);
  },
});

void ROLES;
