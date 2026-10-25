/** Bounded least-recently-used cache. Pure (unit tested). */
export class LRU<K, V> {
  private map = new Map<K, V>();
  readonly max: number;
  private onEvict?: (k: K, v: V) => void;
  hits = 0;
  misses = 0;

  constructor(max: number, onEvict?: (k: K, v: V) => void) {
    this.max = Math.max(1, max);
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.map.size;
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Refresh recency: Map preserves insertion order.
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }

  /** Read without touching recency. */
  peek(k: K): V | undefined {
    return this.map.get(k);
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      const ov = this.map.get(oldest) as V;
      this.map.delete(oldest);
      this.onEvict?.(oldest, ov);
    }
  }

  delete(k: K): boolean {
    const v = this.map.get(k);
    if (v === undefined) return false;
    this.map.delete(k);
    this.onEvict?.(k, v);
    return true;
  }

  clear(): void {
    if (this.onEvict) for (const [k, v] of this.map) this.onEvict(k, v);
    this.map.clear();
  }

  getOrCreate(k: K, make: () => V): V {
    const v = this.get(k);
    if (v !== undefined) return v;
    const nv = make();
    this.set(k, nv);
    return nv;
  }

  keys(): IterableIterator<K> {
    return this.map.keys();
  }
}
