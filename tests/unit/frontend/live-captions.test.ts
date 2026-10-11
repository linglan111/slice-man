import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, type Segment } from '../../../src/shared/contracts';
import { activeCaptions, captionLines, captionOpacity, containedVideoRect, emphasizedParts, nativeCaptionText } from '../../../src/renderer/src/lib/live-captions';

const CUE: Segment = { id: 'cue', startMs: 100, endMs: 1000, sourceText: 'Source words', translatedText: '', translationStale: false };

describe('live caption timeline and literal text contracts', () => {
  it('uses source until translation exists and adds source only for translated bilingual cues', () => {
    expect(captionLines(CUE, false)).toEqual([{ text: 'Source words', isSource: false }]);
    expect(captionLines(CUE, true)).toHaveLength(1);
    const translated = { ...CUE, translatedText: 'Translated words' };
    expect(captionLines(translated, false)).toEqual([{ text: 'Translated words', isSource: false }]);
    expect(captionLines(translated, true)).toEqual([{ text: 'Translated words', isSource: false }, { text: 'Source words', isSource: true }]);
  });

  it('includes exact starts, excludes exact ends and retains overlaps and genuine repeated speech', () => {
    const cues = [CUE, { ...CUE, id: 'overlap', startMs: 500, endMs: 1500 }, { ...CUE, id: 'later', startMs: 2000, endMs: 2001 }];
    expect(activeCaptions(cues, 99)).toEqual([]);
    expect(activeCaptions(cues, 100)).toEqual([CUE]);
    expect(activeCaptions(cues, 999.99).map((cue) => cue.id)).toEqual(['cue', 'overlap']);
    expect(activeCaptions(cues, 1000).map((cue) => cue.id)).toEqual(['overlap']);
    expect(activeCaptions(cues, 1500)).toEqual([]);
    expect(activeCaptions(cues, 2000).map((cue) => cue.id)).toEqual(['later']);
    expect(activeCaptions(cues, 2001)).toEqual([]);
    expect(activeCaptions(cues, Number.NaN)).toEqual([]);
  });

  it('fits portrait/pillarbox and wide/letterbox content instead of using outer player dimensions', () => {
    expect(containedVideoRect(640, 360, 360, 640)).toEqual({ left: 218.75, top: 0, width: 202.5, height: 360 });
    expect(containedVideoRect(640, 360, 1280, 360)).toEqual({ left: 0, top: 90, width: 640, height: 180 });
    expect(containedVideoRect(0, 360, 640, 360).height).toBe(0);
  });

  it('matches literal metacharacters and chooses the longer matching keyword without corrupting text', () => {
    const text = 'a+b <b>literal</b> a+b';
    const parts = emphasizedParts(text, ['a+', 'a+b', '<b>', '', 'missing']);
    expect(parts.map((part) => part.text).join('')).toBe(text);
    expect(parts.filter((part) => part.isEmphasized).map((part) => part.text)).toEqual(['a+b', '<b>', 'a+b']);
    expect(emphasizedParts('unchanged', [])).toEqual([{ text: 'unchanged', isEmphasized: false }]);
  });

  it('escapes native cue markup and preserves target/source newlines', () => {
    expect(nativeCaptionText({ ...CUE, translatedText: '<b>x & y</b> -->' }, true)).toBe('&lt;b&gt;x &amp; y&lt;/b&gt; --&gt;\nSource words');
  });

  it('derives fade opacity from media time, including paused/short cues', () => {
    const animation = DEFAULT_STYLE.animation;
    expect(captionOpacity(CUE, 100, animation)).toBe(0);
    expect(captionOpacity(CUE, 160, animation)).toBe(.5);
    expect(captionOpacity(CUE, 500, animation)).toBe(1);
    expect(captionOpacity(CUE, 940, animation)).toBe(.5);
    const short = { ...CUE, endMs: 110 };
    expect(captionOpacity(short, 105, animation)).toBe(1);
    expect(captionOpacity(CUE, 100, { ...animation, type: 'none' })).toBe(1);
    expect(captionOpacity({ ...CUE, endMs: 200 }, 145, { type: 'fade', inMs: 900, outMs: 100 })).toBe(.5);
  });
});
