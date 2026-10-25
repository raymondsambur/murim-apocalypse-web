/**
 * Loads the real renderer (src/render/index.ts) when it exists, otherwise the stand-in.
 * `import.meta.glob` resolves to an empty map while the file is missing, so this builds either way.
 */
import type { RenderModule } from '../render/api';
import { standinRenderModule } from './standin/render';

let cached: Promise<{ module: RenderModule; standin: boolean }> | null = null;

function isRenderModule(m: unknown): m is RenderModule {
  return !!m && typeof (m as RenderModule).createGameView === 'function' && typeof (m as RenderModule).drawLookPreview === 'function';
}

export function loadRenderModule(): Promise<{ module: RenderModule; standin: boolean }> {
  if (cached) return cached;
  cached = (async () => {
    // `?standin=1` forces the placeholder renderer (handy while the real one is unfinished).
    const forceStandin = typeof location !== 'undefined' && new URLSearchParams(location.search).has('standin');
    const found = import.meta.glob('../render/index.ts');
    const loader = found['../render/index.ts'];
    if (loader && !forceStandin) {
      try {
        const mod = (await loader()) as Record<string, unknown>;
        const candidates = [mod.default, mod.renderModule, mod.render, mod];
        for (const c of candidates) if (isRenderModule(c)) return { module: c, standin: false };
        console.warn('[render] src/render/index.ts does not export a RenderModule yet; using the stand-in');
      } catch (e) {
        console.error('[render] failed to load the renderer; using the stand-in', e);
      }
    }
    return { module: standinRenderModule, standin: true };
  })();
  return cached;
}
