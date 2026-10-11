# Desktop Subtitle Contracts

## 1. Scope / Trigger

The video subtitle workflow crosses renderer, preload, main services, SQLite, AI providers and native media processes. The authoritative shared declarations are in `src/shared/contracts.ts`. Read the source contract before changing a method; backend and renderer must change together. Do not introduce an alternate renderer-only API or duplicate style/timing schemas.

Project-wide optional translation, partial rerun and AI review follow [subtitle-review-reprocessing.md](./subtitle-review-reprocessing.md). In original-only mode, all caption/compiler paths explicitly select source text and all translation APIs reject requests until the project enables translation.

## 2. Signatures

The renderer calls `window.api` through the typed preload bridge. Key operations include:

```typescript
api.jobs.recognize(jobId);
api.jobs.recognizeAgain({ jobId, revision });
api.jobs.translate({ jobId, segmentIds });
api.jobs.editSegment({ jobId, segment, revision });
api.jobs.addSegment({ jobId, revision, segment: { startMs, endMs, sourceText, translatedText } });
api.jobs.removeSegment({ jobId, revision, segmentId });
api.jobs.setStyle({ jobId, style });
api.jobs.designStyle({ jobId, prompt });
api.jobs.preview({ jobId, atMs });
api.jobs.export({ jobId, format, quality, videoCodec, resolution });
api.jobs.export({ jobId, format: 'srt' });
api.runtime.install({ modelId, preferGpu });
```

Operations return `Result<T>`: `{ success: true, data: T }` or `{ success: false, error: string, code: string }`. Check `success === true` before reading `data`. Progress subscriptions return an unsubscribe callback, which renderer effects must invoke during cleanup.

## 3. Contracts (Request / Response / Environment)

- Segment fields: stable `id`, integer millisecond `startMs`/`endMs`, `sourceText`, `translatedText`, and `translationStale`. Milliseconds are offsets on the video playback timeline; database creation/update timestamps are a separate date concept.
- ASS serialization floors cue starts and ceils cue ends to centiseconds, with a minimum one-centisecond cue. The serialized final cue may extend at most nine milliseconds past the exact source duration to represent its final centisecond; it does not extend the encoded media. Validate the original timeline against exact duration first. SRT/VTT preserve millisecond times.
- Translation output associates IDs with text; the text model does not own replacement media timestamps. Selected retranslation must preserve unselected segments and source timing.
- Material edits to a referenced provider profile (`protocol`, `mode`, `baseUrl`, `model`) invalidate the dependent work even when its profile ID is unchanged. Cloud-recognition dependencies require recognition again; translation dependencies mark existing translations stale. Increase affected job revisions and invalidate preview/export so an in-flight old result cannot commit. Changes to key/name/timeout do not invalidate completed content. Retain the last valid style when its design provider changes, and refresh jobs after profile save in the renderer.
- Editing includes the current job `revision`. A delayed response must not replace edits made after its request snapshot.
- Manual addition/deletion uses narrow revision-checked `addSegment` / `removeSegment` methods returning `Result<Job>`. Main generates the added cue ID; missing translation defaults to empty. Reject active work/stale revisions/invalid text or timing before mutation, persist changes atomically, preserve every unrelated cue/translation/global style and historical exported file, and invalidate derived render/export state. Remove only the deleted cue's emphasis references. Manual CRUD does not call speech or translation providers. An empty job may become a usable manually supplied source timeline with an explicit manual-save stage message, without claiming actual native inference/backend.
- Recognition modes are `local` or `cloud`. Local model IDs are the shared schema enum; do not hardcode another model catalog in the renderer. Cloud recognition requires usable segment timestamps.
- Recognition language `auto` is omitted from the cloud multipart language field and uses local Whisper's automatic option. Explicit regional locales such as `zh-CN`/`zh-TW` are normalized to the base language accepted by the recognizer; preserve the original configured locale for translation and settings.
- Local `normalizeWhisper(raw, offsetMs, durationMs)` validates structure, finite integer nonnegative offsets, text bounds and media bounds before omitting zero-duration/empty cues. Whisper can legitimately emit non-displayable short tokens with equal endpoints. Omit only those cues; preserve every usable cue's exact text/timing and raw-index ID, without inventing durations. Reversed/out-of-range local timing is `TIMING_INVALID`; malformed local output is `LOCAL_RECOGNITION_INVALID`. All-zero/silent local output remains a successful empty timeline. Cloud/manual/persisted segments still require `endMs > startMs`.
- Local whisper.cpp recognition passes `-mc 0` on both GPU and CPU/fallback invocations, disabling historical text conditioning. A real full-length Japanese Large v3 Turbo comparison eliminated the observed repeated-tail loop; distinct text does not prove linguistic accuracy. Do not suppress repeated text after recognition: repetition may be real speech.
- Ordinary `recognize(jobId)` retains successful-cache reuse. Only explicit `recognizeAgain({jobId, revision})` bypasses that cache, after a renderer confirmation of replaced source/translated/manual text and derived preview invalidation. Reject stale revisions or running-work conflicts before mutation. Check cancellation immediately before the successful replacement commit, including after asynchronous native-output/receipt reads; cancellation/failure retains prior text. The action does not automatically translate or delete historical exported files. Cloud-mode confirmation must explain that audio is uploaded again and the configured service may charge.
- A successful fresh recognition clears `style.emphasisBySegment` and resets the design stage, retaining template/global typography settings. Recycled local cue IDs must not bind old keyword emphasis to unrelated replacement text. Cancellation/failure retains the complete prior style. Historical output paths/files remain available even though their export state is invalidated.
- Style v1 uses known template/font IDs, finite bounded relative sizes/positions, six-digit RGB colors, `none`/`fade` effects and per-segment literal keyword references. All nested objects are strict; model-specific native JSON output does not replace local validation.
- Video formats are `mp4`/`mkv`; standalone subtitle formats are `srt`/`ass`/`vtt`. Standalone export reads persisted text/timing and must not call AI again.
- Independent export defaults and optional per-operation codec/resolution follow `../backend/export-preferences.md`. Renderer video export supplies explicit choices; legacy omitted options preserve H.264/original dimensions. Standalone files need only job ID/format and bypass video encoding/settings. Burn-in original codec means re-encoding the same supported H.264/HEVC/AV1/VP9/VP8 type, never video packet copying; unsupported source codecs/container combinations require explicit selection.
- Export renders/writes an adjacent temporary file, then checks cancellation and revision before no-clobber publication using a hard link. An existing destination returns `DESTINATION_EXISTS`; unsupported hard-link destinations return `DESTINATION_UNSUPPORTED`, with guidance to choose a local NTFS folder. Never replace an existing destination or remove somebody else's file after a stale result.
- Ordinary provider reads expose `hasKey`, not plaintext `apiKey`. Key-entry state is transient; later provider calls occur in main. Never include secrets in jobs, logs or export artifacts.
- Changing a saved profile from persisted to session-only without a replacement key must remove its stored ciphertext and retain the usable key only in memory. Changing back must protect the current session key before persistence or fail without changing the prior profile. A checkbox change must not merely relabel how an existing key is stored.
- This shared contract has no environment-based production API substitution. Explicit E2E environment gates belong to the main/test harness and must be documented with that implementation; a production window must always use real IPC services.
- Local playback/reference URLs follow `media-streaming.md`: opaque registered tokens, valid bounded HTTP byte-range responses and actual decoded-frame seek verification. Do not treat a file reader or an optimistic renderer time label as proof of browser seek support.

