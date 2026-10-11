import type { Segment, SubtitleStyle } from '../../../shared/contracts';

export type CaptionLine = { text: string; isSource: boolean };
export type TextPart = { text: string; isEmphasized: boolean };
export type VideoRect = { left: number; top: number; width: number; height: number };

export function captionLines(segment: Segment, bilingual: boolean): CaptionLine[] {
  const lines = [{ text: segment.translatedText || segment.sourceText, isSource: false }];
  if (bilingual && segment.translatedText) lines.push({ text: segment.sourceText, isSource: true });
  return lines;
}

export function activeCaptions(segments: readonly Segment[], timeMs: number): Segment[] {
  if (!Number.isFinite(timeMs) || timeMs < 0) return [];
  return segments.filter((segment) => segment.startMs <= timeMs && timeMs < segment.endMs);
}

/** Object-fit contain uses decoded dimensions, including display rotation/SAR. */
export function containedVideoRect(width: number, height: number, videoWidth: number, videoHeight: number): VideoRect {
  if (Math.min(width, height, videoWidth, videoHeight) <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const contentWidth = videoWidth * scale;
  const contentHeight = videoHeight * scale;
  return { left: (width - contentWidth) / 2, top: (height - contentHeight) / 2, width: contentWidth, height: contentHeight };
}

/** Literal matching avoids executing subtitle markup or treating keywords as regex. */
export function emphasizedParts(text: string, keywords: readonly string[]): TextPart[] {
  const words = [...new Set(keywords.filter(Boolean))].sort((left, right) => right.length - left.length);
  const parts: TextPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let nextStart = text.length;
    let nextWord = '';
    for (const word of words) {
      const index = text.indexOf(word, cursor);
      if (index >= 0 && index < nextStart) { nextStart = index; nextWord = word; }
    }
    if (nextStart > cursor) parts.push({ text: text.slice(cursor, nextStart), isEmphasized: false });
    if (!nextWord) break;
    parts.push({ text: nextWord, isEmphasized: true });
    cursor = nextStart + nextWord.length;
  }
  return parts;
}

export function captionOpacity(segment: Segment, timeMs: number, animation: SubtitleStyle['animation']): number {
  if (animation.type === 'none') return 1;
  const duration = segment.endMs - segment.startMs;
  const total = animation.inMs + animation.outMs;
  const scale = total > duration ? duration / total : 1;
  const fadeIn = animation.inMs * scale;
  const fadeOut = animation.outMs * scale;
  return Math.max(0, Math.min(1, fadeIn ? (timeMs - segment.startMs) / fadeIn : 1, fadeOut ? (segment.endMs - timeMs) / fadeOut : 1));
}

/** VTTCue parses WebVTT tags; escape text before assigning the native track. */
export function nativeCaptionText(segment: Segment, bilingual: boolean): string {
  return captionLines(segment, bilingual).map(({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n');
}
