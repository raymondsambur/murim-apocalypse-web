/**
 * Animated ink-wash backdrop for the title and creation screens: a pale moon, layered mountain ridges,
 * drifting mist bands and a few falling embers. Pure canvas, no assets. Draws a single still frame when the
 * player prefers reduced motion, and pauses while the tab is hidden.
 */
import { prefersReducedMotion } from '../dom';

interface Ridge {
  /** 0 = far, 1 = near. */
  depth: number;
  path: Path2D;
  color: string;
  top: number;
}

interface Ember {
  x: number;
  y: number;
  r: number;
  vy: number;
  vx: number;
  hue: number;
  phase: number;
}

/** Deterministic pseudo-random so the mountains look the same every visit. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sum of a few sines with random phases: a cheap but convincing ridgeline. */
export function ridgeProfile(width: number, seed: number, base: number, amp: number): number[] {
  const rnd = mulberry(seed);
  const waves = Array.from({ length: 5 }, (_, i) => ({
    f: (1.3 + i * 1.7 + rnd()) / Math.max(320, width),
    a: amp / Math.pow(1.7, i),
    p: rnd() * Math.PI * 2,
  }));
  const pts: number[] = [];
  const step = 8;
  for (let x = -step; x <= width + step; x += step) {
    let y = base;
    for (const w of waves) y -= (Math.sin(x * w.f * Math.PI * 2 + w.p) * 0.5 + 0.5) * w.a;
    pts.push(y);
  }
  return pts;
}

export function mountInkBackdrop(host: HTMLElement): { destroy(): void; el: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.className = 'ink-backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let ridges: Ridge[] = [];
  let embers: Ember[] = [];
  let raf = 0;
  let last = 0;
  let t0 = performance.now();
  const still = prefersReducedMotion();

  const build = () => {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ridges = [];
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const depth = i / (layers - 1);
      const base = H * (0.46 + depth * 0.42);
      const amp = H * (0.22 - depth * 0.07);
      const prof = ridgeProfile(W, 1000 + i * 77, base, amp);
      const path = new Path2D();
      path.moveTo(-8, H + 4);
      prof.forEach((y, k) => path.lineTo(-8 + k * 8, y));
      path.lineTo(W + 8, H + 4);
      path.closePath();
      const light = 34 - depth * 28;
      ridges.push({ depth, path, color: `hsl(${28 - depth * 6}, ${16 + depth * 6}%, ${Math.max(3, light)}%)`, top: Math.min(...prof) });
    }
    const rnd = mulberry(99);
    embers = Array.from({ length: Math.round(Math.min(60, W / 22)) }, () => ({
      x: rnd() * W,
      y: rnd() * H,
      r: 0.6 + rnd() * 1.6,
      vy: 6 + rnd() * 14,
      vx: -4 + rnd() * 8,
      hue: rnd() < 0.7 ? 40 : 10,
      phase: rnd() * 6,
    }));
  };

  const draw = (now: number, dt: number) => {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const time = (now - t0) / 1000;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#07080b');
    sky.addColorStop(0.45, '#14110f');
    sky.addColorStop(1, '#2a1c12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // moon with halo
    const mx = W * 0.74;
    const my = H * 0.2;
    const mr = Math.min(W, H) * 0.075;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 6);
    halo.addColorStop(0, 'rgba(240, 220, 170, 0.28)');
    halo.addColorStop(1, 'rgba(240, 220, 170, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e9ddb9';
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120, 100, 60, 0.22)';
    ctx.beginPath();
    ctx.arc(mx - mr * 0.3, my - mr * 0.1, mr * 0.28, 0, Math.PI * 2);
    ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // ridges back to front, with a mist band in front of each
    ridges.forEach((r, i) => {
      ctx.fillStyle = r.color;
      ctx.fill(r.path);
      const bandY = r.top + (H - r.top) * 0.28;
      const drift = (time * (4 + i * 3)) % (W + 400);
      for (let k = -1; k < 4; k++) {
        const bx = ((k * (W + 400)) / 3 + drift) % (W + 400) - 200;
        const grad = ctx.createRadialGradient(bx, bandY, 0, bx, bandY, W * 0.36);
        const a = 0.1 + r.depth * 0.04;
        grad.addColorStop(0, `rgba(190, 176, 150, ${a})`);
        grad.addColorStop(1, 'rgba(190, 176, 150, 0)');
        ctx.fillStyle = grad;
        ctx.save();
        ctx.translate(0, bandY);
        ctx.scale(1, 0.22);
        ctx.translate(0, -bandY);
        ctx.fillRect(bx - W * 0.4, bandY - W * 0.4, W * 0.8, W * 0.8);
        ctx.restore();
      }
    });

    // embers
    for (const e of embers) {
      e.y += e.vy * dt;
      e.x += (e.vx + Math.sin(time + e.phase) * 6) * dt;
      if (e.y > H + 4) {
        e.y = -4;
        e.x = Math.random() * W;
      }
      if (e.x < -4) e.x = W + 4;
      if (e.x > W + 4) e.x = -4;
      const flick = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.3 + e.phase));
      ctx.fillStyle = `hsla(${e.hue}, 80%, 62%, ${0.55 * flick})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    // ~30 fps is plenty for slow mist
    if (now - last < 33) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    draw(now, dt);
  };

  const ro = new ResizeObserver(() => {
    build();
    draw(performance.now(), 0);
  });
  ro.observe(host);
  build();
  draw(performance.now(), 0);
  if (!still) raf = requestAnimationFrame(frame);

  return {
    el: canvas,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.remove();
    },
  };
}
