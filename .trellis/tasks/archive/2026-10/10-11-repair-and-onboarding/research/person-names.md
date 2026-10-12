# Research: Recurring person names and reversible batch correction

- Query: Analyze recurring person names in existing subtitles, default editable values to AI recommendations, atomically replace source/active translated names, and undo only the last batch while preserving subsequent edits.
- Scope: internal
- Date: 2026-10-11
- Planning only: product implementation is not authorized for this added child yet. Ownership is this research file only; original loop/onboarding workers may change cited files concurrently.

## Findings

### Relevant files and existing contracts

- `src/shared/contracts.ts:36`: IDs and strict segment schema; source and translated fields each accept at most 20,000 UTF-16 code units, stable IDs and millisecond bounds. Optional Job additions must be added both to the Job type (`:205`) and strict job schema (`:249`).
- `src/shared/contracts.ts:92`: strict style schema, with at most 20 literal emphasis keywords per cue. `:312` owns the typed AppApi.
- `src/shared/channels.ts:1`: explicit IPC channel allowlist; new methods must be registered here.
- `src/shared/ipc-validation.ts:32`: strict progress schema; `:78` onward registers every job result schema. New channels without output validation fail preload calls.
- `src/preload/index.ts:18`: typed invoke-only bridge; new job methods follow `:61` and `:68` patterns.
- `src/main/ipc/index.ts:260`: thin schema-validated review wrapper; `:280` wraps ordinary manual edit. No provider secrets in renderer.
- `src/main/services/jobs/lib/job-service.ts:148`: update refreshes review applicability, persists, and emits refreshed Job. `:160` invalidates preview/export but retains historical output paths.
- `src/main/services/jobs/lib/job-service.ts:223`: editSegment checks revision/busy state, validates a complete resulting timeline, and applies source/translation staleness. Repeated calls are unsuitable for atomic batch application: each call commits and increments revision separately.
- `src/main/services/jobs/lib/job-service.ts:240`: editableTimeline rejects any active main operation and stale revision. `:329` cancels the active controller; `:335` protects referenced provider profiles while work runs.
- `src/main/services/jobs/lib/job-service.ts:310`: style references must refer to actual primary subtitle text. Batch replacement must address disappearing keyword references.
- `src/main/services/jobs/lib/job-service.ts:994`: review owns one main controller for its entire request, retains the prior report on error/cancel, and checks timeline revision, translation mode, profile ID and provider fingerprint before final publication (`:1129`). This is the model for names analysis.
- `src/main/services/jobs/lib/reprocessing.ts:91`: cue fingerprint includes time/source and active translation. `:102` fingerprints provider protocol/mode/baseUrl/model; `:105` refreshes changed target and neighboring-context grades, including previously clear assessments.
- `src/main/services/providers/lib/text-provider.ts:5`: parseJson handles surrounding JSON fences. `:20` has bounded HTTP responses, retry/backoff and AbortSignal propagation; `:80` generates text through the existing OpenAI/chat/responses, Anthropic and Gemini adapters. No new provider adapter or dependency is needed.
- `src/main/db/store.ts:103`: saveJob validates strict Job and transactionally saves job payload, all segments and stages. Optional JSON metadata needs no relational migration. `:243` invalidates material provider dependencies; names report needs a corresponding applicability check.
- `src/main/services/subtitles/lib/timeline.ts:4`: validateTimeline validates IDs, segment shape/media limits and chronological ordering.
- `tests/integration/backend/manual-timeline.test.ts:33`: isolated Store/JobService fixture and provider-free manual edit invariants; suitable starting point for apply/undo integration coverage.
- `tests/integration/backend/reprocessing.test.ts`: delayed/cancelled provider work, revision and report applicability tests; suitable starting point for analysis coverage.
- `tests/unit/backend/store.test.ts`: restart/legacy payload compatibility and material provider changes.
- `tests/e2e/helpers.ts:44`: real HTTP fixture server; `:312` launches actual isolated Electron; `:385` imports and `:401` configures cloud providers. Extend test fixture protocol to names analysis without changing production provider APIs.

### Recommended API and report shape

