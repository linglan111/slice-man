import { describe, expect, it } from 'vitest';
import { styleSchema } from '../../../src/shared/contracts';
import { formatTime, templateStyle, validateCueTimes } from '../../../src/renderer/src/lib/presentation';

describe('Subtitle correction input', () => {
  it.each([['', '1'], ['abc', '1'], ['-1', '2'], ['2', '2'], ['2', '1'], ['1', '5.001'], ['Infinity', '4']])('rejects invalid bounds %s to %s', (start, end) => {
    expect(typeof validateCueTimes(start, end, 5000)).toBe('string');
  });
  it('keeps millisecond precision at the media boundary', () => {
    expect(validateCueTimes('0.001', '5.000', 5000)).toEqual({ startMs: 1, endMs: 5000 });
    expect(formatTime(61001)).toBe('01:01.001');
  });
});

describe('Built-in style choices', () => {
  it.each(styleSchema.shape.templateId.options)('produces a valid %s style without sharing mutable defaults', (id) => {
    const first = templateStyle(id);
    expect(styleSchema.safeParse(first).success).toBe(true);
    first.layout.marginBottomRatio = .25;
    first.emphasisBySegment.push({ segmentId: 'a', keywords: ['word'] });
    expect(templateStyle(id).layout.marginBottomRatio).not.toBe(.25);
    expect(templateStyle(id).emphasisBySegment).toEqual([]);
  });
});
