/** Title screen: login / register with inline validation that mirrors the server rules. */
import type { MeResponse } from '@murim/shared';
import { ApiFailure, api } from '../../net/api';
import { t } from '../../i18n';
import { h, mount } from '../dom';
import { textField } from '../forms';
import { passwordStrength, validatePassword, validatePasswordConfirm, validateUsername } from '../validation';
import { tabs } from '../widgets/tabs';
import { mountInkBackdrop } from './inkBackdrop';
import type { Screen } from './screen';
import { icon } from '../icons';

export interface AuthScreenOptions {
  onAuthed(me: MeResponse): void;
  /** Shown above the form, e.g. "Your session has expired". */
  notice?: string;
  initialTab?: 'login' | 'register';
}

export function brandBlock(): HTMLElement {
  return h(
    'header',
    { class: 'brand' },
    h('span', { class: 'seal seal-lg', 'aria-hidden': 'true' }, icon('logo')),
    h('h1', { class: 'brand-title' }, t('app.title')),
    h('p', { class: 'brand-tag' }, t('app.tagline')),
  );
}

export function createAuthScreen(o: AuthScreenOptions): Screen {
  const root = h('main', { class: 'screen screen-auth' });
  const backdrop = mountInkBackdrop(root);

  const user = textField({ id: 'auth-user', label: t('auth.username'), autocomplete: 'username', maxLength: 20, validate: validateUsername, hint: t('auth.usernameHint') });
  const pass = textField({
    id: 'auth-pass',
    label: t('auth.password'),
    type: 'password',
    autocomplete: 'current-password',
    revealable: true,
    maxLength: 72,
    validate: (v) => (mode() === 'login' ? (v ? null : 'val.password.required') : validatePassword(v)),
    onInput: (v) => updateStrength(v),
  });
  const confirm = textField({
    id: 'auth-confirm',
    label: t('auth.confirm'),
    type: 'password',
    autocomplete: 'new-password',
    maxLength: 72,
    validate: (v) => validatePasswordConfirm(pass.get(), v),
  });
  pass.input.addEventListener('input', () => {
    if (confirm.get()) confirm.validate(true);
  });

  const strengthBars = [0, 1, 2, 3].map(() => h('span', { class: 'strength-seg' }));
  const strengthText = h('span', { class: 'strength-text' });
  const strength = h('div', { class: 'strength', 'aria-live': 'polite' }, h('div', { class: 'strength-bars' }, strengthBars), strengthText);
  const strengthKeys = ['auth.strength.weak', 'auth.strength.weak', 'auth.strength.fair', 'auth.strength.good', 'auth.strength.strong'];
  function updateStrength(v: string): void {
    const s = v ? passwordStrength(v) : 0;
    strengthBars.forEach((b, i) => b.classList.toggle('on', i < s));
    strength.dataset.level = String(s);
    strengthText.textContent = v ? t(strengthKeys[s]) : '';
  }

  const formError = h('div', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' });
  const switchLink = h('button', { class: 'link-btn', type: 'button' });
  const noticeEl = o.notice ? h('div', { class: 'form-notice', role: 'status' }, o.notice) : null;

  const tabBar = tabs(
    [
      { id: 'login', label: t('auth.tab.login'), glyph: 'login' },
      { id: 'register', label: t('auth.tab.register'), glyph: 'recruit' },
    ],
    (id) => applyMode(id as 'login' | 'register'),
    { initial: o.initialTab ?? 'login', label: t('auth.tabs'), cls: 'auth-tabs' },
  );
  const mode = () => tabBar.current() as 'login' | 'register';

  function applyMode(m: 'login' | 'register'): void {
    const reg = m === 'register';
    confirm.el.hidden = !reg;
    strength.hidden = !reg;
    pass.input.autocomplete = reg ? 'new-password' : 'current-password';
    user.el.querySelector<HTMLElement>('.field-hint')!.hidden = !reg;
    switchLink.textContent = reg ? t('auth.switch.toLogin') : t('auth.switch.toRegister');
    formError.textContent = '';
    for (const f of [user, pass, confirm]) f.setError(null);
    updateStrength(pass.get());
    setBusy(busy);
  }
  switchLink.addEventListener('click', () => {
    tabBar.select(mode() === 'login' ? 'register' : 'login');
    user.focus();
  });

  let busy = false;
  const setBusy = (b: boolean) => {
    busy = b;
    submit.disabled = b;
    submit.setAttribute('aria-busy', String(b));
    mount(submit, b ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, h('span', {}, b ? t('auth.working') : mode() === 'login' ? t('auth.submit.login') : t('auth.submit.register')));
  };

  const form = h(
    'form',
    {
      class: 'auth-form',
      novalidate: true,
      onsubmit: async (ev: Event) => {
        ev.preventDefault();
        if (busy) return;
        const reg = mode() === 'register';
        const checks: [boolean, { focus(): void }][] = [
          [user.validate(true), user],
          [pass.validate(true), pass],
          [reg ? confirm.validate(true) : true, confirm],
        ];
        const bad = checks.find(([ok]) => !ok);
        if (bad) {
          bad[1].focus();
          return;
        }
        setBusy(true);
        formError.textContent = '';
        try {
          const req = { username: user.get().trim(), password: pass.get() };
          const me = reg ? await api.register(req) : await api.login(req);
          o.onAuthed(me);
        } catch (e) {
          const msg = e instanceof ApiFailure ? e.message : t('err.generic');
          if (e instanceof ApiFailure && (e.status === 409 || e.code === 'username_taken')) user.setError(msg);
          else formError.textContent = msg;
          if (e instanceof ApiFailure && e.status === 401) pass.focus();
        } finally {
          if (root.isConnected) setBusy(false);
        }
      },
    },
    user.el,
    pass.el,
    strength,
    confirm.el,
    formError,
    submit,
    h('p', { class: 'auth-switch' }, switchLink),
  );

  const card = h('section', { class: 'auth-card parchment', 'aria-label': t('auth.card') }, tabBar.el, noticeEl, form, h('p', { class: 'auth-foot' }, t('auth.foot')));
  root.append(brandBlock(), card);
  applyMode(mode());
  queueMicrotask(() => user.focus());
  return {
    el: root,
    destroy() {
      backdrop.destroy();
      root.remove();
    },
  };
}
