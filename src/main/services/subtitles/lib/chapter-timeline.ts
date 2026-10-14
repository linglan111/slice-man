import type { Segment } from '../../../../shared/contracts';
import { AppError } from '../../../lib/errors';

export function clipChapterTimeline(segments: Segment[], startMs: number, endMs: number): Segment[] {
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs) throw new AppError('TIMING_INVALID', '章节范围无效');
  return segments.filter((cue) => cue.startMs < endMs && cue.endMs > startMs).map((cue) => ({ ...cue, startMs: Math.max(cue.startMs, startMs) - startMs, endMs: Math.min(cue.endMs, endMs) - startMs }));
}
