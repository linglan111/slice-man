import {
  styleSchema,
  type Segment,
  type SubtitleStyle,
} from "../../../../shared/contracts";
import { validateTimeline } from "./timeline";
export function escapeAss(text: string): string {
  return text
    .replace(/\\/g, "＼")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\r\n?|\n/g, "\\N");
}
function rgb(color: string): string {
  return `&H${color.slice(5, 7)}${color.slice(3, 5)}${color.slice(1, 3)}&`;
}
function time(ms: number, ass = false): string {
  const value = ass ? Math.floor(ms / 10) * 10 : ms;
  const h = Math.floor(value / 3600000);
  const m = Math.floor(value / 60000) % 60;
  const s = Math.floor(value / 1000) % 60;
  return `${ass ? h : String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${ass ? "." : ","}${String(ass ? Math.floor((value % 1000) / 10) : value % 1000).padStart(ass ? 2 : 3, "0")}`;
}
function displayed(s: Segment, bilingual: boolean): string {
  const target = s.translatedText || s.sourceText;
  return bilingual && s.translatedText ? `${target}\n${s.sourceText}` : target;
}
function wrap(text: string, max: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const tokens = line.match(/[\u2e80-\uffff]|\S+\s*|\s+/gu) ?? [];
      const lines: string[] = [];
      let current = "";
      for (const token of tokens) {
        if ([...(current + token)].length > max && current) {
          lines.push(current.trimEnd());
          current = "";
        }
        current += token;
        if ([...current].length > max) {
          const chars = [...current];
          while (chars.length > max) lines.push(chars.splice(0, max).join(""));
          current = chars.join("");
        }
      }
      lines.push(current.trimEnd());
      return lines.join("\n");
    })
    .join("\n");
}
export function compileSubtitles(
  segments: Segment[],
  rawStyle: SubtitleStyle,
  geometry: { width: number; height: number; durationMs: number },
  bilingual: boolean,
  format: "ass" | "srt" | "vtt",
): string {
  const style = styleSchema.parse(rawStyle);
  const cues = validateTimeline(segments, geometry.durationMs);
  if (format !== "ass") {
    const body = cues
      .map(
        (s, i) =>
          `${format === "srt" ? `${i + 1}\n` : ""}${time(s.startMs).replace(",", format === "vtt" ? "." : ",")} --> ${time(s.endMs).replace(",", format === "vtt" ? "." : ",")}\n${displayed(s, bilingual).replace(/-->/g, "→")}\n`,
      )
      .join("\n");
    return `${format === "vtt" ? "WEBVTT\n\n" : ""}${body}`;
  }
  const size = geometry.height * style.fontSizeRatio;
  const margin = Math.round(geometry.height * style.layout.marginBottomRatio);
  const marginX = Math.round(
    (geometry.width * (1 - style.layout.maxWidthRatio)) / 2,
  );
  const alignment =
    style.layout.anchor === "top-center"
      ? 8
      : style.layout.anchor === "center"
        ? 5
        : 2;
  const bold = style.fontId === "managed-cjk-bold" ? -1 : 0;
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${geometry.width}\nPlayResY: ${geometry.height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Noto Sans CJK SC,${size.toFixed(2)},${rgb(style.textColor)},${rgb(style.textColor)},${rgb(style.outlineColor)},&H${Math.round(
    (1 - style.shadow.opacity) * 255,
  )
    .toString(16)
    .padStart(
      2,
      "0",
    )}${style.shadow.color.slice(5, 7)}${style.shadow.color.slice(3, 5)}${style.shadow.color.slice(1, 3)},${bold},0,0,0,100,100,0,0,1,${(geometry.height * style.outlineWidthRatio).toFixed(2)},0,${alignment},${marginX},${marginX},${margin},1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`;
  const events = cues.map((s) => {
    let target = wrap(
      s.translatedText || s.sourceText,
      Math.max(
        1,
        Math.floor((geometry.width * style.layout.maxWidthRatio) / size),
      ),
    );
    let rendered = escapeAss(target);
    const emphasis = style.emphasisBySegment.find((e) => e.segmentId === s.id);
    if (emphasis) {
      const keywords = [...new Set(emphasis.keywords)].sort(
        (a, b) => b.length - a.length,
      );
      if (keywords.length) {
        const regex = new RegExp(
          keywords
            .map((k) => escapeAss(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|"),
          "g",
        );
        rendered = rendered.replace(
          regex,
          (match) =>
            `{\\c${rgb(style.emphasisColor)}}${match}{\\c${rgb(style.textColor)}}`,
        );
      }
    }
    if (bilingual && s.translatedText) {
      target = wrap(
        s.sourceText,
        Math.max(
          1,
          Math.floor(
            (geometry.width * style.layout.maxWidthRatio) /
              (size * style.layout.sourceScale),
          ),
        ),
      );
      rendered += `\\N{\\fs${(size * style.layout.sourceScale).toFixed(2)}}${escapeAss(target)}`;
    }
    const duration = Math.max(10, s.endMs - s.startMs);
    const totalFade = style.animation.inMs + style.animation.outMs;
    const factor = totalFade > duration ? duration / totalFade : 1;
    const fade =
      style.animation.type === "fade"
        ? `\\fad(${Math.floor(style.animation.inMs * factor)},${Math.floor(style.animation.outMs * factor)})`
        : "";
    // ASS uses centiseconds: round start down/end up and retain at least one unit.
    return `Dialogue: 0,${time(s.startMs, true)},${time(Math.max(Math.ceil(s.endMs / 10) * 10, Math.floor(s.startMs / 10) * 10 + 10), true)},Default,,0,0,0,,{${fade}\\xshad${(geometry.height * style.shadow.offsetXRatio).toFixed(2)}\\yshad${(geometry.height * style.shadow.offsetYRatio).toFixed(2)}}${rendered}`;
  });
  return header + events.join("\n") + "\n";
}
