# Slice Man

**English** | [简体中文](README.zh-CN.md)

A Windows desktop workspace for video subtitles: import, transcribe, optionally translate, proofread, review with AI, and export in one application. **The interface is currently in Chinese.** Original-language subtitles are supported without translation.

![Slice Man v0.1.5 subtitle workspace and full-text chapters](docs/screenshots/workspace-v0.1.5.png)

*Actual v0.1.5 interface. The video, subtitles, and suspicion grades are demonstration data; grades were returned by a local mock service.*

## Download and install

Download the Windows x64 installer from the [latest Release](https://github.com/linglan111/slice-man/releases/latest). Check that release's assets and `SHA256SUMS.txt` for the version and SHA-256 checksum.

- Windows 11 x64 has been verified; Windows 10 still needs verification on a separate device.
- No separate Node.js, Python, or compiler installation is needed. Install local Whisper runtimes, models, and video download tools on demand inside the app.
- Local recognition supports CPU execution and optional acceleration on compatible NVIDIA GPUs, with CPU fallback. The interface shows the actual backend used.
- Online recognition and AI text features use your configured providers and API keys. Shared service credits are not included.
- Builds are currently unsigned. Clean-device installation, upgrades, and the SmartScreen experience still require manual acceptance checks.

## Features

| Area | Supported features |
| --- | --- |
| Import | Local videos or video URLs; configurable download folder, format, codec, resolution, and proxy for URL imports. |
| Speech recognition | Local Whisper Base / Small / Large v3 Turbo, or an OpenAI-compatible speech service returning segment timestamps; whole-video and scoped re-recognition. |
| Optional translation | Original-language or translated subtitle projects; whole-video, selected-cue, and time-range translation using Chat Completions, Responses, Anthropic Messages, or Gemini text protocols. |
| Proofreading and preview | Edit source text, translations, and timing; add/delete cues; follow playback, seek, edit on-video captions, and preview bilingual or fullscreen subtitles. |
| AI subtitle review | Review all cues, selected cues, or a time range; consistent none/low/medium/high suspicion grades with reasons, evidence, filters, ignored findings, and pending-recheck states. |
| Automatic repair loop | Review, re-recognize speech, optionally retranslate, audit old and new subtitles together, and reassess within a chosen scope, minimum suspicion grade, and round limit. |
| Person-name review | Analyze variants of the same person's name across the whole video, verify occurrences and context, edit and explicitly apply suggestions, and undo the latest successful batch. |
| Chapters | Reuse full-text chapters for AI text operations; select custom chapters by a criterion, edit titles, summaries, and boundaries, and export chapters separately. |
| Styling and export | Built-in and AI-designed styles; SRT / ASS / VTT or MP4 / MKV with burned-in subtitles, with independent codec, resolution, and quality settings. |
| Processing information | Phases, repair rounds, chapter/cue completion, queued and concurrent requests; stream viewers, request logs, and cancellation. |
| Workspace and tools | First-run feature guide, adjustable dividers, layout reset; verified resumable downloads and cache cleanup for runtimes, models, yt-dlp, and Deno. |

## Quick start

1. **Prepare services:** install a local recognition runtime and model under **本地引擎** (Local engine) in the lower-left sidebar. Configure online recognition, translation, AI review, and styling under **API 服务** (API services) as needed.
2. **Import a video:** choose **导入视频** (Import video) or **链接导入** (Import URL), then confirm the source language and whether to enable translation. Original-language projects need no translation service; preview, repair, and export use source text.
3. **Generate subtitles:** after import, open **生成设置** (Generation settings) in the lower-left sidebar to select recognition mode and services. Click **生成** (Generate) below the preview and confirm. Edit text and timing in **字幕校对** (Subtitle proofreading) on the right; click a timestamp to seek. Check the effective scope before scoped re-recognition or retranslation.
4. **Review and repair:** use **AI 检查字幕** (AI subtitle review) to inspect suspicious cues, or explicitly start **字幕自动修复** (Automatic subtitle repair). Person-name review gives separate suggestions for you to approve and apply.
5. **Style and export:** configure appearance in the lower-left **样式设置** (Style settings), or request AI design with **样式** (Style) below the preview. Use **导出** (Export) for subtitle files or videos with burned-in subtitles, and **章节** (Chapters) for selected clips.

The upper-left question mark reopens the feature guide. Operations open separate panels; opening a panel does not start processing. Switching operations fits the panel to its contents, capped at 45% of the middle column's available height while reserving minimum video space. Drag the horizontal divider between preview and operation panel for a temporary height; the next operation switch fits it again. Sidebar width, column proportions, and proofreading/results heights persist; temporary operation-panel height does not. **重置布局** (Reset layout) restores defaults. Dividers also support keyboard adjustment.

## How AI processing works

### Full-text chapters and service concurrency

Translation, subtitle review, the text phases of automatic repair, style generation, and custom chapter analysis reuse a valid **全文章节切分** (Full-text chapter split). Each chapter is at most 20 minutes long. Short videos without a valid plan automatically get one coverage chapter; longer videos use content-based planning. Custom chapter splits select content for export and do not replace processing chapters.

Each targeted chapter normally receives one generation request per phase, with the complete chapter's timing, source text, enabled translations, and explicit targets. Selecting a subset limits changes or review targets while preserving full chapter context. Capacity failures are reported explicitly: adjust chapter boundaries or the model. Context is not silently truncated, and dense chapters are not split into hidden smaller batches. Speech recognition processes audio intervals; person-name review analyzes the entire subtitle timeline in one request. Neither depends on chapters.

In **API 服务** (API services), set **文字请求并发上限** (Text request concurrency limit) per service profile: default **2**, integer range **1–16**. Text requests using the same profile share this limit, including whole-video person-name analysis; speech recognition is separate. Full-video translation and subtitle review retain completed chapters and can continue when compatible. Scoped operations and each repair round replace their targets only after complete success. Duration, token use, and results depend on subtitle density, model capacity, and provider rate limits.

### Review, repair loops, and person names

Subtitle review analyzes text and timing, without listening to the original audio or editing subtitles. **无** (None) means no obvious suspicion was identified, not guaranteed accuracy. **未检查** (Unchecked) includes never-reviewed cues and cues requiring recheck. Changes to text or context can invalidate earlier grades. **可疑度标准** (Suspicion criteria) explains the shared rubric.

Automatic repair defaults to **medium or higher, 3 rounds**. It supports low/medium/high thresholds, 1–20 rounds, and all subtitles or a fixed time range. Each round reviews missing or stale assessments, freshly recognizes unignored findings meeting the threshold, and generates fresh translations when enabled. It audits old and new timing, source text, translations, and suspicion reasons together using full chapter context. After complete validation, the entire round is saved and reassessed. Even if the audit retains the original text, the cue is reviewed again. Recognition expands to complete cues and necessary overlapping intervals; inspect the effective scope. Ignoring a finding does not lock its cue against changes.

Before finishing, an additional review checks pending assessments within the requested and affected coverage against the final saved state. This step only reviews and does not add a repair round. Reaching the limit can leave suspicious cues; results show the remaining count. Cancellation, failure, interruption, or incomplete final review cannot claim everything is fixed. Saved rounds remain; unfinished rounds do not partially replace subtitles. Restart never automatically resumes paid processing. Closing the repair dialog does not cancel work; use the cancel button.

Person-name review retains whole-video identity context; each person must appear in at least two distinct cues. Actual aliases, fields, positions, and counts are checked locally. Inspect spellings and examples, edit recommended source/translated names, select entries, and explicitly apply them. Suggestions never apply automatically. Only the latest successful batch can be undone across restarts; later manual changes remain and conflicts are reported. Deleted or re-recognized cues are not reconstructed. Invalid model formats or evidence permit at most one visible whole-batch correction; terminal failure retains the previous report. Literal matches cannot prove identity, so check context.

During processing, view queued, running, and streaming states for every concurrent request alongside the phase and repair round. Logs record duration, bytes, and provider-reported usage. Connection/idle timeouts and total generation timeout are independently configurable; the total defaults to 30 minutes and supports 1–60 minutes. Interrupted generation requests are not automatically replayed, and incomplete JSON is never applied.

## Data, export, and limitations

- Local recognition processes audio on your computer. Cloud recognition uploads audio; translation, review, person-name analysis, chapters, and AI styling send relevant subtitle text, timing, and context. Data handling and fees depend on your provider.
- The main process manages API keys, with protected local storage or session-only use. Answer files stay on the computer. Logs do not retain keys, complete prompts, or model reasoning; reasoning is displayed temporarily only. Answers may contain subtitle content, so inspect diagnostics before sharing. Ended logs retain at most 30 days and the latest 1,000 records, and can be cleared manually.
- Original-language mode makes no translation calls and uses source text for previews and all exports. Changing modes preserves stored translations. Full-video re-recognition requires confirmation before replacing existing corrections and does not automatically translate afterward. Failure or cancellation preserves existing content; historical export files remain.
- Standalone subtitles use current saved text and timing without calling AI again. Burning subtitles into video always re-encodes it. Selecting the original codec means re-encoding with a supported codec of the same type. Resolution limits do not upscale smaller sources.
- Chapter exports clip subtitles to boundaries and rebase their times to zero. Existing files remain; completed outputs survive failure or cancellation, and compatible unfinished exports can continue. Publishing a video file requires a destination with hard-link support, usually local NTFS. Choose another folder and a new filename if unsupported.
- Runtimes, models, and download tools must be installed or resumed explicitly and are enabled only after verification. Resuming their installation is separate from resuming source-video URL downloads. URL compatibility depends on the site, permissions, and network conditions.

See the [English workflow guide](docs/usage.en.md) for detailed instructions and the [manual acceptance checklist](docs/manual-acceptance.md) for device installation and real-network verification boundaries. Test results apply to their recorded commit or build; they do not establish compatibility with every provider, GPU, language, or site.

## Run from source

Use Windows x64, Node.js **24.17.x**, and npm **11.x**. Install locked dependencies and prepare verified FFmpeg, fonts, and test audio:

```powershell
npm ci
npm run setup:resources
npm run dev
```

Common checks and desktop tests:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run setup:whisper-fixtures
npm run setup:download-fixtures
npm run test:e2e
```

Unit/integration tests run through Electron's embedded Node to match SQLite's native ABI. Do not rebuild SQLite for ordinary Node before desktop tests. GPU tests also require compatible hardware and `npm run setup:whisper-fixtures -- --gpu`. Paid real-service and external-download tests have explicit opt-in conditions; skipped tests do not count as passes.

```powershell
npm run package
npm run make
npm run test:package
```

`package` creates `dist/win-unpacked`; `make` creates the Windows x64 NSIS installer. If an app from that directory is running, package into a separate output directory and pass it to `test:package -- --app-dir <directory-under-dist>`. Downloaded binaries, runtimes, models, caches, personal data, and installers are not committed as source. See the [development environment](docs/development-environment.md) for detailed prerequisites, native testing, and packaging options.

## Releases and contributions

Only `release` automatically publishes official releases; `main` and other development branches do not. Update the versions in both `package.json` and `package-lock.json`, then merge reviewed changes into `release`. GitHub Actions runs checks, Electron regression tests, Windows builds, and package verification before publishing the installer and SHA-256 manifest. Published versions are never overwritten. Manual workflow runs must also select `release`. See the [release workflow](docs/releasing.md) for details.

Report issues or suggest improvements through [Issues](https://github.com/linglan111/slice-man/issues) or pull requests. Include your operating system, application version, and reproduction steps, and remove API keys and private video/subtitle information.

## License and third-party components

Project code uses the [MIT License](LICENSE). Third-party components retain their own licenses: FFmpeg / FFprobe are separate GPLv3 tools; Noto Sans CJK fonts use OFL 1.1; Whisper / whisper.cpp retain MIT notices; on-demand yt-dlp, Deno, and their dependencies follow their respective licenses.

See [RESOURCE-ORIGINS.md](resources/notices/RESOURCE-ORIGINS.md) for component build information, notices, and corresponding source origins. The project's MIT license does not replace third-party distribution requirements.