Add strict shared `person-name-contracts.ts`, re-exported by contracts, with three narrow APIs:

1. `jobs.analyzeNames({jobId, revision}) -> Result<Job>`: inspect all existing source and active translated text, hold the main active owner, reuse configured `reviewProfileId`, issue a bounded structured JSON request and persist an optional names report only after cancellation/revision/profile/mode checks. Existing subtitle text is data, never instructions. This is text-consistency analysis, not speaker identification or acoustic evidence.
2. `jobs.applyNames({jobId, revision, reportId, mappings:[{candidateId, sourceName, translatedName, enabled}]}) -> Result<Job>`: renderer sends editable replacement names and candidate IDs, not trusted occurrences/counts/aliases. Main resolves validated aliases and occurrences from its stored report and current snapshot. One all-or-nothing synchronous content transaction; no ASR/translation provider calls.
3. `jobs.undoNames({jobId, revision, batchId}) -> Result<Job>`: one revision-checked operation computes all safe inversions and field conflicts, validates once and persists once. Result Job contains bounded batch summary/conflicts. No whole-job restoration.

Persist optional `Job.nameReport` and `Job.nameBatch`. Legacy jobs omit both. A names report stores an application schema version, report ID, profile ID/fingerprint, analyzed revision, translation mode, timeline fingerprint, candidates and locally derived occurrences. Candidate aliases are field-specific; AI proposals include canonical original/translated names and brief grounded rationale. Main generates stable candidate IDs and actual occurrence IDs/positions, and rejects unknown keys, invalid IDs, duplicate aliases assigned to incompatible people and hallucinated aliases. Prefer rejecting an invalid response as a whole over silently presenting a partially validated report as complete.

Use the current review text profile, not translation/style profile fallback. Its key remains main-only. Missing profile/key/text budget errors must appear before any persisted replacement. Use the new reviewed one-shot request budget helper once that child has settled; no silent request splitting or provider-dependent context guessing. Names extraction emits bounded progress under a validated `names` progress stage; do not add names to the fixed content pipeline stage object merely for UI status. Extend `ProgressEvent`, IPC progress validation and renderer status handling together.

Report applicability must be computed in main and shown in renderer: any analyzed text, cue identity/timing, active translation mode, configured review profile or material provider change invalidates it. A successful apply invalidates its old report; rescan before another batch. Credential-only changes need not invalidate text conclusions. Undo remains usable even when the old analysis report is stale because it checks its own batch ID and current field values; it does not rely on stale AI conclusions.

### Occurrence grounding and safe matching

- The model proposes people and explicit source/translated aliases, not authoritative counts. Main enumerates actual literal occurrences in source and, only when enabled, translated fields. Retain recurring candidates with matches in at least two distinct cues; displayed total and per-field counts come from this enumeration. Explain this recurrence threshold in UI. Mention-only-once names are outside the default recurring list, not proof of absence from the video.
- No regex construction from aliases. Exact, case-sensitive, code-point-aware literal matching preserves existing text and positions; do not silently normalize case, whitespace or Unicode composition. Distinct normalized-looking spellings need explicit aliases grounded in the transcript. Surrogate pairs and combining marks must not be split.
- For aliases with Latin/Greek/Cyrillic/alphanumeric edges, enforce neighboring word boundaries using Unicode character properties, including combining marks/underscore/digits as continuations. Example: `Ann` must not replace `Anna`, and `John` must not replace `Johnston`; punctuation-separated `Ann,` may match. Document the precise matcher rule and test it rather than using ASCII `\b` as universal Unicode segmentation.
- CJK script does not offer trustworthy programmatic word boundaries for concatenated sentences. Exact CJK aliases may occur inside larger phrases, including false person-name hypotheses. Show cue context and permit deselecting each candidate before apply. Single-character aliases should be clearly warned or excluded from initial AI recommendations; do not claim the matcher proves that every CJK hit is a person. This limitation is repository-independent product truth, not a missing implementation dependency.
- Resolve all replacements against the original field text before writing anything; apply spans in one pass so `A -> B` and `B -> C` cannot cascade. Source and translated namespaces are separate.
- Multiple aliases for the same candidate that nest at one location use the longest literal span. Overlapping spans attributed to different selected candidates, or the same alias assigned incompatible target values, reject the entire selected batch with an actionable conflict. Adjacent disjoint spans are allowed. User can deselect/edit mappings and retry.
- Exclude disabled and unchanged mappings from actual mutation counts. Prevent empty/whitespace-only targets, excessive aliases/names and resulting fields above 20,000 units before publication. No-op apply should not create/replace an undo batch or increment revision.
- Do not link source and translation occurrences by identical character offset. Pairing comes from a candidate with separately grounded field aliases; source and translated text lengths differ.

