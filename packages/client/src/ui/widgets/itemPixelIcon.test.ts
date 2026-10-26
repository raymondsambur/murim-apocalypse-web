/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_PX } from '../../art/itemicons';

// vitest blanks CSS imports, so the stylesheet is read as text
const css = readFileSync(new URL('../../styles/components.css', import.meta.url), 'utf8');

/** Width of a fixed-size slot rule in px (1rem = 16px) and the border it carries. */
function slotWidth(selector: string): number {
  const m = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*?width:\\s*([0-9.]+)rem`).exec(css);
  expect(m, `${selector} has a rem width`).not.toBeNull();
  return Number(m![1]) * 16;
}

describe('pixel icons fit every item slot at 1:1', () => {
  it('the inner box of the small, medium and large slots holds the 40 px icon (2 px border on each side)', () => {
    expect(ICON_PX).toBe(40);
    for (const sel of ['.slot-sm', '.slot', '.slot-lg']) expect(slotWidth(sel) - 4, sel).toBeGreaterThanOrEqual(ICON_PX);
  });
});
