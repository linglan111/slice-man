# Streamed AI, chapter workflows and managed artifact downloads

## Scope / Trigger

Read before changing text providers, Job chapter scheduling, diagnostic persistence, chapter export or managed runtime/tool installation. The public source of truth is the Zod schemas in `chapter-contracts.ts`, `chapter-export-contracts.ts`, `provider-diagnostics-contracts.ts` and `artifact-cache-contracts.ts`.

## Signatures and IPC contracts

```ts
api.jobs.planChapters({jobId, revision, kind: 'normal' | 'custom', profileId?, criterionId?});
api.jobs.updateChapters({jobId, revision, planId, planRevision, chapters});
api.chapterCriteria.list();
api.chapterCriteria.save({id?, revision?, name, instructions});
api.chapterCriteria.copy({id, revision});
api.chapterCriteria.remove({id, revision});
api.chapterCriteria.select({id?});
api.chapterExports.export({jobId, revision, planId, planRevision, chapterIds, format, quality?, videoCodec?, resolution?, runId?});
api.chapterExports.list(jobId);
api.diagnostics.list({jobId?, before?, beforeId?, limit?}); // max 100
api.diagnostics.detail(id);
api.diagnostics.readAnswer(id); // {text, truncated}, max 20,000 chars
api.diagnostics.clear(ids?);
api.diagnostics.live({jobId?, requestId?}); // transient snapshots, never restored
api.runtime.clearDownloadCache();
api.download.clearDownloadCache();
```

All methods return validated `Result<T>` through the allowlisted main/preload API. Renderer supplies criterion identity, never a trusted instructions snapshot or export directory. A new export opens a native directory picker; compatible `runId` resumes its persisted directory without another picker. E2E-only `APP_E2E_EXPORT_DIRECTORIES` provides isolated folder choices. SQLite additive migrations preserve existing jobs and include diagnostic payloads and criterion/export state.

## Text generation and diagnostics

- All five text operations (translation, review, names, chapter planning, style) use `requestText`, with owned normalized-answer files and additive SQLite diagnostics. Speech transcription remains separate.
- Chat, Responses, Anthropic and Gemini streams have protocol-level completion checks. Reasoning is separate from the normalized answer: it may be displayed in transient session memory, but never persisted with answers, SQLite, logs, secrets or complete prompts. A same-response JSON fallback must not dispatch a second POST.
- Responses `output_index` addresses an output item, unlike Chat's alternative-choice index. A reasoning item at 0 followed by assistant text at 1 is valid. `content_part.added/done` belongs to reasoning items (`reasoning_text`) as well as messages (`output_text`); classify part kind before binding item identity. Only output text contributes to answer files. Validate bounded indexes, item IDs, canonical text-part order and per-index final content without assuming all parts are messages. Reference: [DeepSeek Responses](https://api-docs.deepseek.com/api/create-response/).
- Header and idle deadlines use profile `timeoutMs`; independent `textTimeoutMs` defaults to 30 minutes. Timeout/partial/network ambiguity must not replay a generation automatically. A partial file is diagnostic evidence, never valid application JSON.
- Store validation/publication state in the same SQLite transaction as the corresponding Job mutation. Keep completed transport records until the caller validates. Await cancelled Job and text-request finalizers before closing SQLite.
- Main owns diagnostic paths. Renderer receives IDs and bounded answer previews, never filesystem paths. Startup reconciles unfinished records and prunes only ended records (30 days / 1,000). Clearing logs must exclude active work.
- Pagination sorts by `(started_at DESC, id DESC)`; next pages send both `before` and `beforeId` so equal-millisecond rows cannot disappear. Legacy timestamp-only cursors remain supported.

## Chapter contracts and atomicity

- Normal plans partition the complete media range with no gaps/overlap; each chapter is at most 1,200,000 ms. Custom plans may select disjoint subsets. Validate trusted criteria snapshots and all boundaries locally.
- Chapter prompts represent anchors explicitly as `{index, timeMs}` with declared index limits. Generated `startAnchor`/`endAnchor` must reference `index`, never milliseconds. Main retains its numeric time lookup and rejects timestamp-shaped or unknown indices rather than guessing the intended boundary. A real provider can return structurally valid JSON with this semantic error; fixture JSON alone is insufficient verification.
- Chapter freshness includes source text, timing, source settings and media identity. Translation changes alone do not invalidate source-content plans. Source changes invalidate dependent plans/review runs; never silently resume an incompatible run.
- Default full translation uses content chapters and bounded dense work units. Short media (at most 20 minutes) requires no planning model call. Limit workers to 1–3 (default 2). Publish each completed full-translation chapter even if an earlier parallel chapter fails. Scoped translation, combined ASR/translation and a repair round retain all-target atomicity.
- Review chapter mode applies only when media duration is strictly greater than 1,800,000 ms. Shorter media retains one complete selected-set generation. Keep original global cue ordinals and canonical adjacent evidence across chapter boundaries. Each target is owned once.
- Retain validated completed review chapters on failure/cancel. Show assessed cue and chapter coverage separately from the report's stored-subset status. Resume original run targets only when plan, source, timeline, provider and rubric identities match. Names analysis always receives global chronological context.