### Atomic application and derived state

Draft the whole resulting timeline, bounded undo metadata and minimal style-reference updates from one current Job; check all inputs and conflicts, call validateTimeline, then increment revision once, invalidate derived preview/export and publish through Store.saveJob. Do not loop over editSegment. Preserve IDs, timing, all unrelated text, global style and historical exports. A validation failure keeps content and previous batch metadata unchanged.

Translation semantics should mirror a conservative manual edit: a changed source marks that cue's translation stale, even if the same name batch also changed translated naming, because the operation does not validate the rest of the translation. A translated-only correction preserves an already-stale flag; it must not falsely clear stale translation caused by earlier source/provider changes. This is intentionally stricter than the current editSegment translated-field branch and should be stated in design. Original-only analysis ignores stored translations and apply does not mutate them or call translation.

Refresh review/context applicability using the existing fingerprint machinery on save; changed neighbors must not remain current clear grades. Name report becomes stale after content application. Existing repairRun metadata is historical, not an instruction to resume or an assertion that modified content remains checked.

After names replacement, retain valid emphasis keywords and remove only now-invalid keywords for changed primary text, preserving every unrelated cue/style field. Record a bounded optional before/after emphasis-entry patch so undo can restore removed references only when the current entry still equals the batch's after entry and the restored keyword exists in current primary text. If the user subsequently edited the emphasis entry, preserve it and report the style conflict. Never restore an entire old style object over later font/template/layout changes.

### Practical last-batch undo

Use per-field compare-and-swap patches, not a diff library or timeline snapshot. Each changed `(segmentId, sourceText | translatedText)` stores exact `before` and `after` values. At undo, match by cue ID; if the current field equals `after`, replace with `before`; if it differs or the cue was deleted/re-recognized, preserve it and report a field conflict. Other fields, times, unrelated cues and global style remain untouched.

This preserves later edits in other cues/fields and all later same-field edits, but deliberately does not surgically reverse a name occurrence inside a field that was manually edited afterward. Such a field is skipped even if its name-looking substring remains. Explain this concrete limitation; it directly implements the user's confirmed conflict-report policy without risking speculative diff reversal. Exact-value ABA (a field later manually returned to the same after text) is indistinguishable from untouched state without a new per-field edit ledger; final design should acknowledge this bounded limitation instead of claiming historical provenance.

Keep only the latest successful names batch per Job, with schema version, batch ID, applied time/revision, changed-field patches, optional minimal emphasis patches and a summary. A newer successful batch replaces the older undo record; cancellation/no-op/failure does not. Metadata persists in the Job JSON and contains no provider key. Proposed bound: at most 20,000 field patches and a cumulative 2,000,000 UTF-16 units across before/after strings, plus bounded conflicts/style metadata; validate the cumulative budget before apply so a batch never succeeds without its promised undo. Field length and candidate/alias limits also apply. This is a design recommendation requiring explicit final contract constants, not an existing schema guarantee.

Undo uses the current revision supplied by UI, not the apply revision: rejecting every later revision would prevent the very edits the user wants preserved. After computing inversions, use one content revision increment only if some text/style changed. Conservatively mark translated text stale whenever source undo occurs; retain preexisting or later staleness rather than claiming old translations are current. For translated-only inversions preserve current staleness. Do not restore old recognize/translate stage snapshots, reports, preview URLs, output lists or repair metadata.

