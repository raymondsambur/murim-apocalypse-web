/** The assembled fragment library. Add a new line by appending to the right group in its topic file; ids are positional. */
import type { DlgFragment } from './types';
import { BLIGHT_FRAGMENTS } from './blight';
import { CLOSE_FRAGMENTS, OPEN_FRAGMENTS } from './frames';
import { GREET_FRAGMENTS } from './greet';
import { ME_FRAGMENTS } from './me';
import { NEWS_FRAGMENTS } from './news';
import { RUMOR_BODY_FRAGMENTS, RUMOR_CLOSE_FRAGMENTS, RUMOR_HEDGE_FRAGMENTS } from './rumors';
import { FOLK_FRAGMENTS, TOWN_FRAGMENTS } from './town';
import { WORK_FRAGMENTS } from './work';

export const ALL_FRAGMENTS: readonly DlgFragment[] = [
  ...GREET_FRAGMENTS,
  ...TOWN_FRAGMENTS,
  ...FOLK_FRAGMENTS,
  ...ME_FRAGMENTS,
  ...BLIGHT_FRAGMENTS,
  ...WORK_FRAGMENTS,
  ...NEWS_FRAGMENTS,
  ...RUMOR_BODY_FRAGMENTS,
  ...RUMOR_HEDGE_FRAGMENTS,
  ...RUMOR_CLOSE_FRAGMENTS,
  ...OPEN_FRAGMENTS,
  ...CLOSE_FRAGMENTS,
];

/** Fragment counts per topic and part (documentation and the coverage test). */
export function libraryStats(): { total: number; byKey: Record<string, number> } {
  const byKey: Record<string, number> = {};
  for (const f of ALL_FRAGMENTS) byKey[`${f.topic}/${f.part}`] = (byKey[`${f.topic}/${f.part}`] ?? 0) + 1;
  return { total: ALL_FRAGMENTS.length, byKey };
}
