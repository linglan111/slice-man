# Research: AI latency and chapter translation

- Query: Why do subtitle review and recurring-name analysis share PROVIDER_TIMEOUT, and how can content chapters below 20 minutes improve translation without weakening integrity?
- Scope: mixed (repository implementation and standard fetch documentation)
- Date: 2026-10-13
- Status: planning only; no production credentials, provider requests, paid tests or production database access performed.

## Findings

### Files found

| File | Responsibility |
| --- | --- |
| `src/main/services/providers/lib/text-provider.ts` | Shared native fetch, retries, protocol adaptation, JSON parsing and translation validation. |
| `src/main/services/jobs/lib/job-service.ts` | Operation lease, review/name publication, incremental full translation and atomic scoped translation. |
| `src/main/services/jobs/lib/review-request.ts` | Complete-selection compact request, strict local-evidence validation, one bounded correction. |
| `src/main/services/jobs/lib/person-name-request.ts` | Complete chronological global-name input and same-person alias grouping instructions. |
| `src/main/services/jobs/lib/person-names.ts` | Literal occurrence grounding, bounded apply and compare-and-swap undo. |
| `src/main/services/jobs/lib/reprocessing.ts` | Canonical review windows, current 30-cue/24k-character batches and neighbouring context. |
| `src/shared/contracts.ts` | Profile timeout, Job options, progress and API contracts. |
| `src/shared/person-name-contracts.ts` | Name candidate/alias/report/undo bounds. |
| `src/renderer/src/components/ProfileEditor.tsx` | Visible timeout control, currently 1–300 seconds. |
| `src/main/db/store.ts`, `src/main/db/schema.ts` | SQLite persisted jobs/profiles, separate encrypted credentials, material-profile invalidation. |
| `src/main/ipc/index.ts`, `src/main/lib/errors.ts` | Sanitized public errors; currently no request diagnostic logging. |
| `tests/unit/backend/providers.test.ts`, `review-request.test.ts` | Protocol/retry/strict-output/correction tests. |
| `tests/integration/backend/pipeline.test.ts`, `reprocessing.test.ts`, `person-names.test.ts` | Native HTTP/SQLite publication, cancellation and freshness tests. |
| `tests/e2e/person-names.spec.ts` | Native global-name, cancellation, apply/export/undo UX coverage. |

### 1. Proven common timeout path

- Review (`job-service.ts:1104–1120`) and names (`job-service.ts:342–353`) both resolve **the project's `reviewProfileId`**, then call `generateText`. Translation uses a different `translationProfileId`; a successful translation request does not establish that the configured review endpoint/model can finish the larger review/name request.
- `profileInputSchema` (`contracts.ts:68–79`) defaults `timeoutMs=120000` and permits 1000–300000. The renderer mirrors 120 seconds, min1/max300, in `ProfileEditor.tsx:17,24,41`. The screenshot does not identify the actual saved timeout, endpoint or model.
- `requestJson` (`text-provider.ts:21–66`) makes at most **three attempts**, with a **fresh full timeout per attempt**. Backoffs are 250/500ms. The default all-timeout failure can therefore take approximately **360.75 seconds**, plus scheduling overhead. Max configured failure can approach **900.75 seconds**. This is per logical generation, not a total operation budget.
- The signal covers `fetch` and **complete `response.text()`** (`text-provider.ts:31,47`). No `stream:true`, stream/SSE parser, first-token progress or separate idle timeout exists. A slow full JSON generation can exceed the deadline after headers or while receiving the body, not merely when connecting.
- Retry triggers include HTTP408/429/500/502/503/504 and *all non-AppError fetch/body failures*, including local timeouts (`text-provider.ts:33–40,52–63`). Timed-out full requests may be repeated while the remote service still computes the first one. No idempotency key or provider cancellation guarantee exists; retries may repeat input/output cost.
- Final `PROVIDER_TIMEOUT` specifically means **the final attempt's local timeout signal was aborted**, when the user signal was not aborted. It is not proof of bad network, wrong URL, model overload or provider quota. Earlier attempts may have failed differently. HTTP504 itself ends as `PROVIDER_HTTP` after retries, rather than this code.
- Current error text incorrectly groups connection failure and timeout into one generic remedy (`text-provider.ts:56–60`). JSON invalidity/truncation/evidence failures have other explicit codes and are not this timeout.

### 2. Input size increases latency risk, but no user-specific diagnosis yet

