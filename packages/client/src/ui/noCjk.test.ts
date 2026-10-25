/**
 * Regression guard for "the whole interface is in English". Scans every client source file that can put text or
 * decoration in front of the player and fails if a CJK character appears outside comments or the allow-list.
 *
 * Allow-list: `glyphMap.ts` (its keys are the CJK `glyph` characters of the shared data, which are never rendered)
 * and test files (they may contain CJK fixtures). Add a file here only when it is a pure data table.
 */
import { describe, expect, it } from 'vitest';

const ALLOWED = [/(^|\/)glyphMap\.ts$/, /\.test\.ts$/];

const sources: Record<string, string> = {
  ...import.meta.glob('../ui/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../i18n/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../net/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../styles/**/*.css', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../*.{ts,css}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

/** Han, kana, Hangul, CJK punctuation, fullwidth forms. */
const CJK = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿＀-￯]|[\u{20000}-\u{2fa1f}]/u;
const ESCAPED_CJK = /\\u(?:[2-9][0-9a-fA-F]{3}|[a-dA-D][0-9a-fA-F]{3}|[fF][9aAbBfF][0-9a-fA-F]{2})|\\u\{[0-9a-fA-F]{4,6}\}/;

function stripComments(file: string, text: string): string {
  if (file.endsWith('.html')) return text.replace(/<!--[\s\S]*?-->/g, '');
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (file.endsWith('.css')) return noBlock;
  // Line comments: only when `//` starts a comment (not inside a URL like https://...).
  return noBlock.replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Percent-encoded UTF-8 (data URIs) hides CJK from a plain scan, so decode those runs first. */
function decodePercent(text: string): string {
  return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
}

describe('no CJK in the player-visible client', () => {
  const files = Object.keys(sources).filter((f) => !ALLOWED.some((re) => re.test(f)));

  it('scans a meaningful set of files', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith('index.html'))).toBe(true);
    expect(files.some((f) => f.endsWith('hud.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('en.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('mock.ts'))).toBe(true);
  });

  it('has no CJK character in code, strings, CSS or HTML', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = decodePercent(stripComments(f, sources[f]));
      text.split('\n').forEach((line, i) => {
        if (CJK.test(line) || ESCAPED_CJK.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('detects CJK in the places the scanner is meant to guard', () => {
    expect(CJK.test('<span>武</span>')).toBe(true);
    expect(CJK.test("content: '金'")).toBe(true);
    expect(ESCAPED_CJK.test("'\\u6b66'")).toBe(true);
    expect(CJK.test(decodePercent('data:image/svg+xml,%E6%AD%A6'))).toBe(true);
    expect(CJK.test('Murim Apocalypse - Gold, Qi, Rank')).toBe(false);
  });
});
