import { describe, expect, it } from 'vitest';
import { clamp, DEFAULT_LAYOUT, parseLayoutPreferences } from '../../../src/renderer/src/lib/layout-preferences';

describe('bounded layout preferences', () => {
  it.each([null, '', 'invalid JSON', 'null', '[]', '7'])('uses defaults for invalid persisted shape %s', (raw) => {
    expect(parseLayoutPreferences(raw)).toEqual(DEFAULT_LAYOUT);
  });
  it('retains valid fields while recovering invalid fields and clamps extreme values', () => {
    expect(parseLayoutPreferences('{"sidebar":500,"columns":0.7,"secondary":"large","editor":-50}')).toEqual({ sidebar: 300, columns: .7, secondary: .42, editor: .1 });
    expect(parseLayoutPreferences('{"sidebar":160,"columns":1e999,"secondary":0.3,"editor":0.5}')).toEqual({ sidebar: 160, columns: .5, secondary: .3, editor: .5 });
  });
  it('preserves pane minimum when container maximum becomes smaller', () => {
    expect(clamp(200, 110, 50)).toBe(110);
  });
});