- Review is intentionally one complete-selection generation: up to2000 targets, complete UTF-8 prompt <=512KiB including8KiB correction reserve (`review-request.ts:15–17,43–66`). One deduplicated cue table contains source/active translation/times and canonical group references/rubric (`review-request.ts:72–129`). Canonical groups remain separate evidence scopes; grouping is **not transport batching**.
- Existing canonical windows are30 cues/24k serialized characters plus at most two neighbouring cues each side under8k characters (`reprocessing.ts:190–252,386–425`). One aggregate request may still include the whole hour of dialogue. These byte/cue guards are application resource limits, **not token estimates or guaranteed provider capacity**.
- Names sends entire chronological timeline including original UUID IDs, ordinals, timing, source and active translation (`person-name-request.ts:4–27`), up to2000cues and512KiB (`job-service.ts:341,347`). It explicitly groups distant once-only spelling variants into recurring identities. Do not silently narrow it to neighbouring windows or selected subtitles: that would regress the last approved feature.
- Review emits explicit none judgments for every inspected cue; up to3issues each with500-character reasons (`review-request.ts:20–40`). Output generation can be considerable. Names permits200candidates/16aliases per field/500-character reasons (`person-name-contracts.ts:3–12`). Anthropic's shared adapter hardcodes `max_tokens:8192` (`text-provider.ts:98–99`), which can cause separate `TRUNCATED`; OpenAI branches currently set no output token cap. A truncation is not fixed by a longer timeout.
- Review's optional one complete corrective generation handles only JSON/shape/ID/coverage/evidence problems (`review-request.ts:253–289`, `job-service.ts:1127–1138`). Timeout/network/auth/truncation **must not trigger content correction**; tested `review-request.test.ts:154–172`, `reprocessing.test.ts:1562`. Names has no content correction loop.

### 3. Evidence available safely, and evidence missing

- Production boot locates `app.db` under `app.getPath('userData')` (`src/main/index.ts:55,69`); development uses separate `-dev` data (`env-setup.ts:11–12`). No user data was opened for this research.
- Public profile metadata is stored separately from `profiles.encrypted_key` (`db/schema.ts:15–20`, `db/store.ts:214–237`). A narrowly scoped **read-only** query/UI inspection can establish selected review/translation profile, protocol/mode/model and timeout; aggregate Job cue count and source/active-translation UTF-8 bytes can quantify load. Never dump profile rows or whole job payloads; URLs may contain query secrets and subtitles are private data. Do not instantiate production `Store` merely to inspect: its constructor marks running states interrupted and clears preview (`db/store.ts:44–80`).
- There is no provider/request elapsed-time/status/phase/attempt trace in current main source; `ipc/index.ts:83–90` merely sanitizes errors through `publicError`, and review/name terminal events preserve the old report. These terminal errors cannot reconstruct response headers/first-byte timing or identify earlier failures. Local packaged/test logs are deterministic fixture evidence, not the user's actual remote timeout.
- Actual diagnosis requires safe metadata plus future sanitized request telemetry (operation+run/attempt, counts/bytes, configured timeout, elapsed-to-headers/complete-body, HTTP status, phase and stable error code; optional sanitized error class). Exclude headers/keys/raw URLs/raw errors/provider payloads/subtitle text. Surface last-attempt phase and actionable timeout hint, not the claim "network failed".

### 4. Smallest robust timeout remediation

1. Preserve one complete logical request for initial selected review and globally grounded names. Keep strict all-target/alias/evidence validation and the continuous cancellable lease. Retain valid old reports on failure.
2. Separate deadline-expiry errors from connection failures and retryable HTTP responses. At minimum **do not automatically retry a local long-generation deadline**; make retry explicit. Keep bounded transientHTTP retry, cancellation-aware backoff, and sanitized attempt diagnostics. A general policy change affects ASR/translation/style too: introduce operation-aware policy/options rather than an unreviewed blanket removal of all retry.
3. Add a bounded **analysis timeout** suitable for large text generation, exposed clearly to users, or expand the generic profile range with compatibility defaults. Exact timeout defaults/caps are a planning decision; longer wait alone cannot guarantee completion. Show elapsed waiting + cancel + retry count/phase, without invented per-cue progress.
4. If provider streaming is adopted, it must handle OpenAI chat/Responses, Anthropic and Gemini protocol differences, refusal/truncation/events, bounded bytes, total deadline/idle deadline and abort. Accumulate/validate complete JSON before report publication; streaming improves liveness diagnostics, not model speed. This is a larger independently testable increment, not a prerequisite for the minimal diagnostic/retry fix. Do not assume compatible custom endpoints support streaming or reasoning fields.
5. Optionally compact global-name wire identifiers to numeric aliases (global chronology/timings/source/active translation remain available), omitting redundant selected/context duplication where semantics permit. The existing review compact tuple wire is already efficient. Byte savings are measurable; model accuracy/time gains need provider experiments, not promises.

### 5. Current translation batching and integrity

