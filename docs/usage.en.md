# Slice Man workflow guide

Slice Man is a Windows x64 desktop workspace for original-language and translated video subtitles. The interface is in Chinese. Download the installer from the [latest Release](https://github.com/linglan111/slice-man/releases/latest); provide your own credentials for online services.

## Prepare and generate

1. For local recognition, install the engine and model through **本地引擎** in the lower-left sidebar. Local models are Base, Small and Large v3 Turbo. CPU works without a GPU; compatible NVIDIA execution is optional, with CPU fallback and the actual backend shown. Cloud recognition requires an OpenAI-compatible speech provider returning usable segment timestamps.
2. Configure text-service profiles as needed. Translation, review, chapter analysis and style design can use separate profiles. Supported text formats are OpenAI Chat Completions/Responses, Anthropic Messages and Gemini. In **API 服务**, set **文字请求并发上限** per profile: default 2, integer range 1–16. All text operations using that profile share its limit; speech recognition is separate.
3. Import a local video with **导入视频**, or use **链接导入**. Choose source language and whether to enable translation. Original-language projects need no translation service.
4. After import, open **生成设置** in the lower-left sidebar to choose recognition mode and the project's service profiles. Click **生成** beneath the preview and confirm. Correct source text, optional translation and cue times in **字幕校对**; click a timestamp to seek. Use **样式设置** for templates, typography and placement, or the toolbar's **样式** for AI design.
5. Choose **导出** for standalone SRT/ASS/VTT or burned-in MP4/MKV. Use **章节** to export selected chapters.

Original-language mode skips translation in generation, reruns, names and repairs. Preview, fullscreen captions and all exports explicitly use source text, even if older translations remain stored. Toggling translation mode preserves those stored translations.

## Proofread and rerun

The preview shows live captions after recognition; translation mode uses available translations with source fallback and the selected bilingual setting. Click a windowed caption or its proofreading row to edit. Add/delete controls and playback following support manual correction without calling AI. Inline preview approximates the layout; inspect the exported video for the final managed-font ASS rendering.

**重新识别片段** and **重新翻译片段** accept selected cues or a time interval. Recognition expands to complete intersecting and overlapping cues; inspect its effective ranges and affected count before confirming. Separate selections preserve unrelated gaps. Combined recognition/translation is available only when translation is enabled. All requested scoped work must succeed before replacing the target; failure/cancellation keeps prior subtitles. Translation-only preserves source text and timing.

**重新识别原片** requires confirmation before replacing existing source corrections and translations. Successful replacement invalidates derived previews and does not automatically translate. Failure/cancellation keeps prior content; historical exported files remain. In cloud mode the audio is uploaded again and the service may charge.

The grade/status filter supports multiple selections. **全选 / 取消全选** operates on the current filtered results. **选择时间范围** adds matching intersecting cues while preserving selections outside that interval. Selection does not start processing.

## Shared full-text chapters

**全文章节切分** provides reusable processing chapters for translation, subtitle review, text phases of repair, style generation and custom chapter analysis. Chapters cover the timeline and are at most 20 minutes long. A short video without a compatible plan gets a single coverage chapter without a planning-model call; longer videos use content planning. Compatible plans are reused across operations. Changed source content can invalidate a plan; repair reuses its validated boundaries while refreshing cue membership.

Each targeted nonempty chapter normally receives one generation per phase, with complete chapter timing, source text, enabled translations and explicit targets. Selecting a few cues restricts targets, while retaining full chapter context. Boundary evidence does not authorize unrelated changes. Capacity checks fail explicitly; adjust chapter boundaries or use a suitable model. Dense chapters are not silently subdivided, and context is not silently truncated. Model capacity and application limits are separate constraints.

Recognition processes audio intervals and does not use these chapters. Person-name analysis sends one chronological whole-timeline request and never requires, creates or changes a chapter plan.

Independent chapters can run concurrently under the API profile's shared 1–16 limit. Full translation and review retain completed chapters after later failure/cancellation, with compatible continuation. Scoped retranslation, combined recognition/translation and each repair round remain atomic across their targets. Request count, token use and elapsed time depend on content, model and service limits.

The **章节类型** question icon explains this processing model. **自定义切分章节** instead selects content using a saved criterion; it does not replace processing chapters. Criteria can be added, edited, copied, deleted and selected, while generated plans retain their criterion snapshot. Edit titles, summaries and boundaries, save, then select chapters for export. Files use safe chapter titles, preserve existing destinations and clip/rebase subtitle times to zero. Completed files survive failure/cancellation; compatible missing outputs can be resumed.

## Subtitle review and automatic repair

Open **AI 检查字幕**, choose all cues, selected cues or a time range, and confirm the review service. Review uses complete chapter context for videos of every duration. Each target receives **无 / 低 / 中 / 高**, derived from the application's fixed rubric and locally validated evidence. **可疑度标准** explains the rules. Review itself uses text/timing, not source audio, and never edits subtitles. **无** means no obvious suspicion was identified; it does not prove acoustic accuracy.

**未检查** includes never-reviewed cues and assessments requiring recheck. Changes to text or dependent context can invalidate old grades, including previously clear cues. Ignoring a finding persists only while its relevant identity remains compatible. Format, coverage or evidence failures may receive at most one visible complete correction; failed output cannot be applied. Completed review chapters remain available when another chapter fails.

Click **字幕自动修复** in the proofreading header. Choose all subtitles or a fixed time range, an inclusive minimum suspicion grade, and 1–20 rounds. Defaults are medium-or-higher and 3 rounds. Closing/reopening preserves the current parameters; closing the dialog does not cancel running work. Use the explicit cancel action.

Each round follows this sequence:

1. Establish/reuse full-text chapters and check missing or stale assessments.
2. Select current unignored findings meeting the threshold and freshly recognize their audio ranges, including necessary complete-cue/overlap expansion.
3. Generate fresh translations when the project enables translation.
4. Audit every target using full chapter context, suspicion reasons and old/new timing, source text and active translations. Validate complete target coverage and permitted changes.
5. Save the whole audited round atomically, invalidate affected assessments even when the audit retains old text, and reassess.

The requested time interval stays fixed across rounds as cue IDs change; the displayed effective recognition range can extend beyond it. Ignoring a finding does not lock its cue against necessary overlapping recognition. Original-language mode performs no translation calls.

Before stopping, an assessment-only consistency phase checks remaining pending grades in the requested and affected coverage, including new/expanded cues and dependent assessments. It does not change content or consume another repair round. Successful closure requires current grades, including explicit **无**, matching saved state. If this phase discovers another eligible scoped finding with rounds available, repair continues.

The summary distinguishes no remaining eligible findings, round cap, cancellation, failure and interruption. A cap can leave suspicious cues; no outcome guarantees correctness. A failed/cancelled current round does not partially replace content, and earlier committed rounds remain. Failed/cancelled final checks retain pending states and cannot claim an all-clear. Restart never automatically resumes paid work.

## Person-name suggestions

Use **人名检查** to group observed variants of the same person across the complete chronological timeline. A group must occur in at least two distinct cues, even if each spelling occurs only once. Contextually distinct people remain separate. Local checks verify exact aliases, fields, positions and counts, including mixed Latin/CJK boundaries. Whole-timeline analysis has explicit capacity limits rather than hidden chapter splitting; changing only chapter boundaries does not change its context.

Inspect variants and examples, edit recommended original/translated names, select entries and explicitly apply. Analysis alone does not edit subtitles. Literal matches cannot establish identity by themselves, especially in unspaced CJK text. Conflicting overlapping replacements are rejected. Recoverable format/evidence errors permit at most one visible whole-request correction; terminal failure retains the previous report.

Only the latest successful batch can be undone across restart. Undo restores a field only if it still equals the batch result; later manual edits remain intact and conflicts are reported. Deleted/re-recognized cues are not reconstructed. The undo attempt is consumed; there is no multi-level undo or redo.

## Workspace and progress

Toolbar operations open separate panels without executing them. On each operation switch, the panel fits its content with an automatic cap of 45% of the middle column's available height while reserving minimum video space. Drag the horizontal divider between preview and operation panel for a temporary height; the next operation switch resets automatic fitting. Sidebar width, column proportions and proofreading/results height persist; the temporary operation height does not. Dividers support keyboard adjustment, and **重置布局** restores defaults.

The initial **功能导航** explains preparation, import, proofreading, AI checking, repair and export without starting those actions. The upper-left **?** reopens it, including with a collapsed sidebar or no project.

During processing, **查看流式信息** opens the active streams. Operation, phase, repair round/cap, completed chapters/targets, queued requests, all concurrent chapter states and elapsed activity stay visible. Whole-timeline names show one global analysis rather than chapter counts. Byte activity is not an ETA. After processing, results provide reopening and **AI 请求日志**.

Text answers stream to local files with SQLite metadata for phase, duration, bytes, provider-reported usage and errors. Incomplete JSON never applies. The service timeout covers connection/idle; total generation timeout defaults to 30 minutes and supports 1–60 minutes. A normal JSON response from the same request is accepted. Providers incompatible with streaming can disable it and retry manually; an interruption does not automatically replay generation.

Reasoning is displayed only temporarily. Persistent logs exclude credentials, complete prompts and reasoning text; answer files may contain subtitle content. Ended records retain at most 30 days / the latest 1,000 entries and can be cleared manually. Inspect diagnostic contents before sharing.

## Downloads, export and data

In **链接导入设置**, install managed download tools and configure save folder, format, codec, resolution and optional proxy. Defaults are Videos/Slice Man, MP4, original codec and 1080p. Downloads and any conversion must finish and validate before a project is added. Site permissions, network and codec/container compatibility can limit import.

Whisper runtimes/models, yt-dlp and Deno retain pinned cached bytes after interrupted installation. Explicit continuation validates ranges and final hashes before activation, preserving a working installation on failure. App startup does not automatically download tools. Cache inspection/clearing is explicit; this is separate from source-video URL downloading.

**导出设置** stores separate video/subtitle defaults. Video export supports MP4/MKV, original/H.264/H.265 choices, resolution and quality; original codec means re-encoding the supported source codec, not copying video packets. Unsupported source codecs/container combinations require another choice. Smaller sources are not upscaled. SRT/VTT contain text/timing; ASS carries supported styling. Standalone export uses the saved corrected timeline without encoding video or calling AI.

Export preserves existing files and requires hard-link support for video publication, normally a local NTFS folder. An unsupported destination reports a recoverable error; select a supported folder and a new filename.

Local recognition processes audio on the computer. Cloud recognition uploads audio; translation, review, names, chapters and AI style send relevant subtitle text/timing context to configured services. Provider handling and charges depend on those services. Keys are managed in main with protected local persistence or session-only storage; neither option changes what an authorized provider request sends.

## Development and verification

Use Windows x64, Node.js 24.17.x and npm 11.x:

```powershell
npm ci
npm run setup:resources
npm run dev
```

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run setup:whisper-fixtures
npm run setup:download-fixtures
npm run test:e2e
```

Unit/integration tests use Electron's embedded Node to match SQLite's ABI. Avoid rebuilding SQLite for ordinary Node before desktop tests. GPU fixtures additionally require `npm run setup:whisper-fixtures -- --gpu` and compatible hardware. Real-service and external-site cases have explicit opt-in conditions; skips are not proof of compatibility or accuracy.

```powershell
npm run package
npm run make
npm run test:package
```

`package` creates `dist/win-unpacked`; `make` creates the Windows x64 NSIS installer. Use a separate builder output directory if an existing unpacked app is running, and select it with `test:package -- --app-dir <directory-under-dist>`. Do not overwrite the running copy. See [development environment](development-environment.md), [manual acceptance](manual-acceptance.md) and [release workflow](releasing.md) for native prerequisites, opt-in checks and packaging details. Only the `release` branch publishes through GitHub Actions; `main` does not.

Windows 11 x64 has been exercised; Windows 10 and clean-device upgrade/install acceptance remain separate checks. Test reports apply to their recorded source/build and distinguish HTTP fixtures, real services and native speech/media evidence.
