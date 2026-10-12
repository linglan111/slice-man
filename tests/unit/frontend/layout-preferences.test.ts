import { describe, expect, it } from 'vitest';
import { clamp, DEFAULT_LAYOUT, parseLayoutPreferences } from '../../../src/renderer/src/lib/layout-preferences';

describe('bounded layout preferences', () => {
  it.each([null, '', 'invalid JSON', 'null', '[]', '7'])('uses defaults for invalid persisted shape %s', (raw) => {
    expect(parseLayoutPreferences(raw)).toEqual(DEFAULT_LAYOUT);
  });
  it('retains valid fields while recovering invalid fields and clamps extreme values', () => {
    expect(parseLayoutPreferences('{"sidebar":500,"columns":0.7,"secondary":"large","editor":-50}')).toEqual({ sidebar: 300, columns: .7, editor: .1 });
    expect(parseLayoutPreferences('{"sidebar":160,"columns":1e999,"secondary":0.3,"editor":0.5}')).toEqual({ sidebar: 160, columns: .5, editor: .5 });
  });
  it('ignores obsolete secondary allocation while preserving user widths and editor size', () => {
    expect(parseLayoutPreferences('{"sidebar":230,"columns":0.6,"secondary":0.8,"editor":0.7}')).toEqual({ sidebar: 230, columns: .6, editor: .7 });
  });
  it('preserves pane minimum when container maximum becomes smaller', () => {
    expect(clamp(200, 110, 50)).toBe(110);
  });
});