## Chapter export

- Criteria are versioned SQLite records. CRUD/copy/select is explicit; deleting the selected item clears selection. An empty library remains empty after restart. A plan stores an immutable criterion snapshot.
- Export resolves a native folder in main, allocates safe title filenames without overwrite, clips/rebases all subtitle formats and preserves media A/V offsets. A range beyond an ended audio track legitimately produces video without audio.
- Hash the owned temporary output and checkpoint reserved destination/hash before no-clobber publication. Recheck cancellation and source identity immediately before publishing. On restart, recover already published matching files before encoding; retain completed clips and retry only missing compatible outputs.

## Managed tool/model cache

- All seven pinned artifacts share durable identity-keyed storage outside install staging. Never auto-download on opening or restart. Keep old active installations until probes and final activation succeed.
- Resume only after validating Range, Content-Range, encoding, total length and stored validators; a 200 response replaces old partial content. A 416 response requires complete-size/hash verification. Identity changes, malformed ranges or hash failure must never activate concatenated or corrupt bytes.
- Cancellation, network errors and process restart retain verified partial bytes. Explicit clear must touch only owned inactive cache entries. Budget cache plus staging disk space; online source-video downloads do not use this cache contract.
- A tool install returns the final cache-enriched snapshot after its cleanup/checkpoint, not a pre-finally success object. Otherwise the stale IPC result can overwrite the newer cache event in renderer state.

## Verification

Use actual SSE fixtures, SQLite migrations/restarts, forced isolated process interruption, transferred Range bytes and hashes. Use bundled FFmpeg to verify A/V offsets, silent tails and subtitle boundaries. Native Electron tests must cover three window sizes, partial cancellation, long-review resume, criteria selection, safe duplicate titles and diagnostic persistence. Do not use installed user data or paid providers for these checks.

## Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Invalid strict IPC payload / unknown renderer snapshot | Reject before model or filesystem side effects |
| Header / idle / total text deadline | Distinct `PROVIDER_HEADER_TIMEOUT` / `PROVIDER_IDLE_TIMEOUT` / `PROVIDER_OVERALL_TIMEOUT`; retain received answer; no automatic replay |
| Invalid protocol / incomplete terminal / invalid full JSON | Do not apply the response; persist failure phase and partial answer |
| Diagnostic file or SQL write failure | `DIAGNOSTIC_STORAGE`; do not claim the result was saved/applied |
| Normal chapter gap, overlap, beyond media or over 20 minutes | `CHAPTER_INVALID`; retain prior plan |
| Job/plan/source identity stale during export | Reject before final publication; remove owned temporary output, retain completed clips |
| Existing title path | Allocate another safe name; never overwrite |
| Resume range inconsistent or checksum mismatch | Do not activate corrupt bytes; preserve old installation |
| Active job / cache in use / active request clear | Reject conflicting mutation; never remove active files |

## Good / Base / Bad Cases

- Good: a 62-minute video has content chapters, second review chapter fails, first assessments remain current and continuing targets only remaining chapters.
- Base: a 4-minute video translates as one deterministic coverage chapter and reviews its complete selection once; explicitly planning chapters still invokes AI.
- Bad: treating a partial JSON prefix as a report, republishing an exported file on restart, or discarding a fast completed chapter when a slower parallel chapter fails.

## Tests Required (assertion points)

- `provider-streaming`, `stream-protocol`, `provider-diagnostics`: split UTF-8/events, semantic terminal, partial retention, no reasoning/secrets, silence checkpoint, storage failure and restart reconciliation.
- Responses fixtures must include reasoning item0 with its own `content_part` added/done lifecycle before message1 text, including final reasoning/message items and multiple text parts. A Responses JSON fallback or Chat SSE fixture is not coverage of this case. Native tests must actually stream Responses through renderer/preload/main and verify published SQLite state, answer files and restart; live tests must forward raw SSE and Content-Type, not buffer/convert it to JSON.
- Live verification uses explicit authorization, synthetic subtitles, session-only credentials, no trace/video/failure screenshots, a durable pre-dispatch call reservation and exclusive ledger ownership outside disposable test output. Stop after the first failed operation; never spend the rest of a bounded allowance on the same failure. Keep failed real attempts visible in reports rather than replacing them with a local mock success.
- `chapter-workflows`, `chapter-diagnostics`, `chapters`: exact 20/30 minute thresholds, provider/source invalidation, whole-global names, original-only behavior, parallel completed retention, atomic scoped failures and review coverage/resume.
- `chapter-export`: actual SQLite and FFmpeg offsets/boundaries/silent audio tails; hash checkpoint before publish; recover matching published clip on restart, safe duplicate names and criterion empty-library persistence.
- `resumable-artifacts`, `resumable-space`: all seven IDs, actual forced child interruption and next-process Range bytes, 200/206/416 and validator mismatch, staging disk budget and old-install retention.
- `chapters-streaming.spec.ts` and operation/native regression: visible controls at 1050×700, 1440×960, 1920×1080; explicit criteria selection, cancellation, persisted normalized answers and no request replay.

