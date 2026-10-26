import { describe, expect, it } from 'vitest';
import { usesPixelIcon } from './itemPixelIcon';

describe('pixel icon in slots', () => {
  it('is used where the 40 px icon fits and skipped in the small slot', () => {
    expect(usesPixelIcon('md')).toBe(true);
    expect(usesPixelIcon('lg')).toBe(true);
    expect(usesPixelIcon(undefined)).toBe(true);
    expect(usesPixelIcon('sm')).toBe(false);
  });
});