- Full translation (`job-service.ts:697–772`) is serial batches of **30 selected cues**. Each request sends selected IDs/source plus neighbouring context; the full path's context includes the targets themselves (`731–739`), so target text is repeated. Partial's `neighboringContext` deliberately excludes targets (`reprocessing.ts:421–425`). Removing full-path duplication is a small deterministic input saving.
- Full batches currently have no complete prompt byte budget or size-aware fallback: only count30. Partial/combined-ASR/repair calls `draftTranslations` (`job-service.ts:786–821`) using30/24k serialized-character batches. The size estimation spreads the Segment and empty translation; it is not complete prompt bytes or output capacity. A20-minute chapter can have hundreds of dense cues and exceed safe output/input even though duration is valid.
- `validateTranslations` (`text-provider.ts:210–237`) requires every selected ID exactly once with nonempty <=20000 text, rejects unknown/duplicate/missing IDs. `translateBatch` has one format/coverage corrective generation (`251–289`), plus shared transport retry. Source/timing/IDs remain unchanged.
- Full translate validates and saves **each complete batch**, increments revision, invalidates derived outputs, then proceeds (`job-service.ts:745–768`). Failure/cancel retains earlier complete batches; next run naturally skips fresh translated cues. Explicit regression: `pipeline.test.ts:657–683` (31 cues, first30 preserved, retry only remaining1). Do not silently switch this to all-or-nothing.
- Scoped translation drafts every batch and publishes once (`job-service.ts:823–862`), preserving original target on any failure/cancel; combined-ASR and repair rounds reuse draft logic. Existing tests: `reprocessing.test.ts:422,435,458,960,1033`. Do not expose chapter progress as partially committed scoped content.
- One `JobService.active` lease/AbortController governs all these operations (`job-service.ts:331–335,435–485`); public options/CRUD disallow mutation while busy. Full translation checks revision each save, and material provider edits mark translations stale/revise jobs (`db/store.ts:248–300`); names/review additionally compare profile fingerprint **and key** immediately before publishing (`job-service.ts:358,1188–1200`). Any new parallel chapter path should capture and revalidate complete provider/key/language/mode/source identity instead of relying only on revision.

### 6. Recommended chapter translation architecture

**Reuse the same persisted content-chapter plan used by chapter export**, rather than running a separate paid chapter analysis per translation. No chapter contracts currently exist in `src/shared`. Chapter plan should bind to source-text/timing/media/language fingerprint; translated text, presentation-only styling and changing a review profile must not unnecessarily force new source-topic analysis. If the chapter analyzer used active translation, capture that dependency explicitly. User-edited title/summary/range needs distinct metadata; chapter range validity is always main-owned.

- Topic-based chapters must be chronological/in-media and below20minutes, with deterministic subdivision of an AI-proposed long chapter. A hard duration cap and **input/output-cap budget** are independent. Use ms and original cue ordinal references, not model-supplied arbitrary ID/timestamp changes. Explicitly handle silent spans, unsorted/overlapping cues, edge-crossing cues and impossible single-cue spans. Reject invalid plans; never silently truncate subtitle text.
- Ordinary translation operates on **coverage chapters**, not selected highlights: excluding non-highlight dialogue would falsely mark whole-video translation complete. Highlight rules/export are separate views over the complete source plan.
- Start with one translation request per chapter only when its validated complete prompt/output budget fits; **split dense/large chapters into bounded translation work units inside that chapter**. Expose this honestly as a chapter plus pieces, not a hidden review/name serial fallback. Strict selected-ID coverage remains mandatory.
- Bigger selected blocks can reduce instruction/identifier overhead and contextual duplication, while supporting longer topic context. Deduplicate request cue tables/targets. Pass chapter title/summary + approved current name glossary, nearby outside boundary cues under a budget, and necessary within-chapter source. Never prepend the entire chapter to every sub-batch by default: that can increase tokens dramatically.
- Use a bounded worker pool (e.g. configurable1–3, conservative2 proposed) for **independent chapter translation**; queue chapters under the same lease. Retry429 with bounded handling, do not let parallelism multiply retry storms. Concurrency reduces wall-clock only when provider accepts it; token cost generally is unaffected by concurrency.
- Each worker returns a validated draft for exact trusted target IDs; one coordinator alone saves content in deterministic chronology. Full translate can atomically commit a completed chapter/work unit with revision/provider/key/source checks, retaining earlier completions on later failure and retrying only stale/missing translations. Do not let concurrent workers reuse mutable `snapshot.revision` and race saves. Scoped translation/combined-ASR/repair collect all required drafts and publish only once, preserving their atomic contract.
- Abort stops queue scheduling and all in-flight requests; await settlement before releasing lease; no late publication. Persist completed full translation without saving incomplete JSON or resurrecting old cue IDs. Startup must never auto-run paid AI; interrupted work is manually resumable through persisted fresh/stale flags.
- Progress reports real chapter/work-unit completions and waiting counts; no invented token-saving percentages. Measure total HTTP requests, complete promptUTF-8 bytes, optional actual provider `usage` (currently discarded), elapsed time, retry count and retained-output counts with deterministic fixtures. Approximate input savings are not guaranteed billable-token/accuracy improvements, especially if chapter planning adds an initial call or a model internally reasons more.

