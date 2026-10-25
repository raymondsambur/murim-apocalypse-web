/** Tiny cache for panel queries: remembers the last result, avoids duplicate in-flight requests and reports changes. */
export class QueryCache<T> {
  data: T | null = null;
  error: string | null = null;
  loading = false;
  at = 0;
  private key = '';

  constructor(private readonly fetcher: () => Promise<T>, private readonly onError: (e: unknown) => string = (e) => String(e)) {}

  /** Fetch when the key changed, nothing was loaded yet, or the data is older than `maxAgeMs`. Calls `done` after each fetch. */
  ensure(done: () => void, key = '', maxAgeMs = 15_000, force = false): void {
    if (this.loading) return;
    const stale = Date.now() - this.at > maxAgeMs;
    if (!force && this.key === key && this.data !== null && !stale) return;
    if (!force && this.key === key && this.error !== null && Date.now() - this.at < 5000) return;
    if (this.key !== key) this.data = null;
    this.key = key;
    this.loading = true;
    this.fetcher()
      .then((d) => {
        this.data = d;
        this.error = null;
      })
      .catch((e) => {
        this.error = this.onError(e);
      })
      .finally(() => {
        this.loading = false;
        this.at = Date.now();
        done();
      });
  }

  invalidate(): void {
    this.at = 0;
  }
}
