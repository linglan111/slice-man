# Slice Man

A Windows x64 Electron desktop application for original-language and translated video subtitles. The interface is in Chinese. Users provide their own API credentials.

## Workflow

1. Import a local video, or use **链接导入** to download a video URL. Choose original-language subtitles or subtitles with translation during import; the project remembers this choice.
2. Choose local Whisper recognition or an OpenAI-compatible speech provider with segment timestamps.
3. For local recognition, open the one-click installer and choose Base, Small or Large v3 Turbo. CPU processing is supported; optional NVIDIA execution is validated and falls back to CPU when unavailable.
4. When translation is enabled, configure a translation profile using OpenAI Chat Completions/Responses, Anthropic Messages or Gemini format. Recognition, translation, text review and style design can use separate profiles. Original-language projects need no translation profile.
5. Generate subtitles, then correct source text, optional translated text and per-segment times. Translation is skipped throughout original-language projects, including reruns and repairs.
6. Choose a built-in template or request a bounded JSON style from AI. Preview the rendered subtitles.
7. Export burned-in MP4/MKV or standalone SRT/ASS/VTT subtitles.

Video export renders subtitle pixels into the picture. SRT/VTT carry text and timing; ASS can retain the application's supported styling. AI styles support typography, colors, outline/shadow, bilingual layout, literal keyword emphasis and limited fades.

Keys stay in the main process, with locally protected persistence or a session-only option. Local recognition keeps speech processing on the computer. Cloud recognition sends audio to the configured service; translation, AI text review and style design send subtitle text.

Use **重新识别片段** or **重新翻译片段** beside **添加画面字幕** to process selected subtitle cues or an explicit time range. Recognition automatically expands to complete intersecting cues; inspect the effective range and affected count before running. Separate selections do not process unrelated gaps. Optional combined translation is available only in translation-enabled projects. The target timeline is replaced only after all requested processing succeeds; failure/cancellation retains prior subtitles. Translation-only keeps source text and timing.

Choose a review text service and use **AI 检查字幕** to jointly inspect chronological dialogue, suspicious timing, source text and active translations. Every inspected cue receives a suspicion grade: **无 / 低 / 中 / 高**. A single versioned rubric defines the rules and examples; the model identifies supported rules and reasons, and the application derives the grade. Low covers minor or weak cues without a clear meaning change; medium requires concrete contextual/meaning/readability concerns; high requires strong evidence of a severe problem, such as reversed negation or a contradictory key quantity. Ordinary topic changes, quotes and spoken ellipsis alone must not be treated as severe errors.

Use the compact grade/pending filter and existing playback, manual editing, ignoring and targeted repair actions. Selected-cue review keeps the same surrounding dialogue as a full scan. Changed context makes dependent grades require rechecking, including previously clear cues. Unchecked and old ungraded reports are distinguishable from “无”. Review uses text/timing only, never source audio, and does not automatically apply corrections; “无” means no obvious suspicion was identified, not proof of spoken accuracy. Reports and acknowledgments persist with the project.

To replace an already-recognized video's source text, choose **重新识别原片** and confirm the replacement. Successful re-recognition replaces existing source corrections/translations and invalidates dependent previews; failure/cancellation retains the previous content. Historical exported files remain. Translate the new source afterward; the rerun action does not automatically translate. Check recognition accuracy against the actual audio, especially in long recordings.

The video preview displays live subtitles as soon as source recognition is available. In translation mode, available translations take priority with source fallback and the selected bilingual option. Original-language mode uses source text for preview/fullscreen and all exports even if older translations remain stored. Playback, paused seeks and edits update the current cue. Inline subtitles follow current layout/colors/typography; native fullscreen uses synchronized browser subtitles. Click a windowed caption or its proofreading row to edit timing/source/translation inline. Add/delete controls are available in both locations, and current cues are highlighted/followed like lyrics. Manual edits do not call recognition or translation; inspect the final exported video for exact managed-font ASS appearance.

Open **链接导入设置** in the lower-left sidebar to install the managed download tools and configure the default save folder, video file format, video encoding, resolution and optional proxy. Defaults are Videos/Slice Man, MP4, original video encoding and 1080p. Available formats are MP4/MKV/original, encoding choices are original/H.264/H.265, and resolution limits range from 360p to 2160p or highest available. Lower-resolution sources stay at their actual quality. These source-download preferences are separate from the subtitle burn-in export settings. Explicit encoding may require a cancellable conversion; incompatible original-encoding/container choices report an actionable error rather than changing the codec silently. Original format with a specified encoder uses MKV, shown in the UI. Downloads and conversions must finish and validate before a project is added; existing files are preserved on failure/cancellation.

Open **导出设置** for independent save-folder, MP4/MKV, original/H.264/H.265 codec, resolution, quality and default subtitle-format preferences. Video defaults are MP4, original codec, 1080p and balanced quality; smaller sources are not enlarged. Burning captions always re-encodes video. Original codec export supports H.264/HEVC/AV1/VP9/VP8 sources; unsupported codecs or container combinations require an explicit supported choice. The export dialog allows operation-specific overrides. **导出字幕文件** provides SRT/ASS/VTT using the latest corrected timeline without video encoding or another recognition/AI request.

## Development

Use Windows x64 with Node.js 24.17.x and npm 11.x. The desktop runtime/model installer does not require the end user to install Python or compiler tools.

```powershell
npm ci
npm run setup:resources
npm run dev
```

The resource setup retrieves pinned, verified media tools and managed CJK fonts. See [development environment](development-environment.md) for versions, native setup, asset sources and measured Whisper behavior.

```powershell
npm run icons:generate
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run test:native
npm run test:media
npm run setup:whisper-fixtures
npm run setup:download-fixtures
npm run test:whisper -- --cpu
npm run test:e2e -- --grep-invert "actual CUDA desktop"
npm run package
npm run make
npm run test:package
npm run test:installer
```

Native unit/integration tests run using Electron's embedded Node to match SQLite's ABI. E2E tests launch real Electron with isolated user data, local HTTP provider fixtures and real media operations. Real API quality and clean-machine installation require the [manual acceptance checks](manual-acceptance.md).

Prepare integrity-checked CPU Whisper/Base/speech fixtures before running the desktop speech tests. For a compatible NVIDIA device, use `npm run setup:whisper-fixtures -- --gpu`, then `npm run test:whisper` and the full `npm run test:e2e`. The GPU desktop case reports a skip when required fixtures or hardware are unavailable. The explicitly gated real-API test prerequisites are documented in the development environment guide. Fixture caches are excluded from Git and from the installer.

`npm run package` produces the unpacked application in `dist`; `npm run make` produces the Windows NSIS installer. Runtime downloads and development caches are excluded from Git. Media tools, managed fonts and their notices are included in the application package.

Export currently requires a destination with hard-link support, normally a local NTFS folder, for atomic publication without overwriting existing files. Unsupported volumes produce a recoverable error; choose a supported folder and a new filename.