### 7. Affected contracts and validation gates

Main changes touch provider adapter/policy, `JobService.translate`/`draftTranslations`/review+names generation and dedicated chapter planner; shared changes need strict chapter plan/settings/progress schemas, optional backward-compatibleJob metadata and IPC allowlist/preload output validation; renderer adds chapter translation strategy/control, trustworthy progress/timeout diagnosis, chapter plan preview and existing chapter export UI integration. Keep provider secrets in main.

Required fixture tests: header/body stall and timeout after headers; precise attempt count/no automatic timeout-replay; transient429/503 retry; cancel during waiting/backoff; no rawprovider/URL/key disclosure; all3protocol adapters; analysis source-only payload and complete selection/global-name preservation; prior report after timeout; cancelled/stale latecomplete response. Chapter tests:20min boundary, long-topic subdivision, dense chapter budget, no cue omissions/duplicates, sparse selections/gaps/cross-boundary cues, original-only zero calls, glossarycontext, worker concurrency bound,429/backpressure, deterministic publication, unfinished-only restart retry, no latepublication aftercancel, provider/key/language/mode conflicts, atomic scoped failure and repaired round retention. Native mockHTTP/SQLite/Electron tests establish plumbing/integrity; linguistic accuracy and real provider latency require separately authorized live testing.

## Related specs

- `.trellis/workflow.md`: planning artifact review before implementation; role-specific research persistence.
- `.trellis/spec/shared/subtitle-review-reprocessing.md`: strict one-selection review, no hidden batching, canonical evidence windows, continuous cancellation, incremental full versus atomic scoped/repair publication.
- `.trellis/spec/shared/person-name-review.md`: global timeline name analysis, exact locally grounded aliases, prior report retention, bounded conflict-preserving undo.
- `.trellis/spec/shared/subtitle-contracts.md`: strict main/preload/renderer contracts and existing per-stage workflow; read during implementation design.
- `.trellis/spec/backend/logging.md`: structured scoped logging guideline. Actual repository currently has no electron-log dependency; use an explicit small safe diagnostic owner/persistence decision, not a nonexistent logger import.
- `.trellis/spec/backend/database.md`, `error-handling.md`, `type-safety.md`: validate before atomic save, sanitized public errors, Zod-first inputs/outputs.

## External references and versions

- [MDN AbortSignal.timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static), accessed2026-10-13: local deadline abort and combining user cancellation with timeout signals. Browser active-time nuance should not be used to assert nativeNode time semantics.
- [MDN Response.text](https://developer.mozilla.org/en-US/docs/Web/API/Response/text), accessed2026-10-13: text consumes the whole response body; supports distinction between connecting and waiting forcompleteJSON.
- [Node global fetch](https://nodejs.org/api/globals.html#fetch), accessed2026-10-13: built-in fetch is browser-compatible and Undici-based. Latest site defaults to26; repo engines requireNode24.17.x, and Electron42.11.11 owns packaged runtime. Pin tests to actual application runtime; do not assume latestNode26defaults.
- Local pinned versions from `package.json`: Electron42.11.11, TypeScript5.9.3, Zod4.6.5, better-sqlite3 12.11.1, Vitest5.0.3, Playwright1.63.0. No provider-specific current model limits or paid pricing assertions are made.

## Caveats / Not Found

- The exact user failure's saved profile, count/prompt bytes, duration, HTTPphase and provider outcome remain **unknown**. Screenshot alone cannot prove root network/model cause; no historicalrequest traces were found in implementation. Do not call live services or read/decrypt credentials to "verify" without explicit scope.
- No production files edited or tests executed for this planning-only research. Tests listed are source evidence, not newly passing runs.
- Product decisions still needed: analysis timeout default/cap and per-operation versus sharedprofile semantics; whether streaming isfirstscope; chapter translation opt-in versus default; concurrency exposed versus managed; visible20mincap interpretedstrict<20 or<=20; whether chapter plans can be manually edited/reused automatically; publication unit forfull chaptertranslation; sourceplan fingerprint dependencies; model/profile forchapter analysis. Recommend source-based reusableplan +explicitstrategy, conservativeboundedparallelism, preserving current incremental-full/atomic-scoped behavior.