## 4. Validation & Error Matrix

| Input / event | Required behavior |
| --- | --- |
| Negative/non-integer timing or end <= start in manual/cloud/persisted segments | Reject before persisting/exporting |
| Local Whisper cue with validated in-range equal endpoints | Omit the non-displayable cue before strict timeline validation; retain every usable neighbour |
| Malformed/reversed/out-of-media local Whisper output | Actionable local-output/timing failure; never silently discard invalid timing |
| End exceeds media duration | Reject with timing failure |
| Duplicate timeline IDs | Reject; do not silently overwrite |
| Speech service returns text without segments | Report unsupported timestamp capability |
| Translation missing/unknown/duplicate IDs | Fail the affected batch; preserve completed data |
| Stale asynchronous edit/translation response | Reject/discard the obsolete update |
| Explicit recognize-again confirmation with stale revision / active work | Reject before replacing content |
| Manual add/remove with stale revision / active work / invalid timing/text | Reject before mutation; retain valid content |
| Manual remove with unknown ID | Structured failure; never delete another cue |
| Manual insert/remove | Atomic revised timeline; preserve unrelated content and historical exports; invalidate derived outputs |
| Recognize-again failure/cancellation | Preserve prior text and exported files; show the failed/cancelled attempt |
| Unknown style field/font/template or out-of-bounds value | Reject and retain the last valid style |
| GPU unavailable/initialization failure | Expose actual CPU fallback rather than GPU success |
| Cancellation/interrupted process | Retain completed artifacts; do not publish partial video |
| Existing/unsupported export destination | Recoverable no-clobber/unsupported-volume error; retain prior file |

Check concrete error codes in the owning service instead of inventing new codes at callers.

## 5. Good / Base / Bad Cases

- Good: translate a selected segment using neighbouring text as context, return its ID, commit only that selection and regenerate a reference preview.
- Base: a CPU-only machine installs a supported model and generates normal translated subtitles; GPU hardware is optional.
- Bad: treat source-word timestamps as translated-word timing, accept plain-text cloud transcription as a complete subtitle timeline, or mark GPU ready from device presence alone.

## 6. Tests Required

- Timing normalization and chunk offsets, overlap deduplication versus repeated speech, duration bounds and short ASS cue rounding.
- Local Whisper middle/tail/all-zero cues, zero at media boundaries, raw structure/nonfinite/negative/fractional/reversed/out-of-range rejection, unchanged cloud/manual strictness, and persisted recognition success with usable neighbours. A real native exit success alone is not proof that result normalization succeeded.
- No-history native arguments for GPU, CPU and fallback; ordinary successful-cache reuse versus explicit recognize-again, stale/active rejection, confirmed success replacement, cancellation/failure retention and no automatic translation. Preserve legitimate repeated speech rather than applying text deduplication as a hallucination workaround.
- Provider mapping and translation completeness, selected updates and stale revision protection.
- Manual add/edit/remove at timeline edges and in an empty job, chronological/overlapping cues, deletion of all cues, busy/stale/bounds/text rejection, removed emphasis references, unchanged unrelated translations and corrected exports without automatic ASR/translation.
- Style bounds, unavailable resources, escaping and special-character keyword matching.
- Persisted corrections flowing into all export formats, cancelled output atomicity and original-file preservation.
- Real Electron E2E through IPC with isolated data; explicitly identify mocked HTTP providers. Real hardware/provider checks are separate evidence.

## 7. Wrong vs Correct

Wrong: place AI-supplied strings directly in ASS override/filter commands and accept their replacement timestamps.

Correct: parse AI output against the shared schema, retain the existing segment IDs/timing, escape displayed text through the compiler and let program-owned render code construct commands using argument arrays.