## Wrong vs Correct

Wrong: wait for ordered chapter 1 before committing already validated chapter 2, then discard chapter 2 when chapter 1 fails. Correct: full-translation coordinator commits each validated chapter immediately; keep ordered/all-target publication only for operations requiring atomic replacement.

Wrong: throttle SQLite checkpoint only from incoming chunks, leaving a lone delta invisible until timeout. Correct: pace active request checkpoints independently of later network traffic and await the sink before terminal close.

Wrong: reuse Chat `index === 0` validation for Responses or bind every `content_part` to a message. Correct: follow the declared output-item/content-part kinds and indexes, ignore reasoning for persistence, and compare completed message text against the exact streamed text parts.

## Live stream visibility and scoped review

### 1. Scope / Trigger
Applies to live external-provider thinking/answer display and time-scoped subtitle review. Keep ephemeral content separate from durable diagnostic metadata and normalized answer files.

### 2. Signatures
`diagnostics.live({jobId?: string, requestId?: UUID})` returns validated `ProviderLiveSnapshot[]`: request/job identity, operation/model, diagnostic state, phase, start/update/elapsed times, wire/answer bytes, separate thinking/answer text and truncation flags. `jobs.reviewSubtitles({jobId, revision, range?: {startMs, endMs}, segmentIds?})` accepts exactly one optional scope.

### 3. Contracts
- Main owns an eight-request in-memory cache, capped at 32,000 UTF-16 units per thinking/answer field without splitting surrogate pairs. Ended entries expire after ten minutes on access; restart restores none. Clearing diagnostic records clears their live entries. No reasoning is written to SQL, files or history.
- Phases are waiting/thinking/answer/complete/failed/cancelled. Only actual reasoning deltas set thinking; heartbeat comments and signatures do not. Responses reasoning text/summary deltas, Chat reasoning_content, Anthropic thinking and Gemini thought text are viewable; redacted/signature data is not.
- Renderer polls current-job snapshots every 750ms only while processing or viewing the modal, cancels stale polls on job/unmount, and renders plain text. Closing the modal does not cancel work. Multiple requests remain independently selectable. Display received wire bytes while waiting/thinking rather than a misleading zero answer-byte counter.
- Main recomputes review range membership with half-open overlap (`cue.start < end && cue.end > start`) against the current revision before chapter planning/provider work. Targets are complete intersecting cues; outside cues may remain evidence. Existing all/selected quick actions and chapter-resume identities remain intact.

### 4. Validation & Error Matrix
| Condition | Result |
| --- | --- |
| Unknown or expired live request | Empty snapshot list, no historical thinking fallback |
| Invalid strict live filter or response | IPC validation failure |
| Both range and selected IDs | Reject ambiguous scope before provider work |
| Reversed, zero-length or beyond-media range | `TIMING_INVALID` |
| Valid range intersecting no cues | `NO_SEGMENTS`, never fall back to full review |
| Stale revision | `STALE_REVISION`, no request |

### 5. Good/Base/Bad Cases
Good: thinking appears before the first answer, opening and closing the popup preserves the one active request. Base: a non-thinking provider shows waiting then answer. Bad: call every heartbeat thinking, append reasoning into application JSON, or silently check all subtitles for an empty time range.

### 6. Tests Required
Parser tests cover all four protocol reasoning channels and exclude signatures; memory tests cover bounds, expiry, filtering and terminal states. Native Electron verifies a paused reasoning-first stream with zero answer bytes, popup close/reopen and three window sizes, no reasoning in database/answer files and empty cache after restart. Range tests verify boundary/gap/invalid scopes, only intersecting assessment targets and retained outside evidence. Authorized live tests forward unchanged SSE, use isolated session credentials and keep only sanitized outcome metadata.

### 7. Wrong vs Correct
Wrong: persist raw SSE to make a live popup readable after restart. Correct: retain bounded parsed text in session memory, persist only diagnostic counters and normalized answers. Wrong: renderer sends an empty ID array after a range has no cues and main interprets it as all. Correct: validate scope and return `NO_SEGMENTS` before any model request.
