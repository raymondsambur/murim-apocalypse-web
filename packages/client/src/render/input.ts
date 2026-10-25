/**
 * Pointer input for the game canvas: tap / context (right click or long press) / hover, drag-pan, wheel zoom and
 * pinch zoom. Gesture classification lives in `GestureTracker` (pure, unit tested); `InputController` wires it
 * to DOM events.
 */

export const TAP_SLOP_MOUSE = 6;
export const TAP_SLOP_TOUCH = 12;
export const LONG_PRESS_MS = 500;

export interface PointerInfo {
  id: number;
  x: number;
  y: number;
  type: 'mouse' | 'touch' | 'pen';
  button: number;
  sx: number;
  sy: number;
  t0: number;
}

export type GestureEvent =
  | { k: 'tap'; x: number; y: number; button: number }
  | { k: 'context'; x: number; y: number }
  | { k: 'pan'; dx: number; dy: number }
  | { k: 'pinch'; scale: number; x: number; y: number }
  | { k: 'hover'; x: number; y: number };

/** Pure gesture state machine. Feed it pointer events and times; it emits gesture events. */
export class GestureTracker {
  private ptrs = new Map<number, PointerInfo>();
  private moved = false;
  private longFired = false;
  private pinchDist = 0;
  private pinching = false;
  private lastHover = -1e9;
  /** Set when a drag began: the following up must not fire a tap. */
  dragging = false;

  constructor(private emit: (e: GestureEvent) => void) {}

  get pointerCount(): number {
    return this.ptrs.size;
  }

  down(id: number, x: number, y: number, type: 'mouse' | 'touch' | 'pen', button: number, now: number): void {
    this.ptrs.set(id, { id, x, y, type, button, sx: x, sy: y, t0: now });
    if (this.ptrs.size === 1) {
      this.moved = false;
      this.longFired = false;
      this.dragging = false;
      this.pinching = false;
    } else if (this.ptrs.size === 2) {
      this.pinching = true;
      this.moved = true;
      this.dragging = true;
      this.pinchDist = this.dist();
    }
  }

  private dist(): number {
    const [a, b] = [...this.ptrs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private mid(): { x: number; y: number } {
    const [a, b] = [...this.ptrs.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  move(id: number, x: number, y: number, now: number): void {
    const p = this.ptrs.get(id);
    if (!p) {
      if (this.ptrs.size === 0 && now - this.lastHover >= 60) {
        this.lastHover = now;
        this.emit({ k: 'hover', x, y });
      }
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.ptrs.size >= 2 && this.pinching) {
      const d = this.dist();
      const m = this.mid();
      if (this.pinchDist > 0 && d > 0) this.emit({ k: 'pinch', scale: d / this.pinchDist, x: m.x, y: m.y });
      this.pinchDist = d;
      this.emit({ k: 'pan', dx: dx / 2, dy: dy / 2 });
      return;
    }
    if (!this.moved) {
      const slop = p.type === 'mouse' ? TAP_SLOP_MOUSE : TAP_SLOP_TOUCH;
      if (Math.hypot(x - p.sx, y - p.sy) > slop) {
        this.moved = true;
        this.dragging = true;
      }
    }
    if (this.moved && !this.longFired) this.emit({ k: 'pan', dx, dy });
  }

  /** Call periodically (or from a timer) so a held touch becomes a context gesture. */
  tick(now: number): void {
    if (this.ptrs.size !== 1 || this.moved || this.longFired) return;
    const p = [...this.ptrs.values()][0];
    if (p.type === 'mouse') return;
    if (now - p.t0 >= LONG_PRESS_MS) {
      this.longFired = true;
      this.emit({ k: 'context', x: p.x, y: p.y });
    }
  }

  up(id: number, x: number, y: number, now: number): void {
    const p = this.ptrs.get(id);
    if (!p) return;
    this.ptrs.delete(id);
    if (this.pinching) {
      if (this.ptrs.size === 0) this.pinching = false;
      return;
    }
    if (this.moved || this.longFired) return;
    if (p.type === 'touch' && now - p.t0 >= LONG_PRESS_MS) {
      this.emit({ k: 'context', x, y });
      return;
    }
    if (p.type === 'mouse' && p.button === 2) this.emit({ k: 'context', x, y });
    else this.emit({ k: 'tap', x, y, button: p.button });
  }

  cancel(): void {
    this.ptrs.clear();
    this.moved = false;
    this.pinching = false;
  }
}

export interface InputHandlers {
  gesture(e: GestureEvent): void;
  /** Wheel: deltaY in px (normalised), cursor position in css px. */
  wheel(deltaY: number, x: number, y: number): void;
}

export class InputController {
  private tracker: GestureTracker;
  private timer = 0;
  private off: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    handlers: InputHandlers,
  ) {
    this.tracker = new GestureTracker((e) => handlers.gesture(e));
    const rel = (ev: MouseEvent | PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => {
      const p = rel(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.tracker.down(e.pointerId, p.x, p.y, e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse', e.button, performance.now());
      if (e.pointerType === 'touch' && !this.timer) this.timer = window.setInterval(() => this.tracker.tick(performance.now()), 80);
      e.preventDefault();
    });
    on('pointermove', (e) => {
      const p = rel(e);
      this.tracker.move(e.pointerId, p.x, p.y, performance.now());
    });
    const up = (e: PointerEvent): void => {
      const p = rel(e);
      this.tracker.up(e.pointerId, p.x, p.y, performance.now());
      if (this.tracker.pointerCount === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
    };
    on('pointerup', up);
    on('pointercancel', (e) => {
      this.tracker.cancel();
      void e;
    });
    on('contextmenu', (e) => e.preventDefault());
    on(
      'wheel',
      (e) => {
        const p = rel(e);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        handlers.wheel(e.deltaY * unit, p.x, p.y);
        e.preventDefault();
      },
      { passive: false },
    );
    canvas.style.touchAction = 'none';
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    if (this.timer) clearInterval(this.timer);
  }
}