Persist terminal undo counts and conflicts and consume the undo batch after the attempt; no redo/history is offered. A conflict-only attempt can update result metadata without a content revision increment. UI offers cancel before apply with zero content changes, apply only after explicit selection/review, and undo with a concise conflict summary. Restart does not automatically analyze/apply/undo anything, and no credentials means saved undo still works.

### Verification matrix

| Layer | Required coverage |
| --- | --- |
| Pure matcher | Latin partial-word protection, punctuation, combining marks/surrogates, CJK literals/ambiguous short aliases, exact case, metacharacters treated literally, same-person nested longest match, distinct-person overlap rejection, adjacent matches and noncascading swaps |
| Analysis validation | Hallucinated aliases/counts, invalid or duplicated candidate keys, recurrence across cues, source-only ignores stored translations, empty results, response truncation/JSON/size limits, selected profile identity, missing credentials, cancellation and stale snapshot retains old report |
| Apply integration | Whole-batch revision/busy/report guards, invalid mapping and result length rollback, no-op retention, all fields one revision/transaction, unrelated time/style/text/output retention, source/translated staleness, no ASR/translation calls, emphasis pruning and context-review recheck |
| Undo integration | Unchanged apply then exact revert, later other-cue edit retained, later other-field edit retained, same-field conflict retained, deleted/new cue ID conflict, mixed safe/conflicting inversions, current revision guard, source staleness, minimal style CAS conflict, no provider requirement, latest-batch replacement and retry semantics |
| Persistence | Legacy optional fields absent, valid report/batch reload, corrupted/oversized metadata rejected by shared schema, restart undo and conflict results, profile/mode/material text changes invalidate report without destroying usable undo |
| Renderer | Recommendations populate inputs without applying; selection/count/context/edit/cancel; stale report disables apply with explanation; original-only hides translated column; no lost input during ordinary rerender; inspect conflict summary and accessible two-column panel at minimum window size |
| Native Electron | Real IPC + named mock HTTP fixture analysis, edit recommendation/apply, manually edit a distinct cue then undo, same-field conflict, cancel before apply, restart saved batch then undo, source-only request data/call counts, corrected standalone export and existing review/loop/manual CRUD regression |

## Related specs

- `.trellis/spec/shared/subtitle-contracts.md`: shared strict IPC, main-only provider keys, revision-checked edits, stable IDs/styles/export-history semantics.
- `.trellis/spec/shared/subtitle-review-reprocessing.md`: continuous operation ownership/cancellation, profile identity, context staleness, original-only no-translation rule and honest AI evidence claims.
- `.trellis/spec/backend/type-safety.md`: Zod-first strict inputs/outputs and explicit Result narrowing.
- `.trellis/spec/backend/api-module.md` and `database.md`: domain helpers/thin IPC and transaction publication.
- `.trellis/spec/frontend/ipc-electron.md`, `electron-browser-api-restrictions.md`, `components.md`: typed preload, no native alert/prompt/confirm, usable semantic forms and focus.

## External references

No external documentation or dependencies are required for this internal architecture research. Existing provider adapters and native test infrastructure are authoritative. Provider-specific context/token limits are not inferable from local profile fields; the one-shot child must define a conservative application budget and preserve provider errors/truncation without pretending to guarantee all-model capacity.

## Caveats / Not Found

- No names-analysis, name occurrence map, batch undo or field-edit history exists today. This is a new shared contract, service helper and UI feature, not an existing endpoint toggle.
- The ongoing loop worker is actively editing JobService/shared contracts. Line anchors were inspected on 2026-10-11 and may shift; sequence overlapping main/shared changes after reviewed loop and one-shot review contracts, then integrate UI once toolbar labels settle.
- Program grounding proves a literal appears in transcript, not that it is a real person's correct name or correct translation. AI recommendation remains user-reviewed and never auto-applied.
- Field CAS cannot reverse only one substring while preserving arbitrary later edits inside that same field; it reports the conflict and preserves the field. Deleted/re-recognized cues cannot be safely reconstructed by name undo.
- Exact cumulative budget, recurrence label, one-character CJK presentation, and terminal batch summary schema need to be fixed in final design; recommendations above are implementable without additional repository research or a new provider.
