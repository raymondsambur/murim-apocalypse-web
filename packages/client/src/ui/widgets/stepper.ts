/** Number stepper: [-] value [+] with keyboard input and clamping. */
import { t } from '../../i18n';
import { h } from '../dom';

export interface StepperHandle {
  el: HTMLDivElement;
  get(): number;
  set(v: number): void;
  setMax(max: number): void;
}

export interface StepperOptions {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  onChange?: (v: number) => void;
}

export function stepper(o: StepperOptions): StepperHandle {
  let min = o.min;
  let max = Math.max(o.min, o.max);
  let value = clamp(o.value);
  const step = o.step ?? 1;
  function clamp(v: number) {
    return Math.max(min, Math.min(max, Math.round(Number.isFinite(v) ? v : min)));
  }
  const input = h('input', {
    class: 'stepper-input',
    type: 'number',
    inputmode: 'numeric',
    min: String(min),
    max: String(max),
    value: String(value),
    'aria-label': o.label,
  });
  const dec = h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('common.decrease'), onclick: () => set(value - step) }, '−');
  const inc = h('button', { class: 'btn-icon btn-sm', type: 'button', 'aria-label': t('common.increase'), onclick: () => set(value + step) }, '+');
  const maxBtn = h('button', { class: 'btn btn-ghost btn-xs', type: 'button', onclick: () => set(max) }, t('common.max'));
  const set = (v: number, notify = true) => {
    const nv = clamp(v);
    const changed = nv !== value;
    value = nv;
    input.value = String(value);
    dec.disabled = value <= min;
    inc.disabled = value >= max;
    maxBtn.hidden = max <= min;
    if (changed && notify) o.onChange?.(value);
  };
  input.addEventListener('change', () => set(Number(input.value)));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') input.blur();
  });
  set(value, false);
  return {
    el: h('div', { class: 'stepper' }, dec, input, inc, maxBtn),
    get: () => value,
    set: (v) => set(v),
    setMax(m) {
      max = Math.max(min, m);
      input.max = String(max);
      set(value);
    },
  };
}
