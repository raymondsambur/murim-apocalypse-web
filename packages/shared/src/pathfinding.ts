export interface PathGrid {
  w: number;
  h: number;
  /** Time cost of entering tile (x, y). Infinity (or <= 0) blocks it. */
  cost(x: number, y: number): number;
}

export interface Point {
  x: number;
  y: number;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function walkable(grid: PathGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return false;
  const c = grid.cost(x, y);
  return c > 0 && c < Infinity;
}

/** Nearest walkable tile to (x, y) within `radius` (including itself). */
export function nearestWalkable(grid: PathGrid, x: number, y: number, radius = 3): Point | null {
  if (walkable(grid, x, y)) return { x, y };
  for (let r = 1; r <= radius; r++) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!walkable(grid, x + dx, y + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x: x + dx, y: y + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * 8-directional A*. Returns the steps after the start tile, or null if unreachable.
 * Diagonals never cut corners. `maxNodes` bounds the search so hostile requests stay cheap.
 */
export function findPath(grid: PathGrid, sx: number, sy: number, tx: number, ty: number, maxNodes = 12000): Point[] | null {
  if (sx === tx && sy === ty) return [];
  if (!walkable(grid, tx, ty)) return null;
  const { w, h } = grid;
  const total = w * h;
  const g = new Float32Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap();
  const start = sy * w + sx;
  const goal = ty * w + tx;
  g[start] = 0;
  open.push(0, start);
  let expanded = 0;

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    if (++expanded > maxNodes) return null;
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (let i = 0; i < 8; i++) {
      const dx = DIRS[i][0];
      const dy = DIRS[i][1];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!walkable(grid, cx + dx, cy) || !walkable(grid, cx, cy + dy))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * grid.cost(nx, ny);
      const ng = g[cur] + step;
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        const ddx = Math.abs(nx - tx);
        const ddy = Math.abs(ny - ty);
        const hEst = (ddx + ddy + (SQRT2 - 2) * Math.min(ddx, ddy)) * 0.7;
        open.push(ng + hEst, ni);
      }
    }
  }

  if (parent[goal] === -1) return null;
  const out: Point[] = [];
  for (let n = goal; n !== start; n = parent[n]) out.push({ x: n % w, y: (n / w) | 0 });
  out.reverse();
  return out;
}
