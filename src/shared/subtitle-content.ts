import type { Segment } from "./contracts";
export function primarySubtitleText(
  segment: Segment,
  translationEnabled = true,
): string {
  return translationEnabled
    ? segment.translatedText || segment.sourceText
    : segment.sourceText;
}
export function subtitleText(
  segment: Segment,
  translationEnabled = true,
  bilingual = false,
): string {
  const text = primarySubtitleText(segment, translationEnabled);
  return translationEnabled && bilingual && segment.translatedText
    ? `${text}\n${segment.sourceText}`
    : text;
}
