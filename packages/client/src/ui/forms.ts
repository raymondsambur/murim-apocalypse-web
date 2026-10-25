/** Small form helpers shared by the auth and character-creation screens. */
import { t } from '../i18n';
import { h } from './dom';

export interface TextFieldOptions {
  id: string;
  label: string;
  type?: 'text' | 'password';
  autocomplete?: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /** Returns an i18n key for the problem, or null when the value is fine. */
  validate?: (value: string) => string | null;
  /** Adds a Show/Hide toggle (password fields). */
  revealable?: boolean;
  onInput?: (value: string) => void;
  /** Mark valid values with a green border once the field was touched. */
  showValid?: boolean;
}

export interface TextFieldHandle {
  el: HTMLDivElement;
  input: HTMLInputElement;
  get(): string;
  set(v: string): void;
  /** Validate now; `show` also displays the message. Returns true when valid. */
  validate(show?: boolean): boolean;
  /** Show a server-side message under the field (or clear it with null). */
  setError(message: string | null): void;
  focus(): void;
}

export function textField(o: TextFieldOptions): TextFieldHandle {
  const errId = `${o.id}-err`;
  const hintId = `${o.id}-hint`;
  const err = h('div', { class: 'field-error', id: errId, role: 'status', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'input',
    id: o.id,
    name: o.id,
    type: o.type ?? 'text',
    autocomplete: o.autocomplete ?? 'off',
    placeholder: o.placeholder,
    maxlength: o.maxLength ? String(o.maxLength) : undefined,
    spellcheck: 'false',
    autocapitalize: 'off',
    'aria-describedby': o.hint ? `${errId} ${hintId}` : errId,
  });
  let touched = false;
  let serverError: string | null = null;

  const show = (msg: string | null) => {
    err.textContent = msg ?? '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const validate = (display = true): boolean => {
    const key = o.validate ? o.validate(input.value) : null;
    if (display) {
      show(key ? t(key) : serverError);
      input.classList.toggle('is-valid', !key && !serverError && !!o.showValid && touched && input.value.length > 0);
    }
    return !key;
  };
  input.addEventListener('input', () => {
    serverError = null;
    o.onInput?.(input.value);
    // Stay quiet until the player has left the field once, then validate live.
    if (touched) validate(true);
  });
  input.addEventListener('blur', () => {
    if (!input.value && !touched) return;
    touched = true;
    validate(true);
  });

  let reveal: HTMLButtonElement | null = null;
  if (o.revealable) {
    reveal = h(
      'button',
      {
        class: 'btn btn-ghost btn-xs field-reveal',
        type: 'button',
        'aria-controls': o.id,
        'aria-pressed': 'false',
        onclick: () => {
          const hidden = input.type === 'password';
          input.type = hidden ? 'text' : 'password';
          reveal!.textContent = hidden ? t('auth.hide') : t('auth.show');
          reveal!.setAttribute('aria-pressed', String(hidden));
        },
      },
      t('auth.show'),
    );
  }
  const el = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field-label', for: o.id }, o.label),
    h('div', { class: 'field-row' }, input, reveal),
    o.hint ? h('div', { class: 'field-hint', id: hintId }, o.hint) : null,
    err,
  );
  return {
    el,
    input,
    get: () => input.value,
    set(v) {
      input.value = v;
    },
    validate: (display = false) => {
      if (display) touched = true;
      return validate(display);
    },
    setError(message) {
      serverError = message;
      show(message);
    },
    focus: () => input.focus(),
  };
}
