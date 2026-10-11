import { z } from "zod";
import { segmentSchema, type Segment } from "../../../../shared/contracts";
import { AppError } from "../../../lib/errors";
export function validateTimeline(
  segments: Segment[],
  durationMs: number,
): Segment[] {
  z.number().int().positive().parse(durationMs);
  const parsed = z.array(segmentSchema).parse(segments);
  const ids = new Set<string>();
  for (const s of parsed) {
    if (ids.has(s.id)) throw new AppError("DUPLICATE_ID", "字幕 ID 重复");
    ids.add(s.id);
    if (s.endMs > durationMs)
      throw new AppError("TIMING_INVALID", "字幕时间超出视频长度");
  }
  return parsed.sort(
    (a, b) =>
      a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id),
  );
}
const cloudSegmentSchema = z.object({
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  text: z.string(),
});
export function normalizeCloud(
  raw: unknown,
  offsetMs: number,
  durationMs: number,
  prefix: string,
): Segment[] {
  const response = z
    .object({ segments: z.array(cloudSegmentSchema) })
    .safeParse(raw);
  if (!response.success)
    throw new AppError(
      "TIMESTAMPS_UNSUPPORTED",
      "识别接口未返回可用的 segments 时间戳，请选择支持 verbose_json 的模型。",
    );
  const segments = response.data.segments
    .filter((s) => s.text.trim())
    .map((s, i) => ({
      id: `${prefix}-${i}`,
      startMs: Math.round(s.start * 1000) + offsetMs,
      endMs: Math.round(s.end * 1000) + offsetMs,
      sourceText: s.text.trim(),
      translatedText: "",
      translationStale: false,
    }));
  return validateTimeline(segments, durationMs);
}
export function normalizeWhisper(
  raw: unknown,
  offsetMs: number,
  durationMs: number,
): Segment[] {
  const parsed = z
    .object({
      transcription: z.array(
        z.object({
          offsets: z.object({
            from: z.number().int().nonnegative(),
            to: z.number().int().nonnegative(),
          }),
          text: z.string().max(20000),
        }),
      ),
    })
    .safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      "LOCAL_RECOGNITION_INVALID",
      "本地识别结果格式无效，请重新识别或更换模型。",
    );
  if (
    !z.number().int().nonnegative().safeParse(offsetMs).success ||
    !z.number().int().positive().safeParse(durationMs).success
  )
    throw new AppError("TIMING_INVALID", "本地识别时间范围无效。");
  const segments: Segment[] = [];
  for (const [index, entry] of parsed.data.transcription.entries()) {
    const startMs = entry.offsets.from + offsetMs;
    const endMs = entry.offsets.to + offsetMs;
    if (endMs < startMs || startMs > durationMs || endMs > durationMs)
      throw new AppError(
        "TIMING_INVALID",
        "本地识别结果包含倒退或超出视频长度的时间戳，请重新识别或更换模型。",
      );
    // whisper.cpp can emit punctuation/short tokens with identical endpoints.
    // They have no display duration: omit just that cue without inventing timing.
    if (endMs === startMs || !entry.text.trim()) continue;
    segments.push({
      id: `local-${index}`,
      startMs,
      endMs,
      sourceText: entry.text.trim(),
      translatedText: "",
      translationStale: false,
    });
  }
  return validateTimeline(segments, durationMs);
}
export function mergeChunkSegments(
  existing: Segment[],
  incoming: Segment[],
): Segment[] {
  // Only deduplicate intersecting equal text. Repeated speech at a different time survives.
  return [
    ...existing,
    ...incoming.filter(
      (s) =>
        !existing.some(
          (e) =>
            e.sourceText === s.sourceText &&
            Math.min(e.endMs, s.endMs) > Math.max(e.startMs, s.startMs) &&
            Math.abs(e.startMs - s.startMs) < 1000,
        ),
    ),
  ].sort((a, b) => a.startMs - b.startMs);
}
